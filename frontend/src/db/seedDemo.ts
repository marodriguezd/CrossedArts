export const SEED_SQL = `
-- Cursos Demo
INSERT INTO learning_resource (id, title, description, cover_path, category, status, type)
VALUES 
  ('c1-react', 'React 18 & TypeScript Masterclass', 'Aprende arquitectura moderna de componentes, hooks personalizados y rendimiento en el frontend.', 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=600&auto=format&fit=crop&q=80', 'Desarrollo Web', 'IN_PROGRESS', 'course'),
  ('c2-python', 'Python para Inteligencia Artificial y Datos', 'De cero a modelos predictivos con NumPy, Pandas, Scikit-Learn y Transformers.', 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600&auto=format&fit=crop&q=80', 'Inteligencia Artificial', 'IN_PROGRESS', 'course'),
  ('c3-sqlite', 'Bases de Datos Relacionales y SQL Avanzado', 'Optimización de consultas, índices B-Tree, transacciones ACID y SQLite embebido.', 'https://images.unsplash.com/photo-1544383835-bda2bc66a55d?w=600&auto=format&fit=crop&q=80', 'Bases de Datos', 'COMPLETED', 'course');

INSERT INTO course (id, instructor, difficulty, total_duration_minutes, total_lessons, completed_lessons)
VALUES
  ('c1-react', 'Dan Abramov & Kent C. Dodds', 'INTERMEDIATE', 360, 6, 2),
  ('c2-python', 'Andrew Ng', 'ADVANCED', 480, 8, 3),
  ('c3-sqlite', 'Richard Hipp', 'INTERMEDIATE', 240, 4, 4);

-- Libros Demo
INSERT INTO learning_resource (id, title, description, cover_path, category, status, type)
VALUES
  ('b1-deepwork', 'Deep Work: Rules for Focused Success', 'Estrategias y hábitos para alcanzar concentración profunda en un mundo lleno de distracciones.', 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80', 'Productividad', 'IN_PROGRESS', 'book'),
  ('b2-pragmatic', 'The Pragmatic Programmer: 20th Edition', 'El manual clásico del artesano del software, refactorización y mentalidad profesional.', 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=600&auto=format&fit=crop&q=80', 'Ingeniería de Software', 'IN_PROGRESS', 'book'),
  ('b3-atomic', 'Atomic Habits', 'Cómo pequeños cambios diarios generan resultados transformadores a largo plazo.', 'https://images.unsplash.com/photo-1589829085413-56de8ae18c73?w=600&auto=format&fit=crop&q=80', 'Desarrollo Personal', 'COMPLETED', 'book');

INSERT INTO book (id, author, isbn, page_count, current_page, reading_percentage)
VALUES
  ('b1-deepwork', 'Cal Newport', '978-1455586691', 304, 106, 34.8),
  ('b2-pragmatic', 'David Thomas, Andrew Hunt', '978-0135957059', 352, 180, 51.1),
  ('b3-atomic', 'James Clear', '978-0735211292', 320, 320, 100.0);

-- Módulos y Lecciones de Cursos
INSERT INTO module (id, course_id, title, order_index)
VALUES
  ('m1-react', 'c1-react', 'Módulo 1: Fundamentos y Modelo Concurrente', 1),
  ('m2-react', 'c1-react', 'Módulo 2: State Management & Redux Toolkit', 2);

INSERT INTO lesson (id, module_id, title, order_index, duration_minutes, lesson_type, media_url, is_completed)
VALUES
  ('l1', 'm1-react', '01. Introducción al Virtual DOM y Fiber', 1, 25, 'VIDEO', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', 1),
  ('l2', 'm1-react', '02. useTransition y useDeferredValue en la práctica', 2, 35, 'VIDEO', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4', 1),
  ('l3', 'm1-react', '03. Arquitectura Server Components vs Client Components', 3, 40, 'VIDEO', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', 0),
  ('l4', 'm2-react', '04. Creando Custom Hooks con TypeScript estricto', 1, 30, 'VIDEO', '', 0);

-- Sesiones de Aprendizaje (Historial de Pomodoros / Estudio)
INSERT INTO learning_session (id, resource_id, duration_minutes, inactive_seconds)
VALUES
  ('s1', 'c1-react', 45, 120),
  ('s2', 'c1-react', 60, 30),
  ('s3', 'b1-deepwork', 50, 0),
  ('s4', 'c2-python', 90, 180);

-- Flashcards para Active Recall y Algoritmo SM-2
INSERT INTO flashcard (id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date)
VALUES
  ('f1', 'c1-react', '¿Qué diferencia a useMemo de useCallback?', 'useMemo memoriza el valor de retorno computado, mientras que useCallback memoriza la referencia a la función en sí misma.', 2, 6, 2.6, datetime('now')),
  ('f2', 'b1-deepwork', '¿Qué es el principio del "Drenaje de Atención"?', 'Cuando alternas rápidamente entre tareas complejas, una fracción de tu foco mental queda rezagada en la tarea anterior.', 1, 1, 2.5, datetime('now')),
  ('f3', 'c3-sqlite', '¿Qué significa el modo WAL en SQLite?', 'Write-Ahead Logging: permite lectores concurrentes sin bloquear a los escritores y mejora sustancialmente el rendimiento.', 3, 12, 2.7, datetime('now', '+2 days')),
  ('f4', 'c2-python', '¿Qué es la similitud del coseno en embeddings vectoriales?', 'Mide el coseno del ángulo entre dos vectores multidimensionales, variando de -1 a 1, indicando afinidad semántica independiente de la magnitud.', 0, 1, 2.5, datetime('now'));

-- Grafo de Conocimiento (Conceptos y Conexiones)
INSERT INTO concept (id, name, description)
VALUES
  ('cp1', 'React 18', 'Biblioteca de renderizado reactivo y UI declarativa'),
  ('cp2', 'Virtual DOM', 'Representación ligera en memoria del árbol DOM nativo'),
  ('cp3', 'TypeScript', 'Superset tipado estáticamente para JavaScript'),
  ('cp4', 'SQLite WASM', 'Motor relacional de base de datos compilado a WebAssembly'),
  ('cp5', 'Active Recall', 'Técnica de aprendizaje de recuperación activa para potenciar memoria'),
  ('cp6', 'Algoritmo SM-2', 'Modelo matemático de repetición espaciada SuperMemo');

INSERT INTO knowledge_connection (id, source_id, target_id, connection_type, weight)
VALUES
  ('kc1', 'cp1', 'cp2', 'references', 1.0),
  ('kc2', 'cp1', 'cp3', 'requires', 0.8),
  ('kc3', 'cp5', 'cp6', 'contains', 1.0),
  ('kc4', 'cp4', 'cp3', 'related_to', 0.7);

-- Notas de Estudio
INSERT INTO note (id, resource_id, title, content, tags)
VALUES
  ('n1', 'c1-react', 'Patrones de Rendimiento en React 18', 'Evitar recreación de objetos inline en props cuando se usan componentes memoizados. Usar useId para accesibilidad garantizada.', 'react, performance, hooks'),
  ('n2', 'b1-deepwork', 'Las 4 Disciplinas de la Ejecución (4DX)', '1. Concentrarse en lo sumamente importante. 2. Medir las medidas de predicción. 3. Llevar un tablero de resultados convincente. 4. Crear una cadencia de rendición de cuentas.', 'enfoque, productividad, habitos');
`;
