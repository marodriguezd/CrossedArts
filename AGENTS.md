# 🤖 CrossedArts — Guía Técnica para Agentes de IA y Contribuidores

Bienvenido a **CrossedArts**. Este documento es la referencia técnica definitiva para cualquier agente de IA o desarrollador humano que trabaje en este repositorio.

---

## 1. Visión General del Proyecto

**CrossedArts** es un **Learning Operating System (LMS)** personal, *local-first*, modular y diseñado con arquitectura **GitHub Pages First**.

### Arquitectura Dual (Monorepo)
El repositorio se divide en dos componentes independientes y desacoplados:

1. **Frontend Web App (`frontend/`):**
   - **Rol:** Aplicación principal de usuario final.
   - **Pila:** React 19 + TypeScript + Vite + Tailwind CSS + Lucide Icons.
   - **Motor de Datos:** SQLite ejecutado en el navegador vía WebAssembly (`sql.js`) y persistido en `IndexedDB`.
   - **Despliegue:** 100% estático en GitHub Pages a través de GitHub Actions (`.github/workflows/deploy.yml`). No requiere servidor backend para su funcionamiento diario.
   - **Módulos clave:** Sesiones de estudio unificadas con repetición espaciada SuperMemo-2 (`ReviewCenter.tsx` + `services/studySession.ts`), grafo de conocimiento 2D (`KnowledgeGraph.tsx` con `vis-network`), streaming de vídeos locales mediante la File System Access API (`CourseDetail.tsx`), y tutor pedagógico híbrido (`aiService.ts`).

2. **Backend Companion (`backend/`):**
   - **Rol:** Servidor API auxiliar opcional para usuarios que deseen análisis avanzado o procesamiento por lotes en disco local.
   - **Pila:** FastAPI + SQLAlchemy 2.0 (ORM) + Alembic + SQLite.
   - **Servicios:** Ingesta y escaneado de directorios masivos, extracción de metadatos de PDF/EPUB, extracción de miniaturas, embeddings con Sentence Transformers y flujos de trabajo LLM con LangChain.

---

## 2. Mapa del Código Fuente

