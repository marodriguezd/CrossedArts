export interface StructuredValidationResult<T> {
  valid: boolean;
  data?: T;
  error?: string;
}

/**
 * Validates and parses structured JSON responses from local models, ensuring
 * typing, rejection of malformed formats, and domain-bound checks.
 */
export function validateStructuredJson<T>(
  rawText: string,
  schemaValidator: (parsed: any) => { valid: boolean; error?: string }
): StructuredValidationResult<T> {
  if (!rawText || !rawText.trim()) {
    return { valid: false, error: 'La respuesta del modelo está vacía.' };
  }

  // Extract the JSON block when it is delimited by markdown ```json ... ```
  let jsonString = rawText.trim();
  const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonString = jsonMatch[1].trim();
  } else {
    // Without fences, try to extract the first object or array
    const firstBrace = jsonString.indexOf('{');
    const firstBracket = jsonString.indexOf('[');
    let startIdx = -1;
    if (firstBrace !== -1 && firstBracket !== -1) {
      startIdx = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
      startIdx = firstBrace;
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
    }

    if (startIdx !== -1) {
      const lastBrace = jsonString.lastIndexOf('}');
      const lastBracket = jsonString.lastIndexOf(']');
      const endIdx = Math.max(lastBrace, lastBracket);
      if (endIdx > startIdx) {
        jsonString = jsonString.substring(startIdx, endIdx + 1);
      }
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: any) {
    return { valid: false, error: `JSON malformado recibido del modelo: ${err?.message}` };
  }

  const validation = schemaValidator(parsed);
  if (!validation.valid) {
    return { valid: false, error: validation.error || 'La estructura no cumple con el esquema requerido.' };
  }

  return { valid: true, data: parsed as T };
}

/* -------------------------------------------------------------------------- */
/* Anti-hallucination gate                                                     */
/* -------------------------------------------------------------------------- */

/** Explicit signals that the model is missing real information. */
const UNCERTAINTY_SIGNALS = [
  'no contiene suficiente informaci',
  'no tengo suficiente informaci',
  'no hay informaci',
  'no encuentro',
  'no aparece',
  'no tengo acceso',
  'no puedo verificar',
  'no dispongo de',
  'sin informaci',
  'no estoy seguro',
  'no puedo confirmar',
  'insuficiente informaci'
];

/**
 * SOURCE-CLAIM patterns a model may invent without context: references to pages,
 * courses, lessons, chapters, authors, or URLs.
 *
 * These are explicit provenance claims, not general language. "The course uses
 * hooks" is a normal explanation; "segun la pagina 42 del curso" is a citation
 * that, without context, is fabricated.
 */
