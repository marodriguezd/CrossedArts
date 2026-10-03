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

### 4. Centro de Repaso Activo (Active Recall & Algoritmo SM-2)
- Tarjetas nemotécnicas con preguntas y respuestas.
- Algoritmo matemático **SuperMemo-2 (SM-2)** que calcula automáticamente el Factor de Facilidad (*Ease Factor*), repeticiones e intervalos óptimos según la curva del olvido de Hermann Ebbinghaus.

### 5. Grafo de Conocimiento Interactivo 2D
- Visualización conceptual mediante simulación física de partículas impulsada por `vis-network`.
- Conecta conceptos teóricos, cursos, libros y notas de estudio para navegar tu red de aprendizaje.

### 6. IA Nativa en Dispositivo (WebLLM + RAG Semántico Híbrido)
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

### 7. Backend Complementario (Opcional)
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
│   │   ├── pages/                # Vistas: Dashboard, Biblioteca, Repaso, Grafo, etc.
│   │   └── types/                # Modelos de datos TypeScript (models.ts)
│   └── tests/                    # Flota de pruebas de integración Zero-Web-Access (23 tests)
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
El proyecto incluye 23 pruebas de integridad que validan la inicialización de SQLite sin red, el algoritmo SM-2, los volcados binarios/JSON y la seguridad offline:

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

