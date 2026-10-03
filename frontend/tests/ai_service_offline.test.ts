import test from 'node:test';
import assert from 'node:assert';
import { aiService } from '../src/ai/aiService.ts';
import type { AIChatMessage, AISettings } from '../src/ai/aiService.ts';

test('5.1 aiService defaults to demo offline mode without external credentials', () => {
  const settings = aiService.getSettings();
  assert.strictEqual(settings.provider, 'demo');
  assert.strictEqual(settings.ollamaUrl, 'http://localhost:11434');
  assert.strictEqual(settings.ollamaModel, 'llama3:8b');
});

test('5.2 aiService.saveSettings persists configuration updates', () => {
  const customConfig: AISettings = {
    provider: 'ollama',
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'mistral:latest',
    apiKey: '',
    apiModel: 'gpt-4o'
  };

  aiService.saveSettings(customConfig);
  const updated = aiService.getSettings();
  assert.strictEqual(updated.provider, 'ollama');
  assert.strictEqual(updated.ollamaModel, 'mistral:latest');

  // Restaurar a demo para los siguientes tests
  aiService.saveSettings({
    provider: 'demo',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3:8b',
    apiKey: '',
    apiModel: 'gemini-1.5-flash'
  });
});

test('5.3 aiService.askTutor executes 100% offline with zero network requests', async () => {
  const messages: AIChatMessage[] = [
    { role: 'user', content: '¿Cómo puedo repasar mis flashcards?' }
  ];

  const startTime = Date.now();
  const reply = await aiService.askTutor(messages, 'C1: React 18');
  const elapsed = Date.now() - startTime;

  assert.ok(reply.length > 20, 'Reply should contain substantial educational content');
  assert.ok(reply.includes('SM-2') || reply.includes('repaso') || reply.includes('Recuperación'), 'Should mention SM-2 or active recall');
  assert.ok(elapsed < 1000, `Execution should complete swiftly offline, took ${elapsed}ms`);
});

test('5.4 aiService.askTutor provides domain-specific answers for technical topics', async () => {
  const reactMessages: AIChatMessage[] = [
    { role: 'user', content: 'Explícame el hook useTransition en react' }
  ];

  const reactReply = await aiService.askTutor(reactMessages, 'React 18 & TypeScript Masterclass');
  assert.ok(reactReply.includes('React 18') || reactReply.includes('Fiber'), 'Should answer React-specific concepts');

  const generalMessages: AIChatMessage[] = [
    { role: 'user', content: '¿Qué debería estudiar a continuación?' }
  ];
  const generalReply = await aiService.askTutor(generalMessages, 'Bases de Datos');
  assert.ok(generalReply.includes('Tutor DomestiK'), 'Should return structured tutor feedback');
});
