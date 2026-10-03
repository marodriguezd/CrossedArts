# 🏛️ CrossedArts — Learning Operating System

<p align="center">
  <a href="https://marodriguezd.github.io/CrossedArts/">
    <img src="https://img.shields.io/badge/🚀%20Web%20App-Probar%20en%20GitHub%20Pages-7c3aed?style=for-the-badge&logo=githubpages&logoColor=white" alt="Probar en GitHub Pages" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Frontend-Vite%20%2B%20React%2019%20%2B%20TS-61dafb?style=flat&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Database-SQLite%20WASM%20%2B%20IndexedDB-003B57?style=flat&logo=sqlite&logoColor=white" alt="SQLite WASM" />
  <img src="https://img.shields.io/badge/Active%20Recall-SuperMemo--2%20(SM--2)-10b981" alt="Algoritmo SM-2" />
  <img src="https://img.shields.io/badge/Knowledge%20Graph-Vis.js%202D-818cf8" alt="Vis.js" />
  <img src="https://img.shields.io/badge/Backend%20Companion-FastAPI%20%2B%20SQLAlchemy-059669?style=flat&logo=fastapi" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Licencia-GPL--3.0--only-blue.svg" alt="Licencia: GPL-3.0-only" />
</p>

<p align="center">
  <a href="README.md">🇬🇧 Read in English</a> • <b>🇪🇸 Versión en Español</b>
</p>

---

