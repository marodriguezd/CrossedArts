# CrossedArts — Learning Operating System

**Aplicación en vivo:** [https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

[English](README.md) · [Español](README.es.md)

---

## Qué Es

CrossedArts es una **plataforma visual de aprendizaje y conocimiento, personal y *local-first*,** que se ejecuta íntegramente en el navegador. Reúne en un mismo entorno cursos, libros, documentos importados, notas, conceptos y el trabajo que tú produces, todo almacenado en una base de datos SQLite local sin requerir servidor backend.

Todo se organiza como se estudia de verdad: una galería en el **Panel** con lo que estás aprendiendo, un **grafo de conocimiento** con cómo se relacionan las piezas, una **montaña** de progreso con ámbito y el **trabajo práctico** que registra lo que has producido. Es deliberadamente **agnóstica al dominio**: funciona igual para matemáticas, música, programación o arte.

La aplicación está diseñada para estudiantes que desean control total sobre sus datos de estudio sin depender de servicios en la nube ni suscripciones.

## Capacidades

- **Galería del Panel:** Punto de entrada visual y curado a tu aprendizaje: cursos, libros, documentos importados y trabajo práctico, agrupados por propósito (continuar aprendiendo, recursos importados, trabajo práctico)
- **Hoy / Enfoque:** Una única respuesta determinista a «¿qué hago ahora?»: la próxima lección, los repasos vencidos, el trabajo práctico pendiente, las metas sin cumplir y los recursos estudiados recientemente, cada uno con el motivo por el que aparece
- **Cursos y Lecciones:** Estructura jerárquica con módulos, lecciones y contenido Markdown editable
- **Libros y Recursos:** Catálogo de biblioteca con progreso de lectura, documentos importados (PDF, EPUB, TXT, MD) y organización de recursos
- **Sesiones de Estudio:** Repaso unificado de tarjetas (SM-2), preguntas de práctica y modos mixtos con seguimiento de progreso local
- **Trabajo Práctico:** Ejercicios, proyectos, ensayos, dibujos o código que tú produces, ligados al recurso, la lección o el concepto que demuestran — en cualquier disciplina. Cada elemento abre un **espacio de trabajo** con contenido Markdown, lista de verificación persistida, autoevaluación y el contexto al que pertenece
- **Metas de Aprendizaje:** Metas explícitas definidas por ti (curso, libro, práctica, hábito) con fecha objetivo; su progreso se deriva solo de progreso medido, nunca inventado
- **Análisis:** Serie diaria de estudio, precisión, actividad por recurso, comparación por rango (7/30/90 días/todo) y racha — calculados a partir de sesiones y repasos reales
- **Grafo de Conocimiento:** Visualización interactiva 2D de cursos, libros, módulos, lecciones, notas, conceptos, trabajo práctico y sus relaciones, más **analítica estructural** (grado, componentes, nodos poco conectados y recientes) que describe topología y nunca ordena importancia
- **Progreso de montaña:** Indicador de recorrido, global o con ámbito de curso, con progreso medido real y los módulos del curso como hitos
- **Paquetes de curso:** Exporta el *material educativo* de un recurso (temario y trabajo propuesto, nunca tu progreso ni tus notas) como paquete JSON portable, para compartirlo e importarlo de forma aditiva
- **Medios Locales:** Reproducción de vídeo y audio desde carpetas locales mediante la File System Access API
- **Búsqueda Local:** Búsqueda determinista basada en SQL en todo el contenido, más una paleta de comandos global (Ctrl+K)
- **Ingestión de Documentos:** Análisis en el navegador de archivos PDF, EPUB, TXT y MD con deduplicación SHA-256
- **Proveedores de IA:** Inferencia local en dispositivo (WebLLM/WebGPU), modo demo heurístico, u Ollama, o API de OpenAI. Las respuestas incluyen **citas de fuentes** que remiten al recurso, la lección o la nota exactos en los que se fundamentaron, además del proveedor y modelo que las generó
- **Copia de Seguridad:** Exportación/importación binaria SQLite y respaldo JSON con validación de esquema
- **PWA:** Capa de aplicación sin conexión con service worker

## Modelo Local-First

CrossedArts utiliza una arquitectura de doble almacenamiento:

- **SQLite WASM** (`sql.js`): La base de datos relacional canónica que se ejecuta en el navegador. Almacena todos los datos de aprendizaje: cursos, lecciones, notas, tarjetas, conceptos, sesiones y recursos.
- **IndexedDB**: Capa de persistencia que sobrevive a reinicios del navegador. La base de datos SQLite se serializa en IndexedDB en cada mutación.

**Qué funciona sin backend:**
- Todas las actividades de aprendizaje (cursos, lecciones, notas, tarjetas, sesiones de estudio)
- Reproducción de medios locales
- Ingestión de documentos y búsqueda
- Visualización del grafo de conocimiento
- Copias de seguridad y restauración

**Qué requiere acceso a red:**
- Descarga inicial de modelos de IA local (pesos WebLLM, modelo de embeddings)
- Llamadas a la API de OpenAI (opt-in)
- Conexión a Ollama (opt-in, servidor local)

## IA y Búsqueda

CrossedArts admite cuatro modos de proveedor de IA:

| Modo | Descripción | Red requerida |
|------|-------------|---------------|
| **Local (WebLLM)** | Inferencia en dispositivo vía WebGPU. Modelos: Qwen3 1.7B (por defecto), Llama 3.2 1B, SmolLM2 1.7B, Qwen3 0.6B | Solo primera descarga |
| **Demo** | Respuestas heurísticas basadas en contenido local. Sin modelo de IA | No |
| **Ollama** | Conexión a un servidor Ollama local en `http://localhost:11434` | Red local |
| **OpenAI** | Usa la API de OpenAI con almacenamiento de clave en memoria | Sí |

**Embeddings y RAG:**
- Embeddings locales con Transformers.js y `onnx-community/embeddinggemma-300m-ONNX` (768 dimensiones nativas, almacenadas como 256d mediante Matryoshka Representation Learning)
- Recuperación híbrida que combina búsqueda léxica y embeddings semánticos
- Vectores cacheados en IndexedDB con hashing SHA-256 y versionado de pipeline (`v2.0-embeddinggemma-mrl256-sha256`)
- Todo el cálculo de embeddings ocurre en el dispositivo; el export ONNX de EmbeddingGemma 300M está verificado para Transformers.js y el frontend prioriza WASM por corrección
- EmbeddingGemma 2 (740M, multimodal) no se declara integrado todavía porque no existe un export ONNX/Transformers.js verificado para este frontend

## Semántica del progreso

CrossedArts registra varias cosas que se llaman "progreso". Nunca se mezclan en silencio: el progreso medido (lecciones completadas, páginas leídas) se muestra como porcentaje; el estado grueso (`sin empezar` / `en progreso` / `completado`) se muestra como estado y nunca como un porcentaje inventado. El progreso de práctica, la maestría de concepto y la actividad de estudio son conceptos distintos con su propio significado.

Todas las reglas —incluida la participación de cada artefacto en la galería, el grafo, la montaña y los paquetes de curso— están documentadas en [`docs/PROGRESS.md`](docs/PROGRESS.md).

## Limitaciones

- **No es un LMS completo:** CrossedArts no tiene clases, matrículas, calificaciones, cuentas de profesor ni aula remota. Los paquetes de curso son *material educativo* portable, no un sistema de gestión.
- **Soporte de navegador:** Se requiere Chrome, Edge o Brave para las funciones de medios locales (File System Access API). Otros navegadores pueden usar todas las funciones sin medios.
- **Hardware de IA local:** Se recomienda GPU con soporte WebGPU para inferencia LLM local. La CPU está disponible como alternativa más lenta.
- **Primera descarga:** El uso inicial de IA local requiere descargar los pesos del modelo (~135 MB para embeddings).
- **Copia de seguridad de medios:** Los archivos de medios locales no se incluyen en las copias de seguridad SQLite. Solo se respalda la base de datos; los medios deben revincularse tras restaurar.
- **Sin sincronización automática:** La sincronización entre múltiples dispositivos no está integrada. La exportación/importación es el mecanismo de transferencia manual.
- **Un solo usuario:** Sin soporte multiusuario ni autenticación.

## Inicio Rápido

### Requisitos

- Node.js v22 o superior (la suite de pruebas usa `--experimental-strip-types`)
- Navegador Chrome, Edge o Brave

### Instalación y Desarrollo

```bash
git clone https://github.com/marodriguezd/CrossedArts.git
cd CrossedArts/frontend
npm install
npm run dev
```

Abre `http://localhost:5173` en tu navegador.

### Pruebas

```bash
cd frontend
npm test
```

La suite de pruebas incluye 551 pruebas en 44 archivos de prueba que cubren inicialización de SQLite, algoritmo SM-2, sesiones de estudio, grafo de conocimiento (incluida la analítica estructural), RAG y procedencia de citas, ingestión de documentos, proveedores de IA, proyección de artefactos de aprendizaje, ámbito de la montaña, conflictos de paquetes de curso, metas de aprendizaje, analítica, planificación del enfoque, el espacio de trabajo práctico, contraste WCAG del tema y legibilidad del estado deshabilitado.

#### QA visual y responsivo (opcional)

La capa de render se verifica de forma programática con Playwright contra la build de producción — tres viewports (escritorio 1280×800, tableta 834×1112, móvil 390×844) — comprobando desbordamiento horizontal, errores de consola, encabezados esperados por vista, la paleta de comandos, el cambio de tema y el espacio de trabajo práctico:

```bash
cd frontend
npx playwright install chromium   # una vez
npm run build
npm run preview -- --port 4173 --strictPort &
QA_URL=http://localhost:4173 npm run qa:visual
```

Las capturas se escriben en `/tmp/crossedarts-qa` (nunca se versionan). El ejecutable devuelve un código distinto de cero si falla alguna comprobación objetiva.

### Compilación

```bash
cd frontend
npm run build
```

Los activos de producción se generan en `frontend/dist/`.

## Arquitectura

CrossedArts es un monorepo con dos componentes independientes:

- **`frontend/`**: Aplicación de una sola página con React 19 + TypeScript + Vite. Se despliega en GitHub Pages.
- **`backend/`**: Servidor Python FastAPI opcional para ingesta por lotes y análisis avanzado.

El frontend es completamente funcional sin el backend. El backend proporciona servicios adicionales para flujos de trabajo de procesamiento pesado.

## Backend Complementario

El backend opcional de Python proporciona:

- Ingestión masiva de documentos (PDF, EPUB)
- Extracción de metadatos y generación de miniaturas
- Embeddings con Sentence Transformers
- Flujos de trabajo LLM con LangChain

Configuración:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
PYTHONPATH=. alembic -c backend/alembic.ini upgrade head
python -m backend.app.main
```

El servidor API se ejecuta en `http://127.0.0.1:8080` con documentación interactiva en `/docs`.

## Copia de Seguridad

Dentro de la vista de Ajustes:

- **Exportar SQLite:** Descarga un archivo de base de datos `.sqlite` estándar
- **Importar SQLite:** Restaura desde una copia de seguridad `.sqlite` previa
- **Exportar JSON:** Genera un volcado estructurado de todas las tablas
- **Importar JSON:** Restaura desde una copia de seguridad JSON (validada antes de cualquier cambio)

## Licencia

CrossedArts está licenciado bajo [GPL-3.0-only](LICENSE).

Las dependencias de terceros conservan sus respectivas licencias:
- `onnx-community/embeddinggemma-300m-ONNX`: Gemma Terms of Use
- `Xenova/multilingual-e5-small`: MIT
- WebLLM (`@mlc-ai/web-llm`): Apache-2.0
- Transformers.js (`@huggingface/transformers`): Apache-2.0
- SQLite WASM (`sql.js`): MIT
