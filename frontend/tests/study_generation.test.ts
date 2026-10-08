import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGrounding, validateFlashcardBatch, validateQuestionBatch } from '../src/lib/studyGeneration/validators.ts';
import { buildFlashcardGenerationPrompt, buildQuestionsGenerationPrompt } from '../src/lib/studyGeneration/prompts.ts';
import { dao } from '../src/db/dao.ts';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { aiService } from '../src/ai/aiService.ts';

const SAMPLE_CONTEXT = [
  'React 18 introduce transiciones automáticas y concurrent mode en el motor Fiber.',
  'El algoritmo SuperMemo-2 (SM-2) calcula el factor de facilidad con un mínimo de 1.30 y ajusta el intervalo según la calificación.',
  'La repetición espaciada permite optimizar la curva del olvido de Hermann Ebbinghaus mediante repaso activo.'
];

test('12.1 Grounding Heuristic: Valida solapamiento léxico frente a contexto y rechaza alucinaciones', () => {
  // Caso respaldado
  const groundedText = '¿Qué motor y qué transiciones incorpora React 18 en su concurrencia?';
  const res1 = checkGrounding(groundedText, SAMPLE_CONTEXT, 0.25);
  assert.equal(res1.grounded, true, 'Debe considerarse fundamentado con solapamiento suficiente');
  assert.ok(res1.score >= 0.25, `El score debe superar el umbral: ${res1.score}`);

  // Caso alucinación sin respaldo
  const hallucinatedText = 'La fotosíntesis celular produce clorofila mediante cloroplastos vegetales.';
  const res2 = checkGrounding(hallucinatedText, SAMPLE_CONTEXT, 0.25);
  assert.equal(res2.grounded, false, 'Debe rechazar conceptos ajenos al contexto');
  assert.ok(res2.score < 0.25, 'El score debe ser inferior al umbral');
});

test('12.2 Flashcard Batch Validation: Valida anverso, reverso, elimina duplicados y exige fundamentación', () => {
  const validBatch = {
    cards: [
      { front: '¿Cuál es el Ease Factor mínimo en SM-2?', back: 'El factor de facilidad mínimo es 1.30.' },
      { front: '¿Qué optimiza la repetición espaciada?', back: 'Optimiza la curva del olvido mediante repaso activo.' },
      { front: '¿Cuál es el Ease Factor mínimo en SM-2?', back: 'Duplicado que debe ser filtrado.' }
    ]
  };

  const validation = validateFlashcardBatch(validBatch, SAMPLE_CONTEXT);
  assert.equal(validation.valid, true, `Debe validar correctamente: ${validation.error}`);
  assert.equal(validation.cards?.length, 2, 'Debe filtrar tarjetas con preguntas duplicadas');

  // Tarjeta vacía o malformada
  const invalidBatch = {
    cards: [
      { front: '', back: 'Invalida por front vacío' }
    ]
  };
  const resInvalid = validateFlashcardBatch(invalidBatch, SAMPLE_CONTEXT);
  assert.equal(resInvalid.valid, false, 'Debe rechazar tarjetas vacías');
});

test('12.3 Question Batch Validation: Valida formato de opciones múltiples, unicidad e índice de respuesta', () => {
  const validQuiz = {
    questions: [
      {
        question: '¿Qué umbral mínimo impone el algoritmo SM-2 para el factor de facilidad?',
        options: ['1.30', '2.50', '0.00', '1.00'],
        correctIndex: 0,
        explanation: 'El algoritmo SM-2 previene intervalos nulos fijando 1.30 como piso mínimo.'
      }
    ]
  };

  const validation = validateQuestionBatch(validQuiz, SAMPLE_CONTEXT);
  assert.equal(validation.valid, true, `Debe ser válido: ${validation.error}`);
  assert.equal(validation.questions?.length, 1);

  // Opciones duplicadas
  const duplicateOpts = {
    questions: [
      {
        question: '¿Qué es React Fiber?',
        options: ['Motor concurrente', 'Motor concurrente', 'Otra cosa', 'Cuarta opción'],
        correctIndex: 0,
        explanation: 'Expl'
      }
    ]
  };
  const resDup = validateQuestionBatch(duplicateOpts, SAMPLE_CONTEXT);
  assert.equal(resDup.valid, false, 'Debe rechazar preguntas con opciones idénticas duplicadas');

  // Índice incorrecto fuera de rango
  const outOfRange = {
    questions: [
      {
        question: '¿Qué es el modo concurrente?',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 9,
        explanation: 'Expl'
      }
    ]
  };
  const resRange = validateQuestionBatch(outOfRange, SAMPLE_CONTEXT);
  assert.equal(resRange.valid, false, 'Debe rechazar un correctIndex fuera de límites');
});

