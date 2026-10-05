# CrossedArts — Learning Operating System

**Aplicación en vivo:** [https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

[English](README.md) · [Español](README.es.md)

---

## Qué Es

CrossedArts es un sistema de gestión de aprendizaje personal y *local-first* que se ejecuta completamente en el navegador. Centraliza cursos, libros, notas, tarjetas de memoria y un grafo de conocimiento, todo almacenado en una base de datos SQLite local sin requerir un servidor backend.

La aplicación está diseñada para estudiantes que desean control total sobre sus datos de estudio sin depender de servicios en la nube ni suscripciones.

## Capacidades

- **Cursos y Lecciones:** Estructura jerárquica con módulos, lecciones y contenido Markdown editable
- **Libros y Recursos:** Catálogo de biblioteca con progreso de lectura, documentos importados (PDF, EPUB, TXT, MD) y organización de recursos
- **Sesiones de Estudio:** Repaso unificado de tarjetas (SM-2), preguntas de práctica y modos mixtos con seguimiento de progreso local
- **Grafo de Conocimiento:** Visualización interactiva 2D de cursos, libros, lecciones, notas, conceptos y sus relaciones
- **Medios Locales:** Reproducción de vídeo y audio desde carpetas locales mediante la File System Access API
- **Búsqueda Local:** Búsqueda determinista basada en SQL en todo el contenido, más una paleta de comandos global (Ctrl+K)
- **Ingestión de Documentos:** Análisis en el navegador de archivos PDF, EPUB, TXT y MD con deduplicación SHA-256
- **Proveedores de IA:** Inferencia local en dispositivo (WebLLM/WebGPU), modo demo heurístico, u Ollama, o API de OpenAI
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
- Embeddings locales con Transformers.js y `Xenova/multilingual-e5-small` (384 dimensiones, ~135 MB)
- Recuperación híbrida que combina búsqueda léxica y embeddings semánticos
- Vectores cacheados en IndexedDB con hashing SHA-256 y versionado de pipeline (`v1.1-e5-sha256`)
- Todo el cálculo de embeddings ocurre en el dispositivo

## Limitaciones

- **Soporte de navegador:** Se requiere Chrome, Edge o Brave para las funciones de medios locales (File System Access API). Otros navegadores pueden usar todas las funciones sin medios.
- **Hardware de IA local:** Se recomienda GPU con soporte WebGPU para inferencia LLM local. La CPU está disponible como alternativa más lenta.
- **Primera descarga:** El uso inicial de IA local requiere descargar los pesos del modelo (~135 MB para embeddings).
- **Copia de seguridad de medios:** Los archivos de medios locales no se incluyen en las copias de seguridad SQLite. Solo se respalda la base de datos; los medios deben revincularse tras restaurar.
- **Sin sincronización automática:** La sincronización entre múltiples dispositivos no está integrada. La exportación/importación es el mecanismo de transferencia manual.
- **Un solo usuario:** Sin soporte multiusuario ni autenticación.

## Inicio Rápido

### Requisitos

- Node.js v20 o superior
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

La suite de pruebas incluye 337 pruebas en 23 archivos de prueba que cubren inicialización de SQLite, algoritmo SM-2, sesiones de estudio, grafo de conocimiento, RAG, ingestión de documentos y proveedores de IA.

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
- `Xenova/multilingual-e5-small`: MIT
- WebLLM (`@mlc-ai/web-llm`): Apache-2.0
- Transformers.js (`@huggingface/transformers`): Apache-2.0
- SQLite WASM (`sql.js`): MIT
