import type { StudyDifficulty } from './types.ts';

export function buildFlashcardGenerationPrompt(
  count: number,
  difficulty: StudyDifficulty,
  contextText: string,
  topicTitle?: string
): { system: string; user: string } {
  const diffInstruction = {
    easy: 'Nivel FÁCIL: Conceptos clave directos, definiciones y términos fundamentales.',
    medium: 'Nivel MEDIO: Relaciones entre conceptos, aplicaciones prácticas y diferencias clave.',
    hard: 'Nivel DIFÍCIL: Análisis crítico, casos límite, implicaciones y detalles avanzados.'
  }[difficulty];

  const system = `Eres un pedagogo experto en Active Recall y Repetición Espaciada (SM-2) para CrossedArts.
Tu tarea es generar exactamente ${count} tarjetas de estudio (flashcards) de alta calidad basadas EXCLUSIVAMENTE en el texto de contexto proporcionado.

REGLAS CRÍTICAS:
1. Basarse ÚNICAMENTE en los hechos expresados en el texto. NO inventes ni agregues información externa.
2. Dificultad: ${diffInstruction}
3. El anverso (front) debe ser una pregunta clara, directa y concisa.
4. El reverso (back) debe ser una respuesta precisa y fundamentada (1-3 frases).
5. Debes responder EXCLUSIVAMENTE con un objeto JSON sin texto antes ni después, con el siguiente formato:
{
  "cards": [
    {
      "front": "¿Pregunta o concepto clave?",
      "back": "Respuesta clara y respaldada por el contexto."
    }
  ]
}`;

  const user = `Contexto de estudio disponible:
"""
${contextText}
"""
${topicTitle ? `Tema específico: ${topicTitle}\n` : ''}
Genera un array JSON con exactamente ${count} flashcards siguiendo las instrucciones pedagógicas.`;

  return { system, user };
}

export function buildQuestionsGenerationPrompt(
  count: number,
  difficulty: StudyDifficulty,
  contextText: string,
  topicTitle?: string
): { system: string; user: string } {
  const diffInstruction = {
    easy: 'Nivel FÁCIL: Reconocimiento directo de hechos o definiciones explícitas.',
    medium: 'Nivel MEDIO: Comprensión conceptual, causas/efectos y comparación entre elementos.',
    hard: 'Nivel DIFÍCIL: Preguntas sobre sutilezas, diagnóstico de casos o análisis de consecuencias.'
  }[difficulty];

  const system = `Eres un evaluador pedagógico experto para CrossedArts.
Tu tarea es generar exactamente ${count} preguntas de práctica de opción múltiple basadas EXCLUSIVAMENTE en el texto de contexto proporcionado.

REGLAS CRÍTICAS:
1. Basa cada pregunta y su respuesta correcta ÚNICAMENTE en el texto proporcionado.
2. Dificultad: ${diffInstruction}
3. Cada pregunta debe tener exactamente 4 opciones de respuesta distintas, donde solo 1 es correcta.
4. "correctIndex" debe ser el índice (0, 1, 2 o 3) de la opción correcta.
5. Proporciona una breve "explanation" justificando la respuesta correcta con base en el texto.
6. Responde EXCLUSIVAMENTE con un objeto JSON sin markdown exterior, con este formato:
{
  "questions": [
    {
      "question": "¿Enunciado de la pregunta?",
      "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correctIndex": 0,
      "explanation": "Justificación basada en el contexto."
    }
  ]
}`;

  const user = `Contexto de estudio disponible:
"""
${contextText}
"""
${topicTitle ? `Tema específico: ${topicTitle}\n` : ''}
Genera un array JSON con exactamente ${count} preguntas tipo test siguiendo las instrucciones pedagógicas.`;

  return { system, user };
}
