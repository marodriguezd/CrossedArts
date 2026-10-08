import test from 'node:test';
import assert from 'node:assert';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { filterFlashcardsByOrigin } from '../src/services/domainLogic.ts';
import type { Flashcard } from '../src/types/models.ts';

test('3.1 SM-2: Grade 5 increases repetition count, calculates proper interval, and raises ease factor', async () => {
  await dbBridge.init();

  // Crear una tarjeta de prueba limpia
  const db = dbBridge.getDatabase();
  const testCardId = 'test-sm2-card-1';
  db.run(`
    INSERT INTO flashcard (id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date)
    VALUES ('${testCardId}', 'c1-react', 'Pregunta test', 'Respuesta test', 0, 1, 2.5, datetime('now'))
  `);

  // Repaso 1: Grado 5 -> reps: 1, interval: 1
  await dao.reviewFlashcardSM2(testCardId, 5);
  let cards = await dao.getFlashcards();
  let card = cards.find(c => c.id === testCardId);
  assert.strictEqual(card?.repetition_count, 1);
  assert.strictEqual(card?.interval_days, 1);
  assert.ok(card!.ease_factor >= 2.5, 'Ease factor should increase on grade 5');

  // Repaso 2: Grado 5 -> reps: 2, interval: 6
  await dao.reviewFlashcardSM2(testCardId, 5);
  cards = await dao.getFlashcards();
  card = cards.find(c => c.id === testCardId);
  assert.strictEqual(card?.repetition_count, 2);
  assert.strictEqual(card?.interval_days, 6);

  // Repaso 3: Grado 5 -> reps: 3, interval: round(6 * ease_factor)
  const prevEase = card!.ease_factor;
  await dao.reviewFlashcardSM2(testCardId, 5);
  cards = await dao.getFlashcards();
  card = cards.find(c => c.id === testCardId);
  assert.strictEqual(card?.repetition_count, 3);
  assert.strictEqual(card?.interval_days, Math.round(6 * prevEase));
});

test('3.2 SM-2: Grade < 3 (failure/lapse) resets repetitions to 0 and interval to 1 day', async () => {
  const db = dbBridge.getDatabase();
  const testCardId = 'test-sm2-lapse';
  db.run(`
    INSERT INTO flashcard (id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date)
    VALUES ('${testCardId}', 'c1-react', 'Pregunta lapse', 'Respuesta lapse', 4, 30, 2.6, datetime('now'))
  `);

  // Evaluación con grado 1 (Olvidado)
  await dao.reviewFlashcardSM2(testCardId, 1);

  const cards = await dao.getFlashcards();
  const card = cards.find(c => c.id === testCardId);
  assert.strictEqual(card?.repetition_count, 0, 'Repetitions must reset to 0');
  assert.strictEqual(card?.interval_days, 1, 'Interval must reset to 1 day on lapse');
  assert.ok(card!.ease_factor < 2.6, 'Ease factor must decrease on failure');
});

test('3.3 SM-2: Ease factor never drops below minimum threshold of 1.30', async () => {
  const db = dbBridge.getDatabase();
  const testCardId = 'test-sm2-floor';
  db.run(`
    INSERT INTO flashcard (id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date)
    VALUES ('${testCardId}', 'c1-react', 'Pregunta difícil', 'Respuesta', 0, 1, 1.4, datetime('now'))
  `);

  // Forzar múltiples fallos consecutivos (grado 0/1)
  for (let i = 0; i < 6; i++) {
    await dao.reviewFlashcardSM2(testCardId, 1);
  }

  const cards = await dao.getFlashcards();
  const card = cards.find(c => c.id === testCardId);
  assert.strictEqual(card?.ease_factor, 1.3, 'Ease factor must be clamped at exactly 1.30 minimum');
});

test('3.4 Flashcard Deck Origin Filtering: Filters cards by course, book or general origin accurately', () => {
  const kindMap = new Map<string, 'course' | 'book' | 'learning_resource'>([
    ['res-course-1', 'course'],
    ['res-book-1', 'book'],
    ['res-doc-1', 'learning_resource']
  ]);

  const mockCards: Flashcard[] = [
    { id: 'fc1', resource_id: 'res-course-1', front: 'Q1', back: 'A1', repetition_count: 0, interval_days: 1, ease_factor: 2.5, due_date: '2026-10-04' },
    { id: 'fc2', resource_id: 'res-book-1', front: 'Q2', back: 'A2', repetition_count: 0, interval_days: 1, ease_factor: 2.5, due_date: '2026-10-04' },
    { id: 'fc3', resource_id: 'res-doc-1', front: 'Q3', back: 'A3', repetition_count: 0, interval_days: 1, ease_factor: 2.5, due_date: '2026-10-04' },
    { id: 'fc4', front: 'Q4', back: 'A4', repetition_count: 0, interval_days: 1, ease_factor: 2.5, due_date: '2026-10-04' }
  ];

  // 'all' -> todas
  assert.strictEqual(filterFlashcardsByOrigin(mockCards, 'all', kindMap).length, 4);

  // 'course' -> solo fc1
  const courseCards = filterFlashcardsByOrigin(mockCards, 'course', kindMap);
  assert.strictEqual(courseCards.length, 1);
  assert.strictEqual(courseCards[0].id, 'fc1');

  // 'book' -> solo fc2
  const bookCards = filterFlashcardsByOrigin(mockCards, 'book', kindMap);
  assert.strictEqual(bookCards.length, 1);
  assert.strictEqual(bookCards[0].id, 'fc2');

  // 'general' -> fc3 (learning_resource) y fc4 (sin resource_id)
  const generalCards = filterFlashcardsByOrigin(mockCards, 'general', kindMap);
  assert.strictEqual(generalCards.length, 2);
  assert.deepStrictEqual(generalCards.map(c => c.id), ['fc3', 'fc4']);
});
