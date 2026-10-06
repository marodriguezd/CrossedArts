import uuid
from datetime import timedelta
from backend.app.core.utils import utc_now_naive
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.base import ResourceStatus, CourseDifficulty, LessonType
from backend.app.models.resource import LearningResource, Course, Book
from backend.app.models.course_structure import Module, Lesson, Task
from backend.app.models.activity import LearningSession, Note
from backend.app.core.logging import get_logger

logger = get_logger("core.seeding")

def seed_db(db: Session, force: bool = False):
    """
    Puebla la base de datos con un conjunto de datos demo de aprendizaje realista.
    Si force=True, vacía las tablas de base de datos antes de sembrar.
    """
    if force:
        logger.info("Vaciando tablas para sembrado limpio...")
        db.query(Note).delete()
        db.query(LearningSession).delete()
        db.query(Task).delete()
        db.query(Lesson).delete()
        db.query(Module).delete()
        db.query(Book).delete()
        db.query(Course).delete()
        db.query(LearningResource).delete()
        db.commit()

    # Comprobar si ya existen datos
    stmt = select(LearningResource)
    existing_resource = db.execute(stmt).first()
    if existing_resource and not force:
        logger.info("Base de datos ya poblada. Omitiendo sembrado.")
        return

    logger.info("Iniciando sembrado de datos semilla realistas...")

    # ==========================================
    # 1. SEMBRADO DE LIBROS
    # ==========================================
    books_data = [
        {
            "title": "Deep Work",
            "description": "Rules for focused success in a distracted world.",
            "cover_path": "/static/covers/deep_work.jpg",
            "category": "Productividad",
            "status": ResourceStatus.IN_PROGRESS,
            "author": "Cal Newport",
            "reading_percentage": 35.0
        },
        {
            "title": "Atomic Habits",
            "description": "An easy and proven way to build good habits and break bad ones.",
            "cover_path": "/static/covers/atomic_habits.jpg",
            "category": "Desarrollo Personal",
            "status": ResourceStatus.IN_PROGRESS,
            "author": "James Clear",
            "reading_percentage": 70.0
        },
        {
            "title": "The Tao Te Ching",
            "description": "El libro del camino y de la virtud.",
            "cover_path": "/static/covers/tao_te_ching.jpg",
            "category": "Filosofía",
            "status": ResourceStatus.COMPLETED,
            "author": "Lao Tse",
            "reading_percentage": 100.0
        },
        {
            "title": "Meditations",
            "description": "A series of personal writings by Marcus Aurelius, Roman Emperor, setting forth private notes on Stoic philosophy.",
            "cover_path": "/static/covers/meditations.jpg",
            "category": "Filosofía",
            "status": ResourceStatus.NOT_STARTED,
            "author": "Marcus Aurelius",
            "reading_percentage": 0.0
        },
        {
            "title": "Learning How to Learn",
            "description": "Powerful mental tools to help you master tough subjects.",
            "cover_path": "/static/covers/learning_how_to_learn.jpg",
            "category": "Educación",
            "status": ResourceStatus.COMPLETED,
            "author": "Barbara Oakley",
            "reading_percentage": 100.0
        }
    ]

    books = []
    for b_info in books_data:
        book = Book(
            id=uuid.uuid4(),
            title=b_info["title"],
            description=b_info["description"],
            cover_path=b_info["cover_path"],
            category=b_info["category"],
            status=b_info["status"],
            author=b_info["author"],
            reading_percentage=b_info["reading_percentage"]
        )
        db.add(book)
        books.append(book)

    # ==========================================
    # 2. SEMBRADO DE CURSOS, MÓDULOS, LECCIONES Y TAREAS
    # ==========================================
    
    # Curso 1: Photography Fundamentals (En progreso)
    c1 = Course(
        id=uuid.uuid4(),
        title="Photography Fundamentals",
        description="Aprende el uso del modo manual, la exposición y las reglas básicas de la composición visual.",
        cover_path="/static/covers/photography.jpg",
        category="Fotografía",
        status=ResourceStatus.IN_PROGRESS,
        difficulty=CourseDifficulty.BEGINNER
    )
    db.add(c1)

    m1_c1 = Module(id=uuid.uuid4(), course_id=c1.id, title="Introducción a la Exposición", order_index=1)
    m2_c1 = Module(id=uuid.uuid4(), course_id=c1.id, title="Composición y Enfoque", order_index=2)
    db.add_all([m1_c1, m2_c1])

    l1_m1 = Lesson(id=uuid.uuid4(), module_id=m1_c1.id, title="Entendiendo la Apertura", duration_minutes=15, is_completed=True, lesson_type=LessonType.VIDEO, order_index=1)
    l2_m1 = Lesson(id=uuid.uuid4(), module_id=m1_c1.id, title="La Velocidad del Obturador", duration_minutes=20, is_completed=True, lesson_type=LessonType.VIDEO, order_index=2)
    l3_m1 = Lesson(id=uuid.uuid4(), module_id=m1_c1.id, title="La Sensibilidad ISO", duration_minutes=10, is_completed=False, lesson_type=LessonType.VIDEO, order_index=3)
    l1_m2 = Lesson(id=uuid.uuid4(), module_id=m2_c1.id, title="Regla de los Tercios", duration_minutes=25, is_completed=False, lesson_type=LessonType.VIDEO, order_index=1)
    db.add_all([l1_m1, l2_m1, l3_m1, l1_m2])

    t1_c1 = Task(id=uuid.uuid4(), course_id=c1.id, title="Tomar 3 fotos controlando la profundidad de campo", description="Hacer una foto con f/1.8 (desenfocado) y otra con f/16 (nítido).", is_completed=False)
    t2_c1 = Task(id=uuid.uuid4(), course_id=c1.id, title="Identificar composición en un catálogo externo", description="Analizar 5 imágenes comerciales.", is_completed=True, completed_at=utc_now_naive() - timedelta(days=2))
    db.add_all([t1_c1, t2_c1])

    # Curso 2: Python for Beginners (En progreso)
    c2 = Course(
        id=uuid.uuid4(),
        title="Python for Beginners",
        description="Aprende los fundamentos de la programación en Python desde cero, estructuras y sintaxis básica.",
        cover_path="/static/covers/python.jpg",
        category="Programación",
        status=ResourceStatus.IN_PROGRESS,
        difficulty=CourseDifficulty.BEGINNER
    )
    db.add(c2)

    m1_c2 = Module(id=uuid.uuid4(), course_id=c2.id, title="Sintaxis y Tipos", order_index=1)
    db.add(m1_c2)

    l1_m1_c2 = Lesson(id=uuid.uuid4(), module_id=m1_c2.id, title="Variables y Operaciones", duration_minutes=12, is_completed=True, lesson_type=LessonType.VIDEO, order_index=1)
    l2_m1_c2 = Lesson(id=uuid.uuid4(), module_id=m1_c2.id, title="Control de Flujo (If/Else)", duration_minutes=18, is_completed=False, lesson_type=LessonType.VIDEO, order_index=2)
    db.add_all([l1_m1_c2, l2_m1_c2])

    t1_c2 = Task(id=uuid.uuid4(), course_id=c2.id, title="Escribir un script conversor de temperatura", description="Crear un código que pase de Celsius a Fahrenheit.", is_completed=True, completed_at=utc_now_naive() - timedelta(days=4))
    db.add(t1_c2)

    # Curso 3: Digital Illustration Basics (No iniciado)
    c3 = Course(
        id=uuid.uuid4(),
        title="Digital Illustration Basics",
        description="Principios de dibujo, dibujo digital con tableta y uso correcto de pinceles e iluminación.",
        cover_path="/static/covers/illustration.jpg",
        category="Diseño",
        status=ResourceStatus.NOT_STARTED,
        difficulty=CourseDifficulty.BEGINNER
    )
    db.add(c3)

    m1_c3 = Module(id=uuid.uuid4(), course_id=c3.id, title="Primeros trazos", order_index=1)
    db.add(m1_c3)

    l1_m1_c3 = Lesson(id=uuid.uuid4(), module_id=m1_c3.id, title="Configuración de Pinceles", duration_minutes=30, is_completed=False, lesson_type=LessonType.VIDEO, order_index=1)
    db.add(l1_m1_c3)

    # Curso 4: Personal Knowledge Management (Completado)
    c4 = Course(
        id=uuid.uuid4(),
        title="Personal Knowledge Management",
        description="Organiza tus notas, proyectos e ideas utilizando metodologías como el Segundo Cerebro.",
        cover_path="/static/covers/pkm.jpg",
        category="Productividad",
        status=ResourceStatus.COMPLETED,
        difficulty=CourseDifficulty.INTERMEDIATE
    )
    db.add(c4)

    m1_c4 = Module(id=uuid.uuid4(), course_id=c4.id, title="El método PARA y Zettelkasten", order_index=1)
    db.add(m1_c4)

    l1_m1_c4 = Lesson(id=uuid.uuid4(), module_id=m1_c4.id, title="Concepto de Segundo Cerebro", duration_minutes=15, is_completed=True, lesson_type=LessonType.VIDEO, order_index=1)
    l2_m1_c4 = Lesson(id=uuid.uuid4(), module_id=m1_c4.id, title="Organización con Carpetas vs Tags", duration_minutes=22, is_completed=True, lesson_type=LessonType.VIDEO, order_index=2)
    db.add_all([l1_m1_c4, l2_m1_c4])

    t1_c4 = Task(id=uuid.uuid4(), course_id=c4.id, title="Configurar bóveda inicial en Obsidian", description="Estructurar carpetas según el método PARA.", is_completed=True, completed_at=utc_now_naive() - timedelta(days=10))
    db.add(t1_c4)

    # Curso 5: Meditation and Focus (En progreso)
    c5 = Course(
        id=uuid.uuid4(),
        title="Meditation and Focus",
        description="Ejercicios diarios de atención plena y técnicas para evitar el cansancio mental.",
        cover_path="/static/covers/meditation.jpg",
        category="Salud",
        status=ResourceStatus.IN_PROGRESS,
        difficulty=CourseDifficulty.BEGINNER
    )
    db.add(c5)

    m1_c5 = Module(id=uuid.uuid4(), course_id=c5.id, title="Mindfulness Diario", order_index=1)
    db.add(m1_c5)

    l1_m1_c5 = Lesson(id=uuid.uuid4(), module_id=m1_c5.id, title="Sesión guiada 5 minutos", duration_minutes=5, is_completed=True, lesson_type=LessonType.VIDEO, order_index=1)
    l2_m1_c5 = Lesson(id=uuid.uuid4(), module_id=m1_c5.id, title="Entendiendo la Ansiedad", duration_minutes=15, is_completed=False, lesson_type=LessonType.VIDEO, order_index=2)
    db.add_all([l1_m1_c5, l2_m1_c5])

    # ==========================================
    # 3. SEMBRADO DE NOTAS REALISTAS
    # ==========================================
    notes_data = [
        {
            "resource_id": c1.id,
            "lesson_id": l1_m1.id,
            "content": "### Notas sobre Apertura\n* f/1.8 permite mucha luz pero da poca profundidad de campo (desenfoque).\n* f/16 cierra la apertura, requiere más luz pero todo sale nítido.\n* Útil para retratos vs paisajes."
        },
        {
            "resource_id": c2.id,
            "lesson_id": l1_m1_c2.id,
            "content": "### Variables en Python\n* Las variables son dinámicas. No requieren declaración de tipo.\n* Usar snake_case para nombres legibles."
        },
        {
            "resource_id": books[0].id, # Deep Work
            "lesson_id": None,
            "content": "### Claves de Deep Work\n1. El trabajo enfocado produce un valor desproporcionado.\n2. La atención dividida (atender notificaciones) arruina la capacidad cognitiva del día."
        },
        {
            "resource_id": books[1].id, # Atomic Habits
            "lesson_id": None,
            "content": "### Regla de los 2 Minutos\nSi vas a arrancar un nuevo hábito positivo, haz que no te tome más de 2 minutos realizar el primer paso (ej. ponerte los tenis para correr)."
        }
    ]

    for n_info in notes_data:
        note = Note(
            id=uuid.uuid4(),
            resource_id=n_info["resource_id"],
            lesson_id=n_info["lesson_id"],
            content=n_info["content"]
        )
        db.add(note)

    # ==========================================
    # 4. SEMBRADO DE HISTORIAL DE ESTUDIO (LearningSession)
    # ==========================================
    now = utc_now_naive()
    sessions_data = [
        # Hoy
        {"resource_id": c1.id, "delta_days": 0, "duration": 25},
        # Ayer
        {"resource_id": books[0].id, "delta_days": 1, "duration": 40},
        {"resource_id": c2.id, "delta_days": 1, "duration": 15},
        # Hace 3 días
        {"resource_id": books[1].id, "delta_days": 3, "duration": 30},
        {"resource_id": c1.id, "delta_days": 3, "duration": 20},
        # Hace 5 días
        {"resource_id": c4.id, "delta_days": 5, "duration": 50},
        # Hace 7 días
        {"resource_id": books[4].id, "delta_days": 7, "duration": 60}
    ]

    for s_info in sessions_data:
        session_start = now - timedelta(days=s_info["delta_days"]) - timedelta(minutes=s_info["duration"])
        session = LearningSession(
            id=uuid.uuid4(),
            resource_id=s_info["resource_id"],
            started_at=session_start,
            ended_at=session_start + timedelta(minutes=s_info["duration"]),
            duration_minutes=s_info["duration"]
        )
        db.add(session)

    db.commit()
    logger.info("Sembrado completado exitosamente.")
