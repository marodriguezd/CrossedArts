/**
 * Consolidación del pipeline RAG:
 *  - diversificación por IDENTIFICADOR BASE de fuente (no por fragmento);
 *  - una única implementación de fusión y de resolución de ámbito.
 */
import test from 'node:test';
import assert from 'node:assert';

import {
  diversifyResults,
  resolveBaseSourceKey,
  DEFAULT_MAX_CHUNKS_PER_SOURCE
} from '../src/lib/localRag/diversification.ts';
import {
  fuseRankedCandidates,
  fuseResults,
  computeRrfScore,
  DEFAULT_FUSION_WEIGHTS
} from '../src/lib/localRag/fusion.ts';
import type { RetrievedDocument } from '../src/lib/localRag/types.ts';

function doc(overrides: Partial<RetrievedDocument> & { id: string }): RetrievedDocument {
  return {
    sourceType: 'lesson',
    title: overrides.title ?? overrides.id,
    snippet: 's',
    score: 1,
    ...overrides
  };
}

/* -------------------------------------------------------------------------- */
/* Diversificación                                                             */
/* -------------------------------------------------------------------------- */

test('diversificación: una lección larga no monopoliza el resultado', () => {
  const candidates: RetrievedDocument[] = [
    doc({ id: 'lesson_abc', chunkKey: 'lesson_abc', score: 0.95 } as any),
    doc({ id: 'lesson_abc_p2', chunkKey: 'lesson_abc_p2', score: 0.9 } as any),
    doc({ id: 'lesson_abc_p3', chunkKey: 'lesson_abc_p3', score: 0.85 } as any),
    doc({ id: 'lesson_xyz', chunkKey: 'lesson_xyz', score: 0.8 } as any),
    doc({ id: 'lesson_xyz_p2', chunkKey: 'lesson_xyz_p2', score: 0.75 } as any),
    doc({ id: 'lesson_uvw', chunkKey: 'lesson_uvw', score: 0.7 } as any)
  ];

  const diversified = diversifyResults(candidates, { maxChunksPerSource: 2 });

  assert.strictEqual(diversified.length, 5);
  const perBase = new Map<string, number>();
  for (const d of diversified) {
    const key = resolveBaseSourceKey(d);
    perBase.set(key, (perBase.get(key) || 0) + 1);
  }
  assert.strictEqual(perBase.get('lesson_abc'), 2, 'La lección larga se limita a 2 fragmentos');
  assert.strictEqual(perBase.get('lesson_xyz'), 2);
  assert.strictEqual(perBase.get('lesson_uvw'), 1);
  // Se conserva el mejor fragmento de la lección larga.
  assert.strictEqual(diversified[0].id, 'lesson_abc');
});

test('diversificación: el recurso propietario no colapsa lecciones distintas', () => {
  const candidates: RetrievedDocument[] = [
    doc({ id: 'lesson_a', resourceId: 'curso-1', score: 0.9 }),
    doc({ id: 'lesson_b', resourceId: 'curso-1', score: 0.8 }),
    doc({ id: 'lesson_c', resourceId: 'curso-1', score: 0.7 })
  ];
  const diversified = diversifyResults(candidates, { maxChunksPerSource: 2 });
  assert.strictEqual(diversified.length, 3, 'Tres lecciones del mismo curso son tres fuentes distintas');
});

test('diversificación: orden determinista y recorte opcional', () => {
  const candidates: RetrievedDocument[] = [
    doc({ id: 'a', score: 0.9 }),
    doc({ id: 'b', score: 0.8 }),
    doc({ id: 'c', score: 0.7 }),
    doc({ id: 'd', score: 0.6 })
  ];
  const first = diversifyResults(candidates, { maxChunksPerSource: DEFAULT_MAX_CHUNKS_PER_SOURCE });
  const second = diversifyResults(candidates, { maxChunksPerSource: DEFAULT_MAX_CHUNKS_PER_SOURCE });
  assert.deepStrictEqual(first.map(d => d.id), second.map(d => d.id), 'La diversificación es determinista');

  const capped = diversifyResults(candidates, { maxChunksPerSource: 2, maxTotalResults: 2 });
  assert.strictEqual(capped.length, 2);
});

/* -------------------------------------------------------------------------- */
/* Fusión                                                                       */
/* -------------------------------------------------------------------------- */

