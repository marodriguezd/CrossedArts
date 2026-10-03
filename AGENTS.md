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
   - **Módulos clave:** Repetición espaciada SuperMemo-2 (`ReviewCenter.tsx`), grafo de conocimiento 2D (`KnowledgeGraph.tsx` con `vis-network`), streaming de vídeos locales mediante la File System Access API (`CourseDetail.tsx`), y tutor pedagógico híbrido (`aiService.ts`).

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
│   │   │   └── aiService.ts        # Motor de IA: Modo Demo (offline), Ollama local o APIs
│   │   ├── components/
│   │   │   ├── ai/
│   │   │   │   └── AIAssistantDrawer.tsx  # Cajón lateral del tutor pedagógico
│   │   │   └── layout/
│   │   │       └── Navbar.tsx      # Barra de navegación principal y selector de pestañas
│   │   ├── db/
│   │   │   ├── dao.ts              # Data Access Object con consultas SQL y algoritmo SM-2
│   │   │   ├── exportImport.ts     # Exportación/importación binaria .sqlite y backup JSON
│   │   │   ├── schema.ts           # DDL con las 10 tablas relacionales del sistema
│   │   │   ├── seedDemo.ts         # Datos de demostración iniciales
│   │   │   └── sqliteBridge.ts     # Carga de WASM, sincronización con IndexedDB y puente SQL
│   │   ├── pages/
│   │   │   ├── CourseDetail.tsx    # Reproductor y visor de lecciones y módulos
│   │   │   ├── Dashboard.tsx       # Métricas de estudio (KPIs), racha y accesos directos
│   │   │   ├── KnowledgeGraph.tsx  # Grafo interactivo con vis-network
│   │   │   ├── Library.tsx         # Catálogo de cursos y libros con filtros
│   │   │   ├── NotesView.tsx       # Editor y visor de notas de estudio en Markdown
│   │   │   ├── ReviewCenter.tsx    # Centro de repaso activo con tarjetas nemotécnicas (SM-2)
│   │   │   └── SettingsView.tsx    # Gestión de BD (backup/restore) y configuración de IA
│   │   ├── types/
│   │   │   └── models.ts           # Interfaces y tipos de datos TypeScript
│   │   ├── App.tsx                 # Contenedor raíz y ciclo de vida de la aplicación
│   │   ├── index.css               # Estilos globales y utilidades de Tailwind
│   │   └── main.tsx                # Entrada de montaje de React en el DOM
│   ├── tests/                      # Flota de pruebas de frontend (23 tests de integridad)
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
└── README.md                       # Documentación pública del repositorio
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

# Ejecutar la flota de pruebas de integridad (23/23 tests)
npm test
# O directamente mediante el test runner de Node:
node --test --experimental-strip-types tests/*.test.ts

# Compilar para producción (genera frontend/dist/)
npx vite build
```

> **IMPORTANTE:** La flota de 23 pruebas de frontend valida:
> 1. Inicialización de SQLite WASM sin acceso a la red (0 web requests).
> 2. Precisión del algoritmo de repetición espaciada SuperMemo-2 (SM-2).
> 3. Operaciones CRUD y métricas KPI de `dao.ts`.
> 4. Exportación e importación binaria SQLite `.sqlite` y copias de seguridad JSON.
> 5. Ausencia de scripts externos o dependencias no autorizadas en `index.html`.
> 6. Parámetro `base: './'` en `vite.config.ts` para despliegue correcto en subdirectorios de GitHub Pages.

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
* Toda modificación de datos debe sincronizarse con `IndexedDB` invocando `await dbBridge.persist()`.
* Si se añaden nuevas tablas o columnas al esquema:
  1. Actualiza `frontend/src/db/schema.ts`.
  2. Actualiza la lista de tablas en `getDatabaseTables()` dentro de `frontend/src/db/exportImport.ts` para que las copias de seguridad sigan siendo íntegras.
  3. Proporciona datos de prueba en `frontend/src/db/seedDemo.ts`.

### Regla 3: Algoritmo de Repetición Espaciada SM-2
* El factor de facilidad (*Ease Factor*) nunca debe descender de `1.30`.
* Calificaciones menores a `3` representan fallo de memorización: deben reiniciar `repetition_count = 0` y establecer `interval_days = 1`.
* Calificaciones entre `3` y `5` calculan el intervalo creciente multiplicando por el factor de facilidad.

### Regla 4: File System Access API
* El acceso a carpetas locales utiliza `window.showDirectoryPicker()`.
* Siempre envuelve la llamada en un bloque `try/catch` y comprueba `'showDirectoryPicker' in window`. Si el usuario cancela el diálogo del sistema operativo, ignora el `AbortError` de forma transparente sin alarmar en la UI.

### Regla 5: Idioma y Experiencia de Usuario
* Toda la interfaz de usuario, títulos, botones, cuadros de diálogo, mensajes de error y textos explicativos deben estar en **español**.
* La estética visual se basa en el tema oscuro de Tailwind (`slate-950`, acentos morados/índigo `purple-500` / `indigo-500`) con soporte para modo claro.

### Regla 6: Higiene de Git y Control de Versiones
* No confirmes archivos de log de agentes, volcados de estado temporal ni artefactos innecesarios en la raíz (`.omg`, `.agents`, `.opencode`, `PLAN.md`, etc.).
* El archivo `.gitignore` debe proteger contra `node_modules/`, `.venv/`, volcados locales de base de datos (`*.db`, `*.sqlite`), ficheros de bloqueo no estándar (`pnpm-lock.yaml`) y cachés de Python (`__pycache__`).

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
