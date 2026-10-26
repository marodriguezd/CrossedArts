import type { ImageOcclusionData, OcclusionMask } from '../types/models.ts';

/**
 * Parses and validates the `extra_data` of an image-occlusion card.
 *
 * The JSON comes from user data (and from backups written by older versions), so
 * it is validated instead of cast: a malformed card must render "no image
 * available", never crash the review session.
 */
export function parseImageOcclusionData(raw: string | null | undefined): ImageOcclusionData | null {
  if (!raw) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const mode: ImageOcclusionData['mode'] =
    parsed.mode === 'hide_one_reveal_one' ? 'hide_one_reveal_one' : 'hide_all_reveal_one';

  const masks: OcclusionMask[] = Array.isArray(parsed.masks)
    ? parsed.masks
        .filter((mask: any) => mask && typeof mask === 'object')
        .map((mask: any, index: number) => ({
          id: typeof mask.id === 'string' && mask.id ? mask.id : `mask_${index + 1}`,
          x: Number(mask.x) || 0,
          y: Number(mask.y) || 0,
          width: Number(mask.width) || 0,
          height: Number(mask.height) || 0,
          label: typeof mask.label === 'string' ? mask.label : '',
          orderIndex: Number(mask.orderIndex) || index + 1
        }))
    : [];

  const imageId = typeof parsed.imageId === 'string' && parsed.imageId ? parsed.imageId : undefined;
  const imageUrl = typeof parsed.imageUrl === 'string' && parsed.imageUrl ? parsed.imageUrl : undefined;

  // Without a bitmap reference there is nothing to occlude.
  if (!imageId && !imageUrl) return null;

  return {
    imageId,
    imageUrl,
    mode,
    masks,
    originalWidth: Number(parsed.originalWidth) || undefined,
    originalHeight: Number(parsed.originalHeight) || undefined
  };
}