const SOURCE_CLAIM_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bseg[uú]n (el|la|los|las|este|esta) (curso|libro|material|documento|texto|manual|art[ií]culo)\b/i, label: 'referencia al material de origen' },
  { pattern: /\b(en|seg[uú]n) (la |el )?(p[aá]gina|p[aá]gs\.?|cap[ií]tulo|cap\.)\s*\d+/i, label: 'referencia a una página o capítulo' },
  { pattern: /\b(p[aá]gina|p[aá]g\.)\s*\d+\b/i, label: 'referencia a una página' },
  { pattern: /\ben (la |el )?lecci[oó]n\s*(n[.ºº]?|\d+|[«"'])/i, label: 'referencia a una lección concreta' },
  { pattern: /\bla lecci[oó]n\s+[«"'][^»"']+[»"']/i, label: 'referencia a una lección citada' },
  { pattern: /\bel (curso|libro|documento)\s+[«"'][^»"']+[»"']/i, label: 'referencia a un curso o libro citado' },
  { pattern: /\bfuente\s*\d+\b/i, label: 'referencia a una fuente numerada' },
  { pattern: /\bfuentes?\s*:\s*\[[^\]]*\]/i, label: 'lista de fuentes' },
  { pattern: /\bhttps?:\/\/\S+/i, label: 'URL citada' },
  { pattern: /\b(autor|autora|escrito por|publicado por)\s+[«"']?[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+/i, label: 'autoría atribuida' },
  { pattern: /\bcomo (se |lo )?(menciona|indica|explica|señala|afirma)\b/i, label: 'atribución a una fuente no identificable' },
  { pattern: /\ben el (cap[ií]tulo|m[oó]dulo|tema)\s*(n[.ºº]?\s*)?\d+/i, label: 'referencia a un módulo o capítulo numerado' }
];

export interface AntiHallucinationInput {
  /** There is retrieved material VISIBLE to the model. */
  hasRetrievedContext: boolean;
  /**
   * Some visible source rests on real content (not metadata alone). With
   * `false` the answer cannot pose as solidly grounded even when citing material.
   */
  hasSubstantiveContext?: boolean;
  /** Titles actually visible to the model (the citations it can uphold). */
  availableSourceTitles?: string[];
}

export interface AntiHallucinationResult {
  /** `false` when the answer would claim an unavailable source. */
  passed: boolean;
  /** Final allowed text: the original, or a controlled honest replacement. */
  text: string;
  /** Deterministic rejection reason (diagnostics and tests). */
  reason?: string;
  /** `true` when the answer CANNOT be presented as grounded. */
  weakGrounding: boolean;
}

/**
 * Controlled, honest message that replaces an answer claiming nonexistent
 * sources. It invents no content and cites nothing.
 */
export const NO_CONTEXT_REFUSAL_MESSAGE =
  'No he encontrado material de estudio en CrossedArts que sustente una respuesta con referencias concretas. ' +
  'Si me dices qué curso, lección o nota te interesa, puedo recuperar ese contexto y responder con citas verificables.';

export const WEAK_GROUNDING_NOTICE =
  'Aviso: solo encontré coincidencias de título o metadatos, no contenido literal. Confirmá con tu material antes de citar esta respuesta.';

function normalizeText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function hasUncertaintySignal(text: string): boolean {
  const normalized = normalizeText(text);
  return UNCERTAINTY_SIGNALS.some(signal => normalized.includes(signal));
}

/**
 * SOURCE CLAIM that cannot be upheld by the visible material.
 *
 * Deterministic and cheap: normalization + literal patterns. Not semantic
 * censorship: only provenance references are evaluated (page, course, lesson,
 * chapter, author, URL). When the reference matches a title actually visible,
 * it is not treated as fabricated.
 */
export function findUnsupportedSourceClaim(
  generatedText: string,
  availableSourceTitles: string[] = []
): string | null {
  const text = generatedText || '';
  const lower = text.toLowerCase();
  const titlesVisible = availableSourceTitles
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  for (const { pattern, label } of SOURCE_CLAIM_PATTERNS) {
    if (!pattern.test(text)) continue;
    const grounded = titlesVisible.some(needle => lower.includes(needle));
    if (grounded) continue;
    return label;
  }
  return null;
}

/**
 * FINAL gate for conversational answers.
 *
 * Rules (deterministic, cheap, no semantic censorship):
 *
 *  1. Without retrieved context, an explicit source claim absent from the
 *     visible material is REJECTED and replaced with an honest message.
 *  2. Without context, HONEST uncertainty is preserved: an answer saying
 *     "there is not enough information" is valid and useful.
 *  3. With weak context (metadata only) the answer is flagged as ungrounded
 *     through an explicit notice.
 *
 * General language and normal explanations are never rejected.
 */
export function validateAntiHallucination(
  generatedText: string,
  hasRetrievedContext: boolean,
  options?: Omit<AntiHallucinationInput, 'hasRetrievedContext'>
): AntiHallucinationResult {
  const { hasSubstantiveContext = false, availableSourceTitles = [] } = options || {};
  const text = generatedText || '';

  if (!hasRetrievedContext) {
    // Rule 2 first: honest uncertainty is never blocked.
    if (hasUncertaintySignal(text)) {
      return { passed: true, text, weakGrounding: true };
    }

    // Rule 1: source claim without visible material.
    const claim = findUnsupportedSourceClaim(text, availableSourceTitles);
    if (claim) {
      return {
        passed: false,
        text: NO_CONTEXT_REFUSAL_MESSAGE,
        reason: `Afirmación de fuente no sustentada (${claim}) sin contexto recuperado.`,
        weakGrounding: true
      };
    }

    return { passed: true, text, weakGrounding: true };
  }

  // Visible context exists. Rule 3: when context is weak (metadata only), the
  // answer is flagged as ungrounded.
  if (!hasSubstantiveContext) {
    return {
      passed: true,
      text: text.includes(WEAK_GROUNDING_NOTICE) ? text : `${text}\n\n${WEAK_GROUNDING_NOTICE}`,
      weakGrounding: true
    };
  }

  return { passed: true, text, weakGrounding: false };
}
