import { SEED_SQL } from './seedDemo.ts';

export type DemoPresetId = 'full' | 'ai_data' | 'reading';

export interface DemoPresetMeta {
  id: DemoPresetId;
  titleKey: string;
  descKey: string;
  badgeKey: string;
  courseCount: number;
  bookCount: number;
  noteCount: number;
  flashcardCount: number;
}

export const DEMO_PRESETS_META: DemoPresetMeta[] = [
  {
    id: 'full',
    titleKey: 'presets.full.title',
    descKey: 'presets.full.desc',
    badgeKey: 'presets.full.badge',
    courseCount: 3,
    bookCount: 3,
    noteCount: 2,
    flashcardCount: 5,
  },
  {
    id: 'ai_data',
    titleKey: 'presets.ai.title',
    descKey: 'presets.ai.desc',
    badgeKey: 'presets.ai.badge',
    courseCount: 1,
    bookCount: 1,
    noteCount: 1,
    flashcardCount: 2,
  },
  {
    id: 'reading',
    titleKey: 'presets.reading.title',
    descKey: 'presets.reading.desc',
    badgeKey: 'presets.reading.badge',
    courseCount: 0,
    bookCount: 2,
    noteCount: 1,
    flashcardCount: 1,
  },
];

export const AI_DATA_SEED_SQL = `
-- Cursos y recursos de Inteligencia Artificial y Datos
INSERT INTO learning_resource (id, title, description, cover_path, category, status, type)
VALUES 
  ('c2-python', 'Python para Inteligencia Artificial y Datos', 'De cero a modelos predictivos con NumPy, Pandas, Scikit-Learn y Transformers.', NULL, 'Inteligencia Artificial', 'IN_PROGRESS', 'course'),
  ('b2-pragmatic', 'The Pragmatic Programmer: 20th Edition', 'El manual clásico del artesano del software, refactorización y mentalidad profesional.', NULL, 'Ingeniería de Software', 'IN_PROGRESS', 'book'),
  ('r1-srs', 'Spaced Repetition Systems: Teoría y práctica', 'Notas sobre el algoritmo SuperMemo-2, la programación de revisiones y la retención a largo plazo.', NULL, 'Aprendizaje', 'IN_PROGRESS', 'pdf');

INSERT INTO course (id, instructor, difficulty, total_duration_minutes, total_lessons, completed_lessons)
VALUES
  ('c2-python', 'Andrew Ng', 'ADVANCED', 480, 8, 3);

INSERT INTO book (id, author, isbn, page_count, current_page, reading_percentage)
VALUES
  ('b2-pragmatic', 'David Thomas, Andrew Hunt', '978-0135957059', 352, 180, 51.1);

INSERT INTO module (id, course_id, title, order_index)
VALUES
  ('m1-python', 'c2-python', 'Módulo 1: Fundamentos de Tensores y Álgebra Lineal', 1),
  ('m2-python', 'c2-python', 'Módulo 2: Modelos de Lenguaje y Embeddings', 2);

INSERT INTO lesson (id, module_id, title, content, order_index, duration_minutes, lesson_type, media_url, is_completed)
VALUES
  ('l-py1', 'm1-python', '01. Representación Matricial y Operaciones Vectoriales', 'Las operaciones matriciales vectorizadas con NumPy aprovechan instrucciones SIMD para acelerar el procesamiento de datos multidimensionales.', 1, 30, 'VIDEO', '01-numpy-vectors.mp4', 1),
  ('l-py2', 'm2-python', '02. Embeddings Semánticos y Espacios Vectoriales', 'Los modelos de embeddings proyectan texto a vectores en un espacio continuo donde la proximidad angular refleja afinidad conceptual.', 1, 45, 'VIDEO', '02-embeddings-space.mp4', 0);

INSERT INTO learning_session (id, resource_id, lesson_id, scope, duration_minutes, inactive_seconds, mode, cards_reviewed, questions_answered, correct_answers, status)
VALUES
  ('s-ai1', 'c2-python', NULL, 'resource', 45, 60, 'flashcards', 15, 0, 0, 'completed'),
  ('s-ai2', 'b2-pragmatic', NULL, 'resource', 35, 0, 'mixed', 5, 4, 3, 'completed');

INSERT INTO flashcard (id, resource_id, front, back, card_type, extra_data, repetition_count, interval_days, ease_factor, due_date)
VALUES
  ('fc-ai1', 'c2-python', '¿Qué es la similitud del coseno en embeddings vectoriales?', 'Mide el coseno del ángulo entre dos vectores multidimensionales, variando de -1 a 1, indicando afinidad semántica independiente de la magnitud.', 'standard', NULL, 0, 1, 2.5, datetime('now')),
  ('fc-ai2', 'c2-python', '¿Qué ventaja ofrece la cuantización INT8 en modelos ONNX?', 'Reduce el uso de memoria a una cuarta parte y acelera la inferencia en CPUs y GPUs estándar manteniendo la precisión semántica.', 'standard', NULL, 1, 3, 2.6, datetime('now'));

INSERT INTO concept (id, name, description)
VALUES
  ('cp-ai1', 'Embeddings Vectoriales', 'Representación densa de conceptos en espacios semánticos continuos'),
  ('cp-ai2', 'Similitud del Coseno', 'Métrica de afinidad angular entre dos representaciones vectoriales'),
  ('cp-ai3', 'Transformers', 'Arquitectura de atención profunda para procesamiento de secuencias');

INSERT INTO knowledge_connection (id, source_id, target_id, connection_type, weight)
VALUES
  ('kc-ai1', 'cp-ai1', 'cp-ai2', 'requires', 0.9),
  ('kc-ai2', 'cp-ai3', 'cp-ai1', 'contains', 1.0);

INSERT INTO note (id, resource_id, title, content, tags)
VALUES
  ('n-ai1', 'c2-python', 'Técnicas de Búsqueda Híbrida (Lexical + Vectorial)', 'La combinación de RRF (Reciprocal Rank Fusion) con filtros BM25 optimiza la precisión en la recuperación de fragmentos documentales.', 'ia, embeddings, rag');

INSERT INTO learning_goal (id, title, description, kind, resource_id, target_value, target_date, status, created_at, updated_at)
VALUES
  ('g-ai1', 'Dominar Embeddings y Transformers en Python', 'Finalizar el temario de modelos de lenguaje y evaluar similitudes vectoriales.', 'course', 'c2-python', NULL, date('now', '+30 days'), 'active', datetime('now'), datetime('now'));
`;

