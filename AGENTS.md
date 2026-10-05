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
│   │   │   │   ├── CommandPalette.ts  # Paleta global (Ctrl+K) en .ts/createElement: es lo que
│   │   │   │   │                       # permite importarla desde el runner de pruebas y testear su HTML
│   │   │   │   └── ThemeToggle.tsx    # Selector de tema claro (crema) / oscuro (carbón)
│   │   │   ├── lesson/
│   │   │   │   └── LessonWorkspace.tsx  # Espacio de trabajo de la lección (contenido, notas, recursos, conceptos, estudio)
│   │   │   ├── ai/
│   │   │   │   ├── AIAssistantDrawer.tsx  # Cajón lateral del tutor pedagógico con citas RAG
│   │   │   │   └── MarkdownMessage.ts     # Render del Markdown del tutor, en createElement para testearlo
│   │   │   ├── ui/
│   │   │   │   ├── index.tsx           # Primitivas visuales compartidas (Button, Badge, Panel, SearchInput, etc.)
│   │   │   │   └── primitives.ts       # cn + Kbd en createElement, importables desde las pruebas;
│   │   │   │                           # reexportados desde index.tsx para no tocar a sus 17 consumidores
│   │   ├── hooks/
│   │   │   ├── useTheme.ts             # Tema claro/oscuro persistente y compartido (localStorage + data-theme)
│   │   │   └── useCommandPaletteHotkey.ts  # Atajo global Ctrl+K / Cmd+K, siempre montado
│   │   │   ├── study/
│   │   │   │   ├── FlashcardGenerationModal.tsx  # Generación y previsualización de flashcards
│   │   │   │   └── PracticeQuestion.tsx  # Pregunta de práctica accesible (grupo de radios)
│   │   │   └── layout/
│   │   │       └── Shell.tsx        # Shell de la aplicación: lateral fijo, barra superior, disparador de la paleta y cajón móvil
│   │   ├── db/
│   │   │   ├── dao.ts              # Data Access Object con consultas SQL y algoritmo SM-2
│   │   │   ├── exportImport.ts     # Exportación/importación binaria .sqlite y backup JSON
│   │   │   ├── schema.ts           # DDL con las 10 tablas relacionales del sistema
│   │   │   ├── seedDemo.ts         # Datos de demostración iniciales
│   │   │   └── sqliteBridge.ts     # Carga de WASM, sincronización con IndexedDB y puente SQL
│   │   ├── lib/
│   │   │   ├── localEmbeddings/    # Motor de embeddings on-device (Transformers.js), SHA-256 para contenido y caché IndexedDB
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
│   │   │   ├── commandPalette.ts      # Lógica pura de la paleta: normalización, ranking, catálogo y navegación
│   │   │   └── localMediaService.ts   # Registro local de medios y matching determinista
│   │   ├── types/
│   │   │   └── models.ts           # Interfaces y tipos de datos TypeScript
│   │   ├── App.tsx                 # Contenedor raíz y ciclo de vida de la aplicación
│   │   ├── index.css               # Estilos globales y utilidades de Tailwind
│   │   └── main.tsx                # Entrada de montaje de React en el DOM
│   ├── tests/                      # Flota de pruebas de frontend (223 tests de integridad)
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

