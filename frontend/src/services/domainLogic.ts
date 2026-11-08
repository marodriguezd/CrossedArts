import type { GraphNodeType, GraphRelationType, ResourceDestination, SearchResult, ConceptNode, DailyActivityPoint, TimeRangeFilter, Note, Flashcard, Module } from '../types/models.ts';
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';

export interface BookProgressCalculation {
  clampedPage: number;
  percentage: number;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
}

export type BookProgressResult = 
  | { valid: true; data: BookProgressCalculation; error?: never }
  | { valid: false; error: string; data?: never };

/**
 * Purely and deterministically validates and computes book reading progress.
 */
export function calculateBookProgress(
  currentPage: number,
  totalPages: number,
  lang: LanguageCode = 'es'
): BookProgressResult {
  if (typeof totalPages !== 'number' || isNaN(totalPages) || totalPages <= 0) {
    return { valid: false, error: translateKey(lang, 'book.err.noTotal') };
  }

  if (typeof currentPage !== 'number' || isNaN(currentPage)) {
    return { valid: false, error: translateKey(lang, 'book.err.badPage') };
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
 * Clamps a book's current page after applying a delta to [0, totalPages].
 */
export function adjustBookPage(currentPage: number, delta: number, totalPages: number): number {
  if (typeof totalPages !== 'number' || isNaN(totalPages) || totalPages <= 0) return 0;
  const current = typeof currentPage === 'number' && !isNaN(currentPage) ? currentPage : 0;
  const target = current + delta;
  return Math.max(0, Math.min(Math.round(target), totalPages));
}

export {
  calculateSM2,
  formatNextReviewInterval,
  type SM2State,
  type SM2Result
} from './sm2.ts';

import {
  formatPlaybackTime,
  parseTimestampToSeconds,
  extractTimestampParts,
  getStoredPlaybackSeconds,
  SUPPORTED_PLAYBACK_SPEEDS,
  calculatePlaybackJump,
  resolveNextPlaybackSpeed,
  type TimestampPart
} from './playback.ts';

export {
  formatPlaybackTime,
  parseTimestampToSeconds,
  extractTimestampParts,
  getStoredPlaybackSeconds,
  SUPPORTED_PLAYBACK_SPEEDS,
  calculatePlaybackJump,
  resolveNextPlaybackSpeed,
  type TimestampPart
};

export { generateDailyActivitySeries } from './analytics.ts';

export type StudyItemKind = 'flashcard' | 'practice';

/**
 * Deterministic plan for mixed study mode: due SM-2 cards first, then
 * generated practice questions. No adaptivity or dynamic weighting.
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
 * Parses a SQLite-stored timestamp (`YYYY-MM-DD HH:MM:SS`, UTC) as a UTC
 * instant, not browser-local time.
 *
 * Returns `NaN` for unparseable input so the caller can degrade gracefully
 * without inventing a valid date.
 */
export function parseUtcTimestamp(value: string | null | undefined): number {
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  // Canonical SQLite format (`CURRENT_TIMESTAMP`) carries no timezone;
  // appending `Z` forces browser-independent UTC interpretation.
  const normalized = value.trim().replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  return Date.parse(withZone);
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
 * Builds a session summary. SM-2 grades never count as correct/wrong: only
 * practice questions report hits and misses, and no universal "knowledge
 * score" is ever computed.
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

/** Relations a user may create manually in the graph. Anything else is
 * structural and therefore not user-editable. */
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
 * Normalizes and validates a relation type. Returns null when the typed model
 * does not support it (avoids storing new arbitrary strings).
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
 * Purely validates a manual graph connection: supported type, existing nodes,
 * no self-links, no duplicates. No database access.
 */
export function validateKnowledgeConnection(
  candidate: KnowledgeConnectionCandidate,
  context: KnowledgeConnectionValidationContext,
  lang: LanguageCode = 'es'
): KnowledgeConnectionValidationResult {
  const relation = normalizeGraphRelation(candidate.relationType);
  if (!relation) {
    return { valid: false, error: translateKey(lang, 'conn.err.badRel', { rel: candidate.relationType }) };
  }
  if (!candidate.sourceId || !candidate.targetId) {
    return { valid: false, error: translateKey(lang, 'conn.err.needBoth') };
  }
  if (candidate.sourceId === candidate.targetId) {
    return { valid: false, error: translateKey(lang, 'conn.err.sameNode') };
  }
  const nodeIds = context.nodeIds instanceof Set ? context.nodeIds : new Set(context.nodeIds);
  if (!nodeIds.has(candidate.sourceId)) {
    return { valid: false, error: translateKey(lang, 'conn.err.noSource') };
  }
  if (!nodeIds.has(candidate.targetId)) {
    return { valid: false, error: translateKey(lang, 'conn.err.noTarget') };
  }
  const duplicate = context.existingEdges.some(
    e =>
      e.source_id === candidate.sourceId &&
      e.target_id === candidate.targetId &&
      e.connection_type === relation
  );
  if (duplicate) {
    return { valid: false, error: translateKey(lang, 'conn.err.dup') };
  }
  return { valid: true, relation };
}

export const GRAPH_NODE_LABELS: Record<GraphNodeType, string> = {
  concept: translateKey('es', 'graph.node.concept'),
  course: translateKey('es', 'graph.node.course'),
  book: translateKey('es', 'graph.node.book'),
  module: translateKey('es', 'graph.node.module'),
  lesson: translateKey('es', 'graph.node.lesson'),
  note: translateKey('es', 'graph.node.note'),
  practice: translateKey('es', 'graph.node.practice'),
  resource: translateKey('es', 'graph.node.resource')
};

/** Localized node-type label. Defaults to Spanish (existing callers omit it). */
export function graphNodeLabel(type: GraphNodeType, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `graph.node.${type}`);
}

/** Localized relation label. Defaults to Spanish (existing callers omit it). */
export function graphRelationLabel(relation: GraphRelationType, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `graph.rel.${relation}`);
}

export const GRAPH_RELATION_LABELS: Record<GraphRelationType, string> = {
  contains: translateKey('es', 'graph.rel.contains'),
  references: translateKey('es', 'graph.rel.references'),
  teaches: translateKey('es', 'graph.rel.teaches'),
  discusses: translateKey('es', 'graph.rel.discusses'),
  related_to: translateKey('es', 'graph.rel.related_to'),
  requires: translateKey('es', 'graph.rel.requires'),
  builds_on: translateKey('es', 'graph.rel.builds_on'),
  about: translateKey('es', 'graph.rel.about')
};

/** Learning-context refs owning an artifact. */
export interface ArtifactContextRefs {
  resourceId?: string;
  lessonId?: string;
  conceptId?: string;
}

/**
 * Target for an artifact WITHOUT its own view (practice work): it opens in
 * its origin learning context. Without context, the Library is the honest
 * fallback.
 *
 * Single source used by the graph, local search, and command palette so all
 * three routes open exactly the same place.
 */
export function resolveArtifactContextDestination(refs: ArtifactContextRefs): ResourceDestination {
  if (refs.resourceId) return { tab: 'resource', resourceId: refs.resourceId };
  if (refs.lessonId) return { tab: 'course', resourceId: refs.lessonId };
  if (refs.conceptId) return { tab: 'concept', conceptId: refs.conceptId };
  return { tab: 'library' };
}

/**
 * Resolves the navigation target of a local search hit. Every supported type
 * has a deterministic action with no AI or network involved.
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
      // Practice work opens in the context it evidences.
      return resolveArtifactContextDestination({
        resourceId: result.resourceId,
        lessonId: result.lessonId
      });
    case 'goal':
      // Goals have no graph node: their own view is their target.
      return { tab: 'goals', goalId: result.id };
    default:
      return { tab: 'library' };
  }
}

/**
 * Resolves the navigation target of a graph node. Modules open through their
 * parent course; concepts use their detail view.
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
      // Practice work has no dedicated view: it opens in its origin context
      // (resource -> detail, lesson/concept -> its view).
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
 * Explicit honest description of a destructive action for the confirm dialog:
 * what is removed, what may remain, and whether it is reversible.
 */
export function describeDestructiveAction(
  action: DestructiveAction,
  targetLabel: string,
  lang: LanguageCode = 'es'
): { title: string; consequence: string; confirmLabel: string; reversible: boolean } {
  const tr = (key: string, params?: Record<string, string | number | null | undefined>): string =>
    translateKey(lang, key, params);
  switch (action) {
    case 'delete-course':
      return {
        title: tr('destroy.courseT'),
        consequence: tr('destroy.courseC', { label: targetLabel }),
        confirmLabel: tr('destroy.courseOk'),
        reversible: false
      };
    case 'delete-module':
      return {
        title: tr('destroy.moduleT'),
        consequence: tr('destroy.moduleC', { label: targetLabel }),
        confirmLabel: tr('destroy.moduleOk'),
        reversible: false
      };
    case 'delete-lesson':
      return {
        title: tr('destroy.lessonT'),
        consequence: tr('destroy.lessonC', { label: targetLabel }),
        confirmLabel: tr('destroy.lessonOk'),
        reversible: false
      };
    case 'delete-connection':
    default:
      return {
        title: tr('destroy.connT'),
        consequence: tr('destroy.connC', { label: targetLabel }),
        confirmLabel: tr('destroy.connOk'),
        reversible: false
      };
  }
}

/**
 * Maps a keypress ('1'-'9' or case-insensitive 'A'-'Z') to a 0-based
 * multiple-choice index, or null when the key does not apply.
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

export interface MarkdownInlineToken {
  type: 'text' | 'bold' | 'italic' | 'code' | 'timestamp';
  content: string;
  seconds?: number;
}

/**
 * Parses a text fragment into inline-markdown tokens and interactive timestamps.
 * Pure function with no DOM or React dependencies for Node testability.
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
 * Filters knowledge-graph nodes by lexical match on name or description.
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
 * Exports an HTMLCanvasElement to a PNG file with an opaque background and triggers download.
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

  // Opaque themed background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, offscreen.width, offscreen.height);

  // Paints the original graph over the background
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
 * File extensions accepted for local document ingestion.
 */
export const SUPPORTED_INGESTION_EXTENSIONS = ['.txt', '.md', '.markdown', '.pdf', '.epub'] as const;

/**
 * Keeps only supported formats from a file list (.txt, .md, .markdown, .pdf, .epub).
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
 * Converts one note to Markdown with frontmatter metadata and a local watermark.
 */
export function exportNoteToMarkdown(note: Note, contextInfo?: { resourceTitle?: string; lessonTitle?: string }, lang: LanguageCode = 'es'): string {
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
  lines.push(`*${translateKey(lang, 'export.md.footer', { date: new Date().toISOString().slice(0, 10) })}*`);
  return lines.join('\n');
}

/**
 * Converts a batch of notes into one consolidated Markdown document with separators.
 */
export function exportNotesToSingleMarkdown(notes: Note[], lang: LanguageCode = 'es'): string {
  const lines: string[] = [];
  lines.push(`# ${translateKey(lang, 'export.md.notebook')}`);
  lines.push('');
  lines.push(`*${translateKey(lang, 'export.md.notebookSub', { n: notes.length, date: new Date().toISOString().slice(0, 10) })}*`);
  lines.push('');

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    lines.push(`## ${i + 1}. ${note.title}`);
    lines.push('');
    if (note.created_at || note.tags) {
      const metaParts: string[] = [];
      if (note.created_at) metaParts.push(translateKey(lang, 'export.md.metaDate', { date: note.created_at.slice(0, 10) }));
      if (note.tags) metaParts.push(translateKey(lang, 'export.md.metaTags', { tags: note.tags }));
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
 * Triggers a text-file download in the user browser.
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
 * Filters flashcards by origin type:
 * - 'all': every available card.
 * - 'course': only cards linked to structured courses.
 * - 'book': only cards linked to books or readings.
 * - 'general': orphan cards with no specific linked resource.
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
 * Filters a course's modules and lessons by lexical query. Returns only
 * modules with matching lessons (or a matching title).
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
 * Extracts every unique tag from a note collection with occurrence counts.
 * Trims and normalizes whitespace; drops empty values and technical tags
 * such as 'sha256:*'.
 */
export function extractUniqueTagsWithCounts(notes: Note[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();

  for (const n of notes) {
    if (!n.tags) continue;
    const parts = n.tags.split(',').map(t => t.trim()).filter(Boolean);
    for (const rawTag of parts) {
      // Skip low-level hash fingerprints in the visual UI
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
 * Accent- and case-insensitive form of a text, for matching.
 *
 * Lowercase first, then NFD splits each base letter from its diacritic so the
 * combining marks can be dropped. SQLite's `lower()` folds ASCII only, which is
 * why a query for «ética» never matched a stored «Ética aplicada».
 */
export function foldForSearch(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Filters notes by combined text query and exact tag filter.
 *
 * The free-text query is folded on BOTH sides (see `foldForSearch`), so
 * «etica» finds «Ética aplicada»; the selected tag stays an exact,
 * case-insensitive comparison — it is picked from the note's own tags, so
 * folding it could only blur what was selected.
 */
export function filterNotesByQueryAndTag(
  notes: Note[],
  query: string,
  selectedTag: string | null
): Note[] {
  const q = foldForSearch(query.trim());
  const targetTag = selectedTag ? selectedTag.trim().toLowerCase() : null;

  return notes.filter(n => {
    // 1. Tag filter when selected
    if (targetTag) {
      const noteTags = (n.tags || '')
        .split(',')
        .map(t => t.trim().toLowerCase());
      if (!noteTags.includes(targetTag)) return false;
    }

    // 2. Query filter when present
    if (!q) return true;
    return (
      foldForSearch(n.title).includes(q) ||
      foldForSearch(n.content).includes(q) ||
      foldForSearch(n.tags || '').includes(q)
    );
  });
}

