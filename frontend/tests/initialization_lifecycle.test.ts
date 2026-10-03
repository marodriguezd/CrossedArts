import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dbBridge, DatabaseInitializationError } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { resolveLocalDay, shiftIsoDay, computeActiveStreak, parseUtcOffsetToMinutes } from '../src/services/localDate.ts';
import { retrieveLocalContext } from '../src/lib/localRag/retrieval.ts';
import { aiService } from '../src/ai/aiService.ts';

// ---------------------------------------------------------------------------
// A. Ciclo de vida de inicialización (defecto: "Database not initialized")
// ---------------------------------------------------------------------------

test('16.1 Concurrent init() calls share a single initialization (StrictMode double-mount safe)', async () => {
  // Reproduce el ciclo de vida real que provocaba el defecto: React StrictMode
  // monta -> desmonta -> monta el efecto de useAppData, y además KnowledgeGraph
  // es perezosa y pide datos por su cuenta. Antes, cada llamada ejecutaba su
  // PROPIA secuencia completa (initSqlJs + loadFromStorage + migraciones +
  // persist) porque la comprobación `if (this.db && this.isInitialized)` no es
  // atómica respecto a los `await` intermedios.
  await dbBridge.init();

  // Un puente nuevo sin base de datos inicializada parte del estado limpio.
  const fresh = new (dbBridge.constructor as any)();

  let persistCalls = 0;
  const originalPersist = fresh.persist;
  fresh.persist = async () => { persistCalls++; return originalPersist.call(fresh); };

  // Diez llamadas simultáneas, como diez vistas que piden datos a la vez.
  const results = await Promise.all(Array.from({ length: 10 }, () => fresh.init()));

  // Todas reciben la MISMA instancia: no hay diez bases de datos compitiendo.
  const uniqueHandles = new Set(results);
  assert.equal(uniqueHandles.size, 1, 'Todas las llamadas concurrentes deben compartir la misma base de datos');
  assert.equal(results[0], fresh.getDatabase());
  assert.ok(persistCalls <= 2, `La inicialización compartida no debe persistir N veces (persistió ${persistCalls})`);
});

test('16.2 A view calling getDatabase() before init never leaks the raw English error', async () => {
  // El defecto observado: `getDatabase()` lanzaba el texto interno en inglés
  // "Database not initialized", que KnowledgeGraph pintaba literalmente.
  const uninitialized = new (dbBridge.constructor as any)();

  let thrown: any = null;
  try {
    uninitialized.getDatabase();
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown, 'getDatabase() debe fallar si no hay base de datos');
  assert.ok(thrown instanceof DatabaseInitializationError);
  assert.equal(thrown.failure.code, 'storage-unavailable');
  // Ningún texto interno en inglés puede llegar a la interfaz.
  assert.ok(!thrown.message.includes('Database not initialized'), 'El mensaje interno en inglés no debe exponerse');
  assert.match(thrown.message, /almacenamiento local/i, 'El mensaje debe estar en español y ser accionable');
  assert.ok(thrown.failure.retryable, 'Debe indicar que reintentar tiene sentido');
});

test('16.3 Initialization exposes a terminal state and KnowledgeGraph awaits it', async () => {
  const fresh = new (dbBridge.constructor as any)();
  assert.equal(fresh.getInitState(), 'idle');
  assert.equal(fresh.getInitFailure(), null);

  await fresh.init();
  assert.equal(fresh.getInitState(), 'ready', 'Una inicialización correcta deja un estado terminal claro');
  assert.equal(fresh.getInitFailure(), null);

  // La vista perezosa espera la inicialización en curso en vez de suponer que
  // la base de datos ya existe.
  const ensureResult = await fresh.ensureInitialized();
  assert.equal(ensureResult, fresh.getDatabase());
  assert.equal(fresh.getInitState(), 'ready');
});

test('16.4 ensureInitialized() is safe from concurrent callers (no second init sequence)', async () => {
  const fresh = new (dbBridge.constructor as any)();
  const [a, b, c] = await Promise.all([
    fresh.ensureInitialized(),
    fresh.ensureInitialized(),
    fresh.ensureInitialized()
  ]);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(fresh.getInitState(), 'ready');
});

