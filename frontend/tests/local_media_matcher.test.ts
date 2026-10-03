import test from 'node:test';
import assert from 'node:assert';
import {
  localMediaService,
  normalizeMediaStem,
  isSupportedMedia,
  matchFilesToLessons,
  SUPPORTED_MEDIA_EXTENSIONS,
  type DiscoveredMediaFile,
  type MatchCandidate
} from '../src/services/localMediaService.ts';

test('7.1 Media Matching: normalizeMediaStem handles accented titles, casing, and extensions', () => {
  assert.strictEqual(
    normalizeMediaStem('01. Introducción al Virtual DOM y Fiber.mp4'),
    '01 introduccion al virtual dom y fiber'
  );
  assert.strictEqual(
    normalizeMediaStem('02_usetransition-deferred.MP4'),
    '02 usetransition deferred'
  );
  assert.strictEqual(
    normalizeMediaStem('Arquitectura Server-Components vs Client.webm'),
    'arquitectura server components vs client'
  );
  assert.strictEqual(
    normalizeMediaStem(''),
    ''
  );
});

test('7.2 Media Extensions: isSupportedMedia identifies valid video/audio and rejects others', () => {
  assert.ok(isSupportedMedia('video.mp4'));
  assert.ok(isSupportedMedia('clip.WEBM'));
  assert.ok(isSupportedMedia('audio.mp3'));
  assert.ok(isSupportedMedia('stream.mov'));
  assert.ok(!isSupportedMedia('document.pdf'));
  assert.ok(!isSupportedMedia('script.py'));
  assert.ok(!isSupportedMedia('data.db'));
  assert.ok(!isSupportedMedia('without_extension'));
});

test('7.3 Media Matching: Exact filename match and case differences', () => {
  const dummyHandle = {} as FileSystemFileHandle;
  const discovered: DiscoveredMediaFile[] = [
    { name: '01-virtual-dom-fiber.mp4', relativePath: '01-virtual-dom-fiber.mp4', fileHandle: dummyHandle },
    { name: '02-USETRANSITION-DEFERRED.MP4', relativePath: '02-USETRANSITION-DEFERRED.MP4', fileHandle: dummyHandle }
  ];

  const lessons: MatchCandidate[] = [
    { id: 'l1', title: '01. Introducción', media_url: '01-virtual-dom-fiber.mp4' },
    { id: 'l2', title: '02. useTransition', media_url: '02-usetransition-deferred.mp4' }
  ];

  const result = matchFilesToLessons(discovered, lessons);
  assert.strictEqual(result.matchedCount, 2);
  assert.strictEqual(result.matchedMap.get('l1')?.name, '01-virtual-dom-fiber.mp4');
  assert.strictEqual(result.matchedMap.get('l2')?.name, '02-USETRANSITION-DEFERRED.MP4');
  assert.strictEqual(result.unmatchedFiles.length, 0);
  assert.strictEqual(result.ambiguousLessons.length, 0);
});

test('7.4 Media Matching: Nested directories with relative paths', () => {
  const dummyHandle = {} as FileSystemFileHandle;
  const discovered: DiscoveredMediaFile[] = [
    { name: 'lesson1.mp4', relativePath: 'modulo1/lesson1.mp4', fileHandle: dummyHandle },
    { name: 'lesson2.mp4', relativePath: 'modulo2/sub/lesson2.mp4', fileHandle: dummyHandle }
  ];

  const lessons: MatchCandidate[] = [
    { id: 'l1', title: 'Leccion 1', media_url: 'modulo1/lesson1.mp4' },
    { id: 'l2', title: 'Leccion 2', media_url: 'modulo2/sub/lesson2.mp4' }
  ];

  const result = matchFilesToLessons(discovered, lessons);
  assert.strictEqual(result.matchedCount, 2);
  assert.strictEqual(result.matchedMap.get('l1')?.relativePath, 'modulo1/lesson1.mp4');
  assert.strictEqual(result.matchedMap.get('l2')?.relativePath, 'modulo2/sub/lesson2.mp4');
});

test('7.5 Media Matching: Missing files and unmatched files reporting', () => {
  const dummyHandle = {} as FileSystemFileHandle;
  const discovered: DiscoveredMediaFile[] = [
    { name: 'extra-bonus-video.mp4', relativePath: 'extra-bonus-video.mp4', fileHandle: dummyHandle }
  ];

  const lessons: MatchCandidate[] = [
    { id: 'l1', title: 'Leccion Inexistente', media_url: '01-virtual-dom-fiber.mp4' }
  ];

  const result = matchFilesToLessons(discovered, lessons);
  assert.strictEqual(result.matchedCount, 0);
  assert.strictEqual(result.unmatchedFiles.length, 1);
  assert.strictEqual(result.unmatchedFiles[0].name, 'extra-bonus-video.mp4');
});

