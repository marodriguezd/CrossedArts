# CrossedArts

**Un entorno personal de aprendizaje local-first para cursos, apuntes, libros y sesiones de estudio.**

[Abrir la aplicación](https://marodriguezd.github.io/CrossedArts/) · [Acerca del proyecto](ABOUT.md)

CrossedArts parte de una idea sencilla: tus datos de estudio deberían seguir siendo útiles y portables sin depender de una cuenta en la nube.

La aplicación principal funciona como una web estática publicada en GitHub Pages. Los cursos, lecciones, notas, libros, tarjetas, conceptos e historial de estudio se almacenan localmente en el navegador mediante SQLite compilado a WebAssembly y persistido con IndexedDB.

## Qué puedes hacer

- Organizar cursos en módulos y lecciones, con contenido editable en Markdown.
- Mantener libros, notas y documentos importados dentro de la misma biblioteca local.
- Estudiar con repetición espaciada mediante el algoritmo SuperMemo-2 (SM-2).
- Crear sesiones de estudio con tarjetas, preguntas de práctica o un modo mixto.
- Usar carpetas locales de vídeo/audio sin copiar los archivos a la base de datos.
- Explorar las relaciones entre cursos, lecciones, notas, libros, conceptos y recursos importados mediante un grafo de conocimiento 2D.
- Buscar en la biblioteca de forma local sin necesitar embeddings ni un LLM.
- Importar archivos .txt, .md, .pdf y .epub y conservar su contenido extraído en la base de datos local.
- Elegir entre varios modos de IA: modelo en el propio navegador, Ollama, OpenAI o un modo demo heurístico sin conexión.
- Usar un pequeño temporizador Pomodoro integrado en la interfaz.
- Exportar y restaurar los datos como SQLite o JSON.

## Local-first por diseño

La aplicación de GitHub Pages no necesita un backend para funcionar.

La ruta principal de almacenamiento es:

    Navegador
      ├─ React + TypeScript
      ├─ SQLite (WebAssembly)
      └─ Persistencia en IndexedDB

La base de datos SQLite es la fuente canónica de los datos de aprendizaje. Los embeddings semánticos se almacenan por separado en IndexedDB para no mezclar matrices vectoriales con la base relacional.

Los medios locales permanecen fuera de la base de datos. Cuando el usuario selecciona una carpeta de cursos, CrossedArts la escanea y crea object URLs temporales para reproducir los archivos. Los handles y URLs temporales no se guardan en SQLite.

Por eso los respaldos tienen un límite claro: la base de datos puede restaurarse en otro dispositivo, pero las carpetas de medios locales deben volver a seleccionarse.

## Flujo de estudio

Una sesión de estudio puede combinar:

1. Tarjetas pendientes programadas con SM-2.
2. Preguntas de práctica generadas para esa sesión.
3. Un resumen local con la actividad que realmente se ha realizado.

Las preguntas de práctica son efímeras. CrossedArts guarda los datos de la sesión, no una copia permanente de todos los prompts generados.

No existe una "puntuación de conocimiento" global. El progreso parte de actividad local real y de estados explícitos.

## Grafo de conocimiento

El grafo es una capa de organización y navegación sobre los mismos datos relacionales que utiliza el resto de la aplicación.

Puede representar:

- cursos
- módulos
- lecciones
- libros
- notas
- conceptos
- recursos importados

Las relaciones estructurales se derivan del modelo de datos existente. Las relaciones creadas por el usuario se almacenan explícitamente y se validan antes de persistirse.

El grafo no inventa automáticamente relaciones semánticas, y las tarjetas y sesiones de estudio no se convierten deliberadamente en nodos.

## IA y búsqueda

La IA es opcional.

El navegador puede ejecutar modelos locales mediante WebLLM/WebGPU, con alternativas CPU/WASM entre los modelos compatibles. La primera descarga de un modelo requiere conexión; una vez cacheado localmente, puede ejecutarse sin un servicio remoto de inferencia.

CrossedArts también dispone de recuperación semántica local basada en Transformers.js y un modelo de embeddings E5 multilingüe. Cuando el índice semántico está disponible, la recuperación combina coincidencia léxica y semántica; si no lo está, se degrada a búsqueda léxica.

Los demás proveedores están claramente separados:

- **Demo:** respuestas heurísticas sin conexión.
- **Local:** inferencia en el propio dispositivo.
- **Ollama:** modelo ejecutado en tu máquina.
- **OpenAI:** inferencia remota. La aplicación avisa de que las consultas salen del navegador y de que el almacenamiento del navegador no es un almacén seguro de secretos.

La biblioteca y el flujo de estudio principal no dependen de la IA.

## Datos y privacidad

La distinción importante es entre la aplicación y los proveedores opcionales.

Con los modos locales, los datos de aprendizaje permanecen en el navegador y la inferencia se realiza localmente. Al elegir Ollama u OpenAI cambia ese límite porque las peticiones se envían al proveedor correspondiente.

CrossedArts no necesita una cuenta de usuario ni una base de datos en la nube para su flujo principal.

## Backend Python opcional

El repositorio incluye además un backend Python basado en FastAPI, SQLAlchemy y Alembic.

Es un complemento para tareas que encajan mejor en un entorno de servidor, como ingestas por lotes y flujos adicionales de búsqueda semántica/LLM. La aplicación de GitHub Pages no depende de él.

Para ejecutarlo localmente:

    python -m venv .venv
    source .venv/bin/activate
    pip install -r backend/requirements.txt

    PYTHONPATH=. alembic -c backend/alembic.ini upgrade head
    python -m backend.app.main

Por defecto, la API se inicia en http://127.0.0.1:8080.

## Desarrollo

### Frontend

Requisitos: Node.js 20+ y un navegador moderno.

    git clone https://github.com/marodriguezd/CrossedArts.git
    cd CrossedArts/frontend

    npm ci
    npm run dev

El servidor de desarrollo de Vite queda disponible en http://localhost:5173.

Para ejecutar las comprobaciones que utiliza CI:

    npm run typecheck
    npm test
    npm run build

El workflow actual de GitHub Actions ejecuta el typecheck del frontend, la suite de pruebas, la compilación de producción y la suite de pytest del backend antes de publicar en GitHub Pages.

### Compatibilidad del navegador

La aplicación principal funciona en navegadores modernos con soporte para WebAssembly e IndexedDB.

El acceso a carpetas locales utiliza File System Access API, por lo que depende del soporte del navegador. La implementación actual está orientada a navegadores basados en Chromium como Chrome, Edge y Brave para esa función.

## Estructura del repositorio

    CrossedArts/
    ├── frontend/       # Aplicación React + TypeScript
    ├── backend/        # Complemento opcional FastAPI
    ├── static/         # Portadas y recursos multimedia compartidos
    ├── ABOUT.md        # Motivos del proyecto y notas técnicas
    ├── AGENTS.md       # Guía de desarrollo/agentes
    ├── README.md       # Documentación principal
    └── README.es.md    # Documentación en español

## Licencia

CrossedArts se distribuye bajo la **GNU General Public License v3.0 only (GPL-3.0-only)**.

Consulta LICENSE para ver el texto completo.

Las bibliotecas de terceros y los artefactos de modelos conservan sus propias licencias.