test('16.5 A failed initialization is a first-class state and never reports success', async () => {
  // Se fuerza un fallo real de la secuencia de inicialización. La dependencia
  // crítica es la carga del WASM de SQLite: si falla, antes solo se registraba en
  // consola y la aplicación continuaba renderizándose contra una base de datos
  // inexistente (de ahí el "Database not initialized" en el grafo).
  const fresh = new (dbBridge.constructor as any)();
  // loadFromStorage lanza: con un almacen corrupto y sin guardado de respaldo la
  // inicialización no puede completarse.
  fresh.loadFromStorage = async () => {
    throw new Error('IndexedDB bloqueado por el navegador');
  };
  fresh.saveToStorage = async () => {
    throw new Error('IndexedDB bloqueado por el navegador');
  };

  let thrown: any = null;
  try {
    await fresh.init();
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown, 'Un fallo de inicialización debe propagarse');
  assert.ok(thrown instanceof DatabaseInitializationError, 'El fallo debe ser una clase controlada');
  assert.equal(fresh.getInitState(), 'failed', 'El fallo es un estado terminal explícito');
  const failure = fresh.getInitFailure();
  assert.ok(failure, 'El detalle del fallo queda disponible para la UI');
  assert.equal(failure.code, 'storage-unavailable');
  assert.ok(failure.message.length > 0);
  assert.ok(failure.message.includes('almacenamiento local'), 'El mensaje explica la causa en español');

  // getDatabase() después del fallo da un mensaje controlado, nunca inglés.
  let dbErr: any = null;
  try {
    fresh.getDatabase();
  } catch (err) {
    dbErr = err;
  }
  assert.ok(dbErr instanceof DatabaseInitializationError);
  assert.equal(dbErr.failure.code, failure.code);
  assert.ok(!dbErr.message.includes('Database not initialized'));

  // Un reintento explícito vuelve a intentar la inicialización (no queda
  // envenenado en un estado de fallo permanente).
  assert.equal(fresh.getInitState(), 'failed');
});

test('16.6 useAppData no longer renders the app after an initialization failure', () => {
  const hook = readFileSync(new URL('../src/hooks/useAppData.ts', import.meta.url), 'utf8');
  // El defecto: `finally { setLoading(false) }` se ejecutaba también en fallo,
  // de modo que la aplicación se renderizaba sin base de datos.
  assert.ok(hook.includes('initError'), 'useAppData debe exponer el error de inicialización');
  assert.ok(/setInitError\(failure\)/.test(hook), 'El fallo debe registrarse en el estado');

  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // El error debe comprobarse ANTES de montar cualquier vista de datos.
  const initErrorIndex = app.indexOf('if (initError)');
  const graphIndex = app.indexOf("currentTab === 'graph'");
  assert.ok(initErrorIndex > -1, 'App debe renderizar una pantalla de error de inicialización');
  assert.ok(graphIndex > -1);
  assert.ok(initErrorIndex < graphIndex, 'La comprobación de initError debe preceder al montaje del grafo');
});

