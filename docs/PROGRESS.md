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
| **Progreso de meta** | Cuánto falta para una meta declarada por el usuario | Progreso medido del recurso asociado, o estado + fecha objetivo | Solo si el dato es medido |

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

7. **Una meta no inventa su progreso.** Una meta (`learning_goal`) declara su
   tipo (`course` / `book` / `practice` / `habit`), a qué artefacto apunta y una
   fecha objetivo opcional. Si el artefacto tiene progreso **medido** (curso,
   libro), la meta muestra ese porcentaje; en cualquier otro caso muestra estado
   y días restantes, **sin barra inventada**. Los umbrales de vencimiento son
   explícitos (`GOAL_DUE_SOON_DAYS = 7`).
   - Implementación: `frontend/src/services/goals.ts` (`computeGoalProgress`,
     `classifyGoalDeadline`).

8. **La analítica mide, no juzga.** Las vistas de Análisis derivan todo de
   registros reales: `learning_session` (minutos, ítems) y los repasos de
   tarjetas (aciertos). La precisión es `aciertos / total` de datos existentes.
   No hay puntuaciones de dominio, "motivación" ni índices psicológicos, y
   cuando no hay datos se dice explícitamente en vez de dibujar un cero
   ambiguo.
   - Implementación: `frontend/src/services/analytics.ts`.

9. **El plan de "Hoy" es determinista.** El orden de la lista de enfoque está
   fijado en `FOCUS_PRIORITY` y **cada elemento declara por qué aparece**
   (repaso vencido, práctica pendiente, meta próxima, continuación disponible).
   No hay aleatoriedad ni urgencia fabricada.
   - Implementación: `frontend/src/services/focus.ts` (`buildFocusPlan`,
     `buildFocusSummary`).

10. **La analítica del grafo describe topología, no importancia.** Grado,
    componentes conexas, nodos poco conectados y nodos tocados recientemente se
    calculan sobre las relaciones reales. El umbral de "bien conectado" es
    estadístico (media + 2σ, con suelo de 4) y los rótulos son deliberadamente
    neutros ("Más conectados", nunca "Más importantes").
    - Implementación: `frontend/src/services/graphExploration.ts`
      (`computeGraphAnalytics`, `buildGraphInsights`).

11. **La IA declara sus fuentes.** Toda respuesta con recuperación expone las
    fuentes usadas (con el recurso o la lección exactos a los que navegar) y el
    proveedor + modelo que la generó. Si la recuperación no devuelve nada, la
    interfaz lo dice ("Sin fuentes recuperadas") en lugar de insinuar un
    fundamento inexistente.
    - Implementación: `frontend/src/lib/localRag/contextBuilder.ts`
      (`buildSourceCitation`, `resolveCitationNavigate`) y
      `frontend/src/ai/aiService.ts` (`AssistantResponse.citations`,
      `modelUsed`).

## Verificación visual (disponibilidad honesta)

El contraste se verifica de forma **ejecutable** (`theme_contrast.test.ts`,
recalculado desde los tokens en ambos temas). Además, el renderizado se verifica
en un navegador real con Playwright sobre la build de producción, mediante
`frontend/scripts/visual-qa.mjs` (`npm run qa:visual`): tres viewports
(escritorio 1280×800, tableta 834×1112, móvil 390×844) recorren Panel, Hoy,
Metas, Análisis, Biblioteca, detalle de recurso, espacio de trabajo práctico,
Grafo y analítica del grafo, y comprueban propiedades **objetivas**:

- desbordamiento horizontal de página (`scrollWidth` vs viewport) y elementos que
  sobresalen sin contenedor con scroll propio;
- errores de consola y excepciones de página;
- presencia de los encabezados/bloques clave de cada vista;
- apertura de la paleta (Ctrl+K) y cambio de tema sin errores.

Estado de la última ejecución: **0 problemas** en los tres viewports. Las
capturas quedan en `/tmp/crossedarts-qa` y no se versionan.

- **Verificado automáticamente:** todo lo anterior, más el contraste de tokens en
  claro y oscuro, la información de la montaña en texto y el nombre accesible de
  las tarjetas.
- **No verificado automáticamente:** legibilidad percibida (juicio humano),
  colisiones de etiquetas SVG dentro del lienzo del grafo y corrección
  tipográfica del contenido editorial.

Esta herramienta encontró y permitió corregir dos defectos reales de la capa de
render: el grafo se quedaba en blanco por un `Set` sin `Symbol.iterator` en el
bundle `peer` de `vis-network` (se usa el build `esnext`), y el detalle de un
libro no era alcanzable desde la Biblioteca (ahora el título abre su espacio de
trabajo).

## Participación de cada artefacto (intencional)

| Artefacto | Galería del panel | Grafo | Montaña | Búsqueda | Paquete de curso |
|-----------|-------------------|-------|---------|----------|------------------|
| Curso | Sí (portada) | Sí (nodo) | Sí (medido) | Sí | Sí (material) |
| Libro | Sí (portada) | Sí (nodo) | Sí (medido) | Sí | Sí (material) |
| Recurso importado | Sí (portada) | Sí (nodo) | No (sin % real) | Sí | Sí (material) |
| Nota | No (tiene vista propia) | Sí (nodo + aristas) | No | Sí | No (dato personal) |
| Concepto | No (tiene vista propia) | Sí (nodo) | No | Sí | No |
| Trabajo práctico | Sí (ficha) | Sí (nodo + aristas) | No | Sí² | Sí (propuesto) |
| Meta | No (tiene vista propia) | No (no es un nodo del grafo) | No | Sí | No (dato personal) |
| Sesiones / repasos | No | No | No | No | No (dato personal) |

² El trabajo práctico no tiene una vista propia: la búsqueda de la Biblioteca y la
paleta de comandos (Ctrl+K) **sí lo encuentran** por título y descripción, pero el
resultado **abre su contexto de aprendizaje de origen** (recurso → detalle,
lección → vista de curso, concepto → vista de concepto). La ruta es única y
compartida (`resolveArtifactContextDestination`) entre grafo, búsqueda y paleta,
para que las tres abran exactamente el mismo sitio. Si el trabajo no declara
contexto, el destino degradado es la Biblioteca.
