/**
 * La migración de copy no puede cambiar el texto que ve el usuario.
 *
 * Cada cadena de esta tabla estaba escrita dentro de un componente, una página o
 * un servicio, y ahora vive en `src/i18n/locales/*`. El español es el idioma por
 * defecto de la interfaz, así que su valor en el catálogo debe ser EXACTAMENTE el
 * literal anterior: migrar de sitio no es reescribir copy.
 *
 * La tabla incluye las cadenas que no son evidentes a simple vista (mensajes de
 * error, estados de preparación de la IA local, avisos de privacidad por
 * proveedor), que es donde una traducción descuidada pasa desapercibida.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { translateKey } from '../src/i18n/dictionaries.ts';
import { validatePracticeWorkDraft } from '../src/services/practiceWork.ts';

/** key -> exact Spanish text the UI displayed before the migration. */
const MIGRATED_COPY: Record<string, string> = {
  /* ReviewCenter — calificaciones SM-2 (el prefijo «0 · » se compone aparte) */
  'review.grade.0.label': 'Apagón',
  'review.grade.0.hint': 'Sin recuerdo alguno',
  'review.grade.1.label': 'Olvidado',
  'review.grade.1.hint': 'Error tras esfuerzo',
  'review.grade.2.label': 'Dudoso',
  'review.grade.2.hint': 'Incorrecta, familiar',
  'review.grade.3.label': 'Difícil',
  'review.grade.3.hint': 'Correcta con esfuerzo',
  'review.grade.4.label': 'Bien',
  'review.grade.4.hint': 'Correcta con duda',
  'review.grade.5.label': 'Perfecto',
  'review.grade.5.hint': 'Retención instantánea',
  'review.gradeAria': 'Calificar como {label}. {hint}',
  'review.gradeFallback': 'Grado {grade}',

  /* ReviewCenter — modalidades */
  'review.mode.flashcards': 'Tarjetas SM-2',
  'review.mode.practice': 'Preguntas de práctica',
  'review.mode.mixed': 'Sesión mixta',
  'review.modeShort.practice': 'Práctica',
  'review.modeShort.mixed': 'Mixta',
  'review.modeDesc.flashcards': '{n} pendientes',
  'review.modeDesc.practice': 'Preguntas generadas',
  'review.modeDesc.mixed': 'Tarjetas + práctica',

  /* ReviewCenter — errores y estado */
  'review.err.generate': 'No se pudieron generar las preguntas de práctica.',
  'review.err.prepare': 'Error preparando la sesión de estudio.',
  'review.err.start': 'No se pudo iniciar la sesión en el almacenamiento local.',
  'review.err.summary': 'No se pudo guardar el resumen de la sesión.',
  'review.err.counter': 'La tarjeta se guardó, pero no se pudo actualizar el contador de la sesión.',
  'review.err.record': 'No se pudo registrar la respuesta en el historial local de la sesión.',
  'review.err.cancel': 'No se pudo cancelar la sesión en el almacenamiento local.',
  'review.err.finalize': 'No se pudo finalizar la sesión.',
  'review.lessonScope': 'Ámbito de lección activo: {title}',
  'review.lessonFallback': 'lección seleccionada',
  'review.lessonScopeBar': '· Lección: {title}',
  'review.lessonScopeFallback': 'ámbito de lección',
  'review.easeFactor': 'Factor de facilidad: {value}',
  'review.ephemeral': 'Práctica efímera',
  'review.nextItem': 'Siguiente ítem',
  'review.viewSummary': 'Ver resumen',
  'review.emptyItems':
    'No encontramos tarjetas pendientes ni pudimos generar preguntas para la selección actual.',
  'review.completedTitle': 'Sesión completada',
  'review.cancelledTitle': 'Sesión cancelada',
  'review.completedBody': 'Tus repasos SM-2 y tu historial local se guardaron correctamente.',
  'review.cancelledBody':
    'Los repasos ya guardados se conservan; el ítem en curso no se registró.',

  /* Dificultad compartida por el repaso y la generación de tarjetas */
  'study.difficulty.easy': 'Fácil',
  'study.difficulty.medium': 'Media',
  'study.difficulty.hard': 'Difícil',

  /* SettingsView */
  'settings.speechTestPhrase':
    'Probando la síntesis de voz en CrossedArts. Aprendizaje offline en el navegador.',
  'settings.indexCancelled': 'Indexación cancelada por el usuario.',
  'settings.indexError': 'Error durante la indexación semántica.',
  'settings.indexCancelling': 'Cancelando indexación...',
  'settings.vectorCacheCleared': 'Caché de vectores vaciado.',
  'settings.demoResetDone': 'Datos restablecidos al dataset de demostración.',
  'settings.backupLimitsTitle': 'Límites del respaldo:',
  'settings.providerDemoNote': '✓ Sin conexión: respuestas heurísticas generadas localmente.',
  'settings.providerLocalNote':
    '✓ 100% en tu dispositivo. La primera descarga del modelo sí requiere red.',
  'settings.providerOllamaNote':
    '● Servidor local en tu máquina; permite el origen de esta app en OLLAMA_ORIGINS (p. ej. http://localhost:5173) en lugar de "*".',
  'settings.providerOpenaiNote': '⚠️ Proveedor REMOTO: tu consulta viaja a los servidores de OpenAI.',
  'settings.runtimeIdle': 'En reposo',
  'settings.runtimePreparing': 'Preparando…',
  'settings.runtimeReady': 'Lista',
  'settings.runtimeUnsupported': 'No disponible',
  'settings.runtimeConsent': 'Pendiente de activación',
  'settings.runtimeError': 'Requiere atención',
  'settings.apiKeySet': 'Clave introducida. Al guardar se conserva solo en la memoria de esta pestaña.',
  'settings.apiKeyMemory': 'La clave se mantiene únicamente en memoria y se pierde al recargar la página.',
  'settings.embedLoading': 'Cargando motor de embeddings...',
  'settings.embedHashing': 'Extrayendo contenidos y generando hashes SHA-256...',
  'settings.embedIndexingChunks': 'Indexando {n} fragmentos...',
  'settings.embedIndexingProgress': 'Indexando fragmento {done} de {total}...',
  'settings.embedIndexDone': '✅ Indexación completa: {n} fragmentos indexados.',
  'settings.embedReleased': 'Modelo de embeddings liberado de la memoria.',
  'settings.embedReleaseFail': 'No se pudo liberar el modelo de embeddings.',

  /* Course detail */
  'courseDetail.lessonCompleted': 'Lección marcada como completada.',
  'courseDetail.lessonPending': 'Lección marcada como pendiente.',
  'courseDetail.lessonToggleFail': 'No se pudo actualizar el estado de la lección.',
  'courseDetail.moduleAllDone': 'Todas las lecciones del módulo marcadas como completadas.',
  'courseDetail.moduleAllPending': 'Todas las lecciones del módulo marcadas como pendientes.',
  'courseDetail.moduleToggleFail': 'No se pudo actualizar el módulo.',
  'courseDetail.moduleCreateFail': 'No se pudo crear el módulo.',
  'courseDetail.moduleCreated': 'Módulo creado correctamente.',
  'courseDetail.lessonCreateFail': 'No se pudo crear la lección.',
  'courseDetail.lessonCreated': 'Lección creada correctamente.',
  'courseDetail.courseDone': 'Curso completado. Repasa la última lección:',
  'courseDetail.continue': 'Continuar curso',
  'courseDetail.noModules': 'Sin módulos.',
  'courseDetail.noLessonMatches': 'No hay lecciones que coincidan con la búsqueda.',
  'courseDetail.markModuleDone': 'Marcar módulo como completado',
  'courseDetail.markModulePending': 'Marcar módulo como pendiente',

  /* Library */
  'library.errPagesPositive': 'El número de páginas debe ser mayor que cero.',
  'library.errPageInvalid': 'Introduce un número de página válido.',
  'library.errImport': 'Error durante la importación de archivos.',
  'search.type.goal': 'Meta',

  /* Practice work */
  'practice.errTitle': 'El trabajo práctico necesita un título.',
  'practice.errLink':
    'Vincula el trabajo a un recurso, una lección o un concepto para poder encontrarlo después.',
  'practice.errRating': 'La autoevaluación debe estar entre 0 y 5.',
  'practice.errBlob': 'No se pueden guardar URLs temporales (blob:) como artefacto.',
  'practice.errChecklistFormat': 'La lista de verificación no tiene un formato válido.',
  'practice.errChecklistMax': 'La lista de verificación no puede superar {n} elementos.',
  'practice.errChecklistItem': 'Los elementos de la lista deben tener texto.',
  'practice.errContent': 'El contenido del espacio de trabajo no es texto válido.',
  'practice.errCreate': 'No se pudo crear el trabajo práctico.',
  'practice.errSave': 'No se pudo guardar el trabajo práctico en tu base local.',
  'practice.errChecklist': 'No se pudo guardar la lista de verificación.',
  'practice.contentPlaceholder':
    'Escribe aquí tu trabajo: planteamiento, desarrollo, código, conclusiones…\n\nSoporta **Markdown**.',

  /* Lesson workspace */
  'lessonWorkspace.saveFail': 'No se pudo guardar la lección.',
  'lessonWorkspace.updated':
    'Lección actualizada. El índice semántico se invalida solo para esta lección.',
  'lessonWorkspace.noteCreated': 'Nota creada y asociada a esta lección.',
  'lessonWorkspace.cardCreated': 'Tarjeta añadida a la lección y programada en SM-2.',
  'lessonWorkspace.reopen': 'Reabrir lección',
  'lessonWorkspace.markDone': 'Marcar lección como completada',
  'lessonWorkspace.mediaLocal': 'Medio local efímero',
  'lessonWorkspace.mediaRemote': 'Medio remoto',
  'lessonWorkspace.mediaNone': 'Sin medio',
  'lessonWorkspace.continueLearning': 'Continuar aprendiendo',

  /* Assistant drawer */
  'ai.citation.course': 'Curso',
  'ai.citation.lesson': 'Lección',
  'ai.citation.book': 'Libro',
  'ai.citation.note': 'Nota',
  'ai.citation.concept': 'Concepto',
  'ai.citation.flashcard': 'Tarjeta',
  'ai.citation.practice': 'Práctica',
  'ai.openCitation': 'Abrir {type} de origen',
  'ai.privacyOnDevice': 'Las respuestas se generan en tu dispositivo.',
  'ai.privacyOllama': 'Se envía a tu servidor local de Ollama.',
  'ai.privacyOpenai': 'Las consultas salen hacia la API de OpenAI.',
  'ai.retrievalHybrid': '⚡ Híbrido',
  'ai.retrievalSemantic': 'Semántico',
  'ai.retrievalLexical': 'Léxico',

  /* Markdown viewer */
  'markdown.code': 'código',
  'markdown.copy': 'Copiar fragmento de código',
  'markdown.copied': 'Código copiado al portapapeles',

  /* Pomodoro */
  'pomodoro.focusDone': '¡Enfoque completado!',
  'pomodoro.breakDone': 'Descanso terminado',
  'pomodoro.takeBreak': 'Tómate 5 minutos. Pulsa ▶ cuando quieras empezar el descanso.',
  'pomodoro.nextRound': 'Listo para otra ronda de 25 minutos. Pulsa ▶ para empezar.',

  /* Dashboard gallery + mountain */
  'mountain.empty': 'Sin recursos todavía',
  'gallery.title': 'Tu aprendizaje de un vistazo',
  'gallery.description': 'Galería visual de los recursos que estás trabajando.',
  'gallery.seeAll': 'Ver toda la Biblioteca',
  'gallery.emptyHint':
    'Aún no hay recursos. Importa un documento o crea tu primer curso desde la Biblioteca.',

  /* Image occlusion editor */
  'occlusion.errInvalidImage': 'Por favor selecciona un archivo de imagen válido (PNG, JPG, WebP, SVG).',
  'occlusion.errNoImage': 'Debes añadir una imagen para crear la tarjeta de oclusión.',
  'occlusion.errNoMask': 'Debes dibujar al menos un área de oclusión sobre la imagen.',
  'occlusion.errNoFront': 'El título / anverso de la tarjeta no puede estar vacío.',
  'occlusion.errSave': 'Error al guardar la tarjeta de oclusión',

  /* Local media */
  'media.fsUnsupported': 'La File System Access API no está soportada en este navegador.',

  /* Local AI runtime */
  'ai.semantic.idle': 'Búsqueda semántica en reposo',
  'ai.semantic.afterConsent': 'La búsqueda semántica se preparará al activar la IA local.',
  'ai.semantic.failed': 'No se pudo preparar la búsqueda semántica.',
  'ai.semantic.unavailable': 'La búsqueda semántica no está disponible en este entorno.',
  'ai.semantic.preparing': 'Preparando búsqueda…',
  'ai.semantic.ready': 'Búsqueda semántica lista',
  'ai.err.shader':
    'Incompatibilidad de shaders WebGPU con tu tarjeta gráfica. Te recomendamos cambiar a Llama 3.2 1B o usar el modelo CPU (WASM).',
  'ai.err.demoFallback': 'Puedes seguir usando el modo demostración o conectar Ollama.',
  'ai.err.memory': 'Cierra otras pestañas pesadas e inténtalo de nuevo.',
  'ai.err.offline': 'Conéctate una vez para completar la descarga.',
  'ai.err.unavailable': 'La IA local no está disponible en este dispositivo.',
  'ai.err.offlineNotReady': 'La IA local todavía no está disponible sin conexión.',
  'ai.err.offlinePrepare': 'Conéctate una vez para prepararla y después podrás usarla sin conexión.'
};

test('la migración conserva exactamente el copy español que había en el código', () => {
  const drift: string[] = [];
  for (const [key, expected] of Object.entries(MIGRATED_COPY)) {
    const actual = translateKey('es', key);
    if (actual !== expected) {
      drift.push(`${key}: se mostraba «${expected}» y ahora «${actual}»`);
    }
  }
  assert.deepEqual(drift, [], `copy alterado al migrar:\n${drift.join('\n')}`);
});

test('la validación del trabajo práctico responde en el idioma pedido', () => {
  const draft = { title: '  ', resource_id: 'c1' };
  assert.equal(validatePracticeWorkDraft(draft).error, 'El trabajo práctico necesita un título.');
  assert.equal(
    validatePracticeWorkDraft(draft, 'en').error,
    'The practice work needs a title.'
  );
  assert.equal(
    validatePracticeWorkDraft({ title: 'Tarea' }, 'en').error,
    'Link the work to a resource, a lesson or a concept so you can find it later.'
  );
});
