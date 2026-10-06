import type { GraphNodeType, GraphRelationType, ResourceDestination, SearchResult, ConceptNode, DailyActivityPoint, TimeRangeFilter, Note, Flashcard, Module } from '../types/models.ts';

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

/**
 * Ajusta la página actual de un libro aplicando un delta y restringiendo al rango [0, totalPages].
 */
export function adjustBookPage(currentPage: number, delta: number, totalPages: number): number {
  if (typeof totalPages !== 'number' || isNaN(totalPages) || totalPages <= 0) return 0;
  const current = typeof currentPage === 'number' && !isNaN(currentPage) ? currentPage : 0;
  const target = current + delta;
  return Math.max(0, Math.min(Math.round(target), totalPages));
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
 * Interpreta una marca temporal almacenada por SQLite (`YYYY-MM-DD HH:MM:SS`, UTC)
 * como un instante UTC y no como hora local del navegador.
 *
 * Devuelve `NaN` si la cadena no es parseable, para que el llamador decida cómo
 * degradar el comportamiento sin inventar una fecha válida.
 */
export function parseUtcTimestamp(value: string | null | undefined): number {
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  // El formato canónico de SQLite (`CURRENT_TIMESTAMP`) no incluye zona horaria;
  // añadir `Z` garantiza una interpretación UTC independiente del navegador.
  const normalized = value.trim().replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  return Date.parse(withZone);
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
  practice: 'Trabajo práctico',
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

/** Referencias al contexto de aprendizaje del que cuelga un artefacto. */
export interface ArtifactContextRefs {
  resourceId?: string;
  lessonId?: string;
  conceptId?: string;
}

/**
 * Destino de un artefacto que NO tiene vista propia (trabajo práctico): se abre
 * en su contexto de aprendizaje de origen. Sin contexto, la Biblioteca es la
 * degradación honesta.
 *
 * Fuente única: la usan el grafo, la búsqueda local y la paleta de comandos, para
 * que las tres rutas abran exactamente el mismo sitio.
 */
export function resolveArtifactContextDestination(refs: ArtifactContextRefs): ResourceDestination {
  if (refs.resourceId) return { tab: 'resource', resourceId: refs.resourceId };
  if (refs.lessonId) return { tab: 'course', resourceId: refs.lessonId };
  if (refs.conceptId) return { tab: 'concept', conceptId: refs.conceptId };
  return { tab: 'library' };
}

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
    case 'practice':
      // El trabajo práctico se abre en el contexto que demuestra.
      return resolveArtifactContextDestination({
        resourceId: result.resourceId,
        lessonId: result.lessonId
      });
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
    case 'practice':
      // El trabajo práctico no tiene vista propia: se abre en su contexto de
      // origen (recurso → detalle, lección/concepto → su vista).
      return resolveArtifactContextDestination({
        resourceId: node.meta?.resource_id,
        lessonId: node.meta?.lesson_id,
        conceptId: node.meta?.concept_id
      });
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

/**
 * Resuelve una pulsación de tecla ('1'-'9' o 'A'-'Z' insensible a mayúsculas)
 * al índice base 0 de opción múltiple, o null si la tecla no corresponde.
 */
export function resolveShortcutOptionIndex(key: string, maxOptions: number): number | null {
  if (!key || maxOptions <= 0) return null;
  const num = parseInt(key, 10);
  if (!isNaN(num) && num >= 1 && num <= maxOptions) {
    return num - 1;
  }
  const letter = key.toUpperCase();
  if (letter.length === 1 && letter >= 'A' && letter <= 'Z') {
    const idx = letter.charCodeAt(0) - 65;
    if (idx >= 0 && idx < maxOptions) {
      return idx;
    }
  }
  return null;
}

/**
 * Formatea un número de segundos en formato 'mm:ss' o 'hh:mm:ss'.
 */
export function formatPlaybackTime(seconds: number): string {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) {
    return '00:00';
  }
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Convierte un string de tiempo tipo '01:15' o '01:05:30' o '[01:15]' a segundos totales.
 */
export function parseTimestampToSeconds(timestamp: string): number | null {
  if (!timestamp) return null;
  const clean = timestamp.replace(/^\[/, '').replace(/\]$/, '').trim();
  const parts = clean.split(':').map(p => parseInt(p, 10));

  if (parts.some(p => isNaN(p) || p < 0)) return null;

  if (parts.length === 2) {
    const [mins, secs] = parts;
    if (secs >= 60) return null;
    return mins * 60 + secs;
  }

  if (parts.length === 3) {
    const [hrs, mins, secs] = parts;
    if (mins >= 60 || secs >= 60) return null;
    return hrs * 3600 + mins * 60 + secs;
  }

  return null;
}

export interface TimestampPart {
  text: string;
  isTimestamp: boolean;
  seconds?: number;
  rawTimestamp?: string;
}

/**
 * Divide un texto en fragmentos de texto plano y marcas de tiempo interactivas [mm:ss] o [hh:mm:ss].
 */
export function extractTimestampParts(content: string): TimestampPart[] {
  if (!content) return [];
  const regex = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/g;
  const parts: TimestampPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        text: content.slice(lastIndex, match.index),
        isTimestamp: false
      });
    }

    const fullTag = match[0];
    const inner = fullTag.slice(1, -1);
    const secs = parseTimestampToSeconds(inner);

    if (secs !== null) {
      parts.push({
        text: fullTag,
        isTimestamp: true,
        seconds: secs,
        rawTimestamp: inner
      });
    } else {
      parts.push({
        text: fullTag,
        isTimestamp: false
      });
    }

    lastIndex = match.index + fullTag.length;
  }

  if (lastIndex < content.length) {
    parts.push({
      text: content.slice(lastIndex),
      isTimestamp: false
    });
  }

  return parts;
}