```text
CrossedArts/
├── frontend/
│   ├── public/
│   │   ├── favicon.svg             # Favicon vectorial
│   │   └── sql-wasm.wasm           # Binario WebAssembly de SQLite (CRÍTICO: nunca eliminar)
│   ├── src/
│   │   ├── ai/
│   │   │   └── aiService.ts        # Motor de IA: Local on-device (WebLLM), Demo, Ollama o OpenAI
│   │   ├── components/
│   │   │   ├── common/
│   │   │   │   ├── ConfirmDialog.tsx  # Diálogo de confirmación accesible para acciones destructivas
│   │   │   │   └── ThemeToggle.tsx    # Selector de tema claro (crema) / oscuro (carbón)
│   │   │   ├── lesson/
│   │   │   │   └── LessonWorkspace.tsx  # Espacio de trabajo de la lección (contenido, notas, recursos, conceptos, estudio)
│   │   │   ├── ai/
│   │   │   │   └── AIAssistantDrawer.tsx  # Cajón lateral del tutor pedagógico con citas RAG
│   │   │   ├── ui/
│   │   │   │   └── index.tsx           # Primitivas visuales compartidas (Button, Badge, Panel, SearchInput, etc.)
│   │   ├── hooks/
│   │   │   └── useTheme.ts             # Tema claro/oscuro persistente (localStorage + data-theme)
│   │   │   ├── study/
│   │   │   │   ├── FlashcardGenerationModal.tsx  # Generación y previsualización de flashcards
│   │   │   │   └── PracticeQuestion.tsx  # Pregunta de práctica accesible (grupo de radios)
│   │   │   └── layout/
│   │   │       └── Shell.tsx        # Shell de la aplicación: lateral fijo, barra superior, buscador global y cajón móvil
│   │   ├── db/
│   │   │   ├── dao.ts              # Data Access Object con consultas SQL y algoritmo SM-2
│   │   │   ├── exportImport.ts     # Exportación/importación binaria .sqlite y backup JSON
│   │   │   ├── schema.ts           # DDL con las 10 tablas relacionales del sistema
│   │   │   ├── seedDemo.ts         # Datos de demostración iniciales
│   │   │   └── sqliteBridge.ts     # Carga de WASM, sincronización con IndexedDB y puente SQL
│   │   ├── lib/
│   │   │   ├── localEmbeddings/    # Motor de embeddings on-device (Transformers.js), hashing FNV-1a y caché IndexedDB
│   │   │   ├── localLlm/           # Motor WebLLM on-device, registro, prompts y validadores
│   │   │   └── localRag/           # RAG híbrido (léxico + semántico con embeddings) sobre SQLite local
│   │   ├── pages/
│   │   │   ├── CourseDetail.tsx    # Reproductor y visor de lecciones y módulos
│   │   │   ├── Dashboard.tsx       # Métricas de estudio (KPIs), racha y accesos directos
│   │   │   ├── KnowledgeGraph.tsx  # Grafo 2.0: nodos tipados, filtros, detalle y conexiones manuales
│   │   │   ├── Library.tsx         # Catálogo de cursos y libros con filtros
│   │   │   ├── NotesView.tsx       # Editor y visor de notas de estudio en Markdown
│   │   │   ├── ResourceDetail.tsx  # Vista de detalle unificada (libro, recurso importado, concepto)
│   │   │   ├── ReviewCenter.tsx    # Host de la sesión de estudio unificada (SM-2 + práctica)
│   │   │   └── SettingsView.tsx    # Gestión de BD (backup/restore), IA on-device e índice semántico
│   │   ├── services/
│   │   │   ├── studySession.ts        # Máquina de estados pura del ciclo de vida de sesión
│   │   │   └── localMediaService.ts   # Registro local de medios y matching determinista
│   │   ├── types/
│   │   │   └── models.ts           # Interfaces y tipos de datos TypeScript
│   │   ├── App.tsx                 # Contenedor raíz y ciclo de vida de la aplicación
│   │   ├── index.css               # Estilos globales y utilidades de Tailwind
│   │   └── main.tsx                # Entrada de montaje de React en el DOM
│   ├── tests/                      # Flota de pruebas de frontend (148 tests de integridad)
│   ├── index.html                  # Punto de entrada HTML
│   ├── package.json                # Dependencias y scripts de Node.js
│   ├── tailwind.config.js          # Configuración de diseño y colores
│   ├── tsconfig.json               # Configuración del compilador TypeScript
│   └── vite.config.ts              # Configuración de empaquetado Vite (base relativa obligatoria)
├── backend/
│   ├── alembic/                    # Versiones y configuración de migraciones
│   ├── app/
│   │   ├── api/                    # Routers FastAPI (/api/v1/courses, /books, /ingestion, etc.)
│   │   ├── core/                   # Base de datos, settings, utilidades y seguridad
│   │   ├── models/                 # Modelos ORM de SQLAlchemy
│   │   ├── schemas/                # Modelos Pydantic para validación de datos
│   │   ├── services/               # Lógica de negocio (extractor, scanner, embedding, llm)
│   │   └── main.py                 # Punto de entrada del servidor FastAPI y archivos estáticos
│   ├── requirements.txt            # Dependencias Python
│   └── tests/                      # Pruebas de integración de backend
├── static/                         # Portadas de muestra y recursos multimedia
├── .github/workflows/deploy.yml    # Pipeline CI/CD para GitHub Pages
├── .gitignore                      # Reglas de exclusión de Git
├── ABOUT.md                        # Manifiesto, filosofía y arquitectura detallada
├── README.md                       # Documentación principal en inglés
└── README.es.md                    # Documentación en español
```

---

## 3. Comandos de Desarrollo y Pruebas

### 3.1. Frontend Web (React + TypeScript)

Todos los comandos de frontend deben ejecutarse dentro del directorio `frontend/`:

```bash
cd frontend

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo en caliente (Vite)
npm run dev

# Ejecutar la flota de pruebas de integridad (185/185 tests)
npm test
# O directamente mediante el test runner de Node:
node --test --experimental-strip-types tests/*.test.ts

# Verificar tipado TypeScript sin emitir código
npm run typecheck

# Compilar para producción (genera frontend/dist/)
npx vite build
```

