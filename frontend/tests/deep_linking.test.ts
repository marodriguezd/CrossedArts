import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseUrlState, serializeUrlState } from '../src/services/deepLinking.ts';

describe('Deep Linking & URL State Serialization/Parsing', () => {
  it('defaults to dashboard when hash is empty or invalid', () => {
    assert.deepEqual(parseUrlState(''), {
      tab: 'dashboard',
      courseId: null,
      lessonId: null,
      resourceId: null,
      noteId: null,
      goalId: null,
      studyResourceId: null,
      studyLessonId: null,
      studyMode: null,
    });

    const parsedInvalid = parseUrlState('#tab=non_existent_tab');
    assert.equal(parsedInvalid.tab, 'dashboard');
  });

  it('accepts the canonical "focus" tab so the Hoy view is deep-linkable', () => {
    assert.equal(parseUrlState('#tab=focus').tab, 'focus');
    assert.equal(parseUrlState('?tab=focus').tab, 'focus');
  });

  it('normalizes the legacy "today" alias to the rendered "focus" tab', () => {
    // `today` ya no es un tab renderizado: enlazarlo sin normalizar dejaba la
    // región principal vacía. Debe resolver a `focus`, nunca a un tab muerto.
    assert.equal(parseUrlState('#tab=today').tab, 'focus');
  });

  it('serializes the Hoy view with the canonical focus id', () => {
    const serialized = serializeUrlState({
      tab: 'focus',
      courseId: null,
      lessonId: null,
      resourceId: null,
      noteId: null,
      goalId: null,
      studyResourceId: null,
      studyLessonId: null,
      studyMode: null,
    });
    assert.equal(serialized, '#tab=focus');
    assert.equal(parseUrlState(serialized).tab, 'focus');
  });

  it('parses tabs and entity IDs correctly from hash', () => {
    const hash = '#tab=course_detail&courseId=course-123&lessonId=lesson-456';
    const state = parseUrlState(hash);
    assert.equal(state.tab, 'course_detail');
    assert.equal(state.courseId, 'course-123');
    assert.equal(state.lessonId, 'lesson-456');
    assert.equal(state.resourceId, null);
  });

  it('parses study mode and session parameters', () => {
    const hash = '#tab=review&studyResourceId=res-1&studyMode=flashcards';
    const state = parseUrlState(hash);
    assert.equal(state.tab, 'review');
    assert.equal(state.studyResourceId, 'res-1');
    assert.equal(state.studyMode, 'flashcards');
  });

  it('serializes state back to URL hash string round-trip', () => {
    const original = {
      tab: 'notes',
      noteId: 'note-abc',
      courseId: null,
      lessonId: null,
      resourceId: null,
      goalId: null,
      studyResourceId: null,
      studyLessonId: null,
      studyMode: null,
    };

    const serialized = serializeUrlState(original);
    assert.equal(serialized, '#tab=notes&noteId=note-abc');

    const parsed = parseUrlState(serialized);
    assert.equal(parsed.tab, 'notes');
    assert.equal(parsed.noteId, 'note-abc');
  });

  it('serializes default dashboard with no query params as empty hash', () => {
    const original = {
      tab: 'dashboard',
      courseId: null,
      lessonId: null,
      resourceId: null,
      noteId: null,
      goalId: null,
      studyResourceId: null,
      studyLessonId: null,
      studyMode: null,
    };

    const serialized = serializeUrlState(original);
    assert.equal(serialized, '');
  });
});
