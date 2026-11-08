/**
 * Flashcards: deck queries, spaced repetition (SM-2) review persistence, CRUD operations.
 */
import { dbBridge } from '../sqliteBridge.ts';
import type { Flashcard, FlashcardType } from '../../types/models.ts';
import { calculateSM2, type SM2Result } from '../../services/sm2.ts';
import { mapFlashcardRow } from './sqlRows.ts';
import { translateKey } from '../../i18n/dictionaries.ts';
import { daoLang } from '../daoLanguage.ts';
import { applyStudyFlashcardReviewIncrement } from './sessions.ts';

/**
 * SM-2 write without persisting.
 *
 * The single place that applies a grade to a card. Called by
 * `reviewFlashcardSM2` (own write) and by the compound review (one write for
 * card + session counter). Returns `null` when the card does not exist.
 */
export function applySm2Review(
  db: ReturnType<typeof dbBridge.getDatabase>,
  id: string,
  grade: number
): SM2Result | null {
  const res = db.exec(
    'SELECT repetition_count, interval_days, ease_factor FROM flashcard WHERE id = ?',
    [id]
  );
  if (!res.length || !res[0].values.length) return null;
  const [reps, interval, ease] = res[0].values[0] as [number, number, number];

  const updated = calculateSM2(
    { repetitionCount: reps, intervalDays: interval, easeFactor: ease },
    grade
  );

  db.run(
    `UPDATE flashcard 
     SET repetition_count = ?, 
         interval_days = ?, 
         ease_factor = ?, 
         due_date = datetime('now', ?),
         last_reviewed = datetime('now')
     WHERE id = ?`,
    [updated.repetitionCount, updated.intervalDays, updated.easeFactor, updated.intervalModifier, id]
  );
  return updated;
}

