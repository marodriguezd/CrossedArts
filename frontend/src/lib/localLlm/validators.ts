export interface StructuredValidationResult<T> {
  valid: boolean;
  data?: T;
  error?: string;
}

/**
 * Valida y parsea respuestas JSON estructuradas de modelos locales,
 * asegurando tipado, rechazo de formatos malformados y comprobación de límites de dominio.
 */
export function validateStructuredJson<T>(
  rawText: string,
  schemaValidator: (parsed: any) => { valid: boolean; error?: string }
): StructuredValidationResult<T> {
  if (!rawText || !rawText.trim()) {
    return { valid: false, error: 'La respuesta del modelo está vacía.' };
  }

  // Extraer bloque JSON si viene delimitado por markdown ```json ... ```
  let jsonString = rawText.trim();
  const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonString = jsonMatch[1].trim();
  } else {
    // Si no tiene fences, intentar extraer el primer objeto o array
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
/* Barrera anti-alucinación                                                   */
/* -------------------------------------------------------------------------- */

/** Señales explícitas de que el modelo está faltando información real. */
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
 * Patrones de AFIRMACIÓN DE FUENTE que un modelo puede inventar cuando no tiene
 * contexto: referencias a páginas, cursos, lecciones, capítulos, autores o URLs.
 *
 * Son afirmaciones de origen explícitas, no lenguaje general. "El curso usa
 * hooks" es una explicación normal; "según la página 42 del curso" es una cita
 * que, sin contexto, es inventada.
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
  /** Hay material recuperado y VISIBLE para el modelo. */
  hasRetrievedContext: boolean;
  /**
   * Alguna de las fuentes visibles se apoya en contenido real (no solo en
   * metadatos). Con `false` la respuesta no puede presentarse como sólidamente
   * fundamentada aunque cite material.
   */
  hasSubstantiveContext?: boolean;
  /** Títulos realmente visibles para el modelo (las citas que puede sostener). */
  availableSourceTitles?: string[];
}

export interface AntiHallucinationResult {
  /** `false` cuando la respuesta afirmaría una fuente no disponible. */
  passed: boolean;
  /** Texto final permitido: el original, o una sustitución controlada y honesta. */
  text: string;
  /** Motivo determinista del rechazo (diagnóstico y pruebas). */
  reason?: string;
  /** `true` cuando la respuesta NO puede presentarse como fundamentada. */
  weakGrounding: boolean;
}

/**
 * Mensaje controlado y honesto que sustituye a una respuesta que afirmaba
 * fuentes inexistentes. No inventa contenido ni cita nada.
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
 * AFIRMACIÓN DE FUENTE que no puede sostenerse con el material visible.
 *
 * Determinista y barata: normalización + patrones literales. No es un sistema de
 * censura semántica: solo se evalúan referencias de procedencia (página, curso,
 * lección, capítulo, autor, URL). Si la referencia coincide con un título
 * realmente visible, no se considera inventada.
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
 * BARRERA FINAL de las respuestas conversacionales.
 *
 * Reglas (deterministas, baratas, sin censura semántica):
 *
 *  1. Sin contexto recuperado, una afirmación explícita de fuente que no exista en
 *     el material visible se RECHAZA y se sustituye por un mensaje honesto.
 *  2. Sin contexto, la incertidumbre HONESTA se conserva: una respuesta que dice
 *     "no hay suficiente información" es válida y útil.
 *  3. Con contexto débil (solo metadatos) la respuesta se marca como no
 *     fundamentada mediante un aviso explícito.
 *
 * El lenguaje general y las explicaciones normales nunca se rechazan.
 */
export function validateAntiHallucination(
  generatedText: string,
  hasRetrievedContext: boolean,
  options?: Omit<AntiHallucinationInput, 'hasRetrievedContext'>
): AntiHallucinationResult {
  const { hasSubstantiveContext = false, availableSourceTitles = [] } = options || {};
  const text = generatedText || '';

  if (!hasRetrievedContext) {
    // Regla 2 primero: la incertidumbre honesta nunca se bloquea.
    if (hasUncertaintySignal(text)) {
      return { passed: true, text, weakGrounding: true };
    }

    // Regla 1: afirmación de fuente sin material visible.
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

  // Hay contexto visible. Regla 3: si el contexto es débil (solo metadatos),
  // la respuesta se marca como no fundamentada.
  if (!hasSubstantiveContext) {
    return {
      passed: true,
      text: text.includes(WEAK_GROUNDING_NOTICE) ? text : `${text}\n\n${WEAK_GROUNDING_NOTICE}`,
      weakGrounding: true
    };
  }

  return { passed: true, text, weakGrounding: false };
}
