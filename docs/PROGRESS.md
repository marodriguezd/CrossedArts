# Semántica de progreso (progress semantics)

CrossedArts muestra varias cosas que podrían llamarse "progreso". **No son la
misma cosa y no se mezclan en silencio.** Este documento fija qué significa cada
una, de dónde sale su dato y qué interfaz la representa.

| Concepto | Qué significa | Fuente real | ¿Porcentaje? |
|----------|---------------|-------------|--------------|
| **Progreso de curso** | Lecciones completadas sobre el total del curso | `course.completed_lessons / course.total_lessons` | Sí (medido) |
| **Progreso de lectura** | Páginas leídas sobre el total del libro | `book.current_page / book.page_count` (`reading_percentage`) | Sí (medido) |
| **Progreso de práctica** | Cuánto trabajo práctico está terminado | Conteo de `practice_work.status` | Sí (conteo, no avance parcial) |
| **Maestría de concepto** | Estimación de comprensión según el modelo de repaso | SM-2 (`repetition_count`, `interval_days`, `ease_factor`) | No se expone como % |
| **Actividad de estudio** | Cuánto se ha estudiado (tiempo e ítems repasados) | `learning_session` | No (es magnitud, no avance) |
| **Progreso de montaña** | Indicador de recorrido de alto nivel, con ámbito | Derivado (ver abajo) | Sí, pero con reglas explícitas |

## Reglas explícitas

1. **Estado ≠ porcentaje.** Un curso guarda un porcentaje real. Un documento
   importado o un trabajo práctico solo guardan un *estado*
   (`NOT_STARTED` / `IN_PROGRESS` / `COMPLETED`). La galería dibuja una barra de
   progreso **solo** cuando el dato es `measured`; cuando es `status` muestra el
   estado y **nunca** un porcentaje inventado.
   - Implementación: `GalleryItem.progressSource` en
     `frontend/src/services/galleryItems.ts`.

2. **El estado del alumno no es material del curso.** Un paquete de curso
   (`crossedarts.course-package`) transporta material educativo (temario y
   trabajo propuesto), **no** el progreso, las notas ni las sesiones del alumno.
   Por eso la firma de conflicto de un trabajo práctico **excluye** `status`:
   que un ejercicio esté terminado localmente no es un conflicto de importación.

3. **Progreso de montaña.** La vista de montaña es una representación de
   recorrido, no una nota.
   - **Biblioteca (global):** media del progreso **medido** de cursos y libros.
     Los artefactos con progreso por estado se excluyen a propósito, porque
     mezclar un indicador grueso con un porcentaje real haría mentir al
     indicador.
   - **Curso (con ámbito):** porcentaje real de lecciones completadas; los hitos
     son los **módulos reales** del temario (cada uno marca el final de su tramo
     de lecciones). Si el curso no tiene lecciones, no se inventan etapas: se
     usan los hitos genéricos.
   - Implementación: `frontend/src/services/mountainPath.ts`
     (`computeOverallProgress`, `deriveStagesFromModules`).

4. **Sin métricas fabricadas.** No hay "motivación", "dificultad oculta" ni
   etapas psicológicas. Si el modelo de datos no soporta una etapa con
   estructura real, la visualización conserva su versión honesta (hitos de
   posición, no de nivel).

5. **Contraste por tema.** Los tokens semánticos de `frontend/src/index.css`
   mantienen WCAG AA en tema claro y oscuro; `frontend/tests/theme_contrast.test.ts`
   recalcula el contraste real desde los tokens y falla si alguna pareja baja de
   umbral.

6. **Estado deshabilitado.** Un control deshabilitado no se resuelve atenuando el
   elemento completo: usa superficie y tinta semánticas (`line` + `muted`, o
   `faint` sobre `surface`), de modo que sigue siendo inequívocamente inactivo y
   a la vez legible (≥4.5:1; 5.16:1 en claro y 5.22:1 en oscuro para
   `muted`/`line`). El estado habilitado no cambia.

## Verificación visual (disponibilidad honesta)

El contraste se verifica de forma **ejecutable** (`theme_contrast.test.ts`,
recalculado desde los tokens en ambos temas). Lo que **no** está automatizado es
la inspección visual del renderizado: el repositorio no incluye un navegador ni
herramientas de automatización de navegador, y no se ha añadido un framework de
testing visual solo por esto. Por tanto:

- **Verificado:** contraste de tokens en claro y oscuro, presencia de nombre
  accesible en las tarjetas, información de la montaña disponible en texto, y
  revisión del comportamiento responsive a nivel de clases/estructura.
- **No verificado automáticamente:** colisiones de etiquetas SVG, solapamientos
  reales de layout y legibilidad percibida en un navegador. Si se añade
  automatización de navegador en el futuro, esta es la primera comprobación que
  debe cubrirse.

## Participación de cada artefacto (intencional)

| Artefacto | Galería del panel | Grafo | Montaña | Búsqueda | Paquete de curso |
|-----------|-------------------|-------|---------|----------|------------------|
| Curso | Sí (portada) | Sí (nodo) | Sí (medido) | Sí | Sí (material) |
| Libro | Sí (portada) | Sí (nodo) | Sí (medido) | Sí | Sí (material) |
| Recurso importado | Sí (portada) | Sí (nodo) | No (sin % real) | Sí | Sí (material) |
| Nota | No (tiene vista propia) | Sí (nodo + aristas) | No | Sí | No (dato personal) |
| Concepto | No (tiene vista propia) | Sí (nodo) | No | Sí | No |
| Trabajo práctico | Sí (ficha) | Sí (nodo + aristas) | No | Sí² | Sí (propuesto) |
| Sesiones / repasos | No | No | No | No | No (dato personal) |

² El trabajo práctico no tiene una vista propia: la búsqueda de la Biblioteca y la
paleta de comandos (Ctrl+K) **sí lo encuentran** por título y descripción, pero el
resultado **abre su contexto de aprendizaje de origen** (recurso → detalle,
lección → vista de curso, concepto → vista de concepto). La ruta es única y
compartida (`resolveArtifactContextDestination`) entre grafo, búsqueda y paleta,
para que las tres abran exactamente el mismo sitio. Si el trabajo no declara
contexto, el destino degradado es la Biblioteca.
