/**
 * Smoke test OPT-IN de embeddings reales en navegador (Playwright + Chromium).
 *
 * A diferencia de `visual-qa.mjs` (que no descarga nada), este script recorre el
 * camino completo de producción: descarga el modelo ONNX del Hub, carga el
 * pipeline con `wasm.proxy`, genera un vector por fragmento desde la UI real
 * (Ajustes → «Reindexar contenido») y verifica que los vectores quedan en
 * `CrossedArts_Embeddings` con la dimensión efectiva (MRL) y norma L2 unitaria.
 *
 * Coste: ~280 MB de descarga y varias minutos de CPU (el modelo se ejecuta en
 * WASM, un solo hilo donde no hay `SharedArrayBuffer`). Por eso NO forma parte
 * de CI ni de `npm test`: se ejecuta a mano.
 *
 * Uso:
 *   npm run build                 # el script sirve `dist/`, no compila
 *   npm run qa:embeddings         # levanta su propio `vite preview` en un puerto libre
 *
 * Variables:
 *   QA_EMBEDDING_TIMEOUT_MS   tiempo máximo para descargar + indexar (por defecto 30 min)
 *   QA_BASE                   reutiliza un servidor ya levantado en vez de spawnear otro
 *
 * Códigos de salida: 0 correcto · 1 fallo de verificación · 2 precondición ausente.
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const EXIT_VERIFICATION = 1;
const EXIT_PRECONDITION = 2;
const INDEX_TIMEOUT_MS = Number(process.env.QA_EMBEDDING_TIMEOUT_MS || 30 * 60 * 1000);
/**
 * Presupuesto de bloqueo del hilo principal. Con `wasm.proxy` el forward pass
 * ocurre en el worker de ONNX Runtime; un pass de 300M parámetros ejecutado en
 * el hilo de la página bloquearía segundos.
 */
const MAX_MAIN_THREAD_BLOCK_MS = 1500;
/** Latido del hilo principal: periodo y umbral de “se quedó parado”. */
const HEARTBEAT_PERIOD_MS = 50;
const BLOCK_THRESHOLD_MS = 200;
/** Base de datos y almacén del vector cache (contrato de `localEmbeddings/cache.ts`). */
const EMBEDDINGS_DB = 'CrossedArts_Embeddings';
const EMBEDDINGS_STORE = 'vector_cache_v3';
/**
 * Consulta de recuperación y fragmento que DEBE quedar primero.
 *
 * La paráfrasis evita a propósito las palabras del corpus («atención», «foco»,
 * «tareas», «distracciones»): si sale la tarjeta correcta es porque el vector
 * de la consulta la puso ahí, no el emparejamiento léxico. Y es la respuesta
 * correcta de verdad: en la biblioteca de demostración, el único fragmento que
 * explica perder el hilo al cambiar de tarea es la tarjeta del «Drenaje de
 * Atención» (seedDemo `f2`, ligada a Deep Work).
 */
const RETRIEVAL_QUERY = '¿Cómo puedo enfocarme en una sola tarea durante horas sin perder el hilo?';
const RETRIEVAL_EXPECTED_SOURCE = 'drenaje de atención';

const problems = [];
const record = message => problems.push(message);

