/**
 * QA visual/responsivo programático (Playwright + Chromium headless).
 *
 * Recorre tres viewports (1280×800, 834×1112, 390×844) y comprueba, para cada
 * vista, propiedades OBJETIVAS del renderizado:
 *  - desbordamiento horizontal de página (scrollWidth vs viewport);
 *  - elementos que sobresalen del viewport sin un contenedor con scroll propio;
 *  - errores de consola / excepciones de página (fallo duro);
 *  - presencia de los encabezados y bloques clave de cada vista, incluida la
 *    navegación entre vistas (fallo duro si una vista principal no aparece);
 *  - apertura de la paleta (Ctrl+K) y del detalle de recurso / espacio de
 *    trabajo práctico;
 *  - cambio de tema (claro/oscuro);
 *  - smoke test del runtime ONNX local (`ort/`): glue servido con MIME de
 *    módulo, módulo evaluado e instantado en la página y en un realm de worker
 *    (el que usa `wasm.proxy`), sin una sola petición a un CDN;
 *  - ninguna petición a orígenes externos durante toda la ejecución.
 *
 * Los rótulos se comparan en minúsculas porque `innerText` devuelve el texto
 * RENDERIZADO y los estilos `type-micro` lo muestran en mayúsculas.
 *
 * La ruta de Biblioteca → detalle → espacio de trabajo depende de los datos de
 * demostración (seedDemo: libro `b1-deepwork`, trabajo práctico `pw3`), que se
 * siembran automáticamente en un perfil de navegador limpio.
 *
 * Uso:
 *   npm run preview -- --port 4173 --strictPort   (en una terminal)
 *   npm run qa:visual                             (en otra)
 *
 * Las capturas se guardan en /tmp/crossedarts-qa (no se versionan). Sale con
 * código distinto de cero si algún problema objetivo falla.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_URL || 'http://localhost:4173';
const SHOTS = process.env.QA_SHOTS || '/tmp/crossedarts-qa';
mkdirSync(SHOTS, { recursive: true });

/**
 * Artefactos del runtime ONNX que el build emite en `ort/` (espejo de
 * `src/lib/localEmbeddings/ortRuntime.ts`, que no se puede importar desde Node
 * sin compilar TypeScript; el test unitario valida la lista canónica).
 */
const ORT_ARTIFACTS = [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs'
];
/** Glue que ONNX Runtime `import()`a en el realm que ejecuta la inferencia. */
const ORT_GLUE = 'ort-wasm-simd-threaded.jsep.mjs';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 }
];

const problems = [];
const notes = [];
const externalRequests = new Set();
const record = (scope, message) => problems.push(`[${scope}] ${message}`);
const note = (scope, message) => notes.push(`[${scope}] ${message}`);

/**
 * El servidor de vista previa tiene que estar vivo antes de navegar: sin esto,
 * `goto` falla y cada vista reporta "falta el encabezado" en vez de la causa.
 */