export interface MarkdownInlineToken {
  type: 'text' | 'bold' | 'italic' | 'code' | 'timestamp';
  content: string;
  seconds?: number;
}

/**
 * Parsea un fragmento de texto en tokens de markdown en línea y marcas de tiempo interactivas.
 * Función pura sin dependencias de DOM ni React para garantizar testeabilidad en Node.
 */
export function parseInlineMarkdownTokens(text: string): MarkdownInlineToken[] {
  if (!text) return [];
  const timestampParts = extractTimestampParts(text);
  const result: MarkdownInlineToken[] = [];

  for (const part of timestampParts) {
    if (part.isTimestamp && part.seconds !== undefined) {
      result.push({
        type: 'timestamp',
        content: part.rawTimestamp || part.text,
        seconds: part.seconds
      });
      continue;
    }

    const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    const tokens = part.text.split(inlineRegex);

    for (const tok of tokens) {
      if (!tok) continue;
      if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
        result.push({ type: 'code', content: tok.slice(1, -1) });
      } else if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
        result.push({ type: 'bold', content: tok.slice(2, -2) });
      } else if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2) {
        result.push({ type: 'italic', content: tok.slice(1, -1) });
      } else {
        result.push({ type: 'text', content: tok });
      }
    }
  }

  return result;
}

/**
 * Filtra nodos del grafo de conocimiento por coincidencia léxica sobre nombre o descripción.
 */
export function searchGraphNodes(
  nodes: ConceptNode[],
  query: string,
  limit = 8
): ConceptNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes
    .filter(n => n.name.toLowerCase().includes(q) || (n.description && n.description.toLowerCase().includes(q)))
    .slice(0, limit);
}

/**
 * Exporta un elemento HTMLCanvasElement a un archivo PNG con fondo opaco y dispara la descarga.
 */
export function exportCanvasAsImage(
  canvas: HTMLCanvasElement,
  backgroundColor = '#FAF7F2',
  filename = 'crossedarts-grafo.png'
): boolean {
  if (typeof document === 'undefined' || !canvas || canvas.width === 0 || canvas.height === 0) {
    return false;
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return false;

  // Fondo opaco temático
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, offscreen.width, offscreen.height);

  // Dibuja el grafo original sobre el fondo
  ctx.drawImage(canvas, 0, 0);

  const dataUrl = offscreen.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}

/**
 * Extensiones de archivo admitidas para la ingesta local de documentos.
 */
export const SUPPORTED_INGESTION_EXTENSIONS = ['.txt', '.md', '.markdown', '.pdf', '.epub'] as const;

/**
 * Filtra una lista de archivos quedándose únicamente con los formatos compatibles (.txt, .md, .markdown, .pdf, .epub).
 */
export function filterSupportedFiles(files: File[] | FileList | null | undefined): File[] {
  if (!files) return [];
  const list = Array.isArray(files) ? files : Array.from(files);
  return list.filter(file => {
    const name = file.name.toLowerCase();
    return SUPPORTED_INGESTION_EXTENSIONS.some(ext => name.endsWith(ext));
  });
}

/**
 * Genera una serie temporal continua de días con actividad de estudio agregada.
 * Rellena los días vacíos con cero para que el gráfico sea uniforme y predecible.
 */
