import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenizeLexical,
  tokenizeQuery,
  computeLexicalIdf,
  scoreLexicalRelevance,
  retrieveLocalContext,
  THRESHOLDS
} from '../src/lib/localRag/retrieval.ts';
import { dbBridge } from '../src/db/sqliteBridge.ts';

/**
 * Regression for the ranking noise found with a real query.
 *
 * The lexical channel counted hits without weighting them, so a single Spanish
 * article was decisive: `scoreLexicalRelevance` gives 2.5 points per whole-word
 * hit and `MIN_LEXICAL_CANDIDATE` is 0.5. «¿Cómo puedo enfocarme en una sola
 * tarea durante horas sin perder el hilo?» scored 5.0 against a React lesson on
 * «como» + «una» alone, and fusion then ranked that lesson above the genuinely
 * relevant material.
 *
 * The fix is frequency weighting, not a word list: a term present in many
 * documents (a function word) weighs close to zero; the rare content term the
 * question is about weighs the most.
 */

const REPORTED_QUERY = '¿Cómo puedo enfocarme en una sola tarea durante horas sin perder el hilo?';

const ATTENTION_CARD =
  '¿Qué es el principio del "Drenaje de Atención"? Cuando alternas rápidamente entre tareas ' +
  'complejas, una fracción de tu foco mental queda rezagada en la tarea anterior.';

const REACT_LESSON =
  '04. Creando Custom Hooks con TypeScript estricto Módulo 2: State Management & Redux Toolkit. ' +
  'Un custom hook es una función que empieza por "use" y puede llamar a otros hooks. Con TypeScript ' +
  'estricto tipamos su retorno como una tupla o un objeto para consumirlo de forma segura.';

/** Segunda cita espuria de la misma ejecución: sólo coincidía en «sin». */
const WAL_CARD =
  '¿Qué significa el modo WAL en SQLite? Write-Ahead Logging: permite lectores concurrentes ' +
  'sin bloquear a los escritores.';

/** Small stand-in for the demo library: function words are everywhere. */
const LIBRARY = [
  { text: ATTENTION_CARD },
  { text: REACT_LESSON },
  { text: 'Las 4 Disciplinas de la Ejecución (4DX) 1. Concentrarse en lo sumamente importante. 2. Medir las medidas de predicción.' },
  { text: 'Atomic Habits. Cómo pequeños cambios diarios generan resultados transformadores a largo plazo.' },
  { text: 'Deep Work: Rules for Focused Success. Estrategias y hábitos para alcanzar concentración profunda en un mundo lleno de distracciones.' },
  { text: 'Nota: Patrones de Rendimiento en React 18. Evitar recreación de objetos inline cuando se usan componentes memoizados.' },
  { text: 'Práctica: Ensayo sobre atención y trabajo profundo en una sola sesión sin interrupciones.' }
];

test('IDF: un término frecuente pesa mucho menos que uno raro', () => {
  const tokens = tokenizeLexical('una tarea');
  const weights = computeLexicalIdf(tokens, LIBRARY);

  const common = weights.get('una')!;
  const rare = weights.get('tarea')!;

  assert.ok(common > 0, 'el peso IDF nunca es negativo ni nulo: no borra coincidencias');
  assert.ok(common < 1, `una palabra funcional debe pesar poco (fue ${common.toFixed(3)})`);
  assert.ok(
    rare > 1.5 * common,
    `el término raro (${rare.toFixed(3)}) debe pesar al menos 1,5x el frecuente (${common.toFixed(3)})`
  );
});

test('IDF: la consulta reportada deja de empatar con la lección de React', () => {
  const tokens = tokenizeLexical(REPORTED_QUERY);
  const weights = computeLexicalIdf(tokens, LIBRARY);

  const cardScore = scoreLexicalRelevance(tokens, ATTENTION_CARD, weights);
  const lessonScore = scoreLexicalRelevance(tokens, REACT_LESSON, weights);

  // Sin pesos ambas puntuaban exactamente 5.0 («como»+«una» frente a «una»+«tarea»).
  assert.equal(scoreLexicalRelevance(tokens, ATTENTION_CARD), 5);
  assert.equal(scoreLexicalRelevance(tokens, REACT_LESSON), 5);

  assert.ok(cardScore > lessonScore, `la tarjeta (${cardScore.toFixed(2)}) debe superar a la lección (${lessonScore.toFixed(2)})`);
  // El término de contenido se conserva: la tarjeta sigue siendo candidata.
  assert.ok(cardScore > THRESHOLDS.MIN_LEXICAL_CANDIDATE);
});

