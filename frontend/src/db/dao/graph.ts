/**
 * Knowledge Graph: nodes, connections, traversal, pruning, related knowledge.
 */
import { dbBridge } from '../sqliteBridge.ts';
import type {
  ConceptEdge,
  ConceptNode,
  GraphNodeType,
  KnowledgeConnection,
  RelatedKnowledgeItem
} from '../../types/models.ts';
import { validateKnowledgeConnection } from '../../services/domainLogic.ts';
import { translateKey } from '../../i18n/dictionaries.ts';
import { daoLang } from '../daoLanguage.ts';

export const graphDao = {
  async getKnowledgeGraph(): Promise<{ nodes: ConceptNode[]; edges: ConceptEdge[] }> {
    const db = dbBridge.getDatabase();
    const nodes: ConceptNode[] = [];
    const byId = new Map<string, ConceptNode>();

    const addNode = (node: ConceptNode) => {
      if (byId.has(node.id)) return;
      byId.set(node.id, node);
      nodes.push(node);
    };

    // Concepts
    const conceptRes = db.exec('SELECT id, name, description FROM concept');
    if (conceptRes.length) {
      for (const r of conceptRes[0].values) {
        addNode({ id: String(r[0]), name: String(r[1]), description: r[2] ? String(r[2]) : undefined, node_type: 'concept', meta: {} });
      }
    }

    // Learning resources (course / book / resource)
    const resRes = db.exec('SELECT id, title, description, type, category, status, source_path, created_at, updated_at FROM learning_resource');
    if (resRes.length) {
      for (const r of resRes[0].values) {
        const rawType = String(r[3]);
        const nodeType: GraphNodeType = rawType === 'course' ? 'course' : rawType === 'book' ? 'book' : 'resource';
        addNode({
          id: String(r[0]),
          name: String(r[1]),
          description: r[2] ? String(r[2]) : undefined,
          node_type: nodeType,
          meta: {
            category: r[4] ? String(r[4]) : undefined,
            status: r[5] ? String(r[5]) : undefined,
            source_path: r[6] ? String(r[6]) : undefined,
            created_at: r[7] ? String(r[7]) : undefined,
            updated_at: r[8] ? String(r[8]) : undefined
          }
        });
      }
    }

    const courseRes = db.exec('SELECT id, instructor, difficulty, total_lessons FROM course');
    if (courseRes.length) {
      for (const r of courseRes[0].values) {
        const node = byId.get(String(r[0]));
        if (node) node.meta = { ...node.meta, instructor: r[1] ? String(r[1]) : undefined, difficulty: r[2] ? String(r[2]) : undefined, total_lessons: Number(r[3]) || 0 };
      }
    }

    const bookRes = db.exec('SELECT id, author, page_count, current_page, reading_percentage FROM book');
    if (bookRes.length) {
      for (const r of bookRes[0].values) {
        const node = byId.get(String(r[0]));
        if (node) node.meta = { ...node.meta, author: r[1] ? String(r[1]) : undefined, page_count: Number(r[2]) || 0, current_page: Number(r[3]) || 0, reading_percentage: Number(r[4]) || 0 };
      }
    }

    // Modules
    const modRes = db.exec('SELECT id, course_id, title, order_index FROM module');
    if (modRes.length) {
      for (const r of modRes[0].values) {
        addNode({ id: String(r[0]), name: String(r[2]), node_type: 'module', meta: { course_id: String(r[1]), order_index: Number(r[3]) || 0 } });
      }
    }

    // Lecciones
    const lesRes = db.exec('SELECT l.id, l.module_id, l.title, l.duration_minutes, l.lesson_type, m.course_id FROM lesson l JOIN module m ON l.module_id = m.id');
    if (lesRes.length) {
      for (const r of lesRes[0].values) {
        addNode({
          id: String(r[0]),
          name: String(r[2]),
          node_type: 'lesson',
          meta: { module_id: String(r[1]), course_id: String(r[5]), duration_minutes: Number(r[3]) || 0, lesson_type: r[4] ? String(r[4]) : undefined }
        });
      }
    }

    // Notas
    const noteRes = db.exec('SELECT id, resource_id, lesson_id, title, tags, created_at, updated_at FROM note');
    if (noteRes.length) {
      for (const r of noteRes[0].values) {
        addNode({
          id: String(r[0]),
          name: String(r[3]),
          node_type: 'note',
          meta: { resource_id: r[1] ? String(r[1]) : undefined, lesson_id: r[2] ? String(r[2]) : undefined, tags: r[4] ? String(r[4]) : undefined, created_at: r[5] ? String(r[5]) : undefined, updated_at: r[6] ? String(r[6]) : undefined }
        });
      }
    }

    // Practice work: student-produced evidence.
    const practiceRes = db.exec(
      'SELECT id, title, resource_id, lesson_id, concept_id, kind, status, created_at, updated_at FROM practice_work'
    );
    if (practiceRes.length) {
      for (const r of practiceRes[0].values) {
        addNode({
          id: String(r[0]),
          name: String(r[1]),
          node_type: 'practice',
          meta: {
            resource_id: r[2] ? String(r[2]) : undefined,
            lesson_id: r[3] ? String(r[3]) : undefined,
            concept_id: r[4] ? String(r[4]) : undefined,
            practice_kind: r[5] ? String(r[5]) : undefined,
            status: r[6] ? String(r[6]) : undefined,
            created_at: r[7] ? String(r[7]) : undefined,
            updated_at: r[8] ? String(r[8]) : undefined
          }
        });
      }
    }

    const edges: ConceptEdge[] = [];

    // Structural edges derived from foreign keys (read-only).
    if (modRes.length) {
      for (const r of modRes[0].values) {
        const courseId = String(r[1]);
        const moduleId = String(r[0]);
        if (byId.has(courseId)) {
          edges.push({ id: `derived-contains-${moduleId}`, source_id: courseId, target_id: moduleId, connection_type: 'contains', weight: 1, derived: true });
        }
      }
    }
    if (lesRes.length) {
      for (const r of lesRes[0].values) {
        const moduleId = String(r[1]);
        const lessonId = String(r[0]);
        if (byId.has(moduleId)) {
          edges.push({ id: `derived-contains-${lessonId}`, source_id: moduleId, target_id: lessonId, connection_type: 'contains', weight: 1, derived: true });
        }
      }
    }
    if (noteRes.length) {
      for (const r of noteRes[0].values) {
        const noteId = String(r[0]);
        const resourceId = r[1] ? String(r[1]) : null;
        const lessonId = r[2] ? String(r[2]) : null;
        if (resourceId && byId.has(resourceId)) {
          edges.push({ id: `derived-about-${noteId}-${resourceId}`, source_id: noteId, target_id: resourceId, connection_type: 'about', weight: 1, derived: true });
        }
        if (lessonId && byId.has(lessonId)) {
          edges.push({ id: `derived-references-${noteId}-${lessonId}`, source_id: lessonId, target_id: noteId, connection_type: 'references', weight: 1, derived: true });
        }
      }
    }

    // Practice-work derived edges: link evidence to what it proves
    // (resource, lesson, or concept). Only when both ends exist.
    if (practiceRes.length) {
      for (const r of practiceRes[0].values) {
        const workId = String(r[0]);
        const resourceId = r[2] ? String(r[2]) : null;
        const lessonId = r[3] ? String(r[3]) : null;
        const conceptId = r[4] ? String(r[4]) : null;
        if (resourceId && byId.has(resourceId)) {
          edges.push({ id: `derived-about-${workId}-${resourceId}`, source_id: workId, target_id: resourceId, connection_type: 'about', weight: 1, derived: true });
        }
        if (lessonId && byId.has(lessonId)) {
          edges.push({ id: `derived-references-${lessonId}-${workId}`, source_id: lessonId, target_id: workId, connection_type: 'references', weight: 1, derived: true });
        }
        if (conceptId && byId.has(conceptId)) {
          edges.push({ id: `derived-about-${workId}-${conceptId}`, source_id: workId, target_id: conceptId, connection_type: 'about', weight: 1, derived: true });
        }
      }
    }

    // Explicit user connections (only when both ends exist).
    const eRes = db.exec('SELECT id, source_id, target_id, connection_type, weight FROM knowledge_connection');
    if (eRes.length) {
      for (const r of eRes[0].values) {
        const source = String(r[1]);
        const target = String(r[2]);
        if (!byId.has(source) || !byId.has(target)) continue;
        edges.push({ id: String(r[0]), source_id: source, target_id: target, connection_type: String(r[3]), weight: Number(r[4]) || 1 });
      }
    }

    return { nodes, edges };
  },
  async getKnowledgeConnections(): Promise<KnowledgeConnection[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, source_id, target_id, connection_type, weight FROM knowledge_connection');
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: String(r[0]),
      source_id: String(r[1]),
      target_id: String(r[2]),
      connection_type: String(r[3]),
      weight: Number(r[4]) || 1
    }));
  },
  async createKnowledgeConnection(input: { sourceId: string; targetId: string; relationType: string; weight?: number }): Promise<{ success: boolean; error?: string; id?: string }> {
    const graph = await graphDao.getKnowledgeGraph();
    const validation = validateKnowledgeConnection(
      { sourceId: input.sourceId, targetId: input.targetId, relationType: input.relationType },
      {
        nodeIds: graph.nodes.map(n => n.id),
        existingEdges: graph.edges.filter(e => !e.derived).map(e => ({ source_id: e.source_id, target_id: e.target_id, connection_type: e.connection_type }))
      },
      daoLang()
    );
    if (!validation.valid || !validation.relation) {
      return { success: false, error: validation.error || translateKey(daoLang(), 'dao.err.connInvalid') };
    }

    const db = dbBridge.getDatabase();
    const id = `kc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const weight = typeof input.weight === 'number' && input.weight > 0 ? input.weight : 1.0;
    db.run(
      `INSERT INTO knowledge_connection (id, source_id, target_id, connection_type, weight) VALUES (?, ?, ?, ?, ?)`,
      [id, input.sourceId, input.targetId, validation.relation, weight]
    );
    await dbBridge.persist();
    return { success: true, id };
  },
  async deleteKnowledgeConnection(id: string): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run('DELETE FROM knowledge_connection WHERE id = ?', [id]);
    await dbBridge.persist();
  },
  async pruneDanglingConnections(): Promise<number> {
    const db = dbBridge.getDatabase();
    const nodeIds = await graphDao.collectGraphNodeIds();
    const res = db.exec('SELECT id, source_id, target_id FROM knowledge_connection');
    if (!res.length) return 0;
    let removed = 0;
    for (const row of res[0].values) {
      const id = String(row[0]);
      if (!nodeIds.has(String(row[1])) || !nodeIds.has(String(row[2]))) {
        db.run('DELETE FROM knowledge_connection WHERE id = ?', [id]);
        removed++;
      }
    }
    if (removed > 0) await dbBridge.persist();
    return removed;
  },
  async getRelatedNodeIds(nodeId: string): Promise<string[]> {
    const db = dbBridge.getDatabase();
    const related = new Set<string>();
    const addAll = (res: any) => {
      if (!res.length) return;
      for (const r of res[0].values) related.add(String(r[0]));
    };

    // Explicit connections (both directions).
    addAll(db.exec('SELECT target_id FROM knowledge_connection WHERE source_id = ?', [nodeId]));
    addAll(db.exec('SELECT source_id FROM knowledge_connection WHERE target_id = ?', [nodeId]));

    addAll(db.exec('SELECT id FROM module WHERE course_id = ?', [nodeId]));
    addAll(db.exec('SELECT course_id FROM module WHERE id = ?', [nodeId]));
    addAll(db.exec('SELECT id FROM lesson WHERE module_id = ?', [nodeId]));
    addAll(db.exec('SELECT module_id FROM lesson WHERE id = ?', [nodeId]));
    addAll(db.exec('SELECT m.course_id FROM lesson l JOIN module m ON l.module_id = m.id WHERE l.id = ?', [nodeId]));
    addAll(db.exec('SELECT id FROM note WHERE resource_id = ?', [nodeId]));
    addAll(db.exec('SELECT id FROM note WHERE lesson_id = ?', [nodeId]));
    addAll(db.exec('SELECT resource_id FROM note WHERE id = ? AND resource_id IS NOT NULL', [nodeId]));
    addAll(db.exec('SELECT lesson_id FROM note WHERE id = ? AND lesson_id IS NOT NULL', [nodeId]));

    // Practice work: the artifact belongs to its resource/lesson perimeter, and
    // its own scope resolves to the parent.
    addAll(db.exec('SELECT id FROM practice_work WHERE resource_id = ?', [nodeId]));
    addAll(db.exec('SELECT id FROM practice_work WHERE lesson_id = ?', [nodeId]));
    addAll(db.exec('SELECT id FROM practice_work WHERE concept_id = ?', [nodeId]));
    addAll(db.exec('SELECT resource_id FROM practice_work WHERE id = ? AND resource_id IS NOT NULL', [nodeId]));
    addAll(db.exec('SELECT lesson_id FROM practice_work WHERE id = ? AND lesson_id IS NOT NULL', [nodeId]));
    addAll(db.exec('SELECT concept_id FROM practice_work WHERE id = ? AND concept_id IS NOT NULL', [nodeId]));

    related.delete(nodeId);
    return Array.from(related);
  },
  async collectGraphNodeIds(): Promise<Set<string>> {
    const db = dbBridge.getDatabase();
    const ids = new Set<string>();
    const collect = (sql: string) => {
      const res = db.exec(sql);
      if (!res.length) return;
      for (const r of res[0].values) ids.add(String(r[0]));
    };
    collect('SELECT id FROM concept');
    collect('SELECT id FROM learning_resource');
    collect('SELECT id FROM module');
    collect('SELECT id FROM lesson');
    collect('SELECT id FROM note');
    collect('SELECT id FROM practice_work');
    return ids;
  },
  async getConceptById(id: string): Promise<{ id: string; name: string; description?: string } | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, name, description FROM concept WHERE id = ?', [id]);
    if (!res.length || !res[0].values.length) return null;
    const r = res[0].values[0];
    return { id: String(r[0]), name: String(r[1]), description: r[2] ? String(r[2]) : undefined };
  },
  async getNodeSummaries(ids: string[]): Promise<Map<string, { title: string; type: GraphNodeType }>> {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    const map = new Map<string, { title: string; type: GraphNodeType }>();
    if (!unique.length) return map;
    const db = dbBridge.getDatabase();
    const ph = unique.map(() => '?').join(',');

    const lr = db.exec(`SELECT id, title, type FROM learning_resource WHERE id IN (${ph})`, unique);
    if (lr.length) for (const r of lr[0].values) {
      const t = String(r[2]);
      map.set(String(r[0]), { title: String(r[1]), type: t === 'course' ? 'course' : t === 'book' ? 'book' : 'resource' });
    }
    const concept = db.exec(`SELECT id, name FROM concept WHERE id IN (${ph})`, unique);
    if (concept.length) for (const r of concept[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'concept' });

    const mod = db.exec(`SELECT id, title FROM module WHERE id IN (${ph})`, unique);
    if (mod.length) for (const r of mod[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'module' });

    const les = db.exec(`SELECT id, title FROM lesson WHERE id IN (${ph})`, unique);
    if (les.length) for (const r of les[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'lesson' });

    const note = db.exec(`SELECT id, title FROM note WHERE id IN (${ph})`, unique);
    if (note.length) for (const r of note[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'note' });

    const practice = db.exec(`SELECT id, title FROM practice_work WHERE id IN (${ph})`, unique);
    if (practice.length) for (const r of practice[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'practice' });

    return map;
  },
  async getRelatedKnowledge(nodeId: string): Promise<RelatedKnowledgeItem[]> {
    const db = dbBridge.getDatabase();
    const related: RelatedKnowledgeItem[] = [];
    const seen = new Set<string>();
    const push = (counterpartId: string, relation: string, derived: boolean) => {
      if (!counterpartId || counterpartId === nodeId) return;
      const key = `${counterpartId}:${relation}`;
      if (seen.has(key)) return;
      seen.add(key);
      related.push({ id: counterpartId, title: counterpartId, type: 'resource', relation, derived });
    };

    const conn = db.exec('SELECT source_id, target_id, connection_type FROM knowledge_connection WHERE source_id = ? OR target_id = ?', [nodeId, nodeId]);
    if (conn.length) for (const r of conn[0].values) {
      const counterpart = String(r[0]) === nodeId ? String(r[1]) : String(r[0]);
      push(counterpart, String(r[2]), false);
    }

    const notesOfResource = db.exec('SELECT id FROM note WHERE resource_id = ?', [nodeId]);
    if (notesOfResource.length) for (const r of notesOfResource[0].values) push(String(r[0]), 'about', true);

    const notesOfLesson = db.exec('SELECT id FROM note WHERE lesson_id = ?', [nodeId]);
    if (notesOfLesson.length) for (const r of notesOfLesson[0].values) push(String(r[0]), 'references', true);

    // Derived structure (same as the graph): modules, lessons, course, note links.
    const modulesOfCourse = db.exec('SELECT id FROM module WHERE course_id = ?', [nodeId]);
    if (modulesOfCourse.length) for (const r of modulesOfCourse[0].values) push(String(r[0]), 'contains', true);

    const courseOfModule = db.exec('SELECT course_id FROM module WHERE id = ?', [nodeId]);
    if (courseOfModule.length) for (const r of courseOfModule[0].values) push(String(r[0]), 'contains', true);

    const lessonsOfModule = db.exec('SELECT id FROM lesson WHERE module_id = ?', [nodeId]);
    if (lessonsOfModule.length) for (const r of lessonsOfModule[0].values) push(String(r[0]), 'contains', true);

    const moduleOfLesson = db.exec('SELECT module_id FROM lesson WHERE id = ?', [nodeId]);
    if (moduleOfLesson.length) for (const r of moduleOfLesson[0].values) push(String(r[0]), 'contains', true);

    const courseOfLesson = db.exec('SELECT m.course_id FROM lesson l JOIN module m ON l.module_id = m.id WHERE l.id = ?', [nodeId]);
    if (courseOfLesson.length) for (const r of courseOfLesson[0].values) push(String(r[0]), 'contains', true);

    const noteResource = db.exec('SELECT resource_id FROM note WHERE id = ? AND resource_id IS NOT NULL', [nodeId]);
    if (noteResource.length) for (const r of noteResource[0].values) push(String(r[0]), 'about', true);

    const noteLesson = db.exec('SELECT lesson_id FROM note WHERE id = ? AND lesson_id IS NOT NULL', [nodeId]);
    if (noteLesson.length) for (const r of noteLesson[0].values) push(String(r[0]), 'references', true);

    const practiceOfResource = db.exec('SELECT id FROM practice_work WHERE resource_id = ?', [nodeId]);
    if (practiceOfResource.length) for (const r of practiceOfResource[0].values) push(String(r[0]), 'about', true);

    const practiceOfLesson = db.exec('SELECT id FROM practice_work WHERE lesson_id = ?', [nodeId]);
    if (practiceOfLesson.length) for (const r of practiceOfLesson[0].values) push(String(r[0]), 'references', true);

    const practiceOfConcept = db.exec('SELECT id FROM practice_work WHERE concept_id = ?', [nodeId]);
    if (practiceOfConcept.length) for (const r of practiceOfConcept[0].values) push(String(r[0]), 'about', true);

    const practiceContext = db.exec('SELECT resource_id, lesson_id, concept_id FROM practice_work WHERE id = ?', [nodeId]);
    if (practiceContext.length) {
      for (const r of practiceContext[0].values) {
        if (r[0]) push(String(r[0]), 'about', true);
        if (r[1]) push(String(r[1]), 'references', true);
        if (r[2]) push(String(r[2]), 'about', true);
      }
    }

    const summaries = await graphDao.getNodeSummaries(related.map(r => r.id));
    return related.map(item => {
      const s = summaries.get(item.id);
      return { ...item, title: s?.title || item.id, type: s?.type || 'resource' };
    });
  }
};