🌐 **Acceso Directo a la Aplicación:** [https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

**CrossedArts** es un **Learning Operating System** (sistema operativo de aprendizaje personal) *local-first*, modular y diseñado con arquitectura **GitHub Pages First**.

Centraliza cursos multimedia, libros técnicos, notas de estudio en Markdown, tarjetas nemotécnicas de repetición espaciada (**SuperMemo-2**) y un grafo de conocimiento interactivo 2D, ejecutando toda la base de datos relacional SQLite directamente dentro de tu navegador web sin requerir servidores ni suscripciones externas.

Para un desglose detallado de la filosofía, ciencia cognitiva y arquitectura del sistema, consulta [ABOUT.md](ABOUT.md).

---

## ✨ Características Principales

### 1. Despliegue Estático en GitHub Pages & PWA Offline
- Funciona como una Single Page Application (SPA) ultra rápida sin necesidad de levantar contenedores, servidores o servicios en la nube.
- **PWA Shell Offline:** Dispone de Web App Manifest (`manifest.json`) y Service Worker (`sw.js`) que cachea el App Shell y el binario de WebAssembly `sql-wasm.wasm`, permitiendo arrancar CrossedArts sin conexión tras la primera visita.
- Despliegue continuo automatizado con GitHub Actions en `.github/workflows/deploy.yml`.
- Pruébala en vivo sin instalar nada: [marodriguezd.github.io/CrossedArts](https://marodriguezd.github.io/CrossedArts/).

### 2. Motor SQLite en WebAssembly & Control de Datos del Usuario
- Motor SQLite compilado a WebAssembly (`sql.js`) ejecutado directamente en el navegador.
- Sincronización transparente con `IndexedDB` (`CrossedArts_IDB`) con reporte explícito de estados de persistencia (`ready`, `persisting`, `persisted`, `corrupt-storage`, `storage-unavailable`).
- Esquema relacional completo (`learning_resource`, `course`, `book`, `module`, `lesson`, `note`, `flashcard`, `concept`, `knowledge_connection`, `learning_session`).
- **Portabilidad y Límites del Respaldo:**
  - Exportación e importación binaria `.crossedarts.sqlite` con verificación estricta de cabecera SQLite 3 y esquema de tablas.
  - El respaldo incluye el 100% de tus cursos, libros, notas, tarjetas y grafo conceptual.
  - Los archivos de vídeo y audio locales no se duplican dentro de SQLite; tras restaurar la base de datos en otro equipo, basta volver a vincular la carpeta de medios.

### 3. Integración de Carpetas Locales (File System Access API)
- Implementada mediante la **File System Access API** estándar (`window.showDirectoryPicker`) en navegadores Chromium (Chrome, Edge, Brave).
- Escanea de forma recursiva carpetas de cursos locales y empareja deterministamente archivos multimedia con las lecciones.
- Los archivos permanecen en tu disco duro sin duplicación; genera streams efímeros `URL.createObjectURL()` en memoria por sesión y los revoca automáticamente sin persistir URLs temporales `blob:` ni handles nativos en SQLite.
- La experiencia inicial con datos demo es 100% funcional sin conexión ni dependencias de medios remotos.

### 4. Sesiones de Estudio Locales Unificadas (Repaso Activo, Práctica y Progreso)
- **Un único flujo coherente:** inicia una sesión de estudio, repasa las tarjetas pendientes, responde preguntas de práctica fundamentadas y termina con un resumen local de progreso.
- **Modalidades de estudio:** `flashcards` (tarjetas pendientes SM-2), `practice` (preguntas generadas de sesión efímera) y `mixed` (determinista: primero tarjetas pendientes, después práctica).
- **Algoritmo SuperMemo-2 (SM-2):** se reutiliza como única autoridad de programación, calculando el Factor de Facilidad (mínimo 1.30), repeticiones e intervalos óptimos según la curva del olvido de Hermann Ebbinghaus. Se expone la escala completa 0–5 con el próximo intervalo real calculado.
- **Ciclo de vida:** `idle → starting → active → paused → completed`, con comportamiento seguro `cancelled`/`failed`. Cada repaso se persiste por tarjeta, por lo que una recarga inesperada nunca los pierde; una sesión solo se reporta como completada cuando la persistencia tiene éxito.
- **Historial local:** los hechos de la sesión (inicio/fin, modalidad, tarjetas repasadas, preguntas respondidas, aciertos, recurso asociado) se guardan en la tabla existente `learning_session`. No se introduce un segundo historial ni un segundo sistema de programación.
- **Práctica efímera:** las preguntas y prompts generados nunca se almacenan de forma permanente; solo los contadores agregados forman parte del historial local.
- **Resumen honesto:** las calificaciones de tarjetas no se reducen a correcto/incorrecto, las preguntas reportan su resultado con normalidad y no se inventa una "puntuación de conocimiento" universal.

```text
Sesión de Estudio
   ↓
Tarjetas → SM-2 existente → historial de aprendizaje
   ↓
Preguntas de práctica → feedback local de sesión
   ↓
Resumen de sesión → progreso local
```

### 5. Espacio de Trabajo de la Lección (Unidad Central de Aprendizaje)
Cada lección es un espacio de trabajo local completo donde ocurre el aprendizaje, construido íntegramente sobre el modelo relacional existente (sin almacén de contenido paralelo).
- **Contenido:** Las lecciones tienen un campo editable `content` en texto plano / Markdown almacenado en la tabla existente `lesson` (migrada de forma idempotente). Se renderiza como datos, nunca como HTML arbitrario.
- **Panel del espacio de trabajo:** Título, contexto de módulo/curso, estado de finalización, duración, contenido, notas, recursos relacionados, medios locales, conceptos y progreso en un solo lugar (`components/lesson/LessonWorkspace.tsx`).
- **Ordenación:** `Subir` / `Bajar` reordena las lecciones de un módulo de forma determinista, normalizando posiciones a `1..N` sin duplicados y manteniendo los totales del curso consistentes.
- **Progreso:** `NOT_STARTED` / `IN_PROGRESS` / `COMPLETED` determinista según contenido propio, notas asociadas y relaciones explícitas (más el indicador de finalización existente); nunca un porcentaje inventado.
- **Continuar aprendiendo:** Una acción de continuación determinista elige la primera lección incompleta por orden de módulo/lección (o la última si el curso está completo). Sin puntuaciones de recomendación ni aprendizaje adaptativo.
- **Estudio e IA locales:** Estudiar, repasar, practicar, explicar y generar flashcards reutilizan el flujo existente de recuperación con ámbito y SM-2, siempre acotado a la lección.

### 6. Grafo de Conocimiento 2.0 y Organización de Recursos
- **Grafo local canónico:** `KnowledgeGraph.tsx` (carga perezosa, `vis-network`) representa nodos tipados de `course`, `book`, `module`, `lesson`, `note`, `concept` y `resource` importados. Las aristas estructurales (`contains`, `about`, `references`) se derivan deterministamente de las claves foráneas de SQLite; las flashcards y las sesiones de estudio **no** se convierten en nodos del grafo.
- **Relaciones explícitas controladas por el usuario:** Las conexiones manuales se validan (tipo soportado, nodos existentes, sin auto-enlaces, sin duplicados) y se persisten en la tabla existente `knowledge_connection`. Las relaciones huérfanas se podan sin dejar nodos colgantes.
- **Filtros, panel de detalle y navegación:** Filtra por categoría de nodo, selecciona uno para ver su tipo, metadatos y relaciones, y vuelve directamente al curso, lección, nota o recurso subyacente. Una lista textual de relaciones mantiene el grafo accesible sin depender del lienzo.
- **Organización de recursos:** Crea cursos/módulos/lecciones, edita metadatos de libros, asocia notas a recursos/lecciones y detecta documentos importados "sin organizar" para vincularlos a un curso más adelante. Cada recurso huérfano ofrece acciones **Abrir / Organizar / Estudiar**.
- **Vistas de detalle unificadas:** Cursos, libros, lecciones, notas, recursos importados y conceptos se abren en un destino dedicado. `ResourceDetail.tsx` muestra metadatos, contenido extraído (tratado como datos, nunca como HTML arbitrario), estado de indexación y una sección **Relacionado** construida con el grafo canónico y las relaciones relacionales. Los libros conservan su progreso y edición de metadatos; los recursos importados exponen archivo, huella SHA-256 y fragmentos.
- **Búsqueda local determinista:** Encuentra cursos, libros, lecciones, notas, conceptos y recursos importados con coincidencia SQL simple, sin embeddings, WebGPU ni LLM, y abre cualquier resultado directamente.
- **Ámbito de estudio por lección:** Inicia una sesión desde una lección para priorizar esa lección, sus notas/recursos asociados y sus vecinos directos. El ámbito se guarda en la tabla existente `learning_session` (`lesson_id`), de modo que el historial identifica lo estudiado, y fluye por la misma capa de recuperación hacia las acciones de IA fundamentadas (explicar, flashcards, práctica).
- **Recuperación con ámbito:** Al estudiar dentro de un recurso, el RAG híbrido aplica un impulso determinista y pequeño al recurso seleccionado y sus vecinos directos, sin anular la relevancia léxica/semántica fuerte.
- **Relaciones canónicas únicamente:** Los tipos de relación válidos están centralizados (`GRAPH_RELATION_TYPES`), las conexiones se validan antes de persistir, las conexiones huérfanas se excluyen del render y solo se podan mediante un camino de limpieza explícito. Las relaciones son datos canónicos locales: sin descubrimiento semántico automático.
- **Confirmaciones accesibles:** Las acciones destructivas (curso/módulo/lección/relación) usan un `ConfirmDialog` reutilizable con consecuencia explícita, Escape para cancelar, gestión de foco y semántica para lectores de pantalla.

```text
Curso
   ↓
Módulo
   ↓
Espacio de trabajo de la lección
   ├── Contenido
   ├── Notas
   ├── Recursos
   ├── Medios
   ├── Conceptos
   ├── Progreso
   └── Estudio local
   ↓
Relaciones canónicas del grafo en SQLite
   ↓
Interfaz del Grafo de Conocimiento
   ↓
Vista de detalle del recurso
   ├── Conocimiento relacionado
   ├── Estudio (SM-2 + práctica)
   ├── RAG local
   └── IA local
   ↓
flujo de estudio
```

### 7. IA Nativa en Dispositivo (WebLLM + RAG Semántico Híbrido)
- **Inferencia 100% on-device:** Motor LLM ejecutado directamente en el navegador con **WebLLM** vía **WebGPU**. Cero llamadas al exterior tras la descarga, sin clave de API y con total privacidad.
- **Descarga Inicial y Cacheado:** La inferencia local corre en el dispositivo del usuario cuando hay soporte WebGPU. El modelo seleccionado requiere descargarse la primera vez; las inferencias posteriores se ejecutan desde el modelo cacheado localmente en IndexedDB.
- **Modelos Verificados:** Compatible con `Qwen3-1.7B-q4f16_1-MLC` (por defecto), `Llama-3.2-1B-Instruct-q4f16_1-MLC`, `SmolLM2-1.7B-Instruct-q4f16_1-MLC` y `Qwen3-0.6B-q4f16_1-MLC`.
- **RAG Híbrido Semántico y Léxico:**
  - **Embeddings en Navegador:** Generación de representaciones vectoriales con Transformers.js y `Xenova/multilingual-e5-small` (basado en `intfloat/multilingual-e5-small`, licencia MIT, ONNX cuantizado q8, 384 dimensiones, 94 idiomas, ~135 MB).
  - **Prefijos E5 Semánticos:** Aplicación estricta de `query: ` en consultas y `passage: ` en materiales indexados.
  - **Aislamiento de Vectores & Hashing Criptográfico:** Persistencia vectorial en almacén IndexedDB dedicado (`CrossedArts_Embeddings`), manteniendo el fichero `.crossedarts.sqlite` 100% puro y ligero. Recomputación exclusiva de fragmentos modificados mediante hashing SHA-256 autoritativo (`crypto.subtle`) y versionado de pipeline (`v1.1-e5-sha256`).
  - **Fusión Calibrada y Deduplicación:** Umbrales separados para candidatos léxicos y semánticos, fusión de rangos RRF y deduplicación por fuente con fallback inmediato a léxico puro si no hay modelo o índice disponible.
- **Tutor Híbrido Multimodo:**
  - **Local On-Device (WebLLM):** Inferencia privada en GPU local con liberación explícita de VRAM en Ajustes.
  - **Modo Demo Heurístico:** 100% desconectado, cero llamadas de red y respuestas pedagógicas basadas en reglas.
  - **Modo Ollama Local:** Conexión directa a tus modelos LLM locales (`http://localhost:11434`).
  - **Modo Proveedores Externos:** Compatible con OpenAI mediante clave en `localStorage`.

### 7. Ingestión de Documentos Locales y RAG de Extremo a Extremo
- **Extracción Local sin Nube:** Importa documentos `.txt`, `.md`, `.pdf` y `.epub` directamente en el navegador con 0 peticiones a servidores externos o servicios de OCR remotos.
- **Recursos de Aprendizaje de Primera Clase:** El contenido extraído se integra en las tablas relacionales de SQLite (`learning_resource` y `note`) con título, autor y metadatos verificables de página y capítulo.
- **Destino y Asociación de Recursos:** Permite importar como material independiente, nuevos libros en Biblioteca, o vincular notas directamente a cursos y lecciones existentes.
- **Acciones Pedagógicas Fundamentadas:** Utiliza el asistente en el dispositivo para explicar recursos con citaciones exactas, negándose explícitamente a inventar detalles si el contexto local es insuficiente.

```text
Archivo local (.txt, .md, .pdf, .epub)
   ↓
Parser en navegador (SHA-256 Web Cryptography)
   ↓
Recurso de aprendizaje CrossedArts (SQLite WASM)
   ↓
Fragmentos deterministas (con página y capítulo)
   ↓
RAG híbrido (léxico + embeddings locales)
   ↓
Respuesta fundamentada con WebLLM local
```

### 8. Backend Complementario (Opcional)
- Servidor REST en `backend/` construido con **FastAPI**, **SQLAlchemy 2.0** y **Alembic**.
- Diseñado para análisis avanzado, ingesta masiva por lotes (extracción de PDF, EPUB, metadatos y transcripciones de vídeo) y búsqueda semántica vectorial.

---

## 📁 Estructura del Repositorio

```text
CrossedArts/
├── frontend/                     # Aplicación Web Client-Side (React 19 + Vite)
│   ├── public/                   # Binarios WASM (sql-wasm.wasm) y favicon
│   ├── src/
│   │   ├── ai/                   # Servicio de tutor IA híbrido (aiService.ts)
│   │   ├── components/           # Componentes de UI (Navbar, Asistente IA, etc.)
│   │   ├── db/                   # Puente SQLite WASM, esquemas DDL, DAO y backups
│   │   ├── lib/                  # Motores de IA local, embeddings, RAG híbrido e ingestión
│   │   ├── pages/                # Vistas: Dashboard, Biblioteca, Repaso, Grafo, etc.
│   │   └── types/                # Modelos de datos TypeScript (models.ts)
│   └── tests/                    # Flota de pruebas de integración Zero-Web-Access (143 tests)
├── backend/                      # Servidor API complementario opcional (Python / FastAPI)
│   ├── alembic/                  # Migraciones de base de datos relacional
│   ├── app/
│   │   ├── api/                  # Endpoints REST (/api/v1)
│   │   ├── core/                 # Configuración, base de datos y utilidades
│   │   ├── models/               # Modelos ORM de SQLAlchemy
│   │   ├── schemas/              # Esquemas Pydantic
│   │   └── services/             # Ingesta, embeddings, LLM, escáner de contenidos
│   └── tests/                    # Pruebas unitarias y de integración de backend
├── static/                       # Portadas y recursos multimedia compartidos
├── .github/workflows/deploy.yml  # Automatización de despliegue a GitHub Pages
├── ABOUT.md                      # Filosofía, arquitectura y diseño conceptual
├── AGENTS.md                     # Guía técnica maestra para agentes y desarrolladores
├── README.md                     # Documentación principal en inglés
└── README.es.md                  # Esta documentación en español
```

---

## 🚀 Inicio Rápido: Aplicación Web

### Requisitos
- **Node.js:** Versión 20 o superior
- **Navegador Moderno:** Chrome, Edge, Brave o Firefox con soporte para WebAssembly

### Desarrollo Local
```bash
# 1. Clonar el repositorio
git clone https://github.com/marodriguezd/CrossedArts.git
cd CrossedArts/frontend

# 2. Instalar dependencias
npm install

# 3. Iniciar el servidor de desarrollo
npm run dev
```

La aplicación estará disponible inmediatamente en `http://localhost:5173`.

### Ejecutar Pruebas (Flota Zero-Web-Access)
El proyecto incluye 143 pruebas de integridad que validan la inicialización de SQLite sin red, el algoritmo SM-2, las sesiones de estudio unificadas, el espacio de trabajo de la lección (edición de contenido, ordenación, progreso, continuación), la integridad y migración del grafo de conocimiento, la organización y el detalle de recursos, el estudio con ámbito de lección, las confirmaciones accesibles, los volcados binarios/JSON, la IA local, el RAG híbrido, la ingestión de documentos y la generación de estudio fundamentada:

```bash
cd frontend
npm test
# O alternativamente con el runner nativo de Node:
node --test --experimental-strip-types tests/*.test.ts
```

### Compilar y Previsualizar Localmente
```bash
cd frontend
npm run build
npm run preview
```
Los archivos optimizados para producción estática se generan en `frontend/dist/`.

---

## 🌐 Publicación en GitHub Pages

1. Haz un **Fork** o clona este repositorio en tu cuenta de GitHub.
2. Ve a la pestaña **Settings** > **Pages** de tu repositorio.
3. En la sección **Build and deployment** > **Source**, selecciona **GitHub Actions**.
4. Cada `git push` a la rama `main` compilará y desplegará automáticamente la aplicación en `https://<tu-usuario>.github.io/<tu-repo>/`.

---

## 🐍 Backend Complementario (Opcional)

Si deseas utilizar el servidor auxiliar en Python para ingesta local masiva de archivos o búsqueda semántica:

```bash
# 1. Crear y activar entorno virtual en la raíz del proyecto
python -m venv .venv
source .venv/bin/activate  # En Windows: .venv\Scripts\activate

# 2. Instalar dependencias
pip install -r backend/requirements.txt

# 3. Aplicar migraciones de base de datos
PYTHONPATH=. alembic -c backend/alembic.ini upgrade head

# 4. Iniciar el servidor FastAPI (sirve la API y monta frontend/dist si está compilado)
python -m backend.app.main
```
El servidor API se iniciará en `http://127.0.0.1:8080` (con documentación interactiva en `/docs`).

---

## 💾 Copias de Seguridad y Soberanía de Datos

En la pestaña **Ajustes** de CrossedArts puedes gestionar tu información con total libertad:
* **Exportar SQLite (.sqlite):** Descarga la base de datos relacional nativa legible por DB Browser for SQLite u otras herramientas SQL.
* **Importar SQLite (.sqlite):** Restaura cualquier base de datos previa al instante.
* **Exportar Respaldo JSON:** Genera un volcado estructurado con todas las tablas y relaciones.
* **Restaurar Respaldo JSON:** Recupera tus datos desde cualquier volcado de texto JSON.

---

## 📄 Licencia

License: GNU General Public License v3.0 only (GPL-3.0-only)

Consulta el archivo [LICENSE](LICENSE) para ver el texto completo de la licencia.

### Licencias de Terceros y Modelos

Las dependencias externas y modelos conservan sus respectivas licencias originales:
- `Xenova/multilingual-e5-small`: Licencia MIT
- WebLLM (`@mlc-ai/web-llm`): Licencia Apache-2.0
- Transformers.js (`@huggingface/transformers`): Licencia Apache-2.0
- SQLite WASM (`sql.js`): Licencia MIT