# Ejecutar la flota completa de pruebas de integridad
npm test
# O directamente mediante el test runner de Node:
node --test --experimental-strip-types tests/*.test.ts

# Verificar tipado TypeScript sin emitir código
npm run typecheck

# Compilar para producción (genera frontend/dist/)
npx vite build
```

> **IMPORTANTE:** La flota de pruebas de frontend valida:
> 1. Inicialización de SQLite WASM sin acceso a la red (0 web requests).
> 2. Precisión del algoritmo de repetición espaciada SuperMemo-2 (`domainLogic.ts` & SM-2).
> 3. Operaciones CRUD, cálculo de racha real y validación pura de lectura de libros en `dao.ts` y `domainLogic.ts`.
> 4. Exportación e importación binaria SQLite `.sqlite` / `.crossedarts.sqlite` con validación estricta de cabecera y esquema, y respaldos universales JSON.
> 5. Resiliencia de almacenamiento, reporte explícito de estados (`StorageState`), coordinación multi-pestaña con `BroadcastChannel` y supervivencia de datos reales tras recarga.
> 6. Emparejamiento jerárquico determinista y asociación individual de medios locales (`localMediaService.ts`).
> 7. Parámetro `base: './'` en `vite.config.ts`, manifest PWA y Service Worker offline (`sw.js`).
> 8. Motor de IA on-device con WebLLM, detección WebGPU, máquina de estados resiliente, prompts pedagógicos delimitados contra injection, validación anti-alucinación y garantía de cero peticiones de red (`localLlm/`).
> 9. RAG local híbrido determinista con embeddings on-device (`Xenova/multilingual-e5-small` con Transformers.js, licencia MIT), prefijos E5 canónicos (`query: ` / `passage: `), normalización L2 estricta a 384 dimensiones, hashing criptográfico SHA-256 (`crypto.subtle`), versionado de pipeline (`v1.1-e5-sha256`), ranking calibrado con fusión RRF y deduplicación inteligente por fuente (`localEmbeddings/`, `localRag/`).
> 10. Ingestión local y extracción de texto en navegador para documentos `.txt`, `.md`, `.pdf`, `.epub`, con huella criptográfica SHA-256 anti-duplicados, segmentación en secciones estructuradas con páginas/capítulos, cero almacenamiento de binarios pesados en SQLite y citación precisa en RAG (`localIngestion/`).
> 11. Conversión de documentos importados en recursos de aprendizaje de primera clase (`learning_resource`), previsualización interactiva con estimación de palabras, selección de destino (standalone, curso, lección, libro), visor de origen de recursos con huella SHA-256 y acción pedagógica fundamentada `explainResource` con rechazo honesto ante contexto insuficiente.
> 12. Generación formativa fundamentada (flashcards y evaluaciones tipo test) con validación heurística de fundamentación (grounding check), previsualización editable antes de persistir en SQLite, inserción en ciclo SM-2 (`dao.createFlashcards`), y sesiones efímeras de preguntas de práctica con feedback inmediato (`studyGeneration/`).
13. Sesiones de estudio locales unificadas (`flashcards`, `practice`, `mixed`) reutilizando la tabla `learning_session`: ciclo de vida explícito (`idle → starting → active → paused → completed/cancelled/failed`), persistencia por repaso (supervivencia a recarga), nunca se reporta finalización si la persistencia falla, cancelación que conserva los repasos ya guardados, preguntas de práctica efímeras, resumen sin "puntuación de conocimiento" universal, agregación diaria y de sesiones recientes en el Dashboard, integridad de racha e integración con el SM-2 existente (`services/studySession.ts`, `dao.ts`, `ReviewCenter.tsx`).
14. Grafo de conocimiento 2.0 y organización de recursos de primera clase: nodos tipados (`course`, `book`, `module`, `lesson`, `note`, `concept`, `resource`), aristas estructurales derivadas de claves foráneas (`contains`, `about`, `references`), conexiones manuales tipadas y validadas en `knowledge_connection` (sin auto-enlaces ni duplicados, con poda de relaciones huérfanas), filtros deterministas, panel de detalle con representación textual accesible, navegación bidireccional, CRUD ligero de cursos/módulos/lecciones, edición de libros, asociación de notas, detección de recursos sin organizar, búsqueda local determinista sin embeddings, y ámbito de recuperación RAG acotado (`dao.ts`, `services/domainLogic.ts`, `KnowledgeGraph.tsx`, `Library.tsx`, `CourseDetail.tsx`, `NotesView.tsx`, `lib/localRag/retrieval.ts`).
15. Vistas de detalle de recursos y consistencia de la experiencia de aprendizaje: destino dedicado para curso, libro, lección, nota, recurso importado y concepto; `ResourceDetail.tsx` (`dao.getResourceDetail`, `dao.getRelatedKnowledge`, `dao.getNodeSummaries`) muestra metadatos, contenido extraído como datos e indexación, con una sección "Relacionado" construida solo con relaciones canónicas (explícitas + derivadas de claves foráneas, sin descubrimiento semántico automático); búsqueda y grafo convierten cada resultado/nodo en una acción determinista (`resolveSearchResultDestination`, `resolveGraphNodeDestination`); ámbito de estudio/recuperación a nivel de lección persistido en `learning_session.lesson_id` y propagado por `aiService`/`localRag`; `ConfirmDialog.tsx` reemplaza el confirm nativo en acciones destructivas; los tipos de relación se centralizan en `GRAPH_RELATION_TYPES`. La navegación y el detalle funcionan sin backend, WebGPU, embeddings ni WebLLM (`ResourceDetail.tsx`, `components/common/ConfirmDialog.tsx`, `dao.ts`, `services/domainLogic.ts`, `services/studySession.ts`).
16. Espacio de trabajo de la lección como unidad central de aprendizaje: campo `content` (texto/Markdown como datos) en la tabla `lesson` con migración idempotente (`migrateLessonContent`), edición de título/contenido/duración vía `dao.updateLesson` con validación, ordenación determinista `dao.moveLesson` (posiciones normalizadas 1..N sin duplicados), agregación `dao.getLessonWorkspace` (notas, recursos, conceptos, progreso `NOT_STARTED`/`IN_PROGRESS`/`COMPLETED` basado en actividad real), continuación determinista `dao.getNextLessonForCourse`, integración del contenido en la recuperación léxica y en el chunking semántico (SHA-256; un cambio de contenido invalida solo ese chunk), acciones de estudio/IA reutilizando `aiService`/RAG con ámbito de lección, y `components/lesson/LessonWorkspace.tsx` (`dao.ts`, `lib/localRag/retrieval.ts`, `lib/localEmbeddings/chunking.ts`, `CourseDetail.tsx`). Corrige además un defecto real de `sql.js`: `db.export()` reinicia `PRAGMA foreign_keys`, por lo que se reafirma tras cada persistencia y se cachea el tamaño de BD sin exportar (`sqliteBridge.ts`).
17. Endurecimiento de integridad local y aislamiento por ámbito: notas del espacio de trabajo acotadas estrictamente a su lección (`dao.getNotesForLesson`; `dao.getNotesForResource` con ámbito de lección filtra solo por `lesson_id`) para que el progreso de una lección no se contamine con notas de lecciones hermanas ni con la nota general del curso; historial de estudio con ámbito de lección preservado y mostrado en el Dashboard (`learning_session.lesson_id` + `lesson_title` en `getRecentStudySessions`, sin inventar lección en sesiones de curso); refuerzo verificado de `PRAGMA foreign_keys` mediante prueba de efecto tras `init`, `persist` y roundtrip export/import binario, con `ON DELETE SET NULL` real en `note` y `learning_session` al borrar una lección; índices deterministas y tripleta única en `knowledge_connection` con migración de deduplicación idempotente (`migrateKnowledgeConnectionIndex`, conservando la fila de id menor); invalidación perezosa de vectores cacheados en la recuperación por SHA-256 + versión de pipeline (`isCachedVectorFresh`); cero diálogos nativos del navegador (`alert`/`confirm` sustituidos por `ConfirmDialog` y avisos `aria-live` en `SettingsView`/`App`/`CourseDetail`); y `.gitignore` con las reglas heredadas de plantilla Python `lib/` ancladas a la raíz (`/lib/`) para que `frontend/src/lib/` (22 ficheros del motor local RAG/LLM/embeddings/ingestión) permanezca versionado (`schema_and_ddl.test.ts`, `lesson_workspace.test.ts`, `study_session.test.ts`, `.gitignore`).

18. IA local de configuración cero y preparación automática: coordinador mínimo `services/localAiRuntime.ts` que orquesta los motores existentes sin reemplazarlos ni introducir un store global. Detecta capacidades WebGPU de forma conservadora (features explícitas y pista tosca de gama; nunca VRAM exacta), selecciona el modelo compatible más seguro de forma determinista (`lib/localLlm/selection.ts`), comparte una única promesa de preparación entre llamantes concurrentes (una sola descarga/carga), solicita un consentimiento único y persistente antes de la primera descarga grande, reutiliza modelos ya cacheados y funciona offline si ya se preparó. La búsqueda semántica (embeddings) se prepara e indexa automáticamente cuando la recuperación la necesita o al importar contenido, con deduplicación de trabajos, cancelación y degradación honesta a recuperación léxica si falla. Límites de proveedor explícitos: `demo`, `ollama` y `openai` nunca cargan WebLLM ni cambian de proveedor en silencio (`localAiRuntime.ts`, `localLlm/capabilities.ts`, `localLlm/selection.ts`, `localRag/retrieval.ts`, `ai/aiService.ts`, `components/ai/AIAssistantDrawer.tsx`, `pages/SettingsView.tsx`).

19. Buscador global como paleta de comandos (Ctrl+K / Cmd+K): `Ctrl+K`/`Cmd+K` alterna una paleta que busca y salta a cursos, libros, lecciones, notas, conceptos y acciones. Toda la inteligencia es **pura y sin dependencias** en `services/commandPalette.ts`. **Cero consultas por pulsación**: el catálogo se construye en memoria con los cursos, libros y notas que `useAppData` ya tiene, más tres índices planos y de una sola consulta (`dao.getLessonIndex()`, `dao.getConceptIndex()` y `dao.getResourceIndex()`), preparados con una única promesa deduplicada al abrir y cacheados hasta la siguiente mutación del grafo; por eso la paleta coincide desde el PRIMER carácter y no hereda el mínimo de 2 caracteres de `searchKnowledge`. Los tres índices viven en `App.tsx` y **no** en `useAppData`: son datos de pantalla, no de arranque, y cargar un PDF por documento importado al iniciar la app sería un coste que el usuario paga siempre para usar Ctrl+K una vez.

    **Los recursos importados también son de primera clase.** `getResourceIndex()` devuelve las filas de `learning_resource` cuyo `type` NO es `course` ni `book`, porque esas dos ya llegan por `getCourses()` y `getBooks()`: incluirlas otra vez mostraría el mismo documento dos veces con dos iconos. Antes, un PDF importado era alcanzable por la búsqueda de la Biblioteca, era nodo del grafo y tenía `ResourceDetail`, pero **no se encontraba desde Ctrl+K**. Un punto de entrada global que no llega al contenido del usuario no es global.

    **Escalera de puntuación** (`PALETTE_SCORE`, excluyentes de arriba abajo): `exact` > `prefix` > `wordStart` > `substring` > `subtitle` > `keyword` > `body` > `fuzzy`. Cada nivel se evalúa sobre el campo que le corresponde y en ese orden, así que una coincidencia real en el título siempre gana a una difusa en el subtítulo. El título manda sobre todo lo demás, y `wordStart` gana a `substring` aunque la primera ocurrencia sea interna. El desempate es explícito (título y luego id) para que la misma entrada produzca siempre la misma lista.

    **Tres niveles de coincidencia**, y por qué existen:
    - `body` (120): busca en el **cuerpo** de notas y lecciones, no solo en títulos. Sin él la paleta sería PEOR que la búsqueda anterior del header, porque `dao.searchKnowledge` sí buscaba en `note.content`. El cuerpo se indexa en `body` y se pre-normaliza en `bodyNormalized` al construir el catálogo, acotado a `PALETTE_BODY_MAX_CHARS`: renormalizarlo en cada pulsación sería el cuello de botella. El subtítulo de una nota es un resumen de 80 caracteres, NUNCA el cuerpo entero (una nota de 4000 caracteres sigue siendo 4000 nodos de texto en el DOM y además taparía el nivel `body`).
    - `fuzzy` (100/90/80): subsecuencia puntuada por **densidad**, para que la red de seguridad ordene lo relevante por delante de lo meramente posible. Exige `PALETTE_FUZZY_MIN_LENGTH = 3`: sin ese mínimo cualquier trigrama casaría con media biblioteca. Solo se resaltan coincidencias **contiguas**; una subsecuencia no forma un tramo que se pueda marcar sin inventar caracteres intermedios, y por eso se distingue por aparecer al final de la lista.
    - `matchPaletteItems` es lo que consume el componente y devuelve, además del elemento, los rangos a resaltar y un `matchedBody`, para que la fila pueda mostrar el **fragmento que casó** y contestar "¿por qué aparece esto?". `filterPaletteItems` es un envoltorio para quien solo necesite la lista.

    **Accesibilidad**: nivel `combobox` completo (`aria-expanded`, `aria-controls`, `aria-autocomplete`, `aria-activedescendant`, `listbox`/`option`/`group`), región `aria-live` con el recuento, foco contenido dentro del diálogo con Tab y restaurado al cerrar, overlay en `z-[70]` por encima del cajón IA y de `ConfirmDialog`, y estado activo marcado por forma y posición además de por color. El `listbox` se monta **siempre**, incluso vacío, y el mensaje de "Sin resultados" vive **fuera** de él: si no, `aria-controls` apuntaría a un id inexistente justo en el caso que más se necesita leer con lector de pantalla. El resaltado usa `<mark>` con segmentos como hijos de React, **nunca `dangerouslySetInnerHTML`**: una nota es contenido de usuario y debe MOSTRARSE, no interpretarse. El header es un disparador cuyo nombre accesible es su texto visible, "Buscar o ir a…" (WCAG 2.5.3 "Label in Name"): un `aria-label` que no lo contenga rompe el control por voz; el atajo se anuncia con `aria-keyshortcuts` (⌘K en Apple, Ctrl+K en el resto). La acción "Continuar aprendiendo" resuelve una sola lección pendiente con `getNextLessonForCourse`, y cualquier destino con `lessonId` abre la lección exacta en vez de solo el curso, algo que `Library.tsx` descartaba. Sin dependencias nuevas, sin red y sin esquema nuevo (`services/commandPalette.ts`, `components/common/CommandPalette.ts`, `hooks/useCommandPaletteHotkey.ts`, `db/dao.ts`, `App.tsx`, `components/layout/Shell.tsx`, `hooks/useTheme.ts`, `db/seedDemo.ts`, `tests/command_palette.test.ts`, `tests/command_palette_render.test.ts`).

    > **Atajo global frente a atajos de una sola tecla.** Todo handler de teclado que compare teclas **sin verificadores de modificador** (`LessonWorkspace.tsx`, `ReviewCenter.tsx`) debe empezar por `if (e.ctrlKey || e.metaKey || e.altKey) return;`. Sin esa guarda, `Cmd+L` saltaba −10 s, `Cmd+M` silenciaba y `Ctrl+K` pausaba el vídeo o calificaba la tarjeta a la vez que abría la paleta. Es un requisito, no una opcionalidad.

    > **Un solo `useTheme`, muchas vistas.** `hooks/useTheme.ts` es un almacén compartido con suscriptores, porque lo consumen la cabecera, Ajustes y la paleta. Con `useState` local en cada consumidor, la etiqueta de la paleta se quedaba desfasada en cuanto el usuario alternaba el tema desde el botón de la cabecera. Añade consumidores con `useTheme()` (o `setThemeMode`), nunca con un `useState` paralelo.

    > **La lógica que se puede probar, se extrae.** Ni `commandPalette.ts` ni `CommandPalette.ts` acceden a `dbBridge`, al DAO ni a la red, y el primero ni siquiera depende de React. La paleta solo lee `PaletteItem[]` ya construido y devuelve el elemento elegido; `App.tsx` es el único que decide qué hacer con cada acción. La vista sí toca el DOM, pero **solo dentro de efectos y manejadores**: durante el render no lo hace nunca, y esa garantía la demuestra la prueba 19.42 del fichero de render, que falla si alguna vez se cumple.

    > **Los guardas de carga también cuentan.** `useCommandPaletteHotkey` se registra antes de los guardas `loading` e `initError`, porque los hooks no pueden ir después de un `return` temprano. Pasa un manejador inerte mientras la app no esté lista, o pulsar Ctrl+K durante el arranque abrirá la paleta solo al terminar de cargar.

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

6. **Buscador por pulsación contra índice en memoria:**
   - `dao.searchKnowledge` está pensado para la vista de Biblioteca y golpea SQL en cada consulta, con un mínimo de **2 caracteres** y orden alfabético plano. La paleta global (`Ctrl+K` / `Cmd+K`) **no debe** reutilizarlo por pulsación: filtra un catálogo en memoria (`services/commandPalette.ts`), por lo que coincide desde el primer carácter, ordena por relevancia y no toca la base de datos. Las lecciones y los conceptos llegan al catálogo mediante los índices planos de una sola consulta `dao.getLessonIndex()` y `dao.getConceptIndex()`, cacheados con una promesa deduplicada; no añadas un DAO por tipo ni un `LIKE` por pulsación.

7. **Conflicto entre el atajo global y los atajos de una sola tecla:**
   - Los handlers de `LessonWorkspace.tsx` (espacio, `k`, `j`, `l`, `m`, `[`, `]`) y de `ReviewCenter.tsx` (espacio, `0`-`5`, `A`-`Z`) comparan `e.key` **sin mirar los modificadores**. Cualquier atajo global con Ctrl/Cmd debe añadir `if (e.ctrlKey || e.metaKey || e.altKey) return;` a esos handlers, o se ejecutarán los dos a la vez. Además, `isPaletteHotkey` es quien **exige** un modificador exacto: no lo rebajes a `Ctrl+K` sin comprobar `e.key`, ni admite Shift/Alt.

8. **Apariencia de un overlay nuevo:**
   - Los overlays del proyecto no usan `createPortal`: se montan en línea con `fixed inset-0` y su limpieza reproduce el ciclo de `ConfirmDialog.tsx` (`previouslyFocused` + `autoFocus` con `setTimeout`, Escape en un `window.addEventListener` registrado solo mientras está abierto y foco restaurado en el `cleanup` del efecto). La paleta vive en `z-[70]`, por encima del cajón IA (`z-50`) y de `ConfirmDialog` (`z-[60]`), y ambos overlays son excluyentes: abrir una cierra la otra. Reutiliza `Kbd`, `cn` y las primitivas de `components/ui/index.tsx`, y solo tokens semánticos de `index.css`.

9. **Auditar colores literales por subcadena es falso positivo:**
   - Las utilidades `translate-y-` y `-translate-x-` **contienen** la subcadena `slate-`. Al comprobar la Regla 5, exige el número de tono (`/\bslate-\d/`) o repetirás falsos positivos en cualquier componente que centra o traduce algo. La prueba `19.28` resuelve esto con `findLiteralPaletteColors`.

10. **Resaltar texto normalizado parte palabras por la mitad:**
    - `"Introducción"` mide **12** caracteres en NFC y **13** en NFD: la tilde se descompone en `o` + acento combinante. Cualquier `indexOf` sobre la forma normalizada devuelve offsets que **no** corresponden al texto original, y el `<mark>` cae en el sitio equivocado. El colapso de espacios también desplaza.
    - Por eso existe `normalizeWithMap(text)`, que devuelve `{ normalized, origin }` con el índice de origen de cada carácter normalizado, y **`normalizePaletteQuery` delega en ella**: si la aguja y el pajar usaran transformaciones distintas, los rangos quedarían desplazados sin que nada lo delatara.
    - Property test que hay que reejecutar si tocas esto: `segmentForHighlight(...).map(s => s.text).join('') === textoOriginal` (prueba `19.39`). Si el `join()` no devuelve el original, hay un desfase.
    - La contraparte es genérica: se normaliza **carácter a carácter**, porque un carácter original puede producir varios normalizados (ligaduras). Confiar en que NFD+strip es 1:1 funciona con el español y se rompe con cualquier otro texto.

11. **Auditar ARIA por texto de fuente no es probar el ARIA:**
    - Una prueba que hace `readFileSync(...).includes('aria-controls')` comprueba que **la cadena esté en el archivo**, no que el ARIA sea válido. Fue exactamente así como se colaron seis defectos en la paleta: la cadena estaba, el árbol no.
    - El runner `node --experimental-strip-types` **no puede importar `.tsx`** (elimina tipos, no JSX). Pero ese NO es un muro: el proyecto ya tiene la salida. `components/ai/MarkdownMessage.ts` está escrito en `.ts` con `createElement` **precisamente para poder testearlo**, y `tests/assistant_markdown.test.ts` lo renderiza con `renderToStaticMarkup` bajo el comando documentado.
    - Regla: **un componente que necesite pruebas de render se escribe en `.ts` con `createElement`**, como `MarkdownMessage.ts`. Es más verboso que JSX y ese es el precio, el mismo que ya pagó ese archivo. Escribirlo en `.tsx` no está prohibido, pero entonces sabe que su JSX queda sin verificar por la suite.
    - Obstáculo real si aún así importas un `.tsx`: `CommandPalette` necesita `cn` y `Kbd` de `components/ui/index.tsx`, que es `.tsx` e **no** se puede importar. Por eso existen `components/ui/primitives.ts` (los dos, ya en `createElement`) y se reexportan desde `ui/index.tsx` para no tocar a sus 17 consumidores.
    - No añadas jsdom, vitest ni esbuild para resolverlo: cambiaría el comando de pruebas documentado. Si aun así necesitas inspección visual del HTML, renderiza con `vite` en modo SSR **fuera de la suite** y borra el scratch después.
