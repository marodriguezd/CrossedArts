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
 *  - cambio de tema (claro/oscuro).
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

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 }
];

const problems = [];
const notes = [];
const record = (scope, message) => problems.push(`[${scope}] ${message}`);
const note = (scope, message) => notes.push(`[${scope}] ${message}`);

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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  const page = await context.newPage();

  page.on('pageerror', err => record('runtime', `excepción de página: ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error' && !/favicon|Download the React DevTools/i.test(msg.text())) {
      record('runtime', `error de consola: ${msg.text().slice(0, 160)}`);
    }
  });

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);

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
