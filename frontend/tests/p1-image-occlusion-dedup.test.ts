import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { parseImageOcclusionData } from '../src/services/imageOcclusion.ts';

/**
 * P1.1 — Una tarjeta de oclusión guarda la imagen UNA sola vez.
 *
 * Antes, el editor escribía el data URL en `media_asset` y además lo copiaba en
 * `flashcard.extra_data.imageUrl`: cada imagen pesaba el doble en SQLite y en
 * cada respaldo JSON.
 */

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAB/8v/9wAAAABJRU5ErkJggg==';

test('P1.1: el editor no incrusta el data URL en extra_data', () => {
  const editor = readFileSync(new URL('../src/components/study/ImageOcclusionEditor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /imageId: mediaId/);
  assert.doesNotMatch(editor, /imageUrl: imageDataUrl/, 'el data URL no puede volver a extra_data');
});

test('P1.1: una tarjeta nueva guarda solo imageId y el visor resuelve el asset', async () => {
  await dbBridge.init();

  const mediaId = await dao.saveMediaAsset({ mime_type: 'image/png', data: PIXEL });
  const extraData = JSON.stringify({
    imageId: mediaId,
    mode: 'hide_all_reveal_one',
    masks: [{ id: 'm1', x: 10, y: 10, width: 20, height: 20, label: 'Uno', orderIndex: 1 }]
  });

  const created = await dao.createFlashcard({
    front: 'Identifica la parte',
    back: 'Uno',
    card_type: 'image_occlusion',
    extra_data: extraData
  });
  assert.ok(created.success && created.id);

  const cards = await dao.getFlashcards();
  const card = cards.find(c => c.id === created.id)!;
  assert.ok(card);
  assert.ok(!String(card.extra_data).includes('data:image'), 'extra_data no debe contener el bitmap');

  const parsed = parseImageOcclusionData(card.extra_data);
  assert.ok(parsed);
  assert.equal(parsed!.imageId, mediaId);
  assert.equal(parsed!.imageUrl, undefined);

  const asset = await dao.getMediaAsset(parsed!.imageId!);
  assert.equal(asset?.data, PIXEL, 'la imagen debe seguir disponible desde media_asset');
});

test('P1.1: la limpieza elimina imageUrl de tarjetas antiguas sin perder la imagen', async () => {
  await dbBridge.init();

  const mediaId = await dao.saveMediaAsset({ mime_type: 'image/png', data: PIXEL });
  const legacy = JSON.stringify({
    imageId: mediaId,
    imageUrl: PIXEL,
    mode: 'hide_one_reveal_one',
    masks: [{ id: 'm1', x: 0, y: 0, width: 50, height: 50, label: 'Viejo', orderIndex: 1 }]
  });

  const created = await dao.createFlashcard({
    front: 'Legacy',
    back: 'Viejo',
    card_type: 'image_occlusion',
    extra_data: legacy
  });
  assert.ok(created.id);

  const pruned = await dao.pruneDuplicateOcclusionImageUrls();
  assert.ok(pruned >= 1, 'debe haber limpiado al menos la tarjeta creada');

  const card = (await dao.getFlashcards()).find(c => c.id === created.id)!;
  assert.ok(!String(card.extra_data).includes('imageUrl'));
  const parsed = parseImageOcclusionData(card.extra_data)!;
  assert.equal(parsed.imageId, mediaId);
  assert.equal((await dao.getMediaAsset(mediaId))?.data, PIXEL);

  // Idempotente: una segunda pasada no cambia nada.
  assert.equal(await dao.pruneDuplicateOcclusionImageUrls(), 0);
});

test('P1.1: una tarjeta antigua sin asset (solo imageUrl) conserva su imagen', async () => {
  await dbBridge.init();

  const created = await dao.createFlashcard({
    front: 'Solo URL',
    back: 'Antigua',
    card_type: 'image_occlusion',
    extra_data: JSON.stringify({
      imageId: 'asset_inexistente',
      imageUrl: PIXEL,
      mode: 'hide_all_reveal_one',
      masks: []
    })
  });

  await dao.pruneDuplicateOcclusionImageUrls();
  const card = (await dao.getFlashcards()).find(c => c.id === created.id)!;
  assert.ok(String(card.extra_data).includes('imageUrl'), 'sin asset no se puede borrar la única copia');
});

test('P1.1: parseImageOcclusionData valida datos corruptos y compatibilidad', () => {
  assert.equal(parseImageOcclusionData(null), null);
  assert.equal(parseImageOcclusionData('no-json'), null);
  assert.equal(parseImageOcclusionData('{}'), null, 'sin imagen no hay tarjeta de oclusión');

  const legacy = parseImageOcclusionData(JSON.stringify({ imageUrl: PIXEL, mode: 'x', masks: 'nope' }));
  assert.ok(legacy);
  assert.equal(legacy!.mode, 'hide_all_reveal_one');
  assert.deepEqual(legacy!.masks, []);

  const withMasks = parseImageOcclusionData(
    JSON.stringify({
      imageId: 'asset_1',
      mode: 'hide_one_reveal_one',
      masks: [
        { x: '5', y: 6, width: 7, height: 8, label: 'A' },
        null,
        { id: 'b', x: 1, y: 2, width: 3, height: 4, label: 'B', orderIndex: 2 }
      ]
    })
  );
  assert.ok(withMasks);
  assert.equal(withMasks!.mode, 'hide_one_reveal_one');
  assert.equal(withMasks!.masks.length, 2, 'las entradas nulas se descartan');
  assert.equal(withMasks!.masks[0].id, 'mask_1');
  assert.equal(withMasks!.masks[0].x, 5);
});