export const READING_SEED_SQL = `
-- Libros clásicos y hábitos de lectura
INSERT INTO learning_resource (id, title, description, cover_path, category, status, type)
VALUES
  ('b1-deepwork', 'Deep Work: Rules for Focused Success', 'Estrategias y hábitos para alcanzar concentración profunda en un mundo lleno de distracciones.', NULL, 'Productividad', 'IN_PROGRESS', 'book'),
  ('b3-atomic', 'Atomic Habits', 'Cómo pequeños cambios diarios generan resultados transformadores a largo plazo.', NULL, 'Desarrollo Personal', 'COMPLETED', 'book');

INSERT INTO book (id, author, isbn, page_count, current_page, reading_percentage)
VALUES
  ('b1-deepwork', 'Cal Newport', '978-1455586691', 304, 106, 34.8),
  ('b3-atomic', 'James Clear', '978-0735211292', 320, 320, 100.0);

INSERT INTO learning_session (id, resource_id, lesson_id, scope, duration_minutes, inactive_seconds, mode, cards_reviewed, questions_answered, correct_answers, status)
VALUES
  ('s-rd1', 'b1-deepwork', NULL, 'resource', 50, 0, 'practice', 0, 8, 6, 'completed');

INSERT INTO flashcard (id, resource_id, front, back, card_type, extra_data, repetition_count, interval_days, ease_factor, due_date)
VALUES
  ('fc-rd1', 'b1-deepwork', '¿Qué es el principio del "Drenaje de Atención"?', 'Cuando alternas rápidamente entre tareas complejas, una fracción de tu foco mental queda rezagada en la tarea anterior.', 'standard', NULL, 1, 1, 2.5, datetime('now'));

INSERT INTO concept (id, name, description)
VALUES
  ('cp-rd1', 'Trabajo Profundo', 'Estado de concentración sin distracciones que empuja las capacidades cognitivas al límite'),
  ('cp-rd2', 'Hábitos Atómicos', 'Estructura iterativa de hábitos basada en pequeños cambios incrementales');

INSERT INTO knowledge_connection (id, source_id, target_id, connection_type, weight)
VALUES
  ('kc-rd1', 'cp-rd1', 'cp-rd2', 'related_to', 0.8);

INSERT INTO note (id, resource_id, title, content, tags)
VALUES
  ('n-rd1', 'b1-deepwork', 'Las 4 Disciplinas de la Ejecución (4DX)', '1. Concentrarse en lo sumamente importante.\n2. Medir las medidas de predicción.\n3. Llevar un tablero de resultados convincente.\n4. Crear una cadencia de rendición de cuentas.', 'enfoque, productividad, habitos');

INSERT INTO practice_work (id, title, description, resource_id, lesson_id, concept_id, kind, status, artifact_url, notes, self_rating, completed_at)
VALUES
  ('pw-rd1', 'Ensayo: atención y trabajo profundo', 'Relaciona el drenaje de atención con tus propias rutinas de estudio.', 'b1-deepwork', NULL, 'cp-rd1', 'essay', 'PLANNED', NULL, 'Bosquejo inicial de 300 palabras.', NULL, NULL);

INSERT INTO learning_goal (id, title, description, kind, resource_id, target_value, target_date, status, created_at, updated_at)
VALUES
  ('g-rd1', 'Completar lectura de Deep Work', 'Leer los capítulos restantes y consolidar notas de ejecución.', 'book', 'b1-deepwork', 304, date('now', '+14 days'), 'active', datetime('now'), datetime('now'));
`;

export function getDemoPresetSql(presetId: DemoPresetId): string {
  switch (presetId) {
    case 'ai_data':
      return AI_DATA_SEED_SQL;
    case 'reading':
      return READING_SEED_SQL;
    case 'full':
    default:
      return SEED_SQL;
  }
}
