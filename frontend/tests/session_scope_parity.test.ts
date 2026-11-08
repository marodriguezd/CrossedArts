/**
 * Paridad del contrato de ámbito de sesión entre las dos capas.
 *
 * `services/sessionScope.ts` y `models/activity.py` implementan la MISMA regla:
 * el ámbito se deriva de las anclas presentes y el declarado sólo se conserva
 * cuando sigue siendo representable. Hasta ahora ningún test ataba las dos
 * implementaciones: una podía cambiar una rama y las dos suites seguían en
 * verde mientras la UI y el backend contaban historias distintas.
 *
 * `shared/session-scope-cases.json` es la atadura. Este test comprueba la
 * implementación del navegador contra esa tabla; `backend/tests/
 * test_session_scope_parity.py` comprueba la del backend contra las MISMAS
 * filas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  resolveEffectiveStudySessionScope,
  resolveStudySessionScope,
  validateStudySessionScope,
  type StudySessionScope
} from '../src/services/sessionScope.ts';

interface DerivationCase {
  name: string;
  resource: boolean;
  lesson: boolean;
  expected: StudySessionScope;
}

interface EffectiveCase extends DerivationCase {
  declared: StudySessionScope | null;
}

interface ValidationCase {
  name: string;
  declared: StudySessionScope;
  resource: boolean;
  lesson: boolean;
  valid: boolean;
}

const CASES: {
  derivation: DerivationCase[];
  effective: EffectiveCase[];
  validation: ValidationCase[];
} = JSON.parse(readFileSync(new URL('../../shared/session-scope-cases.json', import.meta.url), 'utf8'));

/** Anclas reales: la tabla dice cuáles existen, nunca su valor. */
function anchors(spec: { resource: boolean; lesson: boolean }) {
  return {
    resourceId: spec.resource ? 'recurso-1' : null,
    lessonId: spec.lesson ? 'leccion-1' : null
  };
}

test('derivación: la tabla compartida se cumple en el navegador', () => {
  for (const caso of CASES.derivation) {
    assert.strictEqual(
      resolveStudySessionScope(anchors(caso)),
      caso.expected,
      `derivación divergente en «${caso.name}»`
    );
  }
});

test('ámbito efectivo: la tabla compartida se cumple en el navegador', () => {
  for (const caso of CASES.effective) {
    assert.strictEqual(
      resolveEffectiveStudySessionScope(caso.declared ?? undefined, anchors(caso)),
      caso.expected,
      `ámbito efectivo divergente en «${caso.name}»`
    );
  }
});

test('validación: un ámbito declarado incoherente se rechaza igual que en el backend', () => {
  for (const caso of CASES.validation) {
    const result = validateStudySessionScope(caso.declared, anchors(caso));
    assert.strictEqual(
      result.ok,
      caso.valid,
      `validación divergente en «${caso.name}»: ${result.error ?? 'sin error'}`
    );
    if (!caso.valid) {
      assert.ok(result.error, `«${caso.name}» debe explicar por qué se rechaza`);
    }
  }
});

test('el ámbito declarado que sigue siendo representable nunca se reescribe', () => {
  const caso = CASES.effective.find(
    (candidate) => candidate.declared === 'resource' && candidate.resource && candidate.lesson
  );
  assert.ok(caso, 'la tabla debe cubrir el caso de recurso declarado con lección presente');
  assert.strictEqual(
    resolveEffectiveStudySessionScope('resource', { resourceId: 'r', lessonId: 'l' }),
    'resource',
    'el declarado coherente se conserva aunque haya una lección enlazada'
  );
});
