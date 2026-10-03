# 🏛️ CrossedArts — Learning Operating System

<p align="center">
  <img src="https://img.shields.io/badge/GitHub%20Pages-Live%20Deploy-7c3aed?style=flat&logo=githubpages&logoColor=white" alt="GitHub Pages" />
  <img src="https://img.shields.io/badge/Frontend-Vite%20%2B%20React%2019%20%2B%20TS-61dafb?style=flat&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Database-SQLite%20WASM%20%2B%20IndexedDB-003B57?style=flat&logo=sqlite&logoColor=white" alt="SQLite WASM" />
  <img src="https://img.shields.io/badge/Active%20Recall-SuperMemo--2%20(SM--2)-10b981" alt="SM-2 Algorithm" />
  <img src="https://img.shields.io/badge/Knowledge%20Graph-Vis.js%202D-818cf8" alt="Vis.js" />
  <img src="https://img.shields.io/badge/Backend%20Companion-FastAPI%20%2B%20SQLAlchemy-059669?style=flat&logo=fastapi" alt="FastAPI" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License MIT" />
</p>

---

**CrossedArts** es un **Learning Operating System** (sistema operativo de aprendizaje personal) *local-first*, modular y diseñado con arquitectura **GitHub Pages First**.

Permite centralizar cursos multimedia, libros técnicos, notas de estudio en Markdown, tarjetas nemotécnicas de repetición espaciada (**SuperMemo-2**) y un grafo de conocimiento interactivo 2D, ejecutando toda la base de datos relacional SQLite directamente dentro de tu navegador web sin requerir servidores ni suscripciones externas.

Para una inmersión completa en la filosofía y diseño del sistema, consulta el documento [ABOUT.md](ABOUT.md).

---

## ✨ Características Principales

### 1. Despliegue Estático en GitHub Pages (100% Client-Side)
- Funciona como una Single Page Application (SPA) ultra rápida sin necesidad de levantar contenedores, servidores o servicios en la nube.
- Despliegue continuo automatizado con GitHub Actions en `.github/workflows/deploy.yml`.

### 2. Motor SQLite en WebAssembly + IndexedDB
- Motor SQLite compilado a WebAssembly (`sql.js`) ejecutado en el navegador.
- Sincronización transparente con `IndexedDB` para persistir los datos permanentemente entre sesiones.
- Esquema relacional completo (`learning_resource`, `course`, `book`, `module`, `lesson`, `note`, `flashcard`, `concept`, `knowledge_connection`, `learning_session`).
- Portabilidad garantizada: exportación e importación de bases de datos binarias `.sqlite` / `.db` y volcados universales en formato JSON.

### 3. Acceso a Medios Locales sin Duplicación de Disco
- Integración con la **File System Access API** (`window.showDirectoryPicker`) en navegadores compatibles.
- Permite seleccionar tus carpetas locales de cursos en disco y reproducir vídeos en streaming mediante blobs de memoria efímeros, sin saturar la memoria ni duplicar gigabytes en tu almacenamiento.

### 4. Centro de Repaso Activo (Active Recall & Algoritmo SM-2)
- Sistema de tarjetas de estudio con preguntas y respuestas.
- Algoritmo matemático **SuperMemo-2 (SM-2)** que calcula automáticamente el Factor de Facilidad (*Ease Factor*), repeticiones e intervalos óptimos según tu curva del olvido.

### 5. Grafo de Conocimiento Interactivo 2D
- Visualización conceptual mediante simulación física de partículas impulsada por `vis-network`.
- Descubre y navega las conexiones entre conceptos teóricos, cursos y temas de especialización.

### 6. Tutor Académico RAG Híbrido
- Asistente de estudio accesible desde cualquier vista de la aplicación.
- **Modo Demo Heurístico:** 100% desconectado, cero llamadas de red y respuestas socráticas adaptadas al contexto de estudio.
- **Modo Ollama Local:** Conexión directa a tus modelos LLM locales (`http://localhost:11434`) con privacidad absoluta.
- **Modo Proveedores Externos:** Compatible con APIs de OpenAI y Gemini mediante clave almacenada de forma segura en tu navegador (`localStorage`).

### 7. Backend Complementario (Opcional)
- Servidor REST en `backend/` construido con **FastAPI**, **SQLAlchemy 2.0** y **Alembic**.
- Diseñado para análisis avanzado, ingesta masiva por lotes (extracción de PDF, EPUB, metadatos y transcripciones de vídeo) y búsqueda semántica vectorial.

---

## 📁 Estructura del Repositorio

```text
CrossedArts/
├── frontend/                     # Aplicación Web Client-Side (React 19 + Vite)
│   ├── public/                   # Binarios WASM (sql-wasm.wasm) y recursos públicos
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
│   │   └── services/             # Lógica de negocio (ingesta, embeddings, LLM, escáner)
│   └── tests/                    # Pruebas unitarias y de integración de backend
├── static/                       # Portadas y recursos multimedia compartidos
├── .github/workflows/deploy.yml  # Automatización de despliegue a GitHub Pages
├── ABOUT.md                      # Filosofía, arquitectura y diseño conceptual
├── AGENTS.md                     # Guía técnica maestra para agentes y desarrolladores
└── README.md                     # Esta documentación
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
El proyecto incluye 23 pruebas de integridad que validan la inicialización de SQLite sin red, el algoritmo SM-2, los volcados binarios/JSON, y la seguridad offline:

```bash
cd frontend
npm test
# O alternativamente con el runner nativo de Node:
node --test --experimental-strip-types tests/*.test.ts
```

### Compilar para Producción
```bash
cd frontend
npm run build
```
Los archivos optimizados para publicación estática se generarán en `frontend/dist/`.

---

## 🌐 Publicación en GitHub Pages

1. Haz un **Fork** o clona este repositorio en tu cuenta de GitHub.
2. Ve a la pestaña **Settings** > **Pages** de tu repositorio.
3. En la sección **Build and deployment** > **Source**, selecciona **GitHub Actions**.
4. Cada `git push` a la rama `main` compilará y desplegará automáticamente la aplicación en `https://<tu-usuario>.github.io/<tu-repo>/`.

---

## 🐍 Backend Complementario (Opcional)

Si deseas utilizar el servidor Python para ingesta local masiva de archivos o búsqueda semántica:

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

## 💾 Copias de Seguridad y Portabilidad

En la pestaña **Ajustes** de CrossedArts puedes gestionar tu información con total soberanía:
* **Exportar SQLite (.sqlite):** Descarga el archivo de base de datos relacional nativo que puedes abrir directamente con aplicaciones como DB Browser for SQLite.
* **Importar SQLite (.sqlite):** Restaura cualquier base de datos previa al instante.
* **Exportar Respaldo JSON:** Genera un volcado estructurado con todas las tablas y relaciones.
* **Restaurar Respaldo JSON:** Recupera tus datos desde cualquier volcado de texto JSON.

---

## 📄 Licencia

Distribuido bajo la Licencia **MIT**. Consulta el archivo `LICENSE` para más información.
