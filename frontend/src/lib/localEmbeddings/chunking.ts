export type SemanticSourceType = 'course' | 'lesson' | 'book' | 'note' | 'flashcard' | 'concept' | 'practice';

export interface SemanticChunk {
  chunkId: string;
  sourceType: SemanticSourceType;
  sourceId: string;
  title: string;
  text: string;
  contentHash: string;
  page?: number;
  chapter?: string;
}

/** Entradas normalizadas para el troceado semántico (frontera de datos externos). */
export interface LessonChunkInput {
  id: string;
  title: string;
  content?: string | null;
  duration_minutes?: number;
}

export interface ModuleChunkInput {
  id: string;
  title: string;
  lessons?: LessonChunkInput[];
}

export interface CourseChunkInput {
  id: string;
  title: string;
  category?: string;
  description?: string | null;
  modules?: ModuleChunkInput[];
}

export interface BookChunkInput {
  id: string;
  title: string;
  author?: string | null;
  category?: string;
  description?: string | null;
  reading_percentage?: number;
}

export interface NoteChunkInput {
  id: string;
  title: string;
  content?: string | null;
  tags?: string | null;
}

export interface FlashcardChunkInput {
  id: string;
  front: string;
  back: string;
}

export interface ConceptChunkInput {
  id: string;
  name: string;
  description?: string | null;
}

/**
 * Trabajo práctico: evidencia PRODUCIDA por el estudiante. Es una fuente de
 * conocimiento de primera clase, no un anexo del recurso: se indexa con sus
 * campos significativos (título, descripción, contenido y notas) para que sea
 * recuperable por búsqueda local y conserve su procedencia.
 */
export interface PracticeChunkInput {
  id: string;
  title: string;
  description?: string | null;
  content?: string | null;
  notes?: string | null;
  kind?: string | null;
  resource_id?: string | null;
  lesson_id?: string | null;
}

export interface ChunkableResources {
  courses: CourseChunkInput[];
  books: BookChunkInput[];
  notes: NoteChunkInput[];
  flashcards: FlashcardChunkInput[];
  concepts: ConceptChunkInput[];
  practiceWork?: PracticeChunkInput[];
}

// ---------------------------------------------------------------------------
// SHA-256 real.
//
// `computeSha256ContentHash` promete un SHA-256 y los consumidores (invalidación
// de caché, identidad de fragmentos) dependen de esa propiedad criptográfica.
// WebCrypto `crypto.subtle` no existe en todos los entornos soportados (p. ej.
// contextos no seguros o workers restringidos), así que el fallback es una
// implementación SHA-256 pura en TypeScript con el mismo resultado exacto
// (digest idéntico byte a byte), nunca un hash ligero disfrazado de 64 hex.
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Implementación SHA-256 pura (FIPS 180-4) sobre UTF-8.
 * Determinista y sin dependencias: produce exactamente el mismo digest que
 * WebCrypto, por lo que ambas rutas son intercambiables.
 */
export function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input);
  const bitLen = data.length * 8;
  const withPadding = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  withPadding.set(data);
  withPadding[data.length] = 0x80;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(withPadding.length - 4, bitLen >>> 0);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map(x => x.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Hash de contenido criptográfico SHA-256. Devuelve 64 caracteres hexadecimales.
 * Usa WebCrypto cuando está disponible y la implementación pura (idéntica) en
 * caso contrario: el resultado es el mismo digest en ambos caminos.
 */
export async function computeSha256ContentHash(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Contextos con subtle degradado: caer a la implementación pura.
    }
  }
  return sha256Hex(input);
}

/**
 * Función de hashing rápida síncrona (FNV-1a 32-bit) para IDs de UI o compatibilidad ligera.
 * NO es un hash criptográfico y jamás se presenta como SHA-256.
 */
export function computeContentHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Troceado semántico acotado.
//
// Truncar el contenido de una lección o nota a un snippet pequeño hacía que la
// recuperación semántica ignorase la mayor parte del texto. Ahora el contenido
// largo se reparte en varios fragmentos acotados, con cortes en frontera de
// párrafo/frase, solape pequeño para conservar contexto, IDs deterministas
// (`<base>` para la parte 1 y `<base>_pN` para las siguientes) y orden estable.
// ---------------------------------------------------------------------------

/** Objetivo de caracteres por fragmento. Acotado para caber en el contexto del modelo de embeddings activo. */
const CHUNK_CHAR_LIMIT = 600;
/** Solape entre fragmentos contiguos: mantiene coherencia sin duplicar en exceso. */
const CHUNK_OVERLAP_CHARS = 80;
/** Un resto más corto que esto se fusiona con el fragmento anterior (evita migajas). */
const MIN_TAIL_CHARS = 60;

