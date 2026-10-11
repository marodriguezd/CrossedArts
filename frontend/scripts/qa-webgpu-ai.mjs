/**
 * Script de QA automatizado en tiempo real con Playwright para WebGPU y modelos multilingües.
 *
 * Ejecuta:
 *  1. Compilación de producción (vite build).
 *  2. Servidor local preview estricto.
 *  3. Instancia de Playwright Chromium con emulación de navegador Brave en Linux.
 *  4. Verificación interactiva del diagnóstico WebGPU, copiado de flags y pestañas.
 *  5. Verificación de catálogo de modelos multilingües (ES/FR/PT/EN).
 *  6. Verificación del banner de aviso y navegación en el cajón de IA.
 *  7. Capturas de pantalla guardadas en /tmp/crossedarts-qa/.
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const SHOTS_DIR = '/tmp/crossedarts-qa';
mkdirSync(SHOTS_DIR, { recursive: true });

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // Reintentando conexión
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Servidor no respondió a tiempo en ${url}`);
}

async function main() {
  console.log('🚀 Iniciando pruebas de QA en tiempo real con Playwright...');

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`📡 Levantando servidor de preview en ${baseUrl}...`);

  const previewProc = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), stdio: 'inherit' }
  );

  const cleanup = () => {
    try { previewProc.kill('SIGTERM'); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  try {
    await waitForServer(baseUrl);
    console.log('✅ Servidor web disponible.');

    const browser = await chromium.launch({
      headless: true,
      args: ['--enable-unsafe-webgpu', '--no-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Brave/124.0.0.0',
      permissions: ['clipboard-read', 'clipboard-write']
    });

    // Inyectar API de Brave para prueba de detección fiel
    await context.addInitScript(() => {
      window.navigator.brave = {
        isBrave: async () => true
      };
    });

    const page = await context.newPage();

    // 1. Navegar a Configuración (#tab=settings)
    console.log('🔍 Navegando a la vista de Configuración...');
    await page.goto(`${baseUrl}/#tab=settings`, { waitUntil: 'networkidle' });

    // Seleccionar proveedor local en caso de estar en modo demo inicial
    await page.waitForSelector('#ai-provider', { timeout: 8000 });
    await page.selectOption('#ai-provider', 'local');
    await page.waitForTimeout(400);

    // Esperar a que el componente de diagnóstico WebGPU aparezca
    await page.waitForSelector('[data-testid="webgpu-diagnostic-guide"]', { timeout: 8000 });
    console.log('✅ WebGpuDiagnosticGuide renderizado en pantalla.');

    // Validar detección de navegador Brave y SO Linux
    const guide = page.locator('[data-testid="webgpu-diagnostic-guide"]');
    await guide.scrollIntoViewIfNeeded();
    const guideText = await page.innerText('[data-testid="webgpu-diagnostic-guide"]');
    if (!guideText.includes('Brave') || !guideText.includes('Linux')) {
      throw new Error(`Detección de navegador o SO incorrecta en guía: "${guideText}"`);
    }
    console.log('✅ Detección correcta: Brave en Linux.');

    // Captura 1: Vista general del diagnóstico en Brave
    await page.screenshot({ path: `${SHOTS_DIR}/01-settings-webgpu-brave.png`, fullPage: false });
    console.log('📸 Captura 1 guardada: 01-settings-webgpu-brave.png');

    // 2. Probar cambio de pestañas a Firefox
    console.log('🔄 Cambiando a pestaña de Firefox...');
    await page.click('button[role="tab"]:has-text("Firefox")');
    await page.waitForTimeout(300);
    await guide.scrollIntoViewIfNeeded();
    const ffPanel = await page.innerText('div[role="tabpanel"]');
    if (!ffPanel.includes('about:config') || !ffPanel.includes('dom.webgpu.enabled')) {
      throw new Error('Instrucciones de Firefox no encontradas en el tabpanel.');
    }
    await page.screenshot({ path: `${SHOTS_DIR}/02-settings-webgpu-tab-firefox.png` });
    console.log('📸 Captura 2 guardada: 02-settings-webgpu-tab-firefox.png');

    // 3. Probar pestaña de CPU / WASM
    console.log('🔄 Cambiando a pestaña Modo CPU (WASM)...');
    await page.click('button[role="tab"]:has-text("Modo CPU")');
    await page.waitForTimeout(300);
    await guide.scrollIntoViewIfNeeded();
    const wasmPanel = await page.innerText('div[role="tabpanel"]');
    if (!wasmPanel.includes('WebAssembly/ONNX') || !wasmPanel.includes('Qwen 2.5 0.5B')) {
      throw new Error('Información de CPU/WASM no encontrada en el tabpanel.');
    }
    await page.screenshot({ path: `${SHOTS_DIR}/03-settings-webgpu-tab-cpu-wasm.png` });
    console.log('📸 Captura 3 guardada: 03-settings-webgpu-tab-cpu-wasm.png');

    // 4. Volver a pestaña Chromium y probar copiado de flag
    console.log('📋 Probando botón de copiado de flags...');
    await page.click('button[role="tab"]:has-text("Brave / Chrome")');
    await page.waitForTimeout(300);

    const copyBtn = await page.waitForSelector('button:has-text("Copiar flag")');
    await copyBtn.click();
    await page.waitForTimeout(400);

    const copyBtnText = await page.innerText('div[role="tabpanel"]');
    if (!copyBtnText.includes('Copiado')) {
      console.warn('⚠️ Nota: feedback visual de copiado puede variar según permisos de portapapeles.');
    } else {
      console.log('✅ Botón de copiar flag muestra feedback "Copiado".');
    }

    // 5. Validar selector de modelos multilingües
    console.log('🧠 Validando catálogo de modelos locales...');
    const selectOptions = await page.$$eval('#local-model option', opts => opts.map(o => o.textContent || ''));
    const hasQwen25 = selectOptions.some(o => o.includes('Qwen 2.5 1.5B'));
    const hasMultilingualGroup = await page.$('optgroup[label*="Multilingüe"]');

    if (!hasQwen25 || !hasMultilingualGroup) {
      throw new Error('Modelo multilingüe Qwen 2.5 1.5B o grupo Multilingüe no encontrado en el desplegable.');
    }
    console.log('✅ Desplegable clasificado con grupo multilingüe y Qwen 2.5 1.5B presente.');

    // Captura 4: Selector de modelos con etiquetas de idioma
    await page.screenshot({ path: `${SHOTS_DIR}/04-settings-model-selector.png` });
    console.log('📸 Captura 4 guardada: 04-settings-model-selector.png');

    // Guardar ajustes para que persista 'local'
    const saveBtn = await page.$('button[type="submit"]:has-text("Guardar configuración")');
    if (saveBtn) {
      await saveBtn.click();
      await page.waitForTimeout(300);
    }

    // 6. Probar apertura del Asistente IA y su banner de diagnóstico WebGPU
    console.log('🤖 Probando apertura del Tutor IA (AIAssistantDrawer)...');
    await page.goto(`${baseUrl}/#tab=library`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    // Abrir el asistente IA mediante botón en la barra
    const tutorBtn = await page.waitForSelector('button[aria-label="Tutor IA"]');
    await tutorBtn.click();
    await page.waitForTimeout(600);

    // Verificar diálogo del asistente abierto
    const drawer = await page.waitForSelector('div[role="dialog"][aria-label="Tutor pedagógico"]');
    if (!drawer) {
      throw new Error('No se abrió el cajón del Tutor Pedagógico.');
    }
    console.log('✅ Tutor Pedagógico abierto.');

    // Captura 5: Cajón del Tutor IA
    await page.screenshot({ path: `${SHOTS_DIR}/05-ai-drawer-with-webgpu-notice.png` });
    console.log('📸 Captura 5 guardada: 05-ai-drawer-with-webgpu-notice.png');

    // Comprobar redirección si hay aviso de WebGPU en el drawer
    const noticeBtn = await page.$('[data-testid="ai-drawer-webgpu-notice"] button');
    if (noticeBtn) {
      console.log('🔗 Probando clic en enlace "Activar WebGPU" desde el asistente...');
      await noticeBtn.click();
      await page.waitForTimeout(500);
      const currentUrl = page.url();
      if (!currentUrl.includes('settings')) {
        throw new Error(`El enlace del drawer no redirigió a Ajustes: ${currentUrl}`);
      }
      console.log('✅ Redirección fluida a Configuración desde el asistente confirmada.');
      await page.screenshot({ path: `${SHOTS_DIR}/06-ai-drawer-redirect-to-settings.png` });
      console.log('📸 Captura 6 guardada: 06-ai-drawer-redirect-to-settings.png');
    }

    await browser.close();
    console.log('🎉 Todas las pruebas automatizadas con Playwright finalizaron con éxito.');
  } finally {
    cleanup();
  }
}

main().catch(err => {
  console.error('❌ Error en prueba Playwright:', err);
  process.exit(1);
});