test('fusión: la recuperación de producción usa la implementación canónica', () => {
  const lexicalCandidates = new Map<string, RetrievedDocument>([
    ['lesson_a', doc({ id: 'lesson_a', score: 2.0 })],
    ['lesson_b', doc({ id: 'lesson_b', score: 1.0 })]
  ]);
  const { candidates, lexicalRanks, semanticRanks } = fuseRankedCandidates({
    lexicalCandidates,
    lexicalRanked: [
      { key: 'lesson_a', doc: lexicalCandidates.get('lesson_a')! },
      { key: 'lesson_b', doc: lexicalCandidates.get('lesson_b')! }
    ],
    semanticRanked: [
      {
        chunkId: 'lesson_a',
        score: 0.9,
        entry: { sourceId: 'lesson_a', sourceType: 'lesson', title: 'A', text: 'cuerpo A' }
      }
    ]
  });

  assert.strictEqual(candidates.length, 2);
  assert.ok(lexicalRanks.has('lesson_a') && lexicalRanks.has('lesson_b'));
  assert.ok(semanticRanks.has('lesson_a') && !semanticRanks.has('lesson_b'));

  const fusedA = candidates.find(c => c.id === 'lesson_a')!;
  const fusedB = candidates.find(c => c.id === 'lesson_b')!;
  assert.strictEqual(fusedA.retrievalMode, 'hybrid', 'Encontrado por ambos canales → híbrido');
  assert.strictEqual(fusedB.retrievalMode, 'lexical');
  assert.ok(fusedA.score > fusedB.score, 'El doble canal gana');
  assert.strictEqual(fusedB.substantive, undefined);
});

test('fusión: procedencia de un acierto solo semántico', () => {
  const { candidates } = fuseRankedCandidates({
    lexicalCandidates: new Map(),
    lexicalRanked: [],
    semanticRanked: [
      {
        chunkId: 'lesson_solo',
        score: 0.8,
        entry: { sourceId: 'solo', sourceType: 'lesson', title: 'Curso › Lección', text: 'texto largo' }
      }
    ]
  });

  const doc = candidates[0];
  assert.strictEqual(doc.id, 'solo', 'La identidad es el artefacto de origen, no el chunk');
  assert.strictEqual(doc.lessonId, 'solo');
  assert.strictEqual(doc.substantive, true, 'Un acierto semántico es contenido, no metadatos');
  assert.strictEqual(doc.retrievalMode, 'semantic');
});

test('fusión: paridad de RANKING con fuseResults(rrf) cuando el RRF domina', () => {
  const lexical = [
    doc({ id: 'x', score: 0.9 }),
    doc({ id: 'y', score: 0.8 })
  ];
  const semantic = [
    doc({ id: 'y', score: 0.95 }),
    doc({ id: 'z', score: 0.7 })
  ];

  // Canonical de producción con peso RRF exclusivo: la señal es el RRF puro.
  const fused = fuseRankedCandidates({
    lexicalCandidates: new Map(lexical.map(d => [d.id, d])),
    lexicalRanked: lexical.map(d => ({ key: d.id, doc: d })),
    semanticRanked: semantic.map(d => ({
      chunkId: d.id,
      score: d.score,
      entry: { sourceId: d.id, sourceType: 'lesson', title: d.id, text: d.id }
    })),
    weights: { lexical: 0, semantic: 0, rrf: 1 }
  });

  const convenience = fuseResults(lexical, semantic, { strategy: 'rrf' });
  const maxRrf = computeRrfScore(0, 0);

  // `fuseRankedCandidates` devuelve los candidatos en orden de clave (estable);
  // el ranking final lo aplica el llamante con su desempate por id. La paridad
  // que importa es el ORDEN POR PUNTUACIÓN.
  const byScore = (a: { score: number; id: string }, b: { score: number; id: string }) =>
    b.score - a.score || a.id.localeCompare(b.id);

  const productionOrder = [...fused.candidates].sort(byScore).map(c => c.id);
  const convenienceOrder = [...convenience].sort(byScore).map(c => c.id);
  assert.deepStrictEqual(productionOrder, convenienceOrder, 'Mismo orden de fusión');

  for (const c of fused.candidates) {
    const other = convenience.find(d => d.id === c.id)!;
    assert.ok(
      Math.abs(c.score - other.score / maxRrf) < 1e-9,
      `RRF normalizado equivalente para ${c.id}`
    );
  }
});

test('fusión: pesos por defecto equilibrados y documentados', () => {
  assert.strictEqual(DEFAULT_FUSION_WEIGHTS.rrf, 0.5);
  assert.strictEqual(DEFAULT_FUSION_WEIGHTS.lexical, 0.25);
  assert.strictEqual(DEFAULT_FUSION_WEIGHTS.semantic, 0.25);
});