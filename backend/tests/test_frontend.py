def test_frontend_imports():
    """Valida que todos los componentes y páginas de NiceGUI importen correctamente sin dependencias rotas."""
    from frontend.app.layout import default_layout
    from frontend.app.components.kpi_widget import kpi_widget
    from frontend.app.components.resource_card import resource_card
    from frontend.app.components.notes_panel import NotesPanel
    from frontend.app.dashboard import DashboardPage
    from frontend.app.library import LibraryPage
    from frontend.app.course_detail import CourseDetailPage
    from frontend.app.book_detail import BookDetailPage
    from frontend.app.notes_list import NotesListPage
    from frontend.app.pages.learning_paths import LearningPathsPage
    from frontend.app.pages.study_plans import StudyPlansPage
    from frontend.app.pages.goals import GoalsPage
    from frontend.app.pages.habits import HabitsPage
    from frontend.app.pages.review_center import ReviewCenterPage
    from frontend.app.pages.knowledge_graph import KnowledgeGraphPage
    from frontend.app.pages.settings import SettingsPage
    from frontend.app.pages.about import AboutPage

    assert DashboardPage is not None
    assert LibraryPage is not None
    assert CourseDetailPage is not None
    assert BookDetailPage is not None
    assert NotesListPage is not None
    assert LearningPathsPage is not None
    assert StudyPlansPage is not None
    assert GoalsPage is not None
    assert HabitsPage is not None
    assert ReviewCenterPage is not None
    assert KnowledgeGraphPage is not None
    assert SettingsPage is not None
    assert AboutPage is not None
    print("[Frontend] Todos los módulos de la UI importaron con éxito.")