test('IDF: la ponderación no borra coincidencias, sólo las ordena', () => {
  const tokens = tokenizeLexical(REPORTED_QUERY);
  const weights = computeLexicalIdf(tokens, LIBRARY);
  // La lección sigue puntuando por encima de cero: su ruido pierde peso, no desaparece.
  assert.ok(scoreLexicalRelevance(tokens, REACT_LESSON, weights) > 0);
  // Y un documento ajeno a la consulta sigue puntuando cero.
  assert.equal(
    scoreLexicalRelevance(tokens, 'Recetas de cocina tradicional y repostería artesanal.', weights),
    0
  );
});

test('IDF: es determinista y tolera colecciones vacías', () => {
  const tokens = tokenizeLexical(REPORTED_QUERY);
  const first = computeLexicalIdf(tokens, LIBRARY);
  const second = computeLexicalIdf(tokens, LIBRARY);
  assert.deepEqual([...first.entries()], [...second.entries()]);

  assert.equal(computeLexicalIdf([], LIBRARY).size, 0);
  assert.equal(computeLexicalIdf(tokens, []).size, 0);
});

test('IDF: sin pesos el scoring clásico queda intacto', () => {
  // `checkGrounding` y los tests históricos dependen de la escala sin ponderar.
  const tokens = ['memoria', 'repaso'];
  assert.equal(scoreLexicalRelevance(tokens, 'La memoria a largo plazo y el repaso espaciado.'), 5);
});

test('IDF: la tokenización conserva las palabras funcionales (no hay lista fija)', () => {
  // Contrato de `checkGrounding`: su umbral está calibrado sobre esta salida.
  assert.deepEqual(tokenizeLexical('¿Cómo puedo enfocarme en una sola tarea?'), [
    'como',
    'puedo',
    'enfocarme',
    'una',
    'sola',
    'tarea'
  ]);
});

const REPORTED_TOKENS = ['enfocarme', 'sola', 'tarea', 'horas', 'perder', 'hilo'];

test('IDF: la consulta léxica descarta la clase cerrada y conserva el contenido', () => {
  assert.deepEqual(tokenizeQuery(REPORTED_QUERY), REPORTED_TOKENS);
});

test('IDF: una consulta sólo de palabras funcionales no se queda vacía', () => {
  // Sin tokens no habría recuperación: se degrada a la tokenización cruda.
  assert.deepEqual(tokenizeQuery('¿cómo es que una?'), tokenizeLexical('¿cómo es que una?'));
});

test('IDF: el filtro no toca palabras de contenido con forma parecida', () => {
  // «sola» (adjetivo) no está en la lista aunque «solo» pueda ser adverbio.
  assert.deepEqual(tokenizeQuery('memoria repaso espaciado sola'), ['memoria', 'repaso', 'espaciado', 'sola']);
});

test('IDF: las dos citas espurias medidas puntúan cero con el filtro', () => {
  const tokens = tokenizeQuery(REPORTED_QUERY);
  const weights = computeLexicalIdf(tokens, LIBRARY);

  // Antes del filtro: 10.20 (React, «como»+«una») y 8.56 (WAL, «sin») sobre el seed real.
  assert.equal(scoreLexicalRelevance(tokens, REACT_LESSON, weights), 0);
  assert.equal(scoreLexicalRelevance(tokens, WAL_CARD, weights), 0);
  assert.ok(scoreLexicalRelevance(tokens, ATTENTION_CARD, weights) > 0);
});

test('IDF: extremo a extremo sobre el seed, la paráfrasis sólo recupera la tarjeta', async () => {
  await dbBridge.init();
  const result = await retrieveLocalContext(REPORTED_QUERY, 5);

  assert.ok(result.hasContext, 'la consulta debe recuperar contexto');
  assert.ok(result.documents[0].title.includes('Drenaje de Atención'), `primera cita: ${result.documents[0].title}`);
  assert.ok(result.hasSubstantiveContext, 'la tarjeta tiene contenido real');
  // Ruido medido en `qa:embeddings` antes del filtro: lección de React y tarjeta WAL.
  assert.ok(
    !result.documents.some(doc => /Custom Hooks|modo WAL/.test(doc.title)),
    `citas inesperadas: ${result.documents.map(doc => doc.title).join(' | ')}`
  );
});
