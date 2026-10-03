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

/**
 * Validador anti-alucinación de contexto:
 * Comprueba que el texto generado no asevere datos ficticios comunes si el contexto estaba vacío.
 */
export function validateAntiHallucination(
  generatedText: string,
  hasRetrievedContext: boolean
): { passed: boolean; warning?: string } {
  if (!hasRetrievedContext) {
    const claimsSpecificSource = /(según el curso|en la página \d+|en la lección \d+)/i.test(generatedText);
    if (claimsSpecificSource) {
      return {
        passed: false,
        warning: 'El modelo generó citas específicas a pesar de no disponer de contexto recuperado.'
      };
    }
  }
  return { passed: true };
}