> **IMPORTANTE:** La flota de 185 pruebas de frontend valida:
> 1. Inicialización de SQLite WASM sin acceso a la red (0 web requests).
> 2. Precisión del algoritmo de repetición espaciada SuperMemo-2 (`domainLogic.ts` & SM-2).
> 3. Operaciones CRUD, cálculo de racha real y validación pura de lectura de libros en `dao.ts` y `domainLogic.ts`.
> 4. Exportación e importación binaria SQLite `.sqlite` / `.crossedarts.sqlite` con validación estricta de cabecera y esquema, y respaldos universales JSON.
> 5. Resiliencia de almacenamiento, reporte explícito de estados (`StorageState`), coordinación multi-pestaña con `BroadcastChannel` y supervivencia de datos reales tras recarga.
> 6. Emparejamiento jerárquico determinista y asociación individual de medios locales (`localMediaService.ts`).
> 7. Parámetro `base: './'` en `vite.config.ts`, manifest PWA y Service Worker offline (`sw.js`).
> 8. Motor de IA on-device con WebLLM, detección WebGPU, máquina de estados resiliente, prompts pedagógicos delimitados contra injection, validación anti-alucinación y garantía de cero peticiones de red (`localLlm/`).
> 9. RAG local híbrido determinista con embeddings on-device (`Xenova/multilingual-e5-small` con Transformers.js, licencia MIT), prefijos E5 canónicos (`query: ` / `passage: `), normalización L2 estricta a 384 dimensiones, hashing criptográfico SHA-256 (`crypto.subtle`), versionado de pipeline (`v1.1-e5-sha256`), ranking calibrado con RRF y deduplicación inteligente por fuente (`localEmbeddings/`, `localRag/`).
> 10. Ingestión local y extracción de texto en navegador para documentos `.txt`, `.md`, `.pdf`, `.epub`, con huella criptográfica SHA-256 anti-duplicados, segmentación en secciones estructuradas con páginas/capítulos, cero almacenamiento de binarios pesados en SQLite y citación precisa en RAG (`localIngestion/`).
> 11. Conversión de documentos importados en recursos de aprendizaje de primera clase (`learning_resource`), previsualización interactiva con estimación de palabras, selección de destino (standalone, curso, lección, libro), visor de origen de recursos con huella SHA-256 y acción pedagógica fundamentada `explainResource` con rechazo honesto ante contexto insuficiente.
> 12. Generación formativa fundamentada (flashcards y evaluaciones tipo test) con validación heurística de fundamentación (grounding check), previsualización editable antes de persistir en SQLite, inserción en ciclo SM-2 (`dao.createFlashcards`), y sesiones efímeras de preguntas de práctica con feedback inmediato (`studyGeneration/`).
13. Sesiones de estudio locales unificadas (`flashcards`, `practice`, `mixed`) reutilizando la tabla `learning_session`: ciclo de vida explícito (`idle → starting → active → paused → completed/cancelled/failed`), persistencia por repaso (supervivencia a recarga), nunca se reporta finalización si la persistencia falla, cancelación que conserva los repasos ya guardados, preguntas de práctica efímeras, resumen sin "puntuación de conocimiento" universal, agregación diaria y de sesiones recientes en el Dashboard, integridad de racha e integración con el SM-2 existente (`services/studySession.ts`, `dao.ts`, `ReviewCenter.tsx`).
14. Grafo de conocimiento 2.0 y organización de recursos de primera clase: nodos tipados (`course`, `book`, `module`, `lesson`, `note`, `concept`, `resource`), aristas estructurales derivadas de claves foráneas (`contains`, `about`, `references`), conexiones manuales tipadas y validadas en `knowledge_connection` (sin auto-enlaces ni duplicados, con poda de relaciones huérfanas), filtros deterministas, panel de detalle con representación textual accesible, navegación bidireccional, CRUD ligero de cursos/módulos/lecciones, edición de libros, asociación de notas, detección de recursos sin organizar, búsqueda local determinista sin embeddings, y ámbito de recuperación RAG acotado (`dao.ts`, `services/domainLogic.ts`, `KnowledgeGraph.tsx`, `Library.tsx`, `CourseDetail.tsx`, `NotesView.tsx`, `lib/localRag/retrieval.ts`).
15. Vistas de detalle de recursos y consistencia de la experiencia de aprendizaje: destino dedicado para curso, libro, lección, nota, recurso importado y concepto; `ResourceDetail.tsx` (`dao.getResourceDetail`, `dao.getRelatedKnowledge`, `dao.getNodeSummaries`) muestra metadatos, contenido extraído como datos e indexación, con una sección "Relacionado" construida solo con relaciones canónicas (explícitas + derivadas de claves foráneas, sin descubrimiento semántico automático); búsqueda y grafo convierten cada resultado/nodo en una acción determinista (`resolveSearchResultDestination`, `resolveGraphNodeDestination`); ámbito de estudio/recuperación a nivel de lección persistido en `learning_session.lesson_id` y propagado por `aiService`/`localRag`; `ConfirmDialog.tsx` reemplaza el confirm nativo en acciones destructivas; los tipos de relación se centralizan en `GRAPH_RELATION_TYPES`. La navegación y el detalle funcionan sin backend, WebGPU, embeddings ni WebLLM (`ResourceDetail.tsx`, `components/common/ConfirmDialog.tsx`, `dao.ts`, `services/domainLogic.ts`, `services/studySession.ts`).
16. Espacio de trabajo de la lección como unidad central de aprendizaje: campo `content` (texto/Markdown como datos) en la tabla `lesson` con migración idempotente (`migrateLessonContent`), edición de título/contenido/duración vía `dao.updateLesson` con validación, ordenación determinista `dao.moveLesson` (posiciones normalizadas 1..N sin duplicados), agregación `dao.getLessonWorkspace` (notas, recursos, conceptos, progreso `NOT_STARTED`/`IN_PROGRESS`/`COMPLETED` basado en actividad real), continuación determinista `dao.getNextLessonForCourse`, integración del contenido en la recuperación léxica y en el chunking semántico (SHA-256; un cambio de contenido invalida solo ese chunk), acciones de estudio/IA reutilizando `aiService`/RAG con ámbito de lección, y `components/lesson/LessonWorkspace.tsx` (`dao.ts`, `lib/localRag/retrieval.ts`, `lib/localEmbeddings/chunking.ts`, `CourseDetail.tsx`). Corrige además un defecto real de `sql.js`: `db.export()` reinicia `PRAGMA foreign_keys`, por lo que se reafirma tras cada persistencia y se cachea el tamaño de BD sin exportar (`sqliteBridge.ts`).
17. Endurecimiento de integridad local y aislamiento por ámbito: notas del espacio de trabajo acotadas estrictamente a su lección (`dao.getNotesForLesson`; `dao.getNotesForResource` con ámbito de lección filtra solo por `lesson_id`) para que el progreso de una lección no se contamine con notas de lecciones hermanas ni con la nota general del curso; historial de estudio con ámbito de lección preservado y mostrado en el Dashboard (`learning_session.lesson_id` + `lesson_title` en `getRecentStudySessions`, sin inventar lección en sesiones de curso); refuerzo verificado de `PRAGMA foreign_keys` mediante prueba de efecto tras `init`, `persist` y roundtrip export/import binario, con `ON DELETE SET NULL` real en `note` y `learning_session` al borrar una lección; índices deterministas y tripleta única en `knowledge_connection` con migración de deduplicación idempotente (`migrateKnowledgeConnectionIndex`, conservando la fila de id menor); invalidación perezosa de vectores cacheados en la recuperación por SHA-256 + versión de pipeline (`isCachedVectorFresh`); cero diálogos nativos del navegador (`alert`/`confirm` sustituidos por `ConfirmDialog` y avisos `aria-live` en `SettingsView`/`App`/`CourseDetail`); y `.gitignore` con las reglas heredadas de plantilla Python `lib/` ancladas a la raíz (`/lib/`) para que `frontend/src/lib/` (22 ficheros del motor local RAG/LLM/embeddings/ingestión) permanezca versionado (`schema_and_ddl.test.ts`, `lesson_workspace.test.ts`, `study_session.test.ts`, `.gitignore`).

