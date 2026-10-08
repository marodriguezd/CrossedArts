import test from 'node:test';
import assert from 'node:assert';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { generateJsonBackup, importJsonBackup } from '../src/db/exportImport.ts';
import type { ImageOcclusionData } from '../src/types/models.ts';

test('IO-1: Crea tarjeta de oclusión de imagen con extra_data y card_type', async () => {
  await dbBridge.init();

  const mockOcclusionData: ImageOcclusionData = {
    imageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
    mode: 'hide_all_reveal_one',
    masks: [
      { id: 'm1', x: 10, y: 20, width: 30, height: 40, label: 'Lóbulo Frontal', orderIndex: 1 },
      { id: 'm2', x: 50, y: 20, width: 30, height: 40, label: 'Lóbulo Parietal', orderIndex: 2 }
    ]
  };

  const created = await dao.createFlashcard({
    resource_id: 'c1-react',
    front: 'Identifica las áreas del cerebro',
    back: 'Lóbulo Frontal y Lóbulo Parietal',
    card_type: 'image_occlusion',
    extra_data: JSON.stringify(mockOcclusionData)
  });

  assert.strictEqual(created.success, true);
  assert.ok(created.id);

  const cards = await dao.getFlashcards();
  const found = cards.find(c => c.id === created.id);
  assert.ok(found, 'La tarjeta creada debe encontrarse en getFlashcards()');
  assert.strictEqual(found!.card_type, 'image_occlusion');
  assert.ok(found!.extra_data);

  const parsed: ImageOcclusionData = JSON.parse(found!.extra_data!);
  assert.strictEqual(parsed.mode, 'hide_all_reveal_one');
  assert.strictEqual(parsed.masks.length, 2);
  assert.strictEqual(parsed.masks[0].label, 'Lóbulo Frontal');
});

test('IO-2: Persistencia y recuperación de MediaAsset binario local', async () => {
  await dbBridge.init();

  const assetId = await dao.saveMediaAsset({
    mime_type: 'image/png',
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  });

  assert.ok(assetId.startsWith('asset_'));

  const loaded = await dao.getMediaAsset(assetId);
  assert.ok(loaded);
  assert.strictEqual(loaded!.id, assetId);
  assert.strictEqual(loaded!.mime_type, 'image/png');
  assert.ok(loaded!.data.startsWith('data:image/png;base64,'));
});

test('IO-3: Ciclo SM-2 funciona idéntico sobre tarjetas de oclusión', async () => {
  await dbBridge.init();

  const created = await dao.createFlashcard({
    resource_id: 'c1-react',
    front: 'Prueba SM2 Oclusión',
    back: 'Respuesta SM2',
    card_type: 'image_occlusion',
    extra_data: JSON.stringify({ mode: 'hide_one_reveal_one', masks: [] })
  });

  assert.ok(created.id);

  // Calificar con Grado 4 (Bien)
  const sm2Result = await dao.reviewFlashcardSM2(created.id!, 4);
  assert.ok(sm2Result);
  assert.strictEqual(sm2Result!.repetitionCount, 1);
  assert.strictEqual(sm2Result!.intervalDays, 1);

  const updatedCards = await dao.getFlashcards();
  const card = updatedCards.find(c => c.id === created.id);
  assert.strictEqual(card?.repetition_count, 1);
  assert.strictEqual(card?.card_type, 'image_occlusion');
});

test('IO-4: Exportación e importación JSON conserva media_asset y tarjetas de oclusión', async () => {
  await dbBridge.init();

  const backup = generateJsonBackup();
  assert.ok(backup);
  assert.ok(Array.isArray(backup.media_asset), 'El volcado JSON debe incluir la tabla media_asset');
  assert.ok(Array.isArray(backup.flashcard), 'El volcado JSON debe incluir la tabla flashcard');

  const occlusionCard = backup.flashcard.find((c: any) => c.card_type === 'image_occlusion');
  assert.ok(occlusionCard, 'Debe existir al menos una tarjeta de oclusión exportada');
  assert.ok(occlusionCard.extra_data, 'Debe conservarse el extra_data de la tarjeta');

  // Restauración de respaldo sin errores
  await importJsonBackup(backup);

  const restoredCards = await dao.getFlashcards();
  const foundRestored = restoredCards.find(c => c.id === occlusionCard.id);
  assert.ok(foundRestored, 'La tarjeta de oclusión debe recuperarse tras restaurar respaldo');
  assert.strictEqual(foundRestored!.card_type, 'image_occlusion');
});