export const flashcardDao = {
  async getDueFlashcards(resourceId?: string): Promise<Flashcard[]> {
    const db = dbBridge.getDatabase();
    const base = `SELECT id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date, last_reviewed, lesson_id, card_type, extra_data
      FROM flashcard WHERE datetime(due_date) <= datetime('now')`;
    const res = resourceId
      ? db.exec(`${base} AND resource_id = ? ORDER BY datetime(due_date) ASC, id ASC`, [resourceId])
      : db.exec(`${base} ORDER BY datetime(due_date) ASC, id ASC`);
    if (!res.length) return [];
    return res[0].values.map(mapFlashcardRow);
  },
  async getFlashcards(): Promise<Flashcard[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date, last_reviewed, lesson_id, card_type, extra_data FROM flashcard');
    if (!res.length) return [];
    return res[0].values.map(mapFlashcardRow);
  },
  async reviewFlashcardSM2(id: string, grade: number): Promise<SM2Result | null> {
    const db = dbBridge.getDatabase();
    const updated = applySm2Review(db, id, grade);
    if (!updated) return null;
    await dbBridge.persist();
    return updated;
  },
  /**
   * Grades a card AND counts it in the study session, with ONE snapshot write.
   *
   * Previously the review center called `reviewFlashcardSM2` and then
   * `recordStudyFlashcardReview`, so every graded card exported the whole
   * database twice. Both statements are applied in memory and persisted once.
   * `sessionUpdated` reports whether the counter actually advanced (a session
   * that is no longer active is not an error).
   */
  async reviewFlashcardInSession(
    id: string,
    grade: number,
    sessionId: string | null
  ): Promise<{ result: SM2Result | null; sessionUpdated: boolean }> {
    const db = dbBridge.getDatabase();
    const result = applySm2Review(db, id, grade);
    if (!result) return { result: null, sessionUpdated: false };

    // An inactive/absent session must not keep an otherwise valid review from
    // being persisted.
    const sessionUpdated = sessionId ? applyStudyFlashcardReviewIncrement(db, sessionId) : false;

    await dbBridge.persist();
    return { result, sessionUpdated };
  },
  /**
   * Drops the duplicated bitmap from legacy image-occlusion cards.
   *
   * Old cards stored the data URL BOTH in `media_asset` and in
   * `flashcard.extra_data.imageUrl`, so every image was written twice. The card
   * keeps `imageId`, which the viewer resolves; `imageUrl` is only removed when
   * the referenced asset still exists, so no image is ever lost.
   *
   * @returns how many cards were cleaned (0 is the normal case: nothing to do).
   */
  async pruneDuplicateOcclusionImageUrls(): Promise<number> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      `SELECT id, extra_data FROM flashcard
       WHERE card_type = 'image_occlusion' AND extra_data IS NOT NULL AND extra_data LIKE '%imageUrl%'`
    );
    if (!res.length || !res[0].values.length) return 0;

    const updates: Array<{ id: string; data: string }> = [];
    for (const row of res[0].values as [string, string][]) {
      const id = String(row[0]);
      const raw = String(row[1] ?? '');
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue; // JSON ajeno o corrupto: no se toca
      }
      if (!parsed || typeof parsed !== 'object') continue;
      if (typeof parsed.imageId !== 'string' || !parsed.imageId) continue;
      if (typeof parsed.imageUrl !== 'string') continue;

      const asset = db.exec('SELECT 1 FROM media_asset WHERE id = ?', [parsed.imageId]);
      if (!asset.length || !asset[0].values.length) continue;

      delete parsed.imageUrl;
      updates.push({ id, data: JSON.stringify(parsed) });
    }

    if (!updates.length) return 0;
    for (const update of updates) {
      db.run('UPDATE flashcard SET extra_data = ? WHERE id = ?', [update.data, update.id]);
    }
    await dbBridge.persist();
    return updates.length;
  },
  async getFlashcardsForLesson(lessonId: string): Promise<Flashcard[]> {
    const db = dbBridge.getDatabase();
    // Same column order as every other flashcard read, so ONE mapper reads them.
    const res = db.exec(
      `SELECT id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date, last_reviewed, lesson_id, card_type, extra_data
       FROM flashcard
       WHERE lesson_id = ?
       ORDER BY rowid DESC`,
      [lessonId]
    );
    if (!res.length || !res[0].values.length) return [];
    return res[0].values.map(mapFlashcardRow);
  },
  async createFlashcard(card: { resource_id?: string; lesson_id?: string; front: string; back: string; card_type?: FlashcardType; extra_data?: string | null }): Promise<{ success: boolean; id?: string; error?: string }> {
    const front = card.front.trim();
    const back = card.back.trim();
    if (!front || !back) {
      return { success: false, error: translateKey(daoLang(), 'dao.err.cardsBoth') };
    }
    const db = dbBridge.getDatabase();
    const id = `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.run(
      `INSERT INTO flashcard (id, resource_id, lesson_id, front, back, card_type, extra_data, repetition_count, interval_days, ease_factor, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 2.5, datetime('now'))`,
      [id, card.resource_id || null, card.lesson_id || null, front, back, card.card_type || 'standard', card.extra_data || null]
    );
    await dbBridge.persist();
    return { success: true, id };
  },
  async updateFlashcard(id: string, updates: { front?: string; back?: string; card_type?: FlashcardType; extra_data?: string | null }): Promise<{ success: boolean; error?: string }> {
    const db = dbBridge.getDatabase();
    const clauses: string[] = [];
    const params: any[] = [];
    if (updates.front !== undefined) {
      const f = updates.front.trim();
      if (!f) return { success: false, error: translateKey(daoLang(), 'dao.err.cardsFront') };
      clauses.push('front = ?');
      params.push(f);
    }
    if (updates.back !== undefined) {
      const b = updates.back.trim();
      if (!b) return { success: false, error: translateKey(daoLang(), 'dao.err.cardsBack') };
      clauses.push('back = ?');
      params.push(b);
    }
    if (updates.card_type !== undefined) {
      clauses.push('card_type = ?');
      params.push(updates.card_type);
    }
    if (updates.extra_data !== undefined) {
      clauses.push('extra_data = ?');
      params.push(updates.extra_data);
    }
    if (clauses.length === 0) return { success: true };
    params.push(id);
    db.run(`UPDATE flashcard SET ${clauses.join(', ')} WHERE id = ?`, params);
    await dbBridge.persist();
    return { success: true };
  },
  async deleteFlashcard(id: string): Promise<{ success: boolean; error?: string }> {
    const db = dbBridge.getDatabase();
    db.run('DELETE FROM flashcard WHERE id = ?', [id]);
    await dbBridge.persist();
    return { success: true };
  },
  async createFlashcards(cards: Array<{ resource_id?: string; lesson_id?: string; front: string; back: string; card_type?: FlashcardType; extra_data?: string | null }>): Promise<string[]> {
    if (!cards || cards.length === 0) return [];
    const db = dbBridge.getDatabase();
    const insertedIds: string[] = [];

    for (const card of cards) {
      const id = `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.run(
        `INSERT INTO flashcard (id, resource_id, lesson_id, front, back, card_type, extra_data, repetition_count, interval_days, ease_factor, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 2.5, datetime('now'))`,
        [id, card.resource_id || null, card.lesson_id || null, card.front, card.back, card.card_type || 'standard', card.extra_data || null]
      );
      insertedIds.push(id);
    }

    await dbBridge.persist();
    return insertedIds;
  }
};
