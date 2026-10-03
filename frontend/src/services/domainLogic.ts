import type { GraphNodeType, GraphRelationType, ResourceDestination, SearchResult, ConceptNode } from '../types/models.ts';

export interface BookProgressCalculation {
  clampedPage: number;
  percentage: number;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
}

export type BookProgressResult = 
  | { valid: true; data: BookProgressCalculation; error?: never }
  | { valid: false; error: string; data?: never };

/**
 * Valida y calcula el progreso de lectura de un libro de forma pura y determinista.
 */
export function calculateBookProgress(
  currentPage: number,
  totalPages: number
): BookProgressResult {
  if (typeof totalPages !== 'number' || isNaN(totalPages) || totalPages <= 0) {
    return { valid: false, error: 'El libro no tiene un número total de páginas válido configurado.' };
  }

  if (typeof currentPage !== 'number' || isNaN(currentPage)) {
    return { valid: false, error: 'La página indicada debe ser un número válido.' };
  }

  const clampedPage = Math.max(0, Math.min(Math.floor(currentPage), totalPages));
  const percentage = Number(((clampedPage / totalPages) * 100).toFixed(1));

  let status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS';
  if (clampedPage === 0) {
    status = 'NOT_STARTED';
  } else if (clampedPage >= totalPages) {
    status = 'COMPLETED';
  }

  return {
    valid: true,
    data: {
      clampedPage,
      percentage,
      status
    }
  };
}

export interface SM2State {
  repetitionCount: number;
  intervalDays: number;
  easeFactor: number;
}

export interface SM2Result extends SM2State {
  intervalModifier: string;
}

/**
 * Aplica el algoritmo SuperMemo-2 (SM-2) a una repetición de flashcard.
 * Función pura y aislada para garantizar determinismo y testeabilidad.
 */
export function calculateSM2(
  currentState: SM2State,
  grade: number
): SM2Result {
  let reps = currentState.repetitionCount;
  let interval = currentState.intervalDays;
  let ease = currentState.easeFactor;

  if (grade >= 3) {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    reps += 1;
  } else {
    reps = 0;
    interval = 1;
  }

  ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  const easeFormatted = Number(ease.toFixed(2));

  return {
    repetitionCount: reps,
    intervalDays: interval,
    easeFactor: easeFormatted,
    intervalModifier: `+${interval} days`
  };
}

export type StudyItemKind = 'flashcard' | 'practice';

/**
 * Plan determinista para la modalidad de estudio mixta: primero las tarjetas SM-2
 * pendientes y después las preguntas de práctica generadas. No implementa
 * adaptabilidad ni ponderación dinámica.
 */
export function buildMixedStudyPlan(flashcardCount: number, questionCount: number): StudyItemKind[] {
  const plan: StudyItemKind[] = [];
  const cards = Number.isFinite(flashcardCount) ? Math.max(0, Math.floor(flashcardCount)) : 0;
  const questions = Number.isFinite(questionCount) ? Math.max(0, Math.floor(questionCount)) : 0;
  for (let i = 0; i < cards; i++) plan.push('flashcard');
  for (let i = 0; i < questions; i++) plan.push('practice');
  return plan;
}

/**
 * Calcula la duración en minutos entre dos marcas temporales almacenadas por SQLite
 * (formato `YYYY-MM-DD HH:MM:SS`, interpretado como UTC de forma consistente).
 */
