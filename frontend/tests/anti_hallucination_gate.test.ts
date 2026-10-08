/**
 * Barrera final anti-alucinación en el camino conversacional.
 *
 * Verifica que la respuesta que ve el usuario nunca afirma una fuente que el
 * modelo no tenía, y que el contexto débil no se presenta como sólido.
 */
import test from 'node:test';
import assert from 'node:assert';

import {
  validateAntiHallucination,
  findUnsupportedSourceClaim,
  NO_CONTEXT_REFUSAL_MESSAGE,
  WEAK_GROUNDING_NOTICE
} from '../src/lib/localLlm/validators.ts';
import { aiService } from '../src/ai/aiService.ts';
import { dbBridge } from '../src/db/sqliteBridge.ts';

test('barrera: sin contexto, una página inventada se rechaza', () => {
  const result = validateAntiHallucination('Tal como aparece en la página 42 del libro.', false);
  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.text, NO_CONTEXT_REFUSAL_MESSAGE);
  assert.ok(result.reason);
});

test('barrera: sin contexto, un curso o lección inventado se rechaza', () => {
  const courseClaim = validateAntiHallucination('Según el curso de Fotografía Avanzada, funciona así.', false);
  assert.strictEqual(courseClaim.passed, false);

  const lessonClaim = validateAntiHallucination('En la lección 3 se explica el procedimiento.', false);
  assert.strictEqual(lessonClaim.passed, false);

  const chapterClaim = validateAntiHallucination('Está en el capítulo 5 del manual.', false);
  assert.strictEqual(chapterClaim.passed, false);
});

test('barrera: sin contexto, una URL o autoría inventada se rechaza', () => {
  assert.strictEqual(
    validateAntiHallucination('Puedes consultarlo en https://ejemplo.inventado/curso', false).passed,
    false
  );
  assert.strictEqual(
    validateAntiHallucination('Como indica Autor en su obra, la respuesta es otra.', false).passed,
    false
  );
});

test('barrera: sin contexto, la incertidumbre honesta se acepta', () => {
  const honest = 'El contexto de CrossedArts disponible no contiene suficiente información para responder con certeza.';
  const result = validateAntiHallucination(honest, false);
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.text, honest);
  assert.strictEqual(result.weakGrounding, true);
});

test('barrera: el lenguaje general NO se censura', () => {
  const explanation = 'Los hooks permiten re-renderizar de forma concurrente sin bloquear el hilo principal.';
  const result = validateAntiHallucination(explanation, false);
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.text, explanation);
  assert.strictEqual(findUnsupportedSourceClaim(explanation), null);
});

test('barrera: con contexto sustantivo, las referencias legítimas se aceptan', () => {
  const answer = 'Según el material entregado, la página 42 describe el proceso de revelado.';
  const result = validateAntiHallucination(answer, true, {
    hasSubstantiveContext: true,
    availableSourceTitles: ['Curso de Fotografía']
  });
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.text, answer);
  assert.strictEqual(result.weakGrounding, false);
});

test('barrera: contexto débil NO se presenta como autoritativo', () => {
  const result = validateAntiHallucination('El curso trata sobreFotografía.', true, {
    hasSubstantiveContext: false
  });
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.weakGrounding, true);
  assert.ok(result.text.includes(WEAK_GROUNDING_NOTICE), 'Se añade un aviso explícito de fundamentación débil');

  // Idempotente: no duplica el aviso.
  const again = validateAntiHallucination(result.text, true, { hasSubstantiveContext: false });
  assert.strictEqual(again.text, result.text);
});

test('barrera: el veredicto es determinista', () => {
  const claim = 'Según el curso, en la página 7.';
  const first = validateAntiHallucination(claim, false);
  const second = validateAntiHallucination(claim, false);
  assert.deepStrictEqual(first, second);
});

test('barrera: camino conversacional real — sin contexto, la cita inventada no llega al usuario', async () => {
  await dbBridge.init();
  aiService.saveSettings({
    provider: 'ollama',
    ollamaUrl: 'http://127.0.0.1:9/inventado',
    ollamaModel: 'demo',
    apiKey: '',
    apiModel: '',
    localModelId: '',
    localAiEnabled: false,
    persistApiKey: false
  });

  try {
    // Sin material recuperable: el proveedor falla, y la barrera deja la
    // respuesta en un estado controlado y honesto (nunca una cita inventada).
    const response = await aiService.askTutor(
      [{ role: 'user', content: 'zzzznadaexactoparecido9999' }],
      '',
      undefined,
      undefined,
      { disableRetrieval: true }
    );
    assert.ok(response.answer.length > 0);
    assert.ok(!/página \d+/i.test(response.answer), 'Ninguna respuesta muestra una página inventada');
  } finally {
    aiService.saveSettings({
      provider: 'demo',
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'llama3:8b',
      apiKey: '',
      apiModel: 'gpt-4o-mini',
      localModelId: '',
      localAiEnabled: false,
      persistApiKey: false
    });
  }
});