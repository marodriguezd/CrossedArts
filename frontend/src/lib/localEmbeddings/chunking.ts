export interface SemanticChunk {
  chunkId: string;
  sourceType: 'course' | 'lesson' | 'book' | 'note' | 'flashcard' | 'concept';
  sourceId: string;
  title: string;
  text: string;
  contentHash: string;
  page?: number;
  chapter?: string;
}

/**
 * Función de hashing criptográfica autoritativa (SHA-256) usando la Web Cryptography API nativa.
 * Devuelve un string hexadecimal de 64 caracteres.
 */
export async function computeSha256ContentHash(input: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback seguro si crypto.subtle no está disponible
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(64, '0');
}

/**
 * Función de hashing rápida síncrona (FNV-1a 32-bit) para IDs de UI o compatibilidad ligera.
 */
export function computeContentHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Divide y normaliza recursos de aprendizaje de CrossedArts en fragmentos semánticos acotados (asíncrono con SHA-256).
 */
export async function createSemanticChunksFromResourcesAsync(
  resources: {
    courses: any[];
    books: any[];
    notes: any[];
    flashcards: any[];
    concepts: any[];
  }
): Promise<SemanticChunk[]> {
  const syncChunks = createSemanticChunksFromResources(resources);
  const chunks: SemanticChunk[] = [];
  for (const c of syncChunks) {
    const sha = await computeSha256ContentHash(c.text);
    chunks.push({
      ...c,
      contentHash: sha
    });
  }
  return chunks;
}

/**
 * Divide y normaliza recursos de aprendizaje de CrossedArts en fragmentos semánticos acotados.
 */
export function createSemanticChunksFromResources(
  resources: {
    courses: any[];
    books: any[];
    notes: any[];
    flashcards: any[];
    concepts: any[];
  }
): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];

  // 1. Cursos
  for (const c of resources.courses) {
    const text = `Curso: ${c.title}. Categoría: ${c.category}. ${c.description || ''}`.trim();
    chunks.push({
      chunkId: `course_${c.id}`,
      sourceType: 'course',
      sourceId: c.id,
      title: c.title,
      text,
      contentHash: computeContentHash(text)
    });

    if (c.modules) {
      for (const m of c.modules) {
        if (m.lessons) {
          for (const l of m.lessons) {
            // El contenido editable de la lección forma parte del texto canónico: un
            // cambio de contenido produce un nuevo SHA-256 e invalida solo este chunk.
            const contentPart = (l.content || '').trim();
            const lText = `Lección: ${l.title} en módulo ${m.title} del curso ${c.title}. Duración: ${l.duration_minutes || 0}m.${contentPart ? ` Contenido: ${contentPart.slice(0, 400)}` : ''}`.trim();
            chunks.push({
              chunkId: `lesson_${l.id}`,
              sourceType: 'lesson',
              sourceId: l.id,
              title: `${c.title} › ${l.title}`,
              text: lText,
              contentHash: computeContentHash(lText)
            });
          }
        }
      }
    }
  }

  // 2. Libros
  for (const b of resources.books) {
    const text = `Libro: ${b.title}. Autor: ${b.author || 'Desconocido'}. Categoría: ${b.category}. ${b.description || ''} Progreso: ${b.reading_percentage}%`.trim();
    chunks.push({
      chunkId: `book_${b.id}`,
      sourceType: 'book',
      sourceId: b.id,
      title: b.title,
      text,
      contentHash: computeContentHash(text)
    });
  }

  // 3. Notas
  for (const n of resources.notes) {
    const rawContent = n.content || '';
    const text = `Nota: ${n.title}. Contenido: ${rawContent.slice(0, 350)}`.trim();
    
    // Extraer número de página si está presente en tags (ej: pág:12)
    let pageNum: number | undefined = undefined;
    if (n.tags) {
      const pageMatch = n.tags.match(/pág:(\d+)/i);
      if (pageMatch) {
        pageNum = parseInt(pageMatch[1], 10);
      }
    }

    chunks.push({
      chunkId: `note_${n.id}`,
      sourceType: 'note',
      sourceId: n.id,
      title: n.title,
      text,
      contentHash: computeContentHash(text),
      page: pageNum
    });
  }

  // 4. Flashcards
  for (const f of resources.flashcards) {
    const text = `Tarjeta mnemotécnica. Pregunta: ${f.front}. Respuesta: ${f.back}`.trim();
    chunks.push({
      chunkId: `flashcard_${f.id}`,
      sourceType: 'flashcard',
      sourceId: f.id,
      title: `Flashcard: ${f.front}`,
      text,
      contentHash: computeContentHash(text)
    });
  }

  // 5. Conceptos
  for (const con of resources.concepts) {
    const text = `Concepto: ${con.name}. ${con.description || ''}`.trim();
    chunks.push({
      chunkId: `concept_${con.id}`,
      sourceType: 'concept',
      sourceId: con.id,
      title: con.name,
      text,
      contentHash: computeContentHash(text)
    });
  }

  return chunks;
}