async function assertServerReachable() {
  try {
    const response = await fetch(`${BASE}/index.html`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    console.error(
      `QA no puede alcanzar ${BASE} (${err?.message || err}).\n` +
        'Arranca el servidor de vista previa en otra terminal: npm run preview:qa'
    );
    process.exit(2);
  }
}

/**
 * Smoke test del runtime ONNX local en un navegador real.
 *
 * No descarga el modelo de embeddings (300 MB): verifica la parte que rompía
 * en producción, que es el hosting de los artefactos. ONNX Runtime recibe
 * `wasmPaths` como DIRECTORIO e `import()`a el glue en tiempo de ejecución
 * desde el realm que infiere; si el build no emite el `.mjs`, o el servidor no
 * lo entrega como módulo JS, la indexación semántica no arranca ni en el hilo
 * principal ni en el worker de `wasm.proxy`.
 */
async function checkOnnxRuntime(page, scope) {
  const artifacts = await page.evaluate(async files => {
    const base = new URL('ort/', document.baseURI).href;
    const results = [];
    for (const file of files) {
      try {
        const response = await fetch(base + file);
        results.push({
          file,
          status: response.status,
          type: response.headers.get('content-type') || '',
          bytes: (await response.arrayBuffer()).byteLength
        });
      } catch (err) {
        results.push({ file, status: 0, type: '', bytes: 0, error: String(err?.message || err) });
      }
    }
    return results;
  }, ORT_ARTIFACTS);

  for (const artifact of artifacts) {
    if (artifact.status !== 200) {
      record(scope, `${artifact.file} no se sirve (status ${artifact.status})`);
      continue;
    }
    if (artifact.bytes < 1000) record(scope, `${artifact.file} está vacío (${artifact.bytes} bytes)`);
    if (artifact.file.endsWith('.mjs') && !/javascript|ecmascript/i.test(artifact.type)) {
      // Un MIME que no sea JS hace que el `import()` del glue falle en runtime.
      record(scope, `${artifact.file} se sirve con content-type "${artifact.type}" en vez de JS`);
    }
  }

  // Hilo principal: el glue se evalúa y la instancia WASM se crea (compila el
  // `.wasm` y expone los HEAP que usa la sesión).
  const mainThread = await page.evaluate(async glue => {
    const url = new URL(`ort/${glue}`, document.baseURI).href;
    try {
      const module = await import(url);
      if (typeof module.default !== 'function') return { ok: false, error: 'el glue no exporta una factory' };
      const runtime = await module.default({ numThreads: 1 });
      return { ok: true, heap: typeof runtime?.HEAPU8 === 'object' };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, ORT_GLUE);
  if (!mainThread.ok) {
    record(scope, `el glue no arranca en el hilo principal: ${mainThread.error}`);
  } else if (!mainThread.heap) {
    record(scope, 'el glue arrancó sin memoria WASM (HEAPU8 ausente)');
  }

  // Realm de worker: `wasm.proxy` arranca la inferencia en un worker propio que
  // re-importa el mismo glue desde `ort/`. Se reproduce ese arranque sin modelo.
  const workerRealm = await page.evaluate(async glue => {
    const url = new URL(`ort/${glue}`, document.baseURI).href;
    const source = `
      self.onmessage = async () => {
        try {
          const module = await import(${JSON.stringify(url)});
          const runtime = await module.default({ numThreads: 1 });
          self.postMessage({ ok: true, heap: typeof runtime?.HEAPU8 === 'object' });
        } catch (err) {
          self.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
        }
      };
    `;
    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(blobUrl, { type: 'module' });
    return await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 25000);
      worker.onmessage = event => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.onerror = event => {
        clearTimeout(timer);
        resolve({ ok: false, error: `onerror: ${event.message}` });
      };
      worker.postMessage('go');
    });
  }, ORT_GLUE);
  if (!workerRealm.ok) {
    record(scope, `el glue no arranca en el realm del worker (wasm.proxy): ${workerRealm.error}`);
  } else if (!workerRealm.heap) {
    record(scope, 'el glue arrancó en el worker sin memoria WASM (HEAPU8 ausente)');
  }
}

async function detectOverflow(page) {
  return page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const offenders = [];
    const hasScrollableAncestor = (el) => {
      let node = el.parentElement;
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) return true;
        node = node.parentElement;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      if (offenders.length >= 8) break;
      const style = getComputedStyle(el);
      if (style.position === 'fixed') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const outside = rect.right > docWidth + 2 || rect.left < -2;
      if (outside && !hasScrollableAncestor(el)) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 90),
          left: Math.round(rect.left),
          right: Math.round(rect.right)
        });
      }
    }
    return { docWidth, scrollWidth, offenders };
  });
}

