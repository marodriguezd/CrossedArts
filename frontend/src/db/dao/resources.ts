/**
 * Resources: learning resources, books, document ingestion, media assets, unorganized assets.
 */
import { dbBridge } from '../sqliteBridge.ts';
import type {
  Book,
  LearningResource,
  MediaAsset,
  ResourceDetail,
  ResourceFragment,
  ResourceKind,
  UnorganizedResource
} from '../../types/models.ts';
import { mapBookRow, mapResourceFragmentRow } from './sqlRows.ts';
import { calculateBookProgress } from '../../services/domainLogic.ts';
import { translateKey } from '../../i18n/dictionaries.ts';
import { daoLang } from '../daoLanguage.ts';
import { deriveNoteTitle, TITLE_MAX_LENGTH, noteDao } from './notes.ts';
import { courseDao } from './courses.ts';
import { flashcardDao } from './flashcards.ts';
import { graphDao } from './graph.ts';
import { practiceWorkDao } from './practiceWork.ts';

export const resourceDao = {
  async getBooks(): Promise<Book[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT r.id, r.title, r.description, r.cover_path, r.category, r.status, r.source_path, r.type,
             b.author, b.isbn, b.page_count, b.current_page, b.reading_percentage
      FROM learning_resource r
      JOIN book b ON r.id = b.id
      ORDER BY r.created_at DESC
    `);
    if (!res.length) return [];
    return res[0].values.map(mapBookRow);
  },
  async getBookById(id: string): Promise<Book | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT r.id, r.title, r.description, r.cover_path, r.category, r.status, r.source_path, r.type,
             b.author, b.isbn, b.page_count, b.current_page, b.reading_percentage
      FROM learning_resource r JOIN book b ON r.id = b.id WHERE r.id = ?`, [id]);
    if (!res.length || !res[0].values.length) return null;
    return mapBookRow(res[0].values[0]);
  },
  async getLearningResources(): Promise<LearningResource[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT id, title, description, cover_path, category, status, source_path, type, created_at, updated_at
      FROM learning_resource
      ORDER BY created_at DESC
    `);
    if (!res.length) return [];
    return res[0].values.map((row: any[]) => ({
      id: row[0],
      title: row[1],
      description: row[2],
      cover_path: row[3],
      category: row[4],
      status: row[5],
      source_path: row[6],
      type: row[7],
      created_at: row[8],
      updated_at: row[9]
    }));
  },
  async getResourceSourceMeta(resourceId: string): Promise<{
    resource: LearningResource | null;
    sourceType: string;
    fileName?: string;
    fingerprint?: string;
    sectionCount: number;
    notesCount: number;
  }> {
    const db = dbBridge.getDatabase();
    const rRes = db.exec('SELECT id, title, description, cover_path, category, status, source_path, type, created_at FROM learning_resource WHERE id = ?', [resourceId]);
    if (!rRes.length || !rRes[0].values.length) {
      return { resource: null, sourceType: 'unknown', sectionCount: 0, notesCount: 0 };
    }
    const rRow = rRes[0].values[0];
    const resource: LearningResource = {
      id: String(rRow[0]),
      title: String(rRow[1]),
      description: rRow[2] ? String(rRow[2]) : undefined,
      cover_path: rRow[3] ? String(rRow[3]) : undefined,
      category: String(rRow[4]),
      status: (rRow[5] as any) || 'NOT_STARTED',
      source_path: rRow[6] ? String(rRow[6]) : undefined,
      type: (rRow[7] as any) || 'learning_resource',
      created_at: rRow[8] ? String(rRow[8]) : undefined
    };

    let fileName: string | undefined = undefined;
    let fingerprint: string | undefined = undefined;
    let sourceType: string = resource.type;

    if (resource.source_path?.startsWith('local://')) {
      const match = resource.source_path.match(/local:\/\/([^#]+)(?:#sha256=(.+))?/);
      if (match) {
        fileName = match[1];
        fingerprint = match[2];
        const ext = fileName.split('.').pop()?.toUpperCase() || 'DOCUMENT';
        sourceType = ext;
      }
    }

    const notesRes = db.exec('SELECT COUNT(*) FROM note WHERE resource_id = ?', [resourceId]);
    const notesCount = notesRes.length ? (notesRes[0].values[0][0] as number) : 0;

    return {
      resource,
      sourceType,
      fileName,
      fingerprint,
      sectionCount: notesCount,
      notesCount
    };
  },
  async updateBookProgress(id: string, currentPage: number, totalPages: number): Promise<{ success: boolean; error?: string }> {
    const calc = calculateBookProgress(currentPage, totalPages);
    if (!calc.valid) {
      return { success: false, error: calc.error };
    }

    const { clampedPage, percentage, status } = calc.data;
    const db = dbBridge.getDatabase();
    db.run(
      'UPDATE book SET current_page = ?, reading_percentage = ? WHERE id = ?',
      [clampedPage, percentage, id]
    );
    db.run(
      'UPDATE learning_resource SET status = ? WHERE id = ?',
      [status, id]
    );
    await dbBridge.persist();
    return { success: true };
  },
  async updateBookDetails(id: string, fields: { title?: string; description?: string; category?: string; author?: string; isbn?: string; pageCount?: number }): Promise<{ success: boolean; error?: string }> {
    const db = dbBridge.getDatabase();
    if (fields.pageCount !== undefined && (typeof fields.pageCount !== 'number' || fields.pageCount <= 0)) {
      return { success: false, error: translateKey(daoLang(), 'dao.err.pagesPositive') };
    }

    if (fields.title !== undefined || fields.description !== undefined || fields.category !== undefined) {
      db.run(
        `UPDATE learning_resource SET title = COALESCE(?, title), description = COALESCE(?, description), category = COALESCE(?, category), updated_at = datetime('now') WHERE id = ?`,
        [fields.title ?? null, fields.description ?? null, fields.category ?? null, id]
      );
    }

    db.run(
      `UPDATE book SET author = COALESCE(?, author), isbn = COALESCE(?, isbn), page_count = COALESCE(?, page_count) WHERE id = ?`,
      [fields.author ?? null, fields.isbn ?? null, fields.pageCount ?? null, id]
    );

    // On page-count change the WHOLE reading state is recomputed with the same
    // pure calculator `updateBookProgress` uses.
    if (fields.pageCount !== undefined) {
      const row = db.exec('SELECT current_page FROM book WHERE id = ?', [id]);
      if (row.length && row[0].values.length) {
        const current = Number(row[0].values[0][0]) || 0;
        const calc = calculateBookProgress(current, fields.pageCount, daoLang());
        if (calc.valid) {
          db.run('UPDATE book SET current_page = ?, reading_percentage = ? WHERE id = ?', [
            calc.data.clampedPage,
            calc.data.percentage,
            id
          ]);
          db.run("UPDATE learning_resource SET status = ? WHERE id = ?", [calc.data.status, id]);
        }
      }
    }

    await dbBridge.persist();
    return { success: true };
  },
  async saveMediaAsset(asset: { id?: string; mime_type: string; data: string }): Promise<string> {
    const db = dbBridge.getDatabase();
    const id = asset.id || `asset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.run(
      `INSERT OR REPLACE INTO media_asset (id, mime_type, data, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, asset.mime_type, asset.data]
    );
    await dbBridge.persist();
    return id;
  },
  async getMediaAsset(id: string): Promise<MediaAsset | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, mime_type, data, created_at FROM media_asset WHERE id = ?', [id]);
    if (!res.length || !res[0].values.length) return null;
    const [assetId, mime, data, createdAt] = res[0].values[0];
    return {
      id: String(assetId),
      mime_type: String(mime),
      data: String(data),
      created_at: String(createdAt)
    };
  },
  async getUnorganizedResources(): Promise<UnorganizedResource[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT r.id, r.title, r.description, r.cover_path, r.category, r.status, r.source_path, r.type, r.created_at,
             (SELECT COUNT(*) FROM note n WHERE n.resource_id = r.id) AS note_count,
             (SELECT COUNT(*) FROM knowledge_connection kc WHERE kc.source_id = r.id OR kc.target_id = r.id) AS conn_count
      FROM learning_resource r
      WHERE r.type = 'learning_resource'
        AND (SELECT COUNT(*) FROM knowledge_connection kc WHERE kc.source_id = r.id OR kc.target_id = r.id) = 0
      ORDER BY r.created_at DESC
    `);
    if (!res.length) return [];
    return res[0].values.map((row: any[]) => ({
      resource: {
        id: String(row[0]),
        title: String(row[1]),
        description: row[2] ? String(row[2]) : undefined,
        cover_path: row[3] ? String(row[3]) : undefined,
        category: String(row[4] || 'General'),
        status: (row[5] as any) || 'NOT_STARTED',
        source_path: row[6] ? String(row[6]) : undefined,
        type: 'learning_resource',
        created_at: row[8] ? String(row[8]) : undefined
      },
      noteCount: Number(row[9]) || 0,
      connectionCount: Number(row[10]) || 0
    }));
  },
  async resolveNodeKind(id: string): Promise<ResourceKind | null> {
    const db = dbBridge.getDatabase();
    const concept = db.exec('SELECT 1 FROM concept WHERE id = ?', [id]);
    if (concept.length && concept[0].values.length) return 'concept';

    const lr = db.exec('SELECT type FROM learning_resource WHERE id = ?', [id]);
    if (lr.length && lr[0].values.length) {
      const type = String(lr[0].values[0][0]);
      return type === 'course' ? 'course' : type === 'book' ? 'book' : 'resource';
    }

    const lesson = db.exec('SELECT 1 FROM lesson WHERE id = ?', [id]);
    if (lesson.length && lesson[0].values.length) return 'lesson';

    const note = db.exec('SELECT 1 FROM note WHERE id = ?', [id]);
    if (note.length && note[0].values.length) return 'note';

    const mod = db.exec('SELECT 1 FROM module WHERE id = ?', [id]);
    if (mod.length && mod[0].values.length) return 'module';

    return null;
  },
  async getResourceDetail(resourceId: string): Promise<ResourceDetail | null> {
    const db = dbBridge.getDatabase();

    const kind = await resourceDao.resolveNodeKind(resourceId);
    if (!kind || kind === 'lesson' || kind === 'note' || kind === 'module') return null;

    if (kind === 'concept') {
      const concept = await graphDao.getConceptById(resourceId);
      if (!concept) return null;
      return {
        resource: { id: concept.id, title: concept.name, description: concept.description, category: 'Concepto', status: 'NOT_STARTED', type: 'learning_resource' },
        kind: 'concept',
        fragments: [],
        related: await graphDao.getRelatedKnowledge(resourceId)
      };
    }

    const meta = await resourceDao.getResourceSourceMeta(resourceId);
    if (!meta.resource) return null;

    const book = kind === 'book' ? await resourceDao.getBookById(resourceId) || undefined : undefined;

    const fragRes = db.exec('SELECT id, title, content, tags, created_at FROM note WHERE resource_id = ? ORDER BY created_at ASC, title ASC', [resourceId]);
    const fragments: ResourceFragment[] = fragRes.length ? fragRes[0].values.map(mapResourceFragmentRow) : [];

    const hasSource = meta.sourceType && meta.sourceType !== 'learning_resource' && meta.sourceType !== 'book';
    return {
      resource: meta.resource,
      kind,
      book,
      source: hasSource || meta.fileName ? {
        sourceType: meta.sourceType,
        fileName: meta.fileName,
        fingerprint: meta.fingerprint,
        sectionCount: meta.sectionCount
      } : undefined,
      fragments,
      related: await graphDao.getRelatedKnowledge(resourceId)
    };
  },
  async getAllLearningResources() {
    const [coursesWithModules, books, notes, flashcards, graph, practiceWork] = await Promise.all([
      courseDao.getCoursesWithModules(),
      resourceDao.getBooks(),
      noteDao.getNotes(),
      flashcardDao.getFlashcards(),
      graphDao.getKnowledgeGraph(),
      practiceWorkDao.getAllPracticeWork()
    ]);

    return {
      courses: coursesWithModules,
      books,
      notes,
      flashcards,
      concepts: graph.nodes,
      // Practice work belongs to the indexable corpus: same path as every other
      // source, no second indexing abstraction.
      practiceWork
    };
  },
  async importDocument(params: {
    title: string;
    author?: string;
    fileType: 'txt' | 'md' | 'pdf' | 'epub';
    fileName: string;
    fingerprint: string;
    category?: string;
    pageCount?: number;
    sections: Array<{ title?: string; page?: number; chapter?: string; content: string }>;
    importAsBook?: boolean;
    destination?: {
      type: 'standalone' | 'course' | 'module' | 'lesson' | 'book';
      targetId?: string;
      targetTitle?: string;
    };
  }): Promise<string> {
    const db = dbBridge.getDatabase();
    const resourceId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const category = params.category || (params.importAsBook ? 'Lecturas' : 'Documentos');
    const sourcePath = `local://${params.fileName}#sha256=${params.fingerprint}`;
    const destination = params.destination || { type: params.importAsBook ? 'book' : 'standalone' };

    // Resolve target resource_id and lesson_id for created notes
    let linkedResourceId: string | null = null;
    let linkedLessonId: string | null = null;

    if (destination.type === 'lesson' && destination.targetId) {
      linkedLessonId = destination.targetId;
      // Look up the lesson's resource_id.
      const lesRow = db.exec(`
        SELECT m.course_id FROM lesson l
        JOIN module m ON l.module_id = m.id
        WHERE l.id = ?
      `, [destination.targetId]);
      if (lesRow.length && lesRow[0].values.length) {
        linkedResourceId = lesRow[0].values[0][0] as string;
      }
    } else if (destination.type === 'course' && destination.targetId) {
      linkedResourceId = destination.targetId;
    } else if (destination.type === 'book' && destination.targetId) {
      linkedResourceId = destination.targetId;
    } else {
      // Standalone or new book: always register as the canonical learning_resource.
      linkedResourceId = resourceId;
      const resourceType = params.importAsBook ? 'book' : 'learning_resource';

      db.run(
        `INSERT INTO learning_resource (id, title, description, category, status, source_path, type)
         VALUES (?, ?, ?, ?, 'NOT_STARTED', ?, ?)`,
        [
          resourceId,
          params.title,
          `Documento importado localmente: ${params.fileName} (${params.fileType.toUpperCase()})`,
          category,
          sourcePath,
          resourceType
        ]
      );

      if (params.importAsBook) {
        const pageCount = params.pageCount || params.sections.length || 1;
        db.run(
          `INSERT INTO book (id, author, page_count, current_page, reading_percentage)
           VALUES (?, ?, ?, 0, 0.0)`,
          [
            resourceId,
            params.author || 'Autor local',
            pageCount
          ]
        );
      }
    }

    for (let i = 0; i < params.sections.length; i++) {
      const sec = params.sections[i];
      const noteId = `note-${resourceId}-${i + 1}`;
      const candidateTitle = (
        sec.title ||
        (sec.chapter ? `${params.title} · ${sec.chapter}` : `${params.title} (pág. ${sec.page || i + 1})`)
      )?.trim();
      const noteTitle =
        candidateTitle?.slice(0, TITLE_MAX_LENGTH) ||
        deriveNoteTitle(sec.content, translateKey(daoLang(), 'dao.note.defaultTitle'));
      const tags = `documento,${params.fileType},sha256:${params.fingerprint}${sec.page ? `,pág:${sec.page}` : ''}${destination.type !== 'standalone' ? `,asociado:${destination.type}` : ''}`;
      
      db.run(
        `INSERT INTO note (id, resource_id, lesson_id, title, content, tags)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          noteId,
          linkedResourceId,
          linkedLessonId,
          noteTitle,
          sec.content,
          tags
        ]
      );
    }

    await dbBridge.persist();
    return resourceId;
  }
};
