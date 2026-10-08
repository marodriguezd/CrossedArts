/**
 * Selección de modelo local consciente de la tarea: UNA sola política.
 *
 * Garantías:
 *  - la tarea ORDENA preferencia entre modelos ya elegibles; nunca introduce un
 *    modelo que el dispositivo no soporta;
 *  - con información de capacidad incierta se conserva el criterio conservador
 *    (el viable más pequeño);
 *  - la selección es determinista: mismas capacidades + misma tarea -> mismo modelo.
 */
import test from 'node:test';
import assert from 'node:assert';

import {
  selectBestLocalModel,
  selectRuntimeProfile,
  selectBestLocalModelForTask,
  eligibleModelsFor,
  type AIModelTask
} from '../src/lib/localLlm/selection.ts';
import { LOCAL_MODELS_REGISTRY } from '../src/lib/localLlm/registry.ts';

const CAPABLE = {
  webgpu: 'supported' as const,
  supportedFeatures: ['shader-f16'],
  deviceTier: 'high' as const
};

const UNCERTAIN = {
  webgpu: 'supported' as const,
  supportedFeatures: [] as string[],
  deviceTier: 'unknown' as const
};

const CPU_ONLY = { webgpu: 'unsupported' as const, hasWasm: true };

test('selección por tarea: solo se apoya en modelos ELEGIBLES por hardware', () => {
  // Sin WebGPU, ninguna tarea puede devolver un modelo WebGPU.
  for (const task of ['tutor', 'summarization', 'flashcard_generation', 'question_generation', 'light_assistance'] as AIModelTask[]) {
    const model = selectBestLocalModelForTask(CPU_ONLY, task);
    assert.ok(model, `${task}: debe elegir un modelo CPU`);
    assert.strictEqual(model.runtimeBackend, 'wasm', `${task}: nunca un modelo WebGPU sin soporte`);
  }
});

test('selección por tarea: sin features f16 reportadas, el modelo que lo exige queda fuera', () => {
  const eligible = eligibleModelsFor({ webgpu: 'supported', supportedFeatures: [] });
  assert.ok(!eligible.some(m => m.requiredFeatures?.includes('shader-f16')));
  for (const task of ['tutor', 'light_assistance'] as AIModelTask[]) {
    const model = selectBestLocalModelForTask({ webgpu: 'supported', supportedFeatures: [] }, task);
    assert.ok(!model?.requiredFeatures?.includes('shader-f16'));
  }
});

test('selección por tarea: es determinista', () => {
  for (const task of ['tutor', 'summarization', 'flashcard_generation', 'question_generation', 'light_assistance'] as AIModelTask[]) {
    const first = selectBestLocalModelForTask(CAPABLE, task)?.id;
    const second = selectBestLocalModelForTask(CAPABLE, task)?.id;
    const third = selectBestLocalModelForTask(CAPABLE, task)?.id;
    assert.strictEqual(first, second);
    assert.strictEqual(second, third);
  }
});

test('selección por tarea: con capacidad incierta se conserva el criterio conservador', () => {
  const conservative = selectBestLocalModel(UNCERTAIN)!;
  for (const task of ['tutor', 'summarization', 'flashcard_generation', 'question_generation', 'light_assistance'] as AIModelTask[]) {
    assert.strictEqual(
      selectBestLocalModelForTask(UNCERTAIN, task)?.id,
      conservative.id,
      `${task}: la tarea no puede subir la exigencia en un dispositivo incierto`
    );
  }
});

test('selección por tarea: todas las tareas resuelven un modelo real y registrado', () => {
  for (const task of ['tutor', 'summarization', 'flashcard_generation', 'question_generation', 'light_assistance'] as AIModelTask[]) {
    const model = selectBestLocalModelForTask(CAPABLE, task);
    assert.ok(model, `${task}: debe resolverse`);
    assert.ok(LOCAL_MODELS_REGISTRY.some(m => m.id === model.id), `${task}: el modelo existe en el registro`);
  }
});

test('selección por tarea: la generación estructurada prioriza adherencia a JSON', () => {
  const structured = selectBestLocalModelForTask(CAPABLE, 'flashcard_generation')!;
  const questions = selectBestLocalModelForTask(CAPABLE, 'question_generation')!;
  assert.strictEqual(structured.id, 'Qwen3-1.7B-q4f16_1-MLC');
  assert.strictEqual(questions.id, structured.id, 'Ambas tareas estructuradas comparten preferencia');
});

test('selección por tarea: sin soporte devuelve null (degradación honesta)', () => {
  assert.strictEqual(selectBestLocalModelForTask({ webgpu: 'unsupported', hasWasm: false }, 'tutor'), null);
  assert.strictEqual(selectBestLocalModelForTask({ webgpu: 'unknown' }, 'summarization'), null);
});

test('selección por tarea: el runtime usa la misma política que la función canónica', () => {
  // `selectBestLocalModelForTask` es la política; `selectRuntimeProfile` sigue
  // exponiendo el motivo de diagnóstico de la MISMA elegibilidad.
  const profile = selectRuntimeProfile(CAPABLE);
  assert.ok(profile);
  const taskModel = selectBestLocalModelForTask(CAPABLE, 'tutor');
  assert.ok(eligibleModelsFor(CAPABLE).some(m => m.id === taskModel!.id));
  assert.ok(eligibleModelsFor(CAPABLE).some(m => m.id === profile!.model.id));
});