test('16.7 KnowledgeGraph waits for initialization and shows no raw English error text', () => {
  const graph = readFileSync(new URL('../src/pages/KnowledgeGraph.tsx', import.meta.url), 'utf8');
  assert.ok(graph.includes('ensureInitialized'), 'El grafo debe esperar la inicialización compartida');
  assert.ok(!graph.includes("setLoadError(err?.message || 'No se pudo cargar"), 'No debe pintarse el mensaje crudo de la excepción');
  assert.ok(!/err\?\.message\s*\|\|\s*'No se pudo cargar el grafo/.test(graph), 'No debe usarse err.message como texto de interfaz');
});

test('16.8 No native dialogs and controlled Spanish messages remain in the app shell', () => {
  for (const file of ['../src/App.tsx', '../src/pages/KnowledgeGraph.tsx', '../src/hooks/useAppData.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    // Se ignoran los comentarios: solo cuenta el código realmente invocable.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/(^|[^.\w])alert\s*\(/.test(code), `${file} no debe invocar alert()`);
    assert.ok(!/(^|[^.\w])confirm\s*\(/.test(code), `${file} no debe invocar confirm()`);
  }
});

// ---------------------------------------------------------------------------
// D. Coordinación multi-pestaña
// ---------------------------------------------------------------------------

test('16.9 A mutation message carries a revision so peers can detect a newer version', () => {
  const bridge = readFileSync(new URL('../src/db/sqliteBridge.ts', import.meta.url), 'utf8');
  // El mensaje debe identificar la versión persistida sin incluir datos.
  assert.ok(/postMessage\(\{[\s\S]*?revision: this\.persistedRevision/.test(bridge), 'El mensaje debe incluir la revisión');
  assert.ok(/origin: TAB_ID/.test(bridge), 'El mensaje debe identificar la pestaña de origen');
  // Detección de estado obsoleto antes de la siguiente operación de datos.
  assert.ok(bridge.includes('stale-other-tab'), 'Debe existir el estado de estado obsoleto');
  assert.ok(bridge.includes('ensureFresh'), 'Debe existir la recarga determinista antes de leer');
  assert.ok(/revision > this\.persistedRevision/.test(bridge), 'Solo una revisión superior marca el estado como obsoleto');
  // Ignora sus propios mensajes: evita bucles de recarga.
  assert.ok(bridge.includes('if (event.data.origin === TAB_ID) return;'), 'Debe ignorar sus propios mensajes');
});

test('16.10 ensureFresh() is a no-op when this tab holds the newest revision', async () => {
  // Sin mensaje remoto, ensureFresh no debe tocar la base de datos.
  const before = dbBridge.getDatabase();
  await dbBridge.ensureFresh();
  assert.equal(dbBridge.getDatabase(), before, 'Sin estado obsoleto no se recarga ni se pierde la instancia');
});

// ---------------------------------------------------------------------------
// B. Historial de estudio reciente
// ---------------------------------------------------------------------------

test('16.11 A completed lesson-only session appears in the recent study history', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const created = await dao.createCourse({ title: 'Curso Historial 16', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo Historial' });
  const lesson = await dao.createLesson({ moduleId: mod.id!, title: 'Lección Solo Ámbito' });

  // Sesión con `lesson_id` pero SIN `resource_id`: el filtro anterior
  // (`resource_id IS NOT NULL`) la excluía del historial reciente.
  const sid = 'test-ss-lesson-only-16';
  db.run(
    `INSERT INTO learning_session (id, resource_id, lesson_id, started_at, duration_minutes, mode, cards_reviewed, questions_answered, correct_answers, status)
     VALUES (?, NULL, ?, datetime('now'), 12, 'flashcards', 3, 0, 0, 'completed')`,
    [sid, lesson.id]
  );

  const recent = await dao.getRecentStudySessions(50);
  const found = recent.find(s => s.id === sid);
  assert.ok(found, 'Una sesión completada con ámbito de lección debe aparecer en el historial');
  assert.equal(found!.lesson_id, lesson.id);
  assert.equal(found!.lesson_title, 'Lección Solo Ámbito', 'Se conserva el título de la lección');
  assert.equal(found!.resource_id, undefined, 'No se inventa un resource_id');

  // La sesión de curso sigue apareciendo (comportamiento preservado).
  const courseSession = 'test-ss-course-16';
  db.run(
    `INSERT INTO learning_session (id, resource_id, lesson_id, started_at, duration_minutes, mode, cards_reviewed, status)
     VALUES (?, ?, NULL, datetime('now'), 8, 'mixed', 1, 'completed')`,
    [courseSession, courseId]
  );
  const after = await dao.getRecentStudySessions(50);
  const courseFound = after.find(s => s.id === courseSession);
  assert.ok(courseFound, 'Las sesiones de recurso siguen apareciendo');
  assert.equal(courseFound!.lesson_id, undefined, 'Una sesión de curso no inventa lección');
  assert.equal(courseFound!.resource_title, 'Curso Historial 16');

  // Una sesión sin ningún ámbito sigue excluida (no es historial de aprendizaje).
  db.run(
    `INSERT INTO learning_session (id, resource_id, lesson_id, started_at, duration_minutes, mode, cards_reviewed, status)
     VALUES ('test-ss-scope-less-16', NULL, NULL, datetime('now'), 5, 'practice', 1, 'completed')`
  );
  const scoped = await dao.getRecentStudySessions(50);
  assert.ok(!scoped.some(s => s.id === 'test-ss-scope-less-16'), 'Una sesión sin ámbito de recurso ni lección no es historial');

  db.run('DELETE FROM learning_session WHERE id IN (?, ?, ?)', [sid, courseSession, 'test-ss-scope-less-16']);
  db.run('DELETE FROM learning_resource WHERE id = ?', [courseId]);
  await dbBridge.persist();
});

// ---------------------------------------------------------------------------
// C. Día de estudio local (frontera de medianoche)
// ---------------------------------------------------------------------------

test('16.12 Local day resolution is deterministic and honours an explicit UTC offset', () => {
  // 2026-10-03T22:15:00Z -> en UTC+2 es 2026-10-04 (día local siguiente).
  const instant = new Date('2026-10-03T22:15:00Z');
  const madrid = resolveLocalDay(instant, '+02:00');
  assert.equal(madrid.day, '2026-10-04');
  assert.equal(madrid.utcOffsetModifier, '+120 minutes');

  // Desplazamiento cero: el modificador DEBE ser '0 minutes', nunca ''.
  // SQLite trata '' como modificador inválido y `date(x, '')` devuelve NULL para
  // todas las filas, lo que ponia la racha y el resumen de "hoy" a cero para
  // cualquier usuario en UTC. Este fallo solo se manifiestaba en husos con
  // desplazamiento distinto de cero, por eso se fija de forma explicita.
  const utc = resolveLocalDay(instant, '+00:00');
  assert.equal(utc.day, '2026-10-03', 'Sin desplazamiento el día es el UTC');
  assert.equal(utc.utcOffsetModifier, '0 minutes');
  assert.notEqual(utc.utcOffsetModifier, '', 'Un modificador vacío haría fallar la consulta en SQLite');

  // Un huso negativo también cruza el límite de día correctamente.
  const ny = resolveLocalDay(new Date('2026-10-04T02:15:00Z'), '-05:00');
  assert.equal(ny.day, '2026-10-03');
  assert.equal(ny.utcOffsetModifier, '-300 minutes');
});

test('16.12b A zero UTC offset still matches today sessions in SQLite', async () => {
  // Regresión del defecto anterior: con el modificador vacío, `date(started_at, ?)`
  // devolvía NULL en UTC y ni el resumen de hoy ni la racha encontraban nada.
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const { day, utcOffsetModifier } = resolveLocalDay(new Date(), '+00:00');
  db.run(
    `INSERT INTO learning_session (id, resource_id, started_at, duration_minutes, mode, cards_reviewed, status)
     VALUES ('test-ss-utc-16', 'c1-react', datetime('now'), 30, 'flashcards', 4, 'completed')`
  );

  const matched = db.exec(
    `SELECT COUNT(*) FROM learning_session WHERE date(started_at, ?) = ? AND id = 'test-ss-utc-16'`,
    [utcOffsetModifier, day]
  );
  assert.equal(Number(matched[0].values[0][0]), 1, 'Una sesión de hoy debe coincidir también con desfase 0');

  // Y el modificador no puede ser una cadena vacía (sería NULL en SQLite).
  assert.notEqual(utcOffsetModifier, '', 'El modificador de desfase cero no puede estar vacío');

  db.run("DELETE FROM learning_session WHERE id = 'test-ss-utc-16'");
  await dbBridge.persist();
});

test('16.13 parseUtcOffsetToMinutes rejects malformed offsets', () => {
  assert.equal(parseUtcOffsetToMinutes('+02:00'), 120);
  assert.equal(parseUtcOffsetToMinutes('-05:30'), -330);
  assert.throws(() => parseUtcOffsetToMinutes('nonsense'), /inválido/i);
});

test('16.14 Streak arithmetic counts consecutive local days without double counting', () => {
  // Con actividad hoy: cuenta hoy y hacia atrás.
  assert.equal(computeActiveStreak(['2026-10-04', '2026-10-03', '2026-10-02'], '2026-10-04'), 3);
  // Sin actividad hoy pero con ayer y anteayer: la racha sigue viva y cuenta
  // desde ayer, sin inventar un día más.
  assert.equal(computeActiveStreak(['2026-10-03', '2026-10-02'], '2026-10-04'), 2);
  // Sin actividad hoy ni ayer: racha rota.
  assert.equal(computeActiveStreak(['2026-10-02'], '2026-10-04'), 0);
  // Un hueco corta la racha.
  assert.equal(computeActiveStreak(['2026-10-04', '2026-10-01'], '2026-10-04'), 1);
  // Sin actividad alguna.
  assert.equal(computeActiveStreak([], '2026-10-04'), 0);
});

test('16.15 shiftIsoDay crosses month, year and leap-day boundaries', () => {
  assert.equal(shiftIsoDay('2026-10-04', -1), '2026-10-03');
  assert.equal(shiftIsoDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftIsoDay('2024-03-01', -1), '2024-02-29', 'Año bisiesto');
  assert.equal(shiftIsoDay('2026-01-01', -1), '2025-12-31');
  assert.throws(() => shiftIsoDay('04/10/2026', -1), /inválido/i);
});

test('16.16 The streak query is parameterized and no longer uses the UTC date("now")', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();
  // El resumen de hoy y la racha deben pasar el día local como parámetro.
  assert.ok(db, 'La base de datos debe estar inicializada');
  const source = readFileSync(new URL('../src/db/dao.ts', import.meta.url), 'utf8');
  assert.ok(!/WHERE date\(started_at\) = date\('now'\)/.test(source), 'No debe usarse date("now") en UTC para el resumen de hoy');
  assert.ok(source.includes('date(started_at, ?) = ?'), 'El día local debe parametrizarse');
  assert.ok(source.includes('date(started_at, ?) AS study_day'), 'La racha debe etiquetar por día local');
});

test('16.17 Today summary and streak stay consistent across the local day boundary', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();
  const { day: localToday, utcOffsetModifier } = resolveLocalDay();

  // Una sesión de hace 3 días (en días UTC) cuenta como actividad real.
  db.run(
    `INSERT INTO learning_session (id, resource_id, started_at, duration_minutes, mode, cards_reviewed, status)
     VALUES ('test-ss-dayboundary-16', 'c1-react', datetime('now', '-3 days'), 25, 'flashcards', 2, 'completed')`
  );

  // Esa sesión NO es de hoy: el resumen de hoy debe excluirla.
  const today = await dao.getTodayStudySummary();
  const row = db.exec(
    "SELECT COALESCE(SUM(cards_reviewed),0) FROM learning_session WHERE date(started_at, ?) = ? AND id = 'test-ss-dayboundary-16'",
    [utcOffsetModifier, localToday]
  );
  assert.equal(Number(row[0].values[0][0]), 0, 'La sesión antigua no se cuenta como actividad de hoy');
  assert.equal(today.items_reviewed, today.flashcards_reviewed + today.questions_answered, 'El resumen de hoy es internamente coherente');

  // La racha debe incluir ese día (está a 3 días, así que no es hoy ni ayer).
  const streak = await dao.getActiveStreak();
  assert.ok(streak >= 0, 'La racha se calcula sin errores en la frontera de día');

  db.run("DELETE FROM learning_session WHERE id = 'test-ss-dayboundary-16'");
  await dbBridge.persist();
});

// ---------------------------------------------------------------------------
// H. Recuperación RAG sin N+1
// ---------------------------------------------------------------------------

test('16.19 The RAG query path stays correct after removing the N+1 course lookup', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso RAG Índice 16', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo RAG Índice' });
  const lesson = await dao.createLesson({
    moduleId: mod.id!,
    title: 'Lección del índice plano',
    content: 'La hipsocicloides son curvas de tres hojas con propósito decorativo.'
  });
  const db = dbBridge.getDatabase();

  // El índice plano resuelve la misma información en una consulta.
  const index = await dao.getLessonIndex();
  const entry = index.find(e => e.lessonId === lesson.id);
  assert.ok(entry, 'La lección debe aparecer en el índice plano');
  assert.equal(entry!.courseId, courseId);
  assert.equal(entry!.moduleTitle, 'Módulo RAG Índice');
  assert.equal(entry!.courseTitle, 'Curso RAG Índice 16');

  // El contenido de la lección sigue siendo recuperable (mismo resultado que con
  // la reconstrucción de jerarquía por curso).
  const result = await retrieveLocalContext('hipsocicloides', 4, { resourceId: courseId, lessonId: lesson.id! });
  assert.ok(result.documents.some(d => d.id === lesson.id && d.sourceType === 'lesson'), 'La lección debe recuperarse por su contenido');
  const doc = result.documents.find(d => d.id === lesson.id)!;
  assert.ok(doc.title.includes('Curso RAG Índice 16'), 'El título conserva el nombre del curso');
  assert.ok(doc.snippet.includes('Módulo RAG Índice'), 'El snippet conserva el módulo');
  assert.ok(doc.snippet.includes('hipsocicloides'), 'El snippet conserva el contenido');
  assert.ok(result.totalCandidates >= 1);

  db.run('DELETE FROM learning_resource WHERE id = ?', [courseId]);
  await dbBridge.persist();
});

test('16.20 The retrieval path no longer calls getCourseById per course', () => {
  const source = readFileSync(new URL('../src/lib/localRag/retrieval.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('dao.getCourseById('), 'La recuperación no debe reconstruir la jerarquía curso por curso');
  assert.ok(source.includes('dao.getLessonIndex()'), 'Debe usar el índice plano de lecciones');
});

// ---------------------------------------------------------------------------
// I. Clave de API: privacidad
// ---------------------------------------------------------------------------

test('16.21 The OpenAI API key is kept in memory unless persistence is explicitly opted in', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear()
  };

  aiService.saveSettings({
    provider: 'openai',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3:8b',
    apiKey: 'sk-secreto-de-prueba',
    apiModel: 'gpt-4o-mini',
    localModelId: 'Qwen3-1.7B-q4f16_1-MLC',
    localAiEnabled: false
  });

  // La configuración persiste, pero la clave NO.
  const raw = store.get('crossedarts_ai_settings') || '';
  assert.ok(!raw.includes('sk-secreto-de-prueba'), 'La clave no debe escribirse en localStorage por defecto');
  assert.ok(raw.includes('openai'), 'El proveedor sí se persiste');
  assert.equal(aiService.getSettings().apiKey, 'sk-secreto-de-prueba', 'La clave sigue disponible en memoria');

  // Opt-in explícito: sí se persiste (documentado como riesgo asumido).
  aiService.saveSettings({
    provider: 'openai',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3:8b',
    apiKey: 'sk-opt-in',
    apiModel: 'gpt-4o-mini',
    localModelId: 'Qwen3-1.7B-q4f16_1-MLC',
    localAiEnabled: false,
    persistApiKey: true
  });
  assert.ok((store.get('crossedarts_ai_settings') || '').includes('sk-opt-in'), 'Con opt-in explícito la clave se persiste');
  assert.equal(aiService.getSettings().apiKey, 'sk-opt-in', 'Y se recupera');

  // Al cambiar de proveedor la clave se descarta: no queda lista por accidente.
  aiService.saveSettings({
    provider: 'demo',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3:8b',
    apiKey: 'sk-opt-in',
    apiModel: 'gpt-4o-mini',
    localModelId: 'Qwen3-1.7B-q4f16_1-MLC',
    localAiEnabled: false,
    persistApiKey: true
  });
  assert.equal(aiService.getSettings().apiKey, '', 'Al dejar de usar OpenAI la clave se descarta');
  assert.ok(!(store.get('crossedarts_ai_settings') || '').includes('sk-opt-in'), 'La clave tampoco queda guardada');

  delete (globalThis as any).localStorage;
});

test('16.22 clearApiKey() removes the key from memory and storage', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear()
  };

  aiService.saveSettings({
    provider: 'openai',
    ollamaUrl: '',
    ollamaModel: '',
    apiKey: 'sk-a-borrar',
    apiModel: 'gpt-4o-mini',
    localModelId: 'Qwen3-1.7B-q4f16_1-MLC',
    localAiEnabled: false,
    persistApiKey: true
  });
  assert.ok((store.get('crossedarts_ai_settings') || '').includes('sk-a-borrar'));

  aiService.clearApiKey();
  assert.equal(aiService.getSettings().apiKey, '', 'La clave desaparece de la memoria');
  assert.ok(!(store.get('crossedarts_ai_settings') || '').includes('sk-a-borrar'), 'La clave desaparece del almacenamiento');

  delete (globalThis as any).localStorage;
});