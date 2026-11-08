/**
 * Tres contratos que el código NO cumplía (deuda de §7 del handoff):
 *
 *  1. `fuseResults` (rama RRF) marcaba `hybrid` todo documento, aunque sólo un
 *     canal lo hubiera encontrado: describía una fusión que no ocurrió.
 *  2. `diversifyResults` comprobaba el tope total DESPUÉS de añadir, así que
 *     `maxTotalResults: 0` devolvía una fila y cualquier tope se pasaba en uno.
 *  3. `trimChatHistory` subía todos los turnos `system` al principio, lo que
 *     reordenaba un recordatorio inyectado a mitad de conversación.
 *
 * Cada test falla con el código anterior: son regresiones, no descripciones.
 */
import test from 'node:test';
import assert from 'node:assert';

import { fuseResults } from '../src/lib/localRag/fusion.ts';
import { diversifyResults } from '../src/lib/localRag/diversification.ts';
import { trimChatHistory } from '../src/lib/localLlm/contextBudget.ts';
import type { RetrievedDocument } from '../src/lib/localRag/types.ts';

function doc(overrides: Partial<RetrievedDocument> & { id: string }): RetrievedDocument {
  return {
    sourceType: 'lesson',
    title: overrides.id,
    snippet: 'fragmento',
    score: 1,
    ...overrides
  };
}

/* -------------------------------------------------------------------------- */
/* 1. Modo de recuperación honesto en la fusión RRF                            */
/* -------------------------------------------------------------------------- */

test('fusión RRF: cada documento declara el canal que lo encontró', () => {
  const lexical = [doc({ id: 'solo-lexico', score: 0.9 }), doc({ id: 'ambos', score: 0.8 })];
  const semantic = [doc({ id: 'ambos', score: 0.95 }), doc({ id: 'solo-semantico', score: 0.7 })];

  const fused = fuseResults(lexical, semantic, { strategy: 'rrf' });
  const modeOf = new Map(fused.map((item) => [item.id, item.retrievalMode]));

  assert.equal(modeOf.get('solo-lexico'), 'lexical', 'un acierto léxico no es una fusión');
  assert.equal(modeOf.get('solo-semantico'), 'semantic', 'un acierto semántico no es una fusión');
  assert.equal(modeOf.get('ambos'), 'hybrid', 'sólo es híbrido lo que encontraron los dos canales');

  // La fusión no pierde ni inventa documentos.
  assert.equal(fused.length, 3);
  assert.deepEqual([...fused.map((item) => item.id)].sort(), ['ambos', 'solo-lexico', 'solo-semantico']);
});

test('fusión RRF: el modo no depende de la puntuación (sólo de la pertenencia)', () => {
  // Un documento léxico con puntuación baja y otro semántico con puntuación
  // alta: si el modo se dedujera del score, el segundo sería "híbrido".
  const fused = fuseResults(
    [doc({ id: 'lexico', score: 0.01 })],
    [doc({ id: 'semantico', score: 0.99 })],
    { strategy: 'rrf', rrfK: 1 }
  );

  const byId = new Map(fused.map((item) => [item.id, item.retrievalMode]));
  assert.equal(byId.get('lexico'), 'lexical');
  assert.equal(byId.get('semantico'), 'semantic');
});

/* -------------------------------------------------------------------------- */
/* 2. Tope exacto de resultados                                                */
/* -------------------------------------------------------------------------- */

test('diversificación: maxTotalResults es un tope exacto', () => {
  const documents = [
    doc({ id: 'n1', score: 0.9 }),
    doc({ id: 'n2', score: 0.8 }),
    doc({ id: 'n3', score: 0.7 }),
    doc({ id: 'n4', score: 0.6 })
  ];

  assert.deepEqual(
    diversifyResults(documents, { maxTotalResults: 0 }),
    [],
    'cero resultados significa cero, no uno'
  );
  assert.equal(diversifyResults(documents, { maxTotalResults: 1 }).length, 1);
  assert.equal(diversifyResults(documents, { maxTotalResults: 3 }).length, 3);
  assert.equal(
    diversifyResults(documents).length,
    documents.length,
    'sin tope no se trunca: recortar es trabajo de la recuperación'
  );
});

test('diversificación: el tope no salta el límite por fuente', () => {
  const documents = [
    doc({ id: 'lesson_a', chunkKey: 'lesson_a', score: 0.9 } as any),
    doc({ id: 'lesson_a_p2', chunkKey: 'lesson_a_p2', score: 0.85 } as any),
    doc({ id: 'lesson_a_p3', chunkKey: 'lesson_a_p3', score: 0.8 } as any),
    doc({ id: 'lesson_b', chunkKey: 'lesson_b', score: 0.7 } as any)
  ];

  const diversified = diversifyResults(documents, { maxChunksPerSource: 2, maxTotalResults: 10 });
  assert.deepEqual(diversified.map((item) => item.id), ['lesson_a', 'lesson_a_p2', 'lesson_b']);
});

/* -------------------------------------------------------------------------- */
/* 3. El recorte conserva el orden del historial                               */
/* -------------------------------------------------------------------------- */

test('recorte de historial: un turno de sistema intercalado no se mueve de sitio', () => {
  const history = [
    { role: 'system' as const, content: 'reglas' },
    { role: 'user' as const, content: `pregunta vieja ${'x'.repeat(600)}` },
    { role: 'system' as const, content: 'recordatorio' },
    { role: 'user' as const, content: 'ok' },
    { role: 'system' as const, content: 'cierre' },
    { role: 'assistant' as const, content: 'listo' }
  ];

  const result = trimChatHistory(history, 100);

  assert.deepEqual(
    result.messages.map((turn) => turn.content),
    ['reglas', 'recordatorio', 'ok', 'cierre', 'listo'],
    'el orden original se conserva: sólo se omite el turno antiguo'
  );
  assert.deepEqual(result.messages.map((turn) => turn.role), [
    'system',
    'system',
    'user',
    'system',
    'assistant'
  ]);
  assert.equal(result.omitted, 1);
  assert.equal(
    result.messages.length + result.omitted,
    history.length,
    'ningún turno se duplica ni desaparece sin contarse'
  );
  assert.ok(result.usedTokens <= 100, 'el turno gigantesco es el que se fue');
});

test('recorte de historial: los turnos de sistema nunca se omiten, y se declara el exceso', () => {
  const rules = { role: 'system' as const, content: `reglas ${'r'.repeat(900)}` };
  const question = { role: 'user' as const, content: 'hola' };

  const result = trimChatHistory([rules, question], 50);

  assert.equal(result.omitted, 0, 'el prompt pedagógico viaja siempre');
  assert.deepEqual(result.messages, [rules, question]);
  assert.ok(
    result.usedTokens > 50,
    'si el sistema no cabe, el resultado lo dice en usedTokens en vez de mentir'
  );
});
