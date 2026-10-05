import { tokenizeLexical } from '../localRag/retrieval.ts';
import type { GeneratedFlashcard, GeneratedQuestion, GroundingCheckResult } from './types.ts';

/**
 * Validador heurístico de fundamentación (grounding check):
 * Verifica que el contenido generado (pregunta, respuesta o tarjeta) contenga términos
 * clave presentes en el contexto recuperado, impidiendo alucinaciones desconectadas.
 */
export function checkGrounding(
  textToCheck: string,
  contextSnippets: string[],
  minOverlapRatio: number = 0.35
): GroundingCheckResult {
  if (!contextSnippets || contextSnippets.length === 0) {
    return { grounded: false, score: 0, unsupportedClauses: ['Sin contexto de referencia'] };
  }

  const generatedTokens = tokenizeLexical(textToCheck);
  if (generatedTokens.length === 0) {
    return { grounded: false, score: 0, unsupportedClauses: ['Texto generado vacío'] };
  }

  const fullContextText = contextSnippets.join(' ').toLowerCase();
  const matchedTokens: string[] = [];
  const unmatchedTokens: string[] = [];

  for (const token of generatedTokens) {
    if (fullContextText.includes(token)) {
      matchedTokens.push(token);
    } else {
      unmatchedTokens.push(token);
    }
  }

  const score = matchedTokens.length / generatedTokens.length;
  const grounded = score >= minOverlapRatio;

  return {
    grounded,
    score,
    unsupportedClauses: grounded ? [] : unmatchedTokens.slice(0, 5)
  };
}

/**
 * Valida la estructura de una lista de tarjetas de memoria candidatas.
 */
export function validateFlashcardBatch(
  parsed: any,
  contextSnippets: string[] = []
): { valid: boolean; error?: string; cards?: Array<{ front: string; back: string }> } {
  if (!parsed) {
    return { valid: false, error: 'Respuesta vacía o nula' };
  }

  const rawList = Array.isArray(parsed) ? parsed : (parsed.cards || parsed.flashcards);
  if (!Array.isArray(rawList)) {
    return { valid: false, error: 'El resultado debe ser un arreglo de tarjetas o contener la propiedad "cards"' };
  }

  if (rawList.length === 0) {
    return { valid: false, error: 'El lote de tarjetas generado está vacío' };
  }

  const validatedCards: Array<{ front: string; back: string }> = [];
  const seenFronts = new Set<string>();

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (typeof item !== 'object' || item === null) {
      return { valid: false, error: `Tarjeta en índice ${i} no es un objeto válido` };
    }

    const front = (item.front || item.question || item.anverso || '').toString().trim();
    const back = (item.back || item.answer || item.reverso || '').toString().trim();

    if (!front || front.length < 3) {
      return { valid: false, error: `Pregunta o anverso demasiado corto o vacío en tarjeta ${i + 1}` };
    }
    if (!back || back.length < 2) {
      return { valid: false, error: `Respuesta o reverso demasiado corto o vacío en tarjeta ${i + 1}` };
    }

    const normalizedFront = front.toLowerCase();
    if (seenFronts.has(normalizedFront)) {
      continue; // Ignorar duplicados
    }
    seenFronts.add(normalizedFront);

    if (contextSnippets.length > 0) {
      const gCheck = checkGrounding(`${front} ${back}`, contextSnippets, 0.25);
      if (!gCheck.grounded) {
        return {
          valid: false,
          error: `Tarjeta "${front.slice(0, 30)}..." no tiene suficiente respaldo en el contexto recuperado (solapamiento: ${(gCheck.score * 100).toFixed(0)}%)`
        };
      }
    }

    validatedCards.push({ front, back });
  }

  if (validatedCards.length === 0) {
    return { valid: false, error: 'No se encontraron tarjetas válidas únicas' };
  }

  return { valid: true, cards: validatedCards };
}

/**
 * Valida la estructura de preguntas tipo test (opción múltiple).
 */
export function validateQuestionBatch(
  parsed: any,
  contextSnippets: string[] = []
): { valid: boolean; error?: string; questions?: Array<{ question: string; options: string[]; correctIndex: number; explanation: string }> } {
  if (!parsed) {
    return { valid: false, error: 'Respuesta vacía o nula' };
  }

  const rawList = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.quiz);
  if (!Array.isArray(rawList)) {
    return { valid: false, error: 'El resultado debe ser un arreglo de preguntas o contener la propiedad "questions"' };
  }

  if (rawList.length === 0) {
    return { valid: false, error: 'El lote de preguntas generado está vacío' };
  }

  const validatedQuestions: Array<{ question: string; options: string[]; correctIndex: number; explanation: string }> = [];

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (typeof item !== 'object' || item === null) {
      return { valid: false, error: `Pregunta en índice ${i} no es un objeto válido` };
    }

    const question = (item.question || item.pregunta || '').toString().trim();
    const options = Array.isArray(item.options || item.opciones) ? (item.options || item.opciones).map((o: any) => o.toString().trim()) : [];
    const correctIndex = typeof item.correctIndex === 'number' ? item.correctIndex : parseInt(item.correctIndex ?? item.correct_index, 10);
    const explanation = (item.explanation || item.explicacion || '').toString().trim();

    if (!question || question.length < 5) {
      return { valid: false, error: `Enunciado de pregunta demasiado corto en ítem ${i + 1}` };
    }
    if (options.length < 3 || options.length > 5) {
      return { valid: false, error: `La pregunta ${i + 1} debe tener entre 3 y 5 opciones (recibidas: ${options.length})` };
    }
    // Verificar unicidad de opciones
    const uniqueOptions = new Set(options.map((o: string) => o.toLowerCase()));
    if (uniqueOptions.size !== options.length) {
      return { valid: false, error: `Opciones duplicadas encontradas en pregunta ${i + 1}` };
    }
    if (isNaN(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return { valid: false, error: `Índice de respuesta correcta inválido (${correctIndex}) en pregunta ${i + 1}` };
    }

    if (contextSnippets.length > 0) {
      // Verificar que el conjunto (pregunta + opción correcta + explicación) tenga respaldo en las fuentes
      const textToVerify = `${question} ${options[correctIndex]} ${explanation}`;
      const gCheck = checkGrounding(textToVerify, contextSnippets, 0.15);
      if (!gCheck.grounded) {
        return {
          valid: false,
          error: `Pregunta "${question.slice(0, 30)}..." no tiene suficiente respaldo en el contexto recuperado (solapamiento: ${(gCheck.score * 100).toFixed(0)}%)`
        };
      }
    }

    validatedQuestions.push({
      question,
      options,
      correctIndex,
      explanation: explanation || `Respuesta correcta respaldada por el contexto de estudio.`
    });
  }

  return { valid: true, questions: validatedQuestions };
}