### 3.2. Backend Companion (Python + FastAPI)

```bash
# Crear y activar entorno virtual
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Instalar dependencias
pip install -r backend/requirements.txt

# Aplicar migraciones de base de datos
PYTHONPATH=. alembic -c backend/alembic.ini upgrade head

# Iniciar servidor backend API
python -m backend.app.main

# Ejecutar pruebas unitarias de backend
pytest backend/tests -q
```

---

## 4. Invariantes del Sistema y Reglas para Agentes

Cualquier modificación o ampliación de código debe respetar estrictamente estas reglas:

### Regla 1: Client-Side & Zero-Web-Access por Defecto
* La aplicación en `frontend/` debe ser capaz de arrancar, consultar datos, reproducir lecciones y repasar flashcards **sin conexión a internet**.
* `sql-wasm.wasm` debe residir físicamente en `frontend/public/` para que `sql.js` lo cargue localmente sin recurrir a CDNs externas.
* Nunca introduzcas dependencias en `frontend/index.html` que carguen fuentes, scripts o estilos desde servidores externos no respaldados en local.

### Regla 2: Persistencia Relacional con SQLite Bridge
* La inicialización de SQLite **debe ser segura ante concurrencia**: `dbBridge.init()` comparte una única promesa entre todos los llamantes y expone estados terminales (`idle` / `initializing` / `ready` / `failed`) mediante `getInitState()`. Nunca ejecutes una secuencia de inicialización paralela que compita por escribir `this.db`.
* Un fallo de inicialización **debe ser un estado de primer clase**: `useAppData()` expone `initError` y `App.tsx` detiene el montaje antes de renderizar cualquier vista de datos. Nunca renderices la aplicación contra una base de datos ausente.
* Las vistas perezosas que llaman al DAO (p. ej. `KnowledgeGraph`) **deben** llamar a `dbBridge.ensureInitialized()` antes de leer, y nunca pintar `err.message` crudo. Solo se muestran clases de fallo conocidas con su mensaje controlado en español (`DbInitFailure`).
* **Día de estudio local:** el "hoy" del usuario y la racha se calculan con el día calendario local (`resolveLocalDay()`) y se pasan como parámetro a consultas SQLite. No vuelvas a `date('now')` (UTC) para lógica visible al usuario. La aritmética de días consecutivos vive en `services/localDate.ts`, no en bucles con `Date`.
* Toda modificación de datos debe sincronizarse con `IndexedDB` invocando `await dbBridge.persist()`.
* Si se añaden nuevas tablas o columnas al esquema:
  1. Actualiza `frontend/src/db/schema.ts`.
  2. Actualiza la lista de tablas en `getDatabaseTables()` dentro de `frontend/src/db/exportImport.ts` para que las copias de seguridad sigan siendo íntegras.
  3. Proporciona datos de prueba en `frontend/src/db/seedDemo.ts`.

