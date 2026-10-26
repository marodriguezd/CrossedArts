import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARS_PER_TOKEN,
  describeTrimNotice,
  estimateTokens,
  resolveContextBudget,
  trimChatHistory
} from '../src/lib/localLlm/contextBudget.ts';
import { MAX_SUMMARIZE_INPUT_CHARS, buildSummarizePrompt } from '../src/lib/localLlm/prompts.ts';

/**
 * P2.3 — la conversación larga no desborda el contexto del modelo local.
 *
 * Antes: el drawer enviaba TODO el historial a modelos de 2048/4096 tokens, sin
 * recorte ni aviso; y `summarizeText` pegaba el material completo.
 */

const SYSTEM = { role: 'system' as const, content: 'sistema' };

function longHistory(turns: number, charsPerTurn = 600) {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (let i = 0; i < turns; i++) {
    history.push({ role: 'user', content: `pregunta ${i} ${'x'.repeat(charsPerTurn)}` });
    history.push({ role: 'assistant', content: `respuesta ${i} ${'y'.repeat(charsPerTurn)}` });
  }
  return history;
}

test('P2.3: un historial largo se recorta y conserva el turno más reciente', () => {
  const history = [SYSTEM, ...longHistory(40)];
  const result = trimChatHistory(history, 1500);

  assert.equal(result.messages[0].role, 'system', 'el prompt de sistema nunca se omite');
  const last = result.messages[result.messages.length - 1];
  assert.equal(last.content, history[history.length - 1].content, 'la última pregunta siempre viaja');
  assert.ok(result.omitted > 0, 'debe omitir turnos antiguos');
  assert.equal(result.messages.length + result.omitted, history.length);
  assert.ok(result.usedTokens <= 1500, `presupuesto respetado (${result.usedTokens} <= 1500)`);
});

test('P2.3: un historial corto viaja completo', () => {
  const history = [SYSTEM, { role: 'user' as const, content: 'hola' }, { role: 'assistant' as const, content: 'buenas' }];
  const result = trimChatHistory(history, 2048);

  assert.equal(result.omitted, 0);
  assert.deepEqual(result.messages, history);
  assert.equal(describeTrimNotice(result), null, 'sin omisiones no hay aviso');
});

test('P2.3: el aviso al usuario está en español y dice cuántos mensajes se omitieron', () => {
  const one = describeTrimNotice({ messages: [], omitted: 1, usedTokens: 10, budgetTokens: 20 });
  assert.match(one || '', /omitido 1 mensaje antiguo/);

  const many = describeTrimNotice({ messages: [], omitted: 7, usedTokens: 10, budgetTokens: 20 });
  assert.match(many || '', /omitido 7 mensajes antiguos/);
});

test('P2.3: el presupuesto sale de la ventana real del modelo activo', () => {
  const wasm = resolveContextBudget('onnx-community/Qwen2.5-0.5B-Instruct');
  const gpu = resolveContextBudget('Qwen3-1.7B-q4f16_1-MLC');

  assert.ok(wasm > 0 && gpu > wasm, 'el modelo de 4096 tokens admite más historial');
  assert.ok(wasm <= 2048 && gpu <= 4096);
  assert.equal(resolveContextBudget(undefined), resolveContextBudget(undefined), 'determinista');
});

test('P2.3: la estimación de tokens es conservadora', () => {
  assert.equal(CHARS_PER_TOKEN, 3);
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('a'.repeat(300)) === 100);
});

test('P2.3: un único turno gigantesco se conserva en vez de vaciar el prompt', () => {
  const giant = { role: 'user' as const, content: 'z'.repeat(50000) };
  const result = trimChatHistory([SYSTEM, giant], 500);

  assert.equal(result.messages.length, 2, 'la pregunta real no se descarta');
  assert.equal(result.messages[1].content, giant.content);
});

test('P2.5: el resumen acota el texto de entrada y lo declara', () => {
  const short = buildSummarizePrompt('texto breve');
  assert.equal(short.user.includes('Texto acotado'), false);

  const huge = buildSummarizePrompt('a'.repeat(MAX_SUMMARIZE_INPUT_CHARS + 5000));
  assert.ok(huge.user.length < MAX_SUMMARIZE_INPUT_CHARS + 500, 'no se envía el material completo');
  assert.match(huge.user, /Texto acotado/);
  assert.equal(buildSummarizePrompt('').user.includes('undefined'), false);
});
