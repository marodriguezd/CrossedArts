# 🏛️ CrossedArts — Acerca del Proyecto y Manifiesto

<p align="center">
  <a href="https://marodriguezd.github.io/CrossedArts/">
    <img src="https://img.shields.io/badge/🚀%20Web%20App-Acceder%20a%20CrossedArts%20en%20GitHub%20Pages-7c3aed?style=for-the-badge&logo=githubpages&logoColor=white" alt="Acceder a GitHub Pages" />
  </a>
</p>

> **"Un Learning Operating System personal, libre, privado y local-first donde el conocimiento pertenece exclusivamente a quien lo cultiva."**

🌐 **Despliegue Oficial en Vivo:** [https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

---

## 1. Visión y Filosofía

El ecosistema actual de educación digital y gestión del conocimiento se encuentra fragmentado en plataformas cerradas, plataformas de suscripción mensual efímeras y servicios en la nube que condicionan el acceso a tus propios datos.

**CrossedArts** nace con una premisa innegociable: **Soberanía Cognitiva del Estudiante**.

1. **Local-First & Client-Side First:** La aplicación se ejecuta de forma nativa e integral en tu navegador o estación de trabajo. No requiere servidores intermediarios para estudiar, consultar notas, gestionar cursos o repasar tarjetas nemotécnicas.
2. **Privacidad y Zero-Cloud:** Tus notas, tus progresos, tus índices relacionales y tus métricas de estudio residen en tu máquina (vía SQLite compilado en WebAssembly persistido en IndexedDB). No hay telemetría invasiva ni recolección de datos personales.
3. **Cero Duplicación de Medios:** Gracias a la **File System Access API**, puedes reproducir lecciones en vídeo y consultar documentación directamente desde las carpetas de tu disco duro sin necesidad de subir gigabytes a la memoria del navegador ni duplicar espacio en disco.
4. **Respaldo Universal y Sin Cautiverio (No Vendor Lock-In):** Todos tus datos son exportables en cualquier momento como base de datos binaria estándar `.sqlite` (legible por cualquier gestor SQLite del mundo) o como volcado JSON abierto.

---

## 2. La Evolución: De DomestiK a CrossedArts

El proyecto se originó bajo el nombre en clave **DomestiK**, concebido como un monolito local en Python impulsado por FastAPI, SQLAlchemy, Alembic y NiceGUI. Si bien ofrecía robustez de backend, dependía de un entorno Python activo, puertos de red locales y dependencias del sistema operativo que dificultaban la inmediatez de uso para estudiantes en cualquier dispositivo.

En su segunda generación, el proyecto evolucionó a **CrossedArts**, acometiendo una transformación arquitectónica radical:

* **Arquitectura "GitHub Pages First":** Se reimplementó la interfaz completa en **React 19**, **TypeScript** y **Vite**, permitiendo que toda la aplicación se compile y sirva estáticamente a través de GitHub Pages con coste cero y disponibilidad inmediata desde cualquier navegador moderno.
* **Persistencia Relacional en WebAssembly:** Se portó la lógica de datos a **SQLite WASM (`sql.js`)** con sincronización automática en **IndexedDB**, garantizando transacciones relacionales ACID completas en memoria del navegador sin servidor backend.
* **Backend Python Preservado como Compañero Avanzado:** El backend original de FastAPI/SQLAlchemy se mantiene estructurado y limpio en el directorio `backend/`. Actúa como motor analítico opcional para aquellos usuarios que deseen ingesta masiva por lotes (análisis de PDF/EPUB, transcripciones de vídeo automáticas, extracción de portadas) y servicios de embeddings semánticos locales con LangChain y Sentence Transformers.

---

## 3. Pilares Tecnológicos del Sistema

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CROSSEDARTS ARCHITECTURE                        │
├───────────────────────────────────┬────────────────────────────────────┤
│         FRONTEND WEB APP          │          BACKEND COMPANION         │
│   (GitHub Pages / 100% Client)    │        (FastAPI / Optional)        │
├───────────────────────────────────┼────────────────────────────────────┤
│ • React 19 + TypeScript + Vite    │ • FastAPI REST API (/api/v1)       │
│ • Tailwind CSS + Lucide Icons     │ • SQLAlchemy 2.0 ORM + Alembic     │
│ • SQLite WASM (sql.js)            │ • Ingestion Engine (PDF, EPUB, MP4)│
│ • IndexedDB Persistence Bridge    │ • Sentence Transformers Embeddings │
│ • File System Access API (Stream) │ • LangChain Hybrid LLM Services    │
│ • Active Recall: Algoritmo SM-2   │ • Media & Thumbnail Scanner        │
│ • Vis.js Interactive 2D Graph     │ • SQLite Local Storage (~/.crossedarts)│
│ • Hybrid AI Tutor (Demo/Ollama/API)│                                   │
└───────────────────────────────────┴────────────────────────────────────┘
```

### 3.1. Base de Datos SQLite en el Navegador (WASM + IndexedDB)
CrossedArts ejecuta un motor SQLite compilado a WebAssembly (`sql.js`) directamente en el entorno de ejecución del navegador.
* **Ciclo de Persistencia:** Al abrir la aplicación, el puente `sqliteBridge.ts` carga el binario WASM (`public/sql-wasm.wasm`), recupera el flujo de bytes de la base de datos desde `CrossedArts_IDB` (IndexedDB) y monta la base de datos relacional. Si es la primera visita, ejecuta el DDL de `schema.ts` y siembra el dataset pedagógico de demostración (`seedDemo.ts`).
* **Operaciones ACID:** Cada creación de notas, progreso de lectura, lección completada o tarjeta repasada se ejecuta mediante consultas SQL relacionales parametrizadas y se sincroniza atómicamente con IndexedDB.
* **Esquema Relacional Unificado:**
  * `learning_resource`: Entidad base polimórfica (cursos y libros).
  * `course`, `module`, `lesson`: Estructura jerárquica de cursos multimedia.
  * `book`: Seguimiento de páginas leídas y porcentaje de lectura.
  * `note`: Anotaciones de estudio enriquecidas con etiquetas y vinculación contextual.
  * `flashcard`: Tarjetas nemotécnicas con métricas de repetición espaciada.
  * `concept`, `knowledge_connection`: Nodos y aristas direccionales ponderadas del grafo de conocimiento.
  * `learning_session`: Sesiones de estudio unificadas (modo, inicio/fin, duración, tarjetas repasadas, preguntas respondidas, aciertos, recurso asociado y estado `active`/`completed`/`cancelled`). Es el único historial de aprendizaje, por lo que no se duplica la infraestructura de progreso.

### 3.2. File System Access API: Integración de Carpetas Locales
Uno de los mayores retos de los LMS basados en navegador es la gestión de cursos con gigabytes de vídeo en alta resolución. 
CrossedArts incorpora la **File System Access API** (`window.showDirectoryPicker`):
* El usuario autoriza el acceso a la carpeta donde residen sus cursos en su disco duro.
* El servicio `localMediaService.ts` recorre recursivamente el directorio, descubre archivos de medios soportados (`.mp4`, `.webm`, etc.) y aplica reglas de emparejamiento deterministas (por ruta relativa o por tallo de título/archivo).
* Los reproductores de vídeo consumen streams efímeros en memoria (`URL.createObjectURL(file)`) que se revocan proactivamente al cambiar de lección o salir del curso. Los handles nativos y URLs temporales nunca se persisten en SQLite, garantizando aislamiento estricto y cero duplicación de almacenamiento.

### 3.3. Centro de Estudio Unificado: Algoritmo SuperMemo-2 (SM-2)
Las interacciones de estudio de CrossedArts se articulan como un **flujo coherente**: una sesión de estudio local puede repasar tarjetas pendientes con SM-2, plantear preguntas de práctica fundamentadas y finalizar con un resumen de progreso. Existen tres modalidades deterministas (`flashcards`, `practice` y `mixed`), sin algoritmos adaptativos ni gamificación.

La memoria humana sigue la curva del olvido descubierta por Hermann Ebbinghaus. Para contrarrestar la pérdida de retención, CrossedArts implementa el algoritmo matemático **SuperMemo-2 (SM-2)**:
* **Calificaciones de Repaso (Grades 0 a 5):**
  * `0`: Apagón mental absoluto.
  * `1`: Respuesta errónea tras esfuerzo.
  * `2`: Respuesta errónea pero con familiaridad.
  * `3`: Respuesta correcta recordada con gran esfuerzo.
  * `4`: Respuesta correcta con ligera duda.
  * `5`: Respuesta correcta perfecta e instantánea.
* **Cálculo de Intervalos y Factor de Facilidad:**
  $$\text{EF}' = \max\left(1.3, \text{EF} + (0.1 - (5 - q) \times (0.08 + (5 - q) \times 0.02))\right)$$
  Donde $q$ es la calificación obtenida y $\text{EF}$ es el Ease Factor (iniciado en 2.5). Los intervalos crecen exponencialmente para fijar el conocimiento en la memoria de largo plazo.
* **Ciclo de vida de la sesión:** `idle → starting → active → paused → completed`, con cancelación segura (`cancelled`). Cada repaso se persiste de inmediato en SQLite, de modo que una recarga del navegador no los pierde; la sesión nunca se reporta como completada si la persistencia falla. Las preguntas de práctica son efímeras por defecto y solo los contadores agregados se incorporan al historial local.
* **Integridad de la racha:** una sesión solo cuenta si hubo actividad real de estudio, varias sesiones del mismo día cuentan como un único día, los registros con fecha futura no cuentan y se mantiene el cálculo determinista existente.

### 3.4. Espacio de Trabajo de la Lección (Unidad Central de Aprendizaje)
La lección deja de ser solo una fila de metadatos para convertirse en el lugar donde realmente ocurre el aprendizaje. Todo se construye sobre el modelo relacional existente, sin crear un almacén de contenido paralelo.
* **Contenido editable:** la tabla `lesson` incorpora un campo `content` (texto plano / Markdown) añadido por migración idempotente. Se muestra como datos y nunca se interpreta como HTML arbitrario.
* **Panel único:** título, contexto de módulo/curso, estado, duración, contenido, notas, recursos, medios locales, conceptos y progreso conviven en `components/lesson/LessonWorkspace.tsx`.
* **Ordenación determinista:** `Subir`/`Bajar` reordena las lecciones de un módulo normalizando posiciones a `1..N` sin duplicados y recalculando los totales del curso mediante `recalculateCourseTotals()`.
* **Progreso honesto:** `NOT_STARTED` / `IN_PROGRESS` / `COMPLETED` se derivan de actividad real (contenido propio, notas asociadas, relaciones explícitas) más el indicador de finalización existente. No se inventa ningún porcentaje sin significado subyacente.
* **Continuar aprendiendo:** una acción determinista selecciona la primera lección incompleta por orden de módulo/lección (o la última si el curso está completo). Sin puntuaciones de recomendación ni aprendizaje adaptativo.
* **Contenido como texto canónico:** el contenido de la lección participa en la recuperación léxica y en el chunking semántico con SHA-256. Editar una lección invalida únicamente su fragmento, no todo el índice.
* **Estudio local:** estudiar, repasar, practicar, explicar y generar flashcards reutilizan el flujo existente (RAG con ámbito + WebLLM) sin rutas específicas de lección.

### 3.5. Grafo de Conocimiento 2.0 (2D Force-Directed, Local-First)
Impulsado por `vis-network` y cargado de forma perezosa, el grafo de conocimiento ya no es una visualización aislada de conceptos: representa la estructura real de aprendizaje almacenada en SQLite.
* **Tipos de nodo:** `course`, `book`, `module`, `lesson`, `note`, `concept` y `resource` (documentos importados). Las flashcards y las sesiones de estudio no se exponen como nodos porque no representan conocimiento estructurado.
* **Aristas estructurales derivadas:** `course → contains → module`, `module → contains → lesson`, `lesson → references → note` y `note → about → resource` se calculan deterministamente desde las claves foráneas existentes (no se duplican relaciones).
* **Relaciones explícitas del usuario:** se almacenan en la tabla canónica `knowledge_connection` con tipos validados (`contains`, `references`, `teaches`, `discusses`, `related_to`, `requires`, `builds_on`, `about`). La creación manual valida existencia de extremos, ausencia de auto-enlaces y de duplicados; las relaciones colgantes se podan al eliminar recursos.
* **Navegación e integración de estudio:** cada nodo permite volver al curso, lección, nota o recurso correspondiente y lanzar las acciones de estudio/revisión/práctica/explicación existentes. El grafo es una capa de navegación alrededor del sistema de aprendizaje, no una segunda aplicación.
* **Accesibilidad:** además del lienzo, el panel de detalle ofrece una representación textual seleccionable de las relaciones del nodo, de modo que comprender el grafo no depende solo de la inspección visual.
* **Integración con el RAG:** la recuperación híbrida puede recibir un ámbito (recurso o lección activos) y aplicar un impulso determinista y acotado al recurso seleccionado y sus vecinos directos, sin sobreescribir arbitrariamente la relevancia léxica/semántica.

### 3.6. Vistas de Detalle de Recursos
Cada entidad de aprendizaje tiene un destino coherente. La búsqueda local y el grafo convierten cualquier resultado o nodo en una acción determinista sin depender de IA ni de red.
* **Destinos por tipo:** curso (`CourseDetail`), lección (lección activa dentro del curso), nota (`NotesView`), y libro, recurso importado y concepto (vista unificada `ResourceDetail`).
* **Detalle del recurso:** `ResourceDetail` muestra título, tipo, categoría, estado, autor, archivo, huella SHA-256, fecha de importación, número de fragmentos indexados y la sección "Relacionado". El contenido extraído se inspecciona como texto plano (datos), nunca como HTML arbitrario.
* **Relaciones canónicas:** la sección "Relacionado" se construye exclusivamente con relaciones explícitas (`knowledge_connection`) y derivadas de claves foráneas. No existe descubrimiento semántico automático de relaciones.
* **Ámbito de lección:** iniciar el estudio desde una lección prioriza esa lección y su contenido asociado, y el ámbito se registra en `learning_session.lesson_id`, de modo que el historial identifica lo estudiado sin crear una segunda tabla.
* **Confirmaciones accesibles:** las acciones destructivas (curso, módulo, lección, relación) usan un `ConfirmDialog` reutilizable con consecuencia explícita, Escape para cancelar y gestión de foco.
* **Local-first:** navegación, detalle, búsqueda y edición de relaciones funcionan sin backend, WebGPU, embeddings ni WebLLM.

### 3.7. Tutor Académico Pedagógico (Asistente Híbrido con RAG Semántico Local)
El asistente virtual (`aiService.ts`) ofrece cuatro modalidades pedagógicas de interacción:
1. **Modo Local On-Device (WebLLM + WebGPU):** Inferencia 100% en dispositivo mediante modelos SLM como `Qwen3 1.7B`, `Llama 3.2 1B` o `SmolLM2 1.7B`. Descarga los pesos a la caché de IndexedDB y no requiere servidor ni clave de API.
2. **RAG Local Híbrido con Embeddings en Navegador:** Recuperación de contexto combinando similitud léxica con embeddings matemáticos on-device (`Xenova/multilingual-e5-small` basado en `intfloat/multilingual-e5-small`, licencia MIT, en ONNX). Los vectores se aíslan en la base de datos `CrossedArts_Embeddings` de IndexedDB con versionado de pipeline (`v1.1-e5-sha256`) y los fragmentos se invalidan de forma incremental mediante hashing criptográfico SHA-256 (`crypto.subtle`). Aplica prefijos canónicos (`query: ` / `passage: `) y normalización L2 estricta a 384 dimensiones.
3. **Modo Demo Heurístico (100% Offline):** No realiza peticiones de red (0 web requests). Proporciona orientación pedagógica inmediata basada en reglas y sugerencias de estudio.
4. **Modo Ollama y Proveedores Externos:** Se conecta a instancias locales de Ollama (`http://localhost:11434`) o claves privadas de OpenAI en `localStorage` inyectando el contexto recuperado de SQLite.

---

## 4. Filosofía del Monorepo

El repositorio está organizado con un desacoplamiento estricto:

| Directorio | Responsabilidad | Dependencias Clave |
|---|---|---|
| `frontend/` | Aplicación de usuario final en GitHub Pages / Navegador | React 19, TypeScript, Vite, Tailwind, sql.js, vis-network |
| `backend/` | Servidor API auxiliar, extracción de contenidos y búsqueda semántica | FastAPI, SQLAlchemy 2.0, Alembic, LangChain, PyPDF, DefusedXML |
| `static/` | Recursos gráficos y portadas de ejemplo | Imágenes y placeholders |

---

## 5. Compromiso con el Software Libre y Abierto

CrossedArts se distribuye bajo la licencia **GNU General Public License v3.0 only (GPL-3.0-only)**. Creemos que el software que gestiona la mente y el aprendizaje debe ser transparente, auditable, extensible y libre para cualquier persona en cualquier rincón del mundo, garantizando las cuatro libertades fundamentales del software libre y protegiendo el procomún abierto mediante copyleft. Consulta el archivo [LICENSE](LICENSE) para ver los términos oficiales completos.

Las dependencias externas y modelos de terceros (como `Xenova/multilingual-e5-small` bajo licencia MIT, WebLLM bajo Apache-2.0, Transformers.js bajo Apache-2.0 y SQLite WASM bajo MIT) conservan sus términos y licencias originales de forma independiente.