### Regla 3: Algoritmo de Repetición Espaciada SM-2
* El factor de facilidad (*Ease Factor*) nunca debe descender de `1.30`.
* Calificaciones menores a `3` representan fallo de memorización: deben reiniciar `repetition_count = 0` y establecer `interval_days = 1`.
* Calificaciones entre `3` y `5` calculan el intervalo creciente multiplicando por el factor de facilidad.

### Regla 4: File System Access API & Medios Locales
* El acceso a carpetas locales utiliza `window.showDirectoryPicker()` coordinado por `localMediaService.ts`.
* Siempre envuelve la llamada en un bloque `try/catch` y comprueba `'showDirectoryPicker' in window`. Si el usuario cancela el diálogo del sistema operativo, ignora el `AbortError` de forma transparente sin alarmar en la UI.
* Las URLs de medios locales son efímeras (`URL.createObjectURL`), se mantienen estrictamente en memoria y se deben revocar (`URL.revokeObjectURL`) al cambiar de lección o salir de la vista. Nunca persistas `blob:` URLs ni `FileSystemHandle`s en la base de datos SQLite.

### Regla 5: Idioma y Experiencia de Usuario
* Toda la interfaz de usuario, títulos, botones, cuadros de diálogo, mensajes de error y textos explicativos deben estar en **español**.
* La estética visual se define mediante variables CSS semánticas (`--c-canvas`, `--c-surface`, `--c-ink`, `--c-accent`, etc.) declaradas en `frontend/src/index.css` y expuestas a Tailwind en `frontend/tailwind.config.js`. El tema **por defecto es claro y cálido (crema)**, con un segundo tema **oscuro suave (carbón)** que el usuario elige de forma persistente (`hooks/useTheme.ts`, `localStorage: crossedarts-theme`). Está prohibido introducir colores literales de paleta (`slate-*`, `purple-*`, `indigo-*`) en el JSX: usa siempre las utilidades semánticas (`bg-surface`, `text-muted`, `text-accent`, `border-line`).
* Los nuevos componentes compartidos deben construirse sobre las primitivas de `frontend/src/components/ui/index.tsx` y el shell de `frontend/src/components/layout/Shell.tsx`.