export function computeStudyDurationMinutes(startedAt: string, endedAt: string): number {
  const start = Date.parse(`${startedAt.replace(' ', 'T')}Z`);
  const end = Date.parse(`${endedAt.replace(' ', 'T')}Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(1, Math.round((end - start) / 60000));
}

/**
 * Formatea el próximo intervalo calculado por SM-2 en texto legible para la UI.
 */
export function formatNextReviewInterval(intervalDays: number): string {
  const days = Math.max(1, Math.round(intervalDays));
  if (days === 1) return '1 día';
  if (days < 30) return `${days} días`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 mes' : `${months} meses`;
}

export interface StudySessionCounters {
  cards_reviewed: number;
  questions_answered: number;
  correct_answers: number;
  duration_minutes: number;
}

export interface StudySessionSummary {
  itemsReviewed: number;
  flashcards: number;
  questions: number;
  correct: number;
  incorrect: number;
  durationMinutes: number;
}

/**
 * Construye el resumen de una sesión. Las calificaciones SM-2 no se agregan como
 * acierto/error: solo las preguntas de práctica reportan aciertos y errores, y
 * nunca se calcula una "puntuación de conocimiento" universal.
 */
export function summarizeStudySession(counters: StudySessionCounters): StudySessionSummary {
  const flashcards = Math.max(0, Math.floor(counters.cards_reviewed || 0));
  const questions = Math.max(0, Math.floor(counters.questions_answered || 0));
  const correct = Math.min(questions, Math.max(0, Math.floor(counters.correct_answers || 0)));
  return {
    itemsReviewed: flashcards + questions,
    flashcards,
    questions,
    correct,
    incorrect: questions - correct,
    durationMinutes: Math.max(0, Math.round(counters.duration_minutes || 0))
  };
}

/** Relaciones que un usuario puede crear manualmente en el grafo. */
export const GRAPH_RELATION_TYPES: readonly GraphRelationType[] = [
  'contains',
  'references',
  'teaches',
  'discusses',
  'related_to',
  'requires',
  'builds_on',
  'about'
];

/**
 * Normaliza y valida un tipo de relación. Devuelve null si el tipo no es
 * soportado por el modelo tipado (evita almacenar cadenas arbitrarias nuevas).
 */
export function normalizeGraphRelation(relationType: string): GraphRelationType | null {
  if (!relationType) return null;
  const normalized = relationType.trim().toLowerCase();
  return (GRAPH_RELATION_TYPES as readonly string[]).includes(normalized)
    ? (normalized as GraphRelationType)
    : null;
}
export interface KnowledgeConnectionCandidate {
  sourceId: string;
  targetId: string;
  relationType: string;
}

export interface KnowledgeConnectionValidationContext {
  nodeIds: Iterable<string>;
  existingEdges: Array<{ source_id: string; target_id: string; connection_type: string }>;
}

export interface KnowledgeConnectionValidationResult {
  valid: boolean;
  relation?: GraphRelationType;
  error?: string;
}

/**
 * Valida de forma pura una conexión manual del grafo: tipo soportado, nodos
 * existentes, sin auto-enlaces y sin duplicados. No accede a la base de datos.
 */
export function validateKnowledgeConnection(
  candidate: KnowledgeConnectionCandidate,
  context: KnowledgeConnectionValidationContext
): KnowledgeConnectionValidationResult {
  const relation = normalizeGraphRelation(candidate.relationType);
  if (!relation) {
    return { valid: false, error: `Tipo de relación no soportado: "${candidate.relationType}".` };
  }
  if (!candidate.sourceId || !candidate.targetId) {
    return { valid: false, error: 'Debes seleccionar un origen y un destino válidos.' };
  }
  if (candidate.sourceId === candidate.targetId) {
    return { valid: false, error: 'El origen y el destino no pueden ser el mismo recurso.' };
  }
  const nodeIds = context.nodeIds instanceof Set ? context.nodeIds : new Set(context.nodeIds);
  if (!nodeIds.has(candidate.sourceId)) {
    return { valid: false, error: 'El recurso de origen no existe en el grafo local.' };
  }
  if (!nodeIds.has(candidate.targetId)) {
    return { valid: false, error: 'El recurso de destino no existe en el grafo local.' };
  }
  const duplicate = context.existingEdges.some(
    e =>
      e.source_id === candidate.sourceId &&
      e.target_id === candidate.targetId &&
      e.connection_type === relation
  );
  if (duplicate) {
    return { valid: false, error: 'Esta conexión ya existe.' };
  }
  return { valid: true, relation };
}

export const GRAPH_NODE_LABELS: Record<GraphNodeType, string> = {
  concept: 'Concepto',
  course: 'Curso',
  book: 'Libro',
  module: 'Módulo',
  lesson: 'Lección',
  note: 'Nota',
  resource: 'Recurso'
};

export const GRAPH_RELATION_LABELS: Record<GraphRelationType, string> = {
  contains: 'contiene',
  references: 'referencia',
  teaches: 'enseña',
  discusses: 'trata sobre',
  related_to: 'relacionado con',
  requires: 'requiere',
  builds_on: 'se basa en',
  about: 'trata de'
};

/**
 * Resuelve el destino de navegación de un resultado de búsqueda local.
 * Cada tipo soportado tiene una acción determinista sin depender de IA ni red.
 */
export function resolveSearchResultDestination(result: SearchResult): ResourceDestination {
  switch (result.type) {
    case 'course':
      return { tab: 'course', resourceId: result.resourceId || result.id };
    case 'book':
    case 'resource':
      return { tab: 'resource', resourceId: result.resourceId || result.id };
    case 'lesson':
      if (result.resourceId) return { tab: 'course', resourceId: result.resourceId, lessonId: result.lessonId || result.id };
      return { tab: 'course', resourceId: result.id };
    case 'note':
      return { tab: 'note', noteId: result.id };
    case 'concept':
      return { tab: 'concept', conceptId: result.id };
    default:
      return { tab: 'library' };
  }
}

/**
 * Resuelve el destino de navegación de un nodo del grafo. Los módulos se abren
 * a través del curso al que pertenecen; los conceptos usan su vista de detalle.
 */
export function resolveGraphNodeDestination(node: Pick<ConceptNode, 'id' | 'node_type' | 'meta'>): ResourceDestination {
  switch (node.node_type) {
    case 'course':
      return { tab: 'course', resourceId: node.id };
    case 'book':
    case 'resource':
      return { tab: 'resource', resourceId: node.id };
    case 'lesson':
      if (node.meta?.course_id) return { tab: 'course', resourceId: node.meta.course_id, lessonId: node.id };
      return { tab: 'course', resourceId: node.id };
    case 'note':
      return { tab: 'note', noteId: node.id };
    case 'concept':
      return { tab: 'concept', conceptId: node.id };
    case 'module':
      if (node.meta?.course_id) return { tab: 'course', resourceId: node.meta.course_id };
      return { tab: 'library' };
    default:
      return { tab: 'library' };
  }
}

export type DestructiveAction = 'delete-course' | 'delete-module' | 'delete-lesson' | 'delete-connection';

/**
 * Descripción explícita y honesta de una acción destructiva para el diálogo de
 * confirmación: qué se elimina, qué puede permanecer y si es reversible.
 */
export function describeDestructiveAction(
  action: DestructiveAction,
  targetLabel: string
): { title: string; consequence: string; confirmLabel: string; reversible: boolean } {
  switch (action) {
    case 'delete-course':
      return {
        title: 'Eliminar curso',
        consequence: `Se eliminará "${targetLabel}" junto con sus módulos y lecciones. Las notas y tarjetas asociadas se conservarán, pero perderán su vínculo con el curso. Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar curso',
        reversible: false
      };
    case 'delete-module':
      return {
        title: 'Eliminar módulo',
        consequence: `Se eliminará "${targetLabel}" y todas sus lecciones. Las notas asociadas se conservarán. Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar módulo',
        reversible: false
      };
    case 'delete-lesson':
      return {
        title: 'Eliminar lección',
        consequence: `Se eliminará "${targetLabel}". Las notas asociadas se conservarán, pero perderán su vínculo con la lección. Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar lección',
        reversible: false
      };
    case 'delete-connection':
    default:
      return {
        title: 'Eliminar conexión',
        consequence: `Se eliminará la relación "${targetLabel}" entre ambos recursos. Solo la relación se borra; los recursos no se modifican. Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar conexión',
        reversible: false
      };
  }
}
