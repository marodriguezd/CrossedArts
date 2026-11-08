/**
 * Unified, backward-compatible DAO façade (SQLite WASM).
 *
 * Domain-specific operations are extracted into dedicated submodules:
 * - dao/sessions.ts: study sessions, KPIs, daily activity, lifecycle
 * - dao/notes.ts: user notes and canonical title derivation
 * - dao/practiceWork.ts: practice projects, exercises, checklists
 * - dao/goals.ts: learning goals and date milestones
 * - dao/courses.ts: courses, modules, lessons, course packages
 * - dao/flashcards.ts: flashcards, spaced repetition (SM-2), occlusion images
 * - dao/graph.ts: concepts, connections, graph traversal, related knowledge
 * - dao/search.ts: full-text search, lookup options, indexing catalogs
 * - dao/resources.ts: learning resources, books, media assets, document ingestion
 *
 * This façade composes all domain modules into a single, cohesive `dao` API.
 */
import { setDaoLanguage } from './daoLanguage.ts';
import { sessionDao } from './dao/sessions.ts';
import { noteDao } from './dao/notes.ts';
import { practiceWorkDao } from './dao/practiceWork.ts';
import { goalDao } from './dao/goals.ts';
import { courseDao } from './dao/courses.ts';
import { flashcardDao } from './dao/flashcards.ts';
import { graphDao } from './dao/graph.ts';
import { searchDao } from './dao/search.ts';
import { resourceDao } from './dao/resources.ts';

export {
  setDaoLanguage,
  sessionDao,
  noteDao,
  practiceWorkDao,
  goalDao,
  courseDao,
  flashcardDao,
  graphDao,
  searchDao,
  resourceDao
};

export const dao = {
  ...sessionDao,
  ...noteDao,
  ...practiceWorkDao,
  ...goalDao,
  ...courseDao,
  ...flashcardDao,
  ...graphDao,
  ...searchDao,
  ...resourceDao
};
