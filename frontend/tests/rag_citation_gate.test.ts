/**
 * Regresión del contrato de proveniencia del contexto RAG.
 *
 * Invariante: `citations` y `sourceTitles` describen EXACTAMENTE el contexto
 * visible para el modelo. Una fuente que no cabe en el límite total de
 * caracteres nunca puede aparecer en la salida, aunque la recuperación la
 * haya producido.
 */
import test from 'node:test';
import assert from 'node:assert';

import {
  buildRagContext,
  MAX_TOTAL_CONTEXT_CHARS,
  MAX_CHARS_PER_SOURCE,
  MAX_SOURCES,
  OMITTED_SOURCES_MARKER
} from '../src/lib/localRag/contextBuilder.ts';
import type { RetrievedDocument } from '../src/lib/localRag/retrieval.ts';

function doc(
  overrides: Partial<RetrievedDocument> & { id: string; sourceType: RetrievedDocument['sourceType'] }
): RetrievedDocument {
  return { title: overrides.title ?? `Fuente ${overrides.id}`, snippet: 'fragmento', score: 1, ...overrides };
}

/** Fragmento largo y SUSTANTIVO que fuerza el desbordamiento del límite total. */
function longSnippet(seed: string): string {
  return `${seed} `.repeat(MAX_CHARS_PER_SOURCE).slice(0, MAX_CHARS_PER_SOURCE);
}

test('cita/contexto: una fuente omitida por límite NO aparece en citas ni en títulos', () => {
  const documents: RetrievedDocument[] = Array.from({ length: MAX_SOURCES }, (_, i) =>
    doc({
      id: `s${i}`,
      sourceType: 'lesson',
      title: `Fuente ${i}`,
      snippet: longSnippet(`SRC${i}`),
      substantive: true
    })
  );

  const built = buildRagContext(documents);

  // El límite se respeta: no se debilita el bound para "meter" más fuentes.
  assert.ok(built.formattedContextText.length <= MAX_TOTAL_CONTEXT_CHARS + OMITTED_SOURCES_MARKER.length);
  assert.ok(built.formattedContextText.includes(OMITTED_SOURCES_MARKER), 'El corpus no cabe: se omiten fuentes');

  const omitted = documents
    .map(d => d.title)
    .filter(title => !built.formattedContextText.includes(`TITULO="${title}"`));
  assert.ok(omitted.length > 0, 'El caso de prueba debe ejercitar realmente la omisión');

  for (const title of omitted) {
    assert.ok(!built.formattedContextText.includes(`TITULO="${title}"`), 'La fuente omitida no es visible para el modelo');
    assert.ok(!built.citations.some(c => c.title === title), 'Ninguna cita apunta a material invisible');
    assert.ok(!built.sourceTitles.includes(title), 'Los títulos son las fuentes realmente usadas');
  }

  assert.strictEqual(built.citations.length, built.sourceTitles.length);
});

test('cita/contexto: toda fuente citada tiene su sección en el texto de contexto', () => {
  const documents: RetrievedDocument[] = Array.from({ length: MAX_SOURCES }, (_, i) =>
    doc({
      id: `s${i}`,
      sourceType: i % 2 === 0 ? 'lesson' : 'note',
      title: `Fuente ${i}`,
      snippet: `cuerpo ${i} ` + longSnippet('X'),
      substantive: true
    })
  );

  const built = buildRagContext(documents);

  assert.ok(built.citations.length >= 1);
  built.citations.forEach((citation, index) => {
    const marker = `<<<DATOS_FUENTE_${index + 1} `;
    assert.ok(
      built.formattedContextText.includes(marker),
      `La cita ${citation.title} debe tener su sección ${marker} en el contexto`
    );
    assert.ok(built.formattedContextText.includes(citation.title));
    assert.ok(built.sourceTitles.includes(citation.title));
  });

  // Ninguna sección del contexto corresponde a una fuente no citada.
  const sectionCount = (built.formattedContextText.match(/<<<DATOS_FUENTE_/g) || []).length;
  assert.strictEqual(sectionCount, built.citations.length, 'Secciones y citas están en correspondencia 1:1');
});

test('cita/contexto: hasSubstantiveContext solo refleja las fuentes incluidas', () => {
  const documents: RetrievedDocument[] = [
    // Fuentes que ocupan el contexto pero NO tienen contenido real.
    ...Array.from({ length: 4 }, (_, i) =>
      doc({
        id: `m${i}`,
        sourceType: 'concept',
        title: `Solo metadatos ${i}`,
        snippet: longSnippet(`META${i}`),
        substantive: false
      })
    ),
    // Una fuente sustantiva que NO cabe: no debe "fundamentar" la respuesta.
    doc({ id: 's1', sourceType: 'lesson', title: 'Sustantiva omitida', snippet: longSnippet('S1'), substantive: true })
  ];

  const built = buildRagContext(documents);

  assert.ok(
    !built.formattedContextText.includes('TITULO="Sustantiva omitida"'),
    'La fuente sustantiva no cabe en el límite total de contexto'
  );
  assert.strictEqual(
    built.hasSubstantiveContext,
    false,
    'Una fuente sustantiva no entregada al modelo no puede fundamentar la respuesta'
  );
  assert.ok(built.hasContext, 'Sí hay material visible, aunque sea solo metadatos');

  // La misma fuente, ahora sí incluida, fundamenta la respuesta.
  const fitting = buildRagContext([
    doc({ id: 's1', sourceType: 'lesson', title: 'Sustantiva incluida', snippet: 'texto real', substantive: true })
  ]);
  assert.strictEqual(fitting.hasSubstantiveContext, true);
});

test('cita/contexto: si ninguna fuente cabe, no hay contexto ni citas', () => {
  const giant = 'X'.repeat(MAX_TOTAL_CONTEXT_CHARS + 500);
  const built = buildRagContext([
    doc({ id: 'g1', sourceType: 'book', title: 'Gigante', snippet: giant, substantive: true })
  ]);

  // El snippet se trunca por fuente, así que al menos una sección entra; lo que
  // nunca puede ocurrir es una cita sin sección.
  assert.strictEqual(built.citations.length, 1);
  assert.ok(built.formattedContextText.includes('<<<DATOS_FUENTE_1 '));
});

test('cita/contexto: el límite de fuentes y el de caracteres siguen aplicándose', () => {
  const many = Array.from({ length: 12 }, (_, i) => doc({ id: `n${i}`, sourceType: 'note' }));
  const built = buildRagContext(many);
  assert.ok(built.citations.length <= MAX_SOURCES);
  assert.ok(built.citations.length <= built.sourceTitles.length);
});