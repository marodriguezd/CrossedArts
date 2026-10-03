# 🏛️ DomestiK — Learning Operating System

<p align="center">
  <img src="https://img.shields.io/badge/GitHub%20Pages-Live%20Deploy-7c3aed?style=flat&logo=githubpages&logoColor=white" alt="GitHub Pages" />
  <img src="https://img.shields.io/badge/Frontend-Vite%20%2B%20React%2018%20%2B%20TS-61dafb?style=flat&logo=react" alt="React 18" />
  <img src="https://img.shields.io/badge/Database-SQLite%20WASM%20%2B%20IndexedDB-003B57?style=flat&logo=sqlite&logoColor=white" alt="SQLite WASM" />
  <img src="https://img.shields.io/badge/Active%20Recall-SM--2%20Algorithm-10b981" alt="SM-2 Algorithm" />
  <img src="https://img.shields.io/badge/Knowledge%20Graph-Vis.js%202D-818cf8" alt="Vis.js" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License MIT" />
</p>

---

**DomestiK** es un **Learning Operating System** (sistema operativo de aprendizaje personal) *local-first*, modular y optimizado para **GitHub Pages First**.

Centraliza cursos estructurados, libros, flashcards de repetición espaciada (algoritmo SuperMemo-2), notas de estudio y un grafo de conocimiento interactivo, ejecutando toda la base de datos relacional SQLite directamente dentro de tu navegador.

---

## ✨ Características Principales

1. **GitHub Pages First & 100% Client-Side:**
   - Despliegue estático automatizado en GitHub Pages.
   - Cero servidores obligatorios para estudiar, consultar notas o repasar tarjetas.
2. **Base de Datos SQLite en el Navegador (WASM + IndexedDB):**
   - Esquema relacional completo (`learning_resource`, `course`, `book`, `module`, `lesson`, `note`, `flashcard`, `concept`, `knowledge_connection`).
   - Importación y exportación nativa de archivos `.sqlite` / `.db` compatibles con el backend original de DomestiK.
   - Respaldo universal en formato JSON.
3. **Acceso a Medios Locales (Streaming sin Duplicar Disco):**
   - Integración con la **File System Access API** (`window.showDirectoryPicker`) para montar directorios locales de cursos y reproducir vídeos en streaming sin saturar la memoria del navegador.
4. **Centro de Repaso Cognitivo (Active Recall & Algoritmo SM-2):**
   - Tarjetas nemotécnicas interactivas con cálculo automático de intervalos de repaso y factor de facilidad según SuperMemo-2.
5. **Grafo de Conocimiento Interactivo:**
   - Mapa conceptual 2D con física dinámica impulsado por `vis-network`.
6. **Tutor Académico RAG Híbrido:**
   - Asistente de estudio configurable entre modo Offline/Demostración, Ollama local (`http://localhost:11434`) o proveedores externos vía API Key.
7. **Monorepo Limpio:**
   - Aplicación web en `frontend/` y backend Python original preservado en `backend/` para ejecuciones de servidor o análisis avanzado de datos.

---

## 🚀 Despliegue en GitHub Pages

El proyecto incluye el workflow automatizado `.github/workflows/deploy.yml`. 
Para activarlo en tu fork o repositorio:
1. Dirígete a **Settings** > **Pages** en tu repositorio de GitHub.
2. En **Build and deployment** > **Source**, selecciona **GitHub Actions**.
3. En cada `git push` a la rama `main`, la web se compilará y publicará automáticamente.

---

## 💻 Desarrollo Local

```bash
# Clonar el repositorio
git clone https://github.com/marodriguezd/DomestiK.git
cd DomestiK/frontend

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo Vite
npm run dev

# Compilar para producción
npm run build
```

---

## 📄 Licencia

Distribuido bajo la Licencia MIT. Consulta el archivo `LICENSE` para más detalles.