export function generateDailyActivitySeries(
  history: Array<{ date: string; minutes: number; reviews: number }>,
  range: TimeRangeFilter,
  todayStr: string
): DailyActivityPoint[] {
  const daysCount = range === '7d' ? 7 : range === '30d' ? 30 : 0;
  const historyMap = new Map<string, { minutes: number; reviews: number }>();
  for (const h of history) {
    const existing = historyMap.get(h.date) || { minutes: 0, reviews: 0 };
    historyMap.set(h.date, {
      minutes: existing.minutes + h.minutes,
      reviews: existing.reviews + h.reviews
    });
  }

  const formatShortLabel = (isoDate: string): string => {
    const parts = isoDate.split('-');
    if (parts.length < 3) return isoDate;
    const [, mm, dd] = parts;
    const monthNames: Record<string, string> = {
      '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun',
      '07': 'Jul', '08': 'Ago', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic'
    };
    return `${dd} ${monthNames[mm] || mm}`;
  };

  if (daysCount > 0) {
    // Generar exactamente los últimos N días terminando en hoy
    const points: DailyActivityPoint[] = [];
    const baseDate = new Date(`${todayStr}T00:00:00Z`);

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(baseDate.getTime() - i * 86_400_000);
      const iso = d.toISOString().slice(0, 10);
      const data = historyMap.get(iso) || { minutes: 0, reviews: 0 };
      points.push({
        date: iso,
        label: formatShortLabel(iso),
        minutes: data.minutes,
        reviews: data.reviews
      });
    }
    return points;
  }

  // Modo 'all': ordenar cronológicamente todos los días registrados
  const allDates = Array.from(historyMap.keys()).sort();
  if (allDates.length === 0) {
    return [{
      date: todayStr,
      label: formatShortLabel(todayStr),
      minutes: 0,
      reviews: 0
    }];
  }

  return allDates.map(iso => {
    const data = historyMap.get(iso)!;
    return {
      date: iso,
      label: formatShortLabel(iso),
      minutes: data.minutes,
      reviews: data.reviews
    };
  });
}

/**
 * Convierte una nota individual a formato Markdown con metadatos en cabecera frontmatter y marca de agua local.
 */
export function exportNoteToMarkdown(note: Note, contextInfo?: { resourceTitle?: string; lessonTitle?: string }): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: "${note.title.replace(/"/g, '\\"')}"`);
  lines.push(`date: "${note.created_at || new Date().toISOString()}"`);
  if (note.tags) lines.push(`tags: [${note.tags.split(',').map(t => `"${t.trim()}"`).join(', ')}]`);
  if (contextInfo?.resourceTitle) lines.push(`resource: "${contextInfo.resourceTitle.replace(/"/g, '\\"')}"`);
  if (contextInfo?.lessonTitle) lines.push(`lesson: "${contextInfo.lessonTitle.replace(/"/g, '\\"')}"`);
  lines.push('source: "CrossedArts Learning OS"');
  lines.push('---');
  lines.push('');
  lines.push(`# ${note.title}`);
  lines.push('');
  lines.push(note.content || '');
  lines.push('');
  lines.push('---');
  lines.push(`*Exportado localmente desde CrossedArts el ${new Date().toISOString().slice(0, 10)}*`);
  return lines.join('\n');
}

/**
 * Convierte un lote de notas a un único documento Markdown consolidado con separadores.
 */