function failPrecondition(message) {
  console.error(`✗ ${message}`);
  process.exit(EXIT_PRECONDITION);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      /* reintentando */
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

/** Texto de la sección de índice semántico (progreso, error y recuento en caché). */
const SECTION_TEXT = () => {
  const heading = Array.from(document.querySelectorAll('h4')).find(node =>
    node.textContent?.includes('Índice semántico local')
  );
  return heading?.closest('div.space-y-3')?.parentElement?.innerText || '';
};

/**
 * Lee el vector cache persistido y valida el contrato de la caché: una entrada
 * por fragmento, dimensión efectiva declarada por el modelo, norma L2 unitaria
 * y provenance (`contentHash` + `pipelineVersion`) presente.
 */
async function inspectEmbeddingCache(page, expectedModelId) {
  return page.evaluate(
    async ({ dbName, storeName, modelId }) => {
      const entries = await new Promise((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve([]);
            return;
          }
          const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
          request.onsuccess = () => {
            db.close();
            resolve(request.result || []);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
      });

      const own = entries.filter(entry => entry && entry.modelId === modelId);
      const report = {
        totalEntries: entries.length,
        ownEntries: own.length,
        dimensions: null,
        unequalDimensions: 0,
        nonFinite: 0,
        nonUnitNorm: 0,
        missingHash: 0,
        missingPipelineVersion: 0
      };
      for (const entry of own) {
        const vector = Array.isArray(entry.vector) ? entry.vector : [];
        if (report.dimensions === null) report.dimensions = vector.length;
        else if (vector.length !== report.dimensions) report.unequalDimensions++;
        let sumSquares = 0;
        for (const value of vector) {
          if (!Number.isFinite(value)) report.nonFinite++;
          sumSquares += value * value;
        }
        if (Math.abs(Math.sqrt(sumSquares) - 1) > 1e-3) report.nonUnitNorm++;
        if (!entry.contentHash) report.missingHash++;
        if (!entry.pipelineVersion) report.missingPipelineVersion++;
      }
      return report;
    },
    { dbName: EMBEDDINGS_DB, storeName: EMBEDDINGS_STORE, modelId: expectedModelId }
  );
}

/**
 * Lanza una pregunta al tutor y devuelve el modo de recuperación y las citas
 * que la UI muestra, en orden.
 *
 * Se lee la UI real (la lista de «Fuentes recuperadas» del cajón) y no el
 * objeto de recuperación: lo que se verifica es la cita que una persona ve.
 */
async function askTutorAndReadCitations(page, query) {
  await page.getByRole('button', { name: 'Tutor IA' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Tutor pedagógico' });
  await drawer.waitFor({ timeout: 15000 });
  await drawer.locator('#ai-chat-input').fill(query);
  await drawer.getByRole('button', { name: 'Enviar mensaje' }).click();

  await page.waitForFunction(
    () => /Fuentes recuperadas:|Sin fuentes recuperadas/.test(document.body.innerText),
    undefined,
    { timeout: 180000 }
  );

  return page.evaluate(() => {
    const header = Array.from(document.querySelectorAll('span')).find(node =>
      /^(Fuentes recuperadas|Sin fuentes recuperadas)/.test((node.textContent || '').trim())
    );
    if (!header) return null;
    const block = header.closest('div');
    const items = Array.from(block.querySelectorAll('li')).map(li => {
      const text = li.innerText || '';
      const [title, ...rest] = text.split('Fuente:');
      return { title: title.trim(), source: rest.join('Fuente:').trim() };
    });
    // El distintivo de modo es su PROPIO span: buscar un sufijo en el texto de
    // cualquier span encontraba el contenedor («Fuentes recuperadas:⚡ Híbrido»).
    const modeNode = Array.from(block.querySelectorAll('span')).find(node =>
      /^(⚡\s*)?(Híbrido|Semántico|Léxico)$/.test((node.textContent || '').trim())
    );
    return {
      hasSources: (header.textContent || '').includes('recuperadas'),
      mode: modeNode ? modeNode.textContent.trim() : null,
      items
    };
  });
}

async function main() {
  if (!existsSync('dist/index.html')) {
    failPrecondition('falta `dist/`. Ejecuta `npm run build` antes de la QA de embeddings.');
  }

  let previewProcess = null;
  let baseUrl = process.env.QA_BASE || '';
  if (!baseUrl) {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`📡 Sirviendo dist/ en ${baseUrl}...`);
    previewProcess = spawn(
      'npx',
      ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: process.cwd(), stdio: 'ignore' }
    );
  }
  const stopPreview = () => {
    if (previewProcess) {
      try {
        previewProcess.kill('SIGTERM');
      } catch {
        /* ya terminado */
      }
    }
  };
  process.on('exit', stopPreview);
  process.on('SIGINT', () => {
    stopPreview();
    process.exit(130);
  });

  if (!(await waitForServer(baseUrl))) {
    stopPreview();
    failPrecondition(`ningún servidor responde en ${baseUrl}.`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES' });
  const page = await context.newPage();

  page.on('pageerror', err => record(`excepción de página: ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error' && !/favicon|Download the React DevTools/i.test(msg.text())) {
      record(`error de consola: ${msg.text().slice(0, 200)}`);
    }
  });
  const downloadOrigins = new Set();
  page.on('request', request => {
    const url = request.url();
    if (!/^https?:/i.test(url)) return;
    if (new URL(url).origin !== new URL(baseUrl).origin) downloadOrigins.add(new URL(url).origin);
  });
  // Latido del hilo principal: cada periodo se anota cuánto se retrasó. Es la
  // medida que importa aquí —si la inferencia corriera en la página, el latido
  // se pararía segundos— y funciona con `PerformanceObserver` desactivado.
  // Cada muestra lleva su fase ('boot' → 'load' → 'index') para poder atribuir
  // el bloqueo: arrancar la app o descargar/cargar 280 MB de modelo no es lo
  // mismo que inferir, y sólo la inferencia prueba que `wasm.proxy` funciona.
  await page.addInitScript(({ period }) => {
    window.__phase = 'boot';
    window.__heartbeatGaps = [];
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      window.__heartbeatGaps.push({ gap: Math.round(now - last - period), phase: window.__phase || 'boot' });
      last = now;
    }, period);
  }, { period: HEARTBEAT_PERIOD_MS });

  await page.goto(`${baseUrl}/#tab=settings`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByRole('heading', { name: 'Ajustes' }).waitFor({ timeout: 20000 });

  const modelSelect = page.locator('#embedding-model');
  await modelSelect.waitFor({ timeout: 10000 });
  const modelId = await modelSelect.inputValue();
  const declaredDimensions = await page.evaluate(() => {
    const match = document.body.innerText.match(/Dimensión vectorial:\s*(\d+)d/);
    return match ? Number(match[1]) : null;
  });
  console.log(`🧠 Modelo seleccionado: ${modelId}${declaredDimensions ? ` (${declaredDimensions}d)` : ''}`);

  const indexButton = page.getByRole('button', { name: /Reindexar contenido/ });
  await indexButton.waitFor({ timeout: 10000 });
  console.log('▶️  Pulsando «Reindexar contenido (avanzado)»...');
  const startedAt = Date.now();
  await indexButton.click();
  await page.evaluate(() => { window.__phase = 'load'; });

  // Fase de carga (descarga del modelo) vs fase de indexación: se reportan por
  // separado porque tienen costes de naturaleza distinta.
  let completed = null;
  let lastProgress = '';
  let errorText = '';
  let downloadMs = null;
  let lastChunk = 0;
  while (Date.now() - startedAt < INDEX_TIMEOUT_MS) {
    const section = await page.evaluate(SECTION_TEXT).catch(() => '');
    const complete = section.match(/Indexación completa:\s*(\d+)\s*fragmentos/);
    if (complete) {
      completed = Number(complete[1]);
      break;
    }
    const failure = section.match(/⚠️\s*(.+)/);
    if (failure) {
      errorText = failure[1].trim();
      break;
    }
    // Se prueban en orden de especificidad: el texto de la sección incluye el
    // rótulo del botón («Preparando…»), que no describe el avance real.
    const progressPatterns = [
      /Descargando artefacto ONNX: [^\n]+/,
      /Indexando fragmento \d+ de \d+/,
      /Extrayendo contenidos[^\n]*/,
      /Cargando motor[^\n]*/
    ];
    const current = progressPatterns.map(pattern => section.match(pattern)).find(Boolean);
    if (current && current[0] !== lastProgress) {
      lastProgress = current[0];
      const chunk = lastProgress.match(/fragmento (\d+)/);
      if (chunk) {
        lastChunk = Number(chunk[1]);
        if (downloadMs === null) {
          downloadMs = Date.now() - startedAt;
          await page.evaluate(() => { window.__phase = 'index'; }).catch(() => {});
        }
        if (lastChunk === 1 || lastChunk % 10 === 0) console.log(`   … ${lastProgress}`);
      } else {
        console.log(`   … ${lastProgress}`);
      }
    }
    await page.waitForTimeout(750);
  }
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  // Se lee AQUÍ: la recarga posterior reinstala el latido y borraría las muestras
  // justo del tramo que interesa medir.
  const heartbeat = await page.evaluate(() => (window.__heartbeatGaps || []).slice()).catch(() => []);
  if (downloadMs !== null) {
    console.log(`⏱️  Descarga + carga del pipeline: ${Math.round(downloadMs / 1000)}s · indexación: ${Math.round((Date.now() - startedAt - downloadMs) / 1000)}s`);
  }

  if (errorText) record(`la indexación falló en la UI: ${errorText}`);
  else if (completed === null) record(`sin confirmación de indexación tras ${elapsed}s (¿modelo inaccesible o demasiado lento?)`);
  else console.log(`✅ Indexación terminada en ${elapsed}s: ${completed} fragmentos.`);

  if (completed !== null) {
    const cache = await inspectEmbeddingCache(page, modelId);
    console.log(`🗄️  Vector cache: ${cache.ownEntries} entradas del modelo activo (${cache.totalEntries} en total)`);
    if (cache.ownEntries !== completed) {
      record(`la caché persistió ${cache.ownEntries} vectores pero la UI informó ${completed}`);
    }
    if (declaredDimensions !== null && cache.dimensions !== declaredDimensions) {
      record(`dimensión almacenada ${cache.dimensions}d ≠ dimensión efectiva declarada ${declaredDimensions}d`);
    }
    if (cache.unequalDimensions > 0) record(`${cache.unequalDimensions} vectores con dimensión distinta al resto`);
    if (cache.nonFinite > 0) record(`${cache.nonFinite} componentes no finitos en los vectores`);
    if (cache.nonUnitNorm > 0) record(`${cache.nonUnitNorm} vectores sin norma L2 unitaria`);
    if (cache.missingHash > 0) record(`${cache.missingHash} entradas sin contentHash (provenance)`);
    if (cache.missingPipelineVersion > 0) record(`${cache.missingPipelineVersion} entradas sin pipelineVersion`);

    // RECUPERACIÓN SEMÁNTICA REAL: se pregunta en ESTA sesión, con el modelo
    // cargado, porque en una página nueva el proveedor demo no calienta el
    // motor y la recuperación sería sólo léxica.
    console.log(`❓ Pregunta al tutor: «${RETRIEVAL_QUERY}»`);
    const retrieval = await askTutorAndReadCitations(page, RETRIEVAL_QUERY);
    if (!retrieval) {
      record('el tutor no mostró el bloque de fuentes recuperadas');
    } else {
      console.log(`🔎 Modo de recuperación: ${retrieval.mode || 'desconocido'}`);
      retrieval.items.forEach((item, index) =>
        console.log(`   ${index + 1}. ${item.title}${item.source ? ` — ${item.source}` : ''}`)
      );
      if (!retrieval.hasSources || retrieval.items.length === 0) {
        record(`la consulta «${RETRIEVAL_QUERY}» no recuperó ninguna fuente`);
      } else {
        const first = retrieval.items[0].title.toLowerCase();
        if (!first.includes(RETRIEVAL_EXPECTED_SOURCE)) {
          record(`la primera cita es «${retrieval.items[0].title}» y no el fragmento esperado («${RETRIEVAL_EXPECTED_SOURCE}»)`);
        }
        // Sin canal semántico el modo sería «Léxico»: la consulta no comparte
        // palabras con el texto del libro, así que acertar exige los vectores.
        if (!/(Híbrido|Semántico)/.test(retrieval.mode || '')) {
          record(`la recuperación quedó en modo «${retrieval.mode}»: la consulta no usó los vectores`);
        }
      }
    }

    // Persistencia real: recargar y comprobar que la caché sigue ahí.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Ajustes' }).waitFor({ timeout: 20000 });
    const cachedBadge = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/(\d+)\s*fragmentos en caché/);
      return match ? Number(match[1]) : null;
    });
    if (cachedBadge !== completed) {
      record(`tras recargar, el panel muestra ${cachedBadge ?? 'nada'} fragmentos en caché en vez de ${completed}`);
    } else {
      console.log(`✅ Persistencia: ${cachedBadge} fragmentos siguen en caché tras recargar.`);
    }
  }

  const summarize = phase => {
    const samples = heartbeat.filter(sample => sample.phase === phase).map(sample => sample.gap);
    if (samples.length === 0) return null;
    return { samples: samples.length, max: Math.max(...samples), slow: samples.filter(gap => gap > BLOCK_THRESHOLD_MS).length };
  };
  const bootPhase = summarize('boot');
  const loadPhase = summarize('load');
  const indexPhase = summarize('index');

  if (heartbeat.length === 0) {
    record('no se pudo medir el hilo principal: el latido no registró muestras');
  }
  console.log(
    `📊 Hilo principal por fase (máx / muestras > ${BLOCK_THRESHOLD_MS} ms / muestras): ` +
      `arranque ${bootPhase ? `${bootPhase.max} / ${bootPhase.slow} / ${bootPhase.samples}` : 'n/d'} · ` +
      `carga ${loadPhase ? `${loadPhase.max} / ${loadPhase.slow} / ${loadPhase.samples}` : 'n/d'} · ` +
      `inferencia ${indexPhase ? `${indexPhase.max} / ${indexPhase.slow} / ${indexPhase.samples}` : 'n/d'}`
  );
  // Sólo la inferencia es responsabilidad de `wasm.proxy`: arrancar la app y
  // cargar el modelo pueden bloquear (SQLite WASM, 280 MB de bytes al worker).
  if (indexPhase === null) {
    record('no hay muestras de la fase de inferencia: no se pudo verificar el hilo principal');
  } else if (indexPhase.max > MAX_MAIN_THREAD_BLOCK_MS) {
    record(
      `durante la inferencia el hilo principal se bloqueó ${indexPhase.max} ms: el forward pass no corre donde debería (wasm.proxy)`
    );
  }

  if (downloadOrigins.size > 0) {
    console.log(`🌐 Orígenes externos consultados (descarga del modelo): ${Array.from(downloadOrigins).join(', ')}`);
  }

  await browser.close();
  stopPreview();

  console.log('=== EMBEDDINGS QA REPORT ===');
  console.log(`modelo: ${modelId}`);
  console.log(`problemas: ${problems.length}`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  process.exit(problems.length > 0 ? EXIT_VERIFICATION : 0);
}

main().catch(error => {
  console.error('QA de embeddings falló:', error);
  process.exit(EXIT_VERIFICATION);
});
