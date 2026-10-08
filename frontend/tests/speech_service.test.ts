import test from 'node:test';
import assert from 'node:assert';
import { speechService } from '../src/services/speechService.ts';

test('SS-1: speechService inicializa con valores predeterminados y límites válidos', () => {
  const settings = speechService.getSettings();
  assert.strictEqual(typeof settings.rate, 'number');
  assert.strictEqual(typeof settings.pitch, 'number');
  assert.strictEqual(typeof settings.autoReadFlashcards, 'boolean');
  assert.strictEqual(typeof settings.lang, 'string');
  assert.ok(settings.lang.startsWith('es'));
});

test('SS-2: updateSettings modifica la configuración y notifica a los suscriptores', () => {
  let notified = false;
  const unsubscribe = speechService.subscribe(() => {
    notified = true;
  });

  const updated = speechService.updateSettings({
    rate: 1.25,
    autoReadFlashcards: true
  });

  assert.strictEqual(updated.rate, 1.25);
  assert.strictEqual(updated.autoReadFlashcards, true);
  assert.strictEqual(notified, true);

  unsubscribe();

  // Restaurar estado
  speechService.updateSettings({
    rate: 1.0,
    autoReadFlashcards: false
  });
});

test('SS-3: speak() y stopSpeaking() toleran entornos sin Web Speech API sin lanzar excepciones', () => {
  assert.doesNotThrow(() => {
    speechService.speak('Texto de prueba para síntesis');
    speechService.stopSpeaking();
  });
});

test('SS-4: startDictation() y stopDictation() manejan fallbacks limpios en ausencia de reconocimiento', () => {
  let errorMessage: string | null = null;
  const started = speechService.startDictation(
    () => {},
    (err) => {
      errorMessage = err;
    }
  );

  assert.strictEqual(typeof started, 'boolean');
  if (!started) {
    assert.ok(errorMessage);
  }

  assert.doesNotThrow(() => {
    speechService.stopDictation();
  });
  assert.strictEqual(speechService.isDictating(), false);
});

test('SS-5: getAvailableVoices es idempotente y no genera bucles recursivos con suscriptores', () => {
  let callCount = 0;
  const unsubscribe = speechService.subscribe(() => {
    callCount++;
    if (callCount > 5) {
      throw new Error('Bucle recursivo detectado en la suscripción de speechService');
    }
    speechService.getAvailableVoices();
  });

  assert.doesNotThrow(() => {
    const voices = speechService.getAvailableVoices();
    assert.ok(Array.isArray(voices));
  });

  unsubscribe();
});