test('12.4 Flashcard Persistence & SM-2 Cycle: dao.createFlashcards inserta en SQLite y prepara para repaso', async () => {
  await dbBridge.init();

  const newCards = [
    { front: '¿Qué es el motor Fiber?', back: 'El motor de reconciliación concurrente de React.' },
    { front: '¿Quién postuló la curva del olvido?', back: 'Hermann Ebbinghaus en sus investigaciones sobre memoria.' }
  ];

  const insertedIds = await dao.createFlashcards(newCards);
  assert.equal(insertedIds.length, 2, 'Deben haberse insertado 2 identificadores');

  const allCards = await dao.getFlashcards();
  const foundCard = allCards.find(c => c.id === insertedIds[0]);
  assert.ok(foundCard, 'La tarjeta debe existir en la tabla flashcard de SQLite');
  assert.equal(foundCard?.front, '¿Qué es el motor Fiber?');
  assert.equal(foundCard?.repetition_count, 0, 'Repetición inicial debe ser 0');
  assert.equal(foundCard?.interval_days, 1, 'Intervalo inicial debe ser 1 día');
  assert.equal(foundCard?.ease_factor, 2.5, 'Factor de facilidad inicial debe ser 2.5');

  // Evaluar repaso SM-2 sobre la tarjeta recién creada
  await dao.reviewFlashcardSM2(insertedIds[0], 5);
  const updatedCards = await dao.getFlashcards();
  const reviewedCard = updatedCards.find(c => c.id === insertedIds[0]);
  assert.equal(reviewedCard?.repetition_count, 1, 'Repetición debe incrementar a 1 tras calificación 5');
  assert.ok((reviewedCard?.ease_factor || 0) > 2.5, 'Factor de facilidad debe subir con calificación perfecta 5');
});

test('12.5 End-to-End Study Generation: aiService.generateFlashcards y generatePracticeQuestions con privacidad total', async () => {
  aiService.saveSettings({
    provider: 'demo',
    ollamaUrl: '',
    ollamaModel: '',
    apiKey: '',
    apiModel: '',
    localModelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    localAiEnabled: false
  });

  // Generar tarjetas
  const fcRes = await aiService.generateFlashcards({
    count: 3,
    difficulty: 'medium',
    topic: 'React'
  });

  assert.equal(fcRes.error, undefined, `No debe tener error: ${fcRes.error}`);
  assert.ok(fcRes.cards.length >= 1, 'Debe generar al menos una flashcard');
  assert.ok(fcRes.sourceTitles.length > 0, 'Debe adjuntar títulos de fuentes del sistema');
  assert.ok(fcRes.sourceIds.length > 0, 'Debe adjuntar identificadores de fuentes del sistema');

  // Generar preguntas de práctica
  const qRes = await aiService.generatePracticeQuestions({
    count: 3,
    difficulty: 'easy',
    topic: 'SuperMemo'
  });

  assert.equal(qRes.error, undefined, `No debe tener error: ${qRes.error}`);
  assert.ok(qRes.questions.length >= 1, 'Debe generar al menos una pregunta');
  assert.equal(qRes.questions[0].options.length, 4, 'Cada pregunta debe tener 4 opciones');
  assert.ok(qRes.questions[0].correctIndex >= 0 && qRes.questions[0].correctIndex < 4);
});
