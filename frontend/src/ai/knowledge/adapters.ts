import type { KnowledgeDocument, DomainKnowledgeEntities } from './types.ts';
import { computeSha256ContentHash, sha256Hex } from '../../lib/localEmbeddings/chunking.ts';

function extractPageFromTags(tags?: string | null): number | undefined {
  if (!tags) return undefined;
  const match = tags.match(/pág:(\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Convierte entidades de dominio de CrossedArts a documentos canónicos síncronamente.
 * Utiliza sha256Hex puro como hash determinista rápido en memoria.
 */
export function domainEntitiesToKnowledgeDocuments(entities: DomainKnowledgeEntities): KnowledgeDocument[] {
  const docs: KnowledgeDocument[] = [];

  // 1. Cursos y Lecciones
  for (const c of entities.courses || []) {
    const courseHeader = `Curso: ${c.title}. Categoría: ${c.category || 'General'}.`;
    const courseBody = (c.description || '').trim();
    const courseText = courseBody ? `${courseHeader} ${courseBody}` : courseHeader;

    docs.push({
      id: `course_${c.id}`,
      sourceType: 'course',
      sourceId: c.id,
      resourceId: c.id,
      title: c.title,
      headerText: courseHeader,
      bodyText: courseBody,
      text: courseText,
      path: [c.title],
      substantive: Boolean(courseBody),
      contentHash: sha256Hex(courseText),
      metadata: {
        category: c.category || 'General'
      }
    });

    for (const m of c.modules || []) {
      for (const l of m.lessons || []) {
        const lessonHeader = `Lección: ${l.title} en módulo ${m.title} del curso ${c.title}. Duración: ${l.duration_minutes || 0}m.`;
        const lessonBody = (l.content || '').trim();
        const lessonText = lessonBody ? `${lessonHeader} ${lessonBody}` : lessonHeader;

        docs.push({
          id: `lesson_${l.id}`,
          sourceType: 'lesson',
          sourceId: l.id,
          resourceId: c.id,
          moduleId: m.id,
          lessonId: l.id,
          title: `${c.title} › ${l.title}`,
          headerText: lessonHeader,
          bodyText: lessonBody,
          text: lessonText,
          path: [c.title, m.title, l.title],
          substantive: Boolean(lessonBody),
          contentHash: sha256Hex(lessonText),
          metadata: {
            courseId: c.id,
            moduleId: m.id,
            durationMinutes: l.duration_minutes || 0
          }
        });
      }
    }
  }

  // 2. Libros
  for (const b of entities.books || []) {
    const bookHeader = `Libro: ${b.title}. Autor: ${b.author || 'Desconocido'}. Categoría: ${b.category || 'General'}. Progreso: ${b.reading_percentage ?? 0}%.`;
    const bookBody = (b.description || '').trim();
    const bookText = bookBody ? `${bookHeader} ${bookBody}` : bookHeader;

    docs.push({
      id: `book_${b.id}`,
      sourceType: 'book',
      sourceId: b.id,
      resourceId: b.id,
      title: b.title,
      headerText: bookHeader,
      bodyText: bookBody,
      text: bookText,
      path: [b.title],
      substantive: Boolean(bookBody),
      contentHash: sha256Hex(bookText),
      metadata: {
        author: b.author || null,
        category: b.category || 'General',
        readingPercentage: b.reading_percentage ?? 0
      }
    });
  }

  // 3. Notas
  for (const n of entities.notes || []) {
    const noteHeader = `Nota: ${n.title}.`;
    const noteBody = (n.content || '').trim();
    const noteText = noteBody ? `${noteHeader} ${noteBody}` : noteHeader;
    const page = extractPageFromTags(n.tags);

    docs.push({
      id: `note_${n.id}`,
      sourceType: 'note',
      sourceId: n.id,
      resourceId: n.resource_id || undefined,
      lessonId: n.lesson_id || undefined,
      title: n.title,
      headerText: noteHeader,
      bodyText: noteBody,
      text: noteText,
      page,
      substantive: Boolean(noteBody),
      contentHash: sha256Hex(noteText),
      metadata: {
        tags: n.tags || null
      }
    });
  }

  // 4. Flashcards
  for (const f of entities.flashcards || []) {
    const fcHeader = 'Tarjeta mnemotécnica.';
    const fcBody = `Pregunta: ${f.front}. Respuesta: ${f.back}`.trim();
    const fcText = `${fcHeader} ${fcBody}`;

    docs.push({
      id: `flashcard_${f.id}`,
      sourceType: 'flashcard',
      sourceId: f.id,
      resourceId: f.resource_id || undefined,
      lessonId: f.lesson_id || undefined,
      title: `Flashcard: ${f.front}`,
      headerText: fcHeader,
      bodyText: fcBody,
      text: fcText,
      substantive: true,
      contentHash: sha256Hex(fcText)
    });
  }

  // 5. Conceptos
  for (const con of entities.concepts || []) {
    const conceptHeader = `Concepto: ${con.name}.`;
    const conceptBody = (con.description || '').trim();
    const conceptText = conceptBody ? `${conceptHeader} ${conceptBody}` : conceptHeader;

    docs.push({
      id: `concept_${con.id}`,
      sourceType: 'concept',
      sourceId: con.id,
      title: con.name,
      headerText: conceptHeader,
      bodyText: conceptBody,
      text: conceptText,
      substantive: Boolean(conceptBody),
      contentHash: sha256Hex(conceptText)
    });
  }

  // 6. Trabajo Práctico
  for (const pw of entities.practiceWork || []) {
    const practiceHeader = `Trabajo práctico: ${pw.title}. Tipo: ${pw.kind || 'exercise'}.`;
    const bodyParts = [pw.description, pw.content, pw.notes]
      .map(v => (v || '').trim())
      .filter(Boolean);
    const practiceBody = bodyParts.join('\n\n');
    const practiceText = practiceBody ? `${practiceHeader} ${practiceBody}` : practiceHeader;

    docs.push({
      id: `practice_${pw.id}`,
      sourceType: 'practice',
      sourceId: pw.id,
      resourceId: pw.resource_id || undefined,
      lessonId: pw.lesson_id || undefined,
      title: pw.title,
      headerText: practiceHeader,
      bodyText: practiceBody,
      text: practiceText,
      substantive: Boolean(practiceBody),
      contentHash: sha256Hex(practiceText),
      metadata: {
        kind: pw.kind || 'exercise'
      }
    });
  }

  return docs;
}

/**
 * Versión asíncrona con cálculo de digest SHA-256 criptográfico validado.
 */
export async function domainEntitiesToKnowledgeDocumentsAsync(entities: DomainKnowledgeEntities): Promise<KnowledgeDocument[]> {
  const syncDocs = domainEntitiesToKnowledgeDocuments(entities);
  return Promise.all(
    syncDocs.map(async (doc) => ({
      ...doc,
      contentHash: await computeSha256ContentHash(doc.text)
    }))
  );
}