function splitAtBoundary(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const window = text.slice(0, limit + 1);
  // Preferir frontera de párrafo, luego fin de frase, luego espacio.
  const paragraph = window.lastIndexOf('\n');
  if (paragraph >= Math.floor(limit * 0.5)) return paragraph + 1;
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'), window.lastIndexOf('? '), window.lastIndexOf('! '));
  if (sentence >= Math.floor(limit * 0.5)) return sentence + 1;
  const space = window.lastIndexOf(' ');
  if (space >= Math.floor(limit * 0.4)) return space + 1;
  return limit; // Corte duro: sin espacios utilizables.
}

/**
 * Reparte `text` en fragmentos acotados y deterministas con solape controlado.
 * El texto vacío o corto produce exactamente un fragmento (sin inflar la caché).
 */
export function splitIntoBoundedParts(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= CHUNK_CHAR_LIMIT) return [trimmed];

  const parts: string[] = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    const end = splitAtBoundary(trimmed, cursor + CHUNK_CHAR_LIMIT);
    const part = trimmed.slice(cursor, end).trim();
    if (part) parts.push(part);
    if (end >= trimmed.length) break;
    // Retroceso con solape para no perder contexto entre fragmentos.
    cursor = Math.max(end - CHUNK_OVERLAP_CHARS, cursor + 1);
  }

  // Fusionar un resto demasiado pequeño con el fragmento anterior.
  if (parts.length > 1 && parts[parts.length - 1].length < MIN_TAIL_CHARS) {
    const tail = parts.pop()!;
    parts[parts.length - 1] = `${parts[parts.length - 1]} ${tail}`.trim();
  }

  return parts;
}

interface BuildChunkArgs {
  baseId: string;
  sourceType: SemanticChunk['sourceType'];
  sourceId: string;
  title: string;
  headerText: string;
  bodyText: string;
  page?: number;
  chapter?: string;
}

function buildChunksForSource(args: BuildChunkArgs): SemanticChunk[] {
  const { baseId, sourceType, sourceId, title, headerText, bodyText, page, chapter } = args;
  const bodyParts = splitIntoBoundedParts(bodyText);
  if (bodyParts.length === 0) {
    // Sin cuerpo: el fragmento es solo la cabecera (metadatos del recurso).
    const text = headerText.trim();
    if (!text) return [];
    return [{
      chunkId: baseId,
      sourceType,
      sourceId,
      title,
      text,
      contentHash: computeContentHash(text),
      page,
      chapter
    }];
  }

  return bodyParts.map((bodyPart, index) => {
    const text = index === 0
      ? `${headerText} ${bodyPart}`.trim()
      : `${headerText} (parte ${index + 1}) ${bodyPart}`.trim();
    return {
      chunkId: index === 0 ? baseId : `${baseId}_p${index + 1}`,
      sourceType,
      sourceId,
      title: index === 0 ? title : `${title} (parte ${index + 1})`,
      text,
      contentHash: computeContentHash(text),
      page,
      chapter
    };
  });
}

function notePageFromTags(tags?: string | null): number | undefined {
  if (!tags) return undefined;
  const pageMatch = tags.match(/pág:(\d+)/i);
  return pageMatch ? parseInt(pageMatch[1], 10) : undefined;
}

/**
 * Divide y normaliza recursos de aprendizaje de CrossedArts en fragmentos semánticos acotados.
 * El contenido largo (lecciones, notas) se representa con varios fragmentos en lugar de truncarse.
 */