### Regla 5-bis: Datos, Copias de Seguridad y Privacidad
* Toda importación de respaldo JSON **debe** pasar `validateJsonBackup()` por completo **antes** de ejecutar cualquier `DELETE`. Si la validación falla, los datos del usuario quedan intactos.
* Las claves de API de terceros (p. ej. OpenAI) se mantienen **en memoria** por defecto. No las escribas en `localStorage` salvo opt-in explícito del usuario, y explica con claridad que el almacenamiento del navegador no es seguro para secretos.
* El día de estudio es el día calendario **local** del usuario; las marcas de tiempo persistidas siguen siendo UTC. Documéntalo si cambias el comportamiento.

### Regla 6: Higiene de Git y Control de Versiones
* No confirmes archivos de log de agentes, volcados de estado temporal ni artefactos innecesarios en la raíz (`.omg`, `.agents`, `.opencode`, `PLAN.md`, etc.).
* El archivo `.gitignore` debe proteger contra `node_modules/`, `.venv/`, volcados locales de base de datos (`*.db`, `*.sqlite`), ficheros de bloqueo no estándar (`pnpm-lock.yaml`) y cachés de Python (`__pycache__`).

### Regla 7: Licencia y Propiedad Intelectual
* El proyecto está licenciado bajo la **GNU General Public License v3.0 only (GPL-3.0-only)** (`LICENSE`).
* El software original del proyecto se distribuye bajo GPL-3.0-only; las dependencias y modelos de terceros (`Xenova/multilingual-e5-small` bajo MIT, WebLLM bajo Apache-2.0, Transformers.js bajo Apache-2.0, SQLite WASM bajo MIT) conservan intactas sus respectivas licencias originales.


---

## 5. Trampas Frecuentes y Cómo Evitarlas

1. **Rutas relativas en Vite (`vite.config.ts`):** 
   - Siempre debe mantener `base: './'`. Si se cambia a `/`, GitHub Pages fallará al buscar los assets en `https://usuario.github.io/CrossedArts/`.
2. **Importaciones de Node.js en navegador (`node:fs`, `node:path`):**
   - En `sqliteBridge.ts`, las importaciones de `node:fs` y `node:path` se usan exclusivamente para el entorno de test en Node.js y están protegidas con `typeof window === 'undefined'`. Vite las marca como externas para que no rompan la compilación del navegador.
3. **Restauración masiva en SQLite:**
   - Durante la importación de respaldos JSON en `exportImport.ts`, se debe ejecutar `PRAGMA foreign_keys = OFF;` antes de vaciar e insertar tablas, y restaurar `PRAGMA foreign_keys = ON;` al finalizar para evitar violaciones de clave foránea intermedias.
4. **Llamadas a Ollama desde el navegador:**
   - Ollama corre por defecto en `http://localhost:11434`. Los navegadores modernos imponen CORS; si el usuario usa Ollama, debe iniciarlo con la variable de entorno `OLLAMA_ORIGINS="*"`.
5. **Nombre y URL del WASM de SQLite en el navegador:**
   - Vite resuelve `sql.js` por la condición `browser` de su `package.json`, es decir `dist/sql-wasm-browser.js`, cuya build de Emscripten pide `sql-wasm-browser.wasm`. El proyecto **solo despliega** `sql-wasm.wasm` en `public/` (binario idéntico), así que `locateFile` debe normalizar el nombre a `sql-wasm.wasm` y resolverlo contra la base real del documento (`document.baseURI`), nunca con una ruta `./` relativa al bundle. Lo contrario provoca un 404 del WASM en GitHub Pages y el error "No se pudo cargar el motor SQLite en WebAssembly". Ayudantes puros y probados en `src/db/sqliteWasmUrl.ts` (`resolveSqliteWasmUrl`, `deployedSqliteWasmFilename`).