export function exportNotesToSingleMarkdown(notes: Note[]): string {
  const lines: string[] = [];
  lines.push('# Cuaderno de Estudio — CrossedArts');
  lines.push('');
  lines.push(`*Colección de ${notes.length} notas de estudio exportadas el ${new Date().toISOString().slice(0, 10)}*`);
  lines.push('');

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    lines.push(`## ${i + 1}. ${note.title}`);
    lines.push('');
    if (note.created_at || note.tags) {
      const metaParts: string[] = [];
      if (note.created_at) metaParts.push(`**Fecha:** ${note.created_at.slice(0, 10)}`);
      if (note.tags) metaParts.push(`**Etiquetas:** \`${note.tags}\``);
      lines.push(metaParts.join(' | '));
      lines.push('');
    }
    lines.push(note.content || '');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Dispara la descarga de un archivo de texto en el navegador del usuario.
 */
export function triggerTextDownload(content: string, filename: string, mimeType = 'text/markdown;charset=utf-8'): boolean {
  if (typeof document === 'undefined') return false;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Filtra flashcards según el tipo de origen:
 * - 'all': Todas las tarjetas disponibles.
 * - 'course': Solo tarjetas asociadas a cursos estructurados.
 * - 'book': Solo tarjetas asociadas a libros o lecturas.
 * - 'general': Tarjetas huérfanas o sin recurso asociado específico.
 */
export function filterFlashcardsByOrigin(
  cards: Flashcard[],
  originType: 'all' | 'course' | 'book' | 'general',
  resourceKindMap: Map<string, 'course' | 'book' | 'learning_resource'>
): Flashcard[] {
  if (originType === 'all') return cards;

  return cards.filter(card => {
    if (!card.resource_id) {
      return originType === 'general';
    }
    const kind = resourceKindMap.get(card.resource_id);
    if (originType === 'course') return kind === 'course';
    if (originType === 'book') return kind === 'book';
    if (originType === 'general') return !kind || kind === 'learning_resource';
    return true;
  });
}

/**
 * Filtra los módulos y lecciones de un curso a partir de una consulta léxica.
 * Devuelve únicamente los módulos que contengan lecciones coincidentes (o cuyo título coincida).
 */
export function filterCourseLessons(
  modules: Module[] | undefined | null,
  query: string
): { filteredModules: Module[]; totalMatchingLessons: number } {
  if (!modules || modules.length === 0) {
    return { filteredModules: [], totalMatchingLessons: 0 };
  }

  const q = query.trim().toLowerCase();
  if (!q) {
    const total = modules.reduce((sum, m) => sum + (m.lessons?.length || 0), 0);
    return { filteredModules: modules, totalMatchingLessons: total };
  }

  let totalMatching = 0;
  const filtered: Module[] = [];

  for (const mod of modules) {
    const modTitleMatches = mod.title.toLowerCase().includes(q);
    const matchingLessons = (mod.lessons || []).filter(l =>
      modTitleMatches ||
      l.title.toLowerCase().includes(q) ||
      (l.content && l.content.toLowerCase().includes(q))
    );

    if (matchingLessons.length > 0) {
      totalMatching += matchingLessons.length;
      filtered.push({
        ...mod,
        lessons: matchingLessons
      });
    }
  }

  return { filteredModules: filtered, totalMatchingLessons: totalMatching };
}

/**
 * Extrae todas las etiquetas únicas de una colección de notas con su conteo de ocurrencias.
 * Limpia y normaliza espacios y descarta valores vacíos o etiquetas técnicas como 'sha256:*'.
 */
export function extractUniqueTagsWithCounts(notes: Note[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();

  for (const n of notes) {
    if (!n.tags) continue;
    const parts = n.tags.split(',').map(t => t.trim()).filter(Boolean);
    for (const rawTag of parts) {
      // Omitir huellas hash de bajo nivel en la interfaz visual
      if (rawTag.startsWith('sha256:')) continue;
      const tag = rawTag.toLowerCase();
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Filtra notas combinando consulta de texto y filtro por etiqueta exacta.
 */
export function filterNotesByQueryAndTag(
  notes: Note[],
  query: string,
  selectedTag: string | null
): Note[] {
  const q = query.trim().toLowerCase();
  const targetTag = selectedTag ? selectedTag.trim().toLowerCase() : null;

  return notes.filter(n => {
    // 1. Filtro por tag si está seleccionado
    if (targetTag) {
      const noteTags = (n.tags || '')
        .split(',')
        .map(t => t.trim().toLowerCase());
      if (!noteTags.includes(targetTag)) return false;
    }

    // 2. Filtro por consulta si existe
    if (!q) return true;
    return (
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      (n.tags || '').toLowerCase().includes(q)
    );
  });
}

/**
 * Recupera de forma segura los segundos de reproducción guardados para una lección en localStorage.
 * Retorna null si no existe, si es inválido o si localStorage no está disponible.
 */
export function getStoredPlaybackSeconds(lessonId: string): number | null {
  if (typeof localStorage === 'undefined' || !lessonId) return null;
  try {
    const raw = localStorage.getItem(`crossedarts-playback:${lessonId}`);
    if (!raw) return null;
    const secs = parseFloat(raw);
    return !isNaN(secs) && secs > 0 ? secs : null;
  } catch {
    return null;
  }
}

export const SUPPORTED_PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/**
 * Calcula el nuevo segundo de reproducción tras un salto temporal (positivo o negativo),
 * garantizando que permanezca estrictamente acotado en el intervalo [0, duration].
 */
export function calculatePlaybackJump(currentTime: number, deltaSeconds: number, duration: number = Infinity): number {
  const safeCurrent = isNaN(currentTime) || currentTime < 0 ? 0 : currentTime;
  const safeDuration = isNaN(duration) || duration <= 0 ? Infinity : duration;
  const target = safeCurrent + deltaSeconds;
  return Math.max(0, Math.min(safeDuration, target));
}

/**
 * Resuelve la siguiente velocidad de reproducción al incrementar o decrementar
 * usando los tramos estándar de la aplicación.
 */
export function resolveNextPlaybackSpeed(currentSpeed: number, direction: 'increase' | 'decrease'): number {
  const speeds = SUPPORTED_PLAYBACK_SPEEDS;
  const idx = speeds.indexOf(currentSpeed as any);
  if (direction === 'increase') {
    if (idx === -1) {
      const next = speeds.find(s => s > currentSpeed);
      return next ?? speeds[speeds.length - 1];
    }
    return idx < speeds.length - 1 ? speeds[idx + 1] : speeds[idx];
  } else {
    if (idx === -1) {
      const prev = [...speeds].reverse().find(s => s < currentSpeed);
      return prev ?? speeds[0];
    }
    return idx > 0 ? speeds[idx - 1] : speeds[0];
  }
}