export function createSemanticChunksFromResources(resources: ChunkableResources): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];

  // 1. Cursos (y sus lecciones)
  for (const c of resources.courses || []) {
    const courseHeader = `Curso: ${c.title}. Categoría: ${c.category || 'General'}.`;
    chunks.push(...buildChunksForSource({
      baseId: `course_${c.id}`,
      sourceType: 'course',
      sourceId: c.id,
      title: c.title,
      headerText: courseHeader,
      bodyText: c.description || ''
    }));

    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        const lessonHeader = `Lección: ${l.title} en módulo ${m.title} del curso ${c.title}. Duración: ${l.duration_minutes || 0}m.`;
        // El contenido editable de la lección forma parte del texto canónico: un
        // cambio de contenido produce un nuevo hash e invalida solo estos fragmentos.
        chunks.push(...buildChunksForSource({
          baseId: `lesson_${l.id}`,
          sourceType: 'lesson',
          sourceId: l.id,
          title: `${c.title} › ${l.title}`,
          headerText: lessonHeader,
          bodyText: (l.content || '').trim()
        }));
      }
    }
  }

  // 2. Libros
  for (const b of resources.books || []) {
    const bookHeader = `Libro: ${b.title}. Autor: ${b.author || 'Desconocido'}. Categoría: ${b.category || 'General'}. Progreso: ${b.reading_percentage ?? 0}%.`;
    chunks.push(...buildChunksForSource({
      baseId: `book_${b.id}`,
      sourceType: 'book',
      sourceId: b.id,
      title: b.title,
      headerText: bookHeader,
      bodyText: b.description || ''
    }));
  }

  // 3. Notas
  for (const n of resources.notes || []) {
    const noteHeader = `Nota: ${n.title}.`;
    chunks.push(...buildChunksForSource({
      baseId: `note_${n.id}`,
      sourceType: 'note',
      sourceId: n.id,
      title: n.title,
      headerText: noteHeader,
      bodyText: (n.content || '').trim(),
      page: notePageFromTags(n.tags)
    }));
  }

  // 4. Flashcards
  for (const f of resources.flashcards || []) {
    chunks.push(...buildChunksForSource({
      baseId: `flashcard_${f.id}`,
      sourceType: 'flashcard',
      sourceId: f.id,
      title: `Flashcard: ${f.front}`,
      headerText: 'Tarjeta mnemotécnica.',
      bodyText: `Pregunta: ${f.front}. Respuesta: ${f.back}`.trim()
    }));
  }

  // 5. Conceptos
  for (const con of resources.concepts || []) {
    chunks.push(...buildChunksForSource({
      baseId: `concept_${con.id}`,
      sourceType: 'concept',
      sourceId: con.id,
      title: con.name,
      headerText: `Concepto: ${con.name}.`,
      bodyText: con.description || ''
    }));
  }

  // 6. Trabajo práctico del estudiante (evidencia producida, indexable).
  for (const pw of resources.practiceWork || []) {
    const practiceHeader = `Trabajo práctico: ${pw.title}. Tipo: ${pw.kind || 'exercise'}.`;
    // Los campos se unen en un único texto canónico: un cambio en cualquiera de
    // ellos altera el hash e invalida solo los fragmentos de este artefacto.
    const bodyText = [pw.description, pw.content, pw.notes]
      .map((value) => (value || '').trim())
      .filter(Boolean)
      .join('\n\n');
    chunks.push(...buildChunksForSource({
      baseId: `practice_${pw.id}`,
      sourceType: 'practice',
      sourceId: pw.id,
      title: pw.title,
      headerText: practiceHeader,
      bodyText
    }));
  }

  return chunks;
}

/**
 * Divide y normaliza un KnowledgeDocument canónico en fragmentos semánticos acotados.
 */
export function createSemanticChunksFromKnowledgeDocument(doc: {
  id: string;
  sourceType: SemanticChunk['sourceType'];
  sourceId: string;
  title: string;
  headerText: string;
  bodyText: string;
  page?: number;
  chapter?: string;
}): SemanticChunk[] {
  return buildChunksForSource({
    baseId: doc.id,
    sourceType: doc.sourceType,
    sourceId: doc.sourceId,
    title: doc.title,
    headerText: doc.headerText,
    bodyText: doc.bodyText,
    page: doc.page,
    chapter: doc.chapter
  });
}

/**
 * Trocea un conjunto de KnowledgeDocuments de forma síncrona y determinista.
 */
export function createSemanticChunksFromKnowledgeDocuments(
  docs: Array<{
    id: string;
    sourceType: SemanticChunk['sourceType'];
    sourceId: string;
    title: string;
    headerText: string;
    bodyText: string;
    page?: number;
    chapter?: string;
  }>
): SemanticChunk[] {
  return docs.flatMap(createSemanticChunksFromKnowledgeDocument);
}

/**
 * Variante asíncrona: recalcula el hash de cada fragmento con SHA-256 real.
 * La identidad de contenido de la caché de vectores depende de esta propiedad.
 */
export async function createSemanticChunksFromResourcesAsync(
  resources: ChunkableResources
): Promise<SemanticChunk[]> {
  const syncChunks = createSemanticChunksFromResources(resources);
  return Promise.all(
    syncChunks.map(async (c) => ({
      ...c,
      contentHash: await computeSha256ContentHash(c.text)
    }))
  );
}

/**
 * Estructura mínima de `KnowledgeDocument` que el troceado necesita.
 *
 * Se declara estructuralmente (no importando el tipo) para que el módulo de
 * troceado siga siendo la frontera baja y `ai/knowledge` pueda depender de él
 * sin ciclo en tiempo de ejecución.
 */
export interface ChunkableKnowledgeDocument {
  id: string;
  sourceType: SemanticChunk['sourceType'];
  sourceId: string;
  title: string;
  headerText: string;
  bodyText: string;
  page?: number;
  chapter?: string;
}

/**
 * Trocea documentos canónicos YA ADAPTADOS y calcula su identidad de contenido
 * con SHA-256 real. Es la ruta de producción: el `KnowledgeDocument` es la
 * frontera semántica, y aquí solo se le aplica el troceado acotado.
 */
export async function createSemanticChunksFromKnowledgeDocumentsAsync(
  documents: ChunkableKnowledgeDocument[]
): Promise<SemanticChunk[]> {
  const syncChunks = createSemanticChunksFromKnowledgeDocuments(documents);
  return Promise.all(
    syncChunks.map(async (c) => ({
      ...c,
      contentHash: await computeSha256ContentHash(c.text)
    }))
  );
}

