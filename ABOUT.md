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
  * `learning_session`: Registro cronológico y duración de sesiones de estudio.

### 3.2. File System Access API: Integración de Carpetas Locales
Uno de los mayores retos de los LMS basados en navegador es la gestión de cursos con gigabytes de vídeo en alta resolución. 
CrossedArts incorpora la **File System Access API** (`window.showDirectoryPicker`):
* El usuario autoriza el acceso a la carpeta donde residen sus cursos en su disco duro.
* El servicio `localMediaService.ts` recorre recursivamente el directorio, descubre archivos de medios soportados (`.mp4`, `.webm`, etc.) y aplica reglas de emparejamiento deterministas (por ruta relativa o por tallo de título/archivo).
* Los reproductores de vídeo consumen streams efímeros en memoria (`URL.createObjectURL(file)`) que se revocan proactivamente al cambiar de lección o salir del curso. Los handles nativos y URLs temporales nunca se persisten en SQLite, garantizando aislamiento estricto y cero duplicación de almacenamiento.

### 3.3. Centro de Repaso Cognitivo: Algoritmo SuperMemo-2 (SM-2)
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

### 3.4. Grafo de Conocimiento Interactivo (2D Force-Directed)
Impulsado por `vis-network`, el grafo de conocimiento renderiza un mapa visual conceptual con simulación física dinámica:
* Permite descubrir conexiones transversales entre lecciones de cursos técnicos, capítulos de libros y conceptos fundamentales.
* Los nodos representan conceptos o recursos formativos y las aristas representan relaciones tipadas (`requires`, `builds_on`, `related_to`) con pesos de afinidad.

### 3.5. Tutor Académico Pedagógico (Asistente Híbrido con RAG Semántico Local)
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