async function checkView(page, scope, { expectHeadings = [], screenshot = true }) {
  await page.waitForTimeout(450);
  const overflow = await detectOverflow(page);
  if (overflow.scrollWidth > overflow.docWidth + 2) {
    record(scope, `desbordamiento horizontal: scrollWidth=${overflow.scrollWidth} > viewport=${overflow.docWidth}`);
    for (const offender of overflow.offenders) {
      record(scope, `  elemento fuera: <${offender.tag} class="${offender.cls}"> right=${offender.right}`);
    }
  } else if (overflow.offenders.length > 0) {
    // Elementos fuera del viewport pero con contenedor con scroll: se anota, no falla.
    note(scope, `${overflow.offenders.length} elemento(s) dentro de contenedores con scroll propio`);
  }

  // `innerText` devuelve el texto RENDERIZADO, así que aplica `text-transform`
  // (los rótulos `type-micro` se ven en mayúsculas aunque el DOM use minúsculas).
  const text = (await page.evaluate(() => document.body.innerText)).toLocaleLowerCase('es');
  for (const heading of expectHeadings) {
    if (!text.includes(heading.toLocaleLowerCase('es'))) {
      record(scope, `falta el encabezado/bloque esperado: "${heading}"`);
    }
  }

  if (screenshot) {
    await page.screenshot({ path: `${SHOTS}/${scope.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: false });
  }
}

async function gotoTab(page, label) {
  // Landmark semántico del Shell: el mismo listado se reutiliza dentro del
  // cajón móvil, así que se elige el que esté visible en cada viewport.
  const sidebarItem = page
    .locator('nav[aria-label="Navegación principal"]')
    .getByRole('button', { name: label, exact: true })
    .first();
  let navigated = false;
  try {
    if (await sidebarItem.isVisible()) {
      await sidebarItem.click({ timeout: 4000 });
      navigated = true;
    }
  } catch {
    /* el elemento está oculto en este viewport */
  }

  if (!navigated) {
    const menu = page.getByRole('button', { name: 'Abrir navegación' }).first();
    if (await menu.count()) await menu.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page
      .getByRole('dialog', { name: 'Navegación' })
      .getByRole('button', { name: label, exact: true })
      .first()
      .click({ timeout: 4000 })
      .catch(() => {});
  }
  await page.waitForTimeout(350);
}

async function run() {
  await assertServerReachable();
  const browser = await chromium.launch({ headless: true });
  // Every expectation below asserts Spanish copy: pin the context locale so
  // the app resolves 'es' on any machine (local es-ES dev boxes and C-locale
  // CI runners alike) instead of inheriting the OS/browser language.
  const context = await browser.newContext({ viewport: VIEWPORTS[0], locale: 'es-ES' });
  const page = await context.newPage();

  page.on('pageerror', err => record('runtime', `excepción de página: ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error' && !/favicon|Download the React DevTools/i.test(msg.text())) {
      record('runtime', `error de consola: ${msg.text().slice(0, 160)}`);
    }
  });
  // Invariante de cero acceso a la web: nada se pide fuera del propio sitio.
  // `blob:`/`data:` no salen de la máquina, así que no cuentan como externos.
  page.on('request', request => {
    const url = request.url();
    if (!/^https?:/i.test(url)) return;
    if (new URL(url).origin !== new URL(BASE).origin) externalRequests.add(url);
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // Si la aplicación arranca en limpio (comportamiento por defecto para nuevos usuarios),
  // cargamos el entorno demo completo a través del selector de demos para que las comprobaciones
  // visuales de las vistas dependientes de contenido (libros, lecciones, espacio de trabajo)
  // puedan renderizarse y comprobarse de extremo a extremo.
  const exploreDemoBtn = page.locator('button', { hasText: 'Explorar versiones demo' }).first();
  if ((await exploreDemoBtn.count()) && (await exploreDemoBtn.isVisible())) {
    await exploreDemoBtn.click();
    await page.waitForTimeout(600);
    const loadButtons = page.locator('button', { hasText: 'Cargar esta versión' });
    if (await loadButtons.count()) {
      await loadButtons.first().click();
      await page.waitForTimeout(2000);
    }
  }

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(400);
    const vp = viewport.name;

    // 1. Dashboard
    await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1200);
    await checkView(page, `${vp}-dashboard`, { expectHeadings: ['Dashboard', 'Continúa aprendizaje', 'Accesos rápidos'] });

    // 2. Hoy / Focus
    await gotoTab(page, 'Hoy');
    await checkView(page, `${vp}-focus`, { expectHeadings: ['Hoy', 'Qué hacer ahora', 'Estudiado recientemente'] });

    // 3. Metas
    await gotoTab(page, 'Metas');
    await checkView(page, `${vp}-goals`, { expectHeadings: ['Metas', 'Nueva meta'] });

    // 4. Análisis
    await gotoTab(page, 'Análisis');
    await checkView(page, `${vp}-analytics`, { expectHeadings: ['Análisis', 'Evolución diaria', 'Actividad por recurso'] });

    // 5. Biblioteca + detalle de recurso (espacio de trabajo práctico)
    await gotoTab(page, 'Biblioteca');
    await checkView(page, `${vp}-library`, {
      expectHeadings: ['Biblioteca', 'Explora y organiza todos tus recursos de aprendizaje.']
    });
    // El título de un libro abre su detalle (Espacio de trabajo del recurso).
    const bookButton = page.locator('button[aria-label*="Deep Work"]').first();
    if (await bookButton.count()) {
      await bookButton.scrollIntoViewIfNeeded().catch(() => {});
      await bookButton.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(900);
      await checkView(page, `${vp}-resource-detail`, { expectHeadings: ['Espacio de trabajo práctico'] });
      const workButton = page.locator('button', { hasText: 'Trabajar' }).first();
      if (await workButton.count()) {
        await workButton.scrollIntoViewIfNeeded().catch(() => {});
        await workButton.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        await checkView(page, `${vp}-practice-workspace`, {
          expectHeadings: ['Contexto de aprendizaje', 'Lista de verificación', 'Vista previa']
        });
      } else {
        record(`${vp}-practice-workspace`, 'no se encontró el botón "Trabajar" de un trabajo práctico');
      }
    } else {
      record(`${vp}-resource-detail`, 'no se pudo abrir el detalle del libro Deep Work');
    }

    // 6. Grafo + estadísticas
    await gotoTab(page, 'Grafo');
    await page.waitForTimeout(2500);
    await checkView(page, `${vp}-graph`, { expectHeadings: ['Grafo', 'Añadir conexión'] });
    const statsButton = page.locator('button', { hasText: 'Estadísticas' }).first();
    if (await statsButton.count()) {
      await statsButton.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      await checkView(page, `${vp}-graph-analytics`, {
        expectHeadings: ['Estadísticas del grafo', 'Más conectados', 'Lectura del grafo']
      });
    } else {
      record(`${vp}-graph-analytics`, 'no se encontró el botón de Estadísticas');
    }

    // 7. Paleta de comandos (Ctrl+K)
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);
    const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
    if (!(await palette.count())) record(`${vp}-palette`, 'Ctrl+K no abrió la paleta');
    else {
      await checkView(page, `${vp}-palette`, { expectHeadings: [] });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // 8. Tema oscuro
    // El botón existe y es único por su nombre accesible («Cambiar al tema
    // oscuro/claro»): si el click no cambia el tema, es un fallo real, no una
    // ausencia opcional.
    const themeToggle = page.getByRole('button', { name: /tema/i }).first();
    if (await themeToggle.count()) {
      await themeToggle.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(500);
      const isDark = await page.evaluate(() => document.documentElement.dataset.theme === 'dark');
      if (!isDark) record(`${vp}-theme`, 'el botón de tema no cambió data-theme a dark');
      await checkView(page, `${vp}-dark-dashboard`, { expectHeadings: [], screenshot: true });
      await themeToggle.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(300);
    } else {
      record(`${vp}-theme`, 'no se encontró el botón de tema');
    }
  }

  // 9. Enlaces profundos y foco del cajón móvil (comprobaciones de
  // comportamiento real, no de código fuente).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE}/#tab=focus`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  const hoyText = await page.evaluate(() => document.body.innerText).then(t => t.toLocaleLowerCase('es'));
  if (!hoyText.includes('qué hacer ahora')) {
    record('deep-link-hoy', 'refrescar/abrir #tab=focus no restaura la vista Hoy');
  }
  await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  const hoyReload = await page.evaluate(() => document.body.innerText).then(t => t.toLocaleLowerCase('es'));
  if (!hoyReload.includes('qué hacer ahora')) {
    record('deep-link-hoy', 'recargar en la vista Hoy no la restaura (debería conservarse en #tab=focus)');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  const navTrigger = page.getByRole('button', { name: 'Abrir navegación' }).first();
  if (await navTrigger.count()) {
    await navTrigger.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const returnedTo = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.getAttribute('aria-label') : null;
    });
    if (returnedTo !== 'Abrir navegación') {
      record('drawer-focus', `al cerrar el cajón el foco volvió a "${returnedTo}" en vez del disparador`);
    }
  } else {
    record('drawer-focus', 'no se encontró el disparador del cajón móvil');
  }

  // 10. Runtime ONNX local (glue + WASM + realm del proxy) en navegador real.
  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  await checkOnnxRuntime(page, 'onnx-runtime');

  for (const url of externalRequests) record('offline', `petición a un origen externo: ${url}`);

  await browser.close();

  console.log('=== VISUAL QA REPORT ===');
  console.log(`capturas: ${SHOTS}`);
  console.log(`problemas: ${problems.length}`);
  for (const problem of problems) console.log('  ✗ ' + problem);
  console.log(`notas: ${notes.length}`);
  for (const item of notes) console.log('  · ' + item);
  process.exit(problems.length > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('QA falló:', err);
  process.exit(2);
});