test('7.6 Media Matching: Ambiguous matching prevents silent guessing', () => {
  const dummyHandle = {} as FileSystemFileHandle;
  // Dos archivos en diferentes carpetas con el mismo nombre y stem
  const discovered: DiscoveredMediaFile[] = [
    { name: 'intro.mp4', relativePath: 'm1/intro.mp4', fileHandle: dummyHandle },
    { name: 'intro.mp4', relativePath: 'm2/intro.mp4', fileHandle: dummyHandle }
  ];

  const lessons: MatchCandidate[] = [
    { id: 'l1', title: 'Intro', media_url: 'intro.mp4' } // Ambigua: dos archivos coinciden con intro.mp4
  ];

  const result = matchFilesToLessons(discovered, lessons);
  // No debe asignar arbitrariamente uno de los dos
  assert.strictEqual(result.matchedCount, 0, 'Ambiguous match should not arbitrarily assign a file');
  assert.strictEqual(result.ambiguousLessons.length, 1);
  assert.strictEqual(result.ambiguousLessons[0], 'Intro');
});

test('7.7 Media Matching: Fallback matching from lesson title stem', () => {
  const dummyHandle = {} as FileSystemFileHandle;
  const discovered: DiscoveredMediaFile[] = [
    { name: '03-server-components-vs-client.mp4', relativePath: '03-server-components-vs-client.mp4', fileHandle: dummyHandle }
  ];

  const lessons: MatchCandidate[] = [
    // Lección sin media_url pero con título afín
    { id: 'l3', title: '03. Server Components vs Client', media_url: undefined }
  ];

  const result = matchFilesToLessons(discovered, lessons);
  assert.strictEqual(result.matchedCount, 1);
  assert.strictEqual(result.matchedMap.get('l3')?.name, '03-server-components-vs-client.mp4');
});

test('7.8 Object URL Lifecycle: Revocation cleans up memory and handles absent entries gracefully', () => {
  // Revocar en ausencia no debe lanzar error ni romper el estado
  localMediaService.revokePlaybackUrl('non-existent-lesson');
  localMediaService.revokeAllObjectUrls();
  assert.strictEqual(localMediaService.hasActiveFolder(), false);
});

test('7.9 Tiered Matching Priority: Stronger match beats weaker match', () => {
  const dummyHandle = {} as FileSystemFileHandle;
  // Discovered files contain both an exact relative path match and a title match
  const discovered: DiscoveredMediaFile[] = [
    { name: 'overview.mp4', relativePath: 'course/lesson-01.mp4', fileHandle: dummyHandle },
    { name: 'lesson-01.mp4', relativePath: 'other/lesson-01.mp4', fileHandle: dummyHandle }
  ];

  const lessons: MatchCandidate[] = [
    { id: 'l1', title: 'lesson-01', media_url: 'course/lesson-01.mp4' }
  ];

  const result = matchFilesToLessons(discovered, lessons);
  assert.strictEqual(result.matchedCount, 1);
  // EXACT_PATH match (course/lesson-01.mp4) must win over EXACT_NAME or STEM_MATCH
  assert.strictEqual(result.matchedMap.get('l1')?.relativePath, 'course/lesson-01.mp4');
});

test('7.10 Media Matching: Weak title fallback rejects short/empty stems to prevent false positives', () => {
  const dummyHandle = {} as FileSystemFileHandle;
  const discovered: DiscoveredMediaFile[] = [
    { name: 'unrelated.mp4', relativePath: 'unrelated.mp4', fileHandle: dummyHandle }
  ];

  const lessons: MatchCandidate[] = [
    { id: 'l1', title: 'ab', media_url: undefined },
    { id: 'l2', title: '', media_url: undefined }
  ];

  const result = matchFilesToLessons(discovered, lessons);
  assert.strictEqual(result.matchedCount, 0);
  assert.strictEqual(result.unmatchedFiles.length, 1);
});

test('7.11 Individual File Association: Validates extensions and tracks individual file', () => {
  // Test validation
  const invalidFile = { name: 'document.pdf', type: 'application/pdf' } as File;
  const resInvalid = localMediaService.associateIndividualFile('l1', invalidFile);
  assert.strictEqual(resInvalid.success, false);
  assert.ok(resInvalid.error?.includes('no soportado'));

  // Test valid association
  const validFile = { name: 'lesson-video.mp4', type: 'video/mp4' } as File;
  const resValid = localMediaService.associateIndividualFile('l1', validFile);
  assert.strictEqual(resValid.success, true);
  assert.strictEqual(localMediaService.hasIndividualFile('l1'), true);

  // Clean up
  localMediaService.clearIndividualFile('l1');
  assert.strictEqual(localMediaService.hasIndividualFile('l1'), false);
});

