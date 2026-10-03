import pytest
from unittest.mock import MagicMock, patch
from frontend.app.library import LibraryPage


@pytest.fixture
def mock_data():
    resources = [
        {
            "id": "r1",
            "title": "FastAPI & Python Backend Mastery",
            "type": "course",
            "status": "IN_PROGRESS",
            "category": "Programación",
            "updated_at": "2026-06-23T10:00:00",
        },
        {
            "id": "r2",
            "title": "El Arte del Aprendizaje Efectivo",
            "type": "book",
            "status": "IN_PROGRESS",
            "category": "Desarrollo Personal",
            "reading_percentage": 35.0,
            "updated_at": "2026-06-23T10:05:00",
        },
        {
            "id": "r3",
            "title": "Clean Code: Refactorización y SOLID",
            "type": "book",
            "status": "NOT_STARTED",
            "category": "Programación",
            "reading_percentage": 0.0,
            "updated_at": "2026-06-23T09:00:00",
        },
        {
            "id": "r4",
            "title": "SQLAlchemy Avanzado",
            "type": "course",
            "status": "COMPLETED",
            "category": "Bases de Datos",
            "updated_at": "2026-06-23T11:00:00",
        }
    ]
    paths = [
        {
            "id": "p1",
            "title": "Ruta de Programación",
            "description": "Aprender desarrollo",
            "items": [
                {"id": "i1", "resource_id": "r1", "is_completed": False},
                {"id": "i3", "resource_id": "r3", "is_completed": False}
            ]
        },
        {
            "id": "p2",
            "title": "Desarrollo y Hábitos",
            "description": "Hábitos eficaces",
            "items": [
                {"id": "i2", "resource_id": "r2", "is_completed": False},
                {"id": "i3_dup", "resource_id": "r3", "is_completed": False}
            ]
        }
    ]
    return resources, paths


@pytest.fixture
def mock_ui():
    """Patches all NiceGUI elements to prevent runtime slot errors."""
    with patch("frontend.app.library.ui.row") as mock_row, \
         patch("frontend.app.library.ui.column") as mock_col, \
         patch("frontend.app.library.ui.label") as mock_lbl:
        yield mock_row, mock_col, mock_lbl


@pytest.mark.asyncio
async def test_library_page_fetch_resources(mock_data, mock_ui):
    resources, paths = mock_data
    mock_result = {"items": resources, "total": len(resources), "limit": 50, "offset": 0}
    with patch("frontend.app.library.get_resources_direct", return_value=mock_result), \
         patch("frontend.app.library.get_learning_paths_direct", return_value=paths), \
         patch("frontend.app.library.resource_card"):
        
        page = LibraryPage()
        
        page.grid_container = MagicMock()
        page.search_input = MagicMock()
        page.search_input.value = ""

        await page.fetch_resources()

        assert page.all_resources == resources
        assert page.learning_paths == paths
        assert page.total_count == len(resources)


def test_library_page_filtering_by_type(mock_data, mock_ui):
    resources, paths = mock_data
    page = LibraryPage()
    page.all_resources = resources
    page.learning_paths = paths
    page.grid_container = MagicMock()
    page.search_input = MagicMock()
    page.search_input.value = ""

    with patch("frontend.app.library.resource_card") as mock_card:
        # 1. Filter courses
        page.type_filter = "course"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert len(rendered_ids) == 2
        assert "r1" in rendered_ids
        assert "r4" in rendered_ids
        assert "r2" not in rendered_ids

        # 2. Filter books
        mock_card.reset_mock()
        page.type_filter = "book"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert len(rendered_ids) == 2
        assert "r2" in rendered_ids
        assert "r3" in rendered_ids

        # 3. Filter all
        mock_card.reset_mock()
        page.type_filter = "all"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert len(rendered_ids) == 4


def test_library_page_filtering_by_status(mock_data, mock_ui):
    resources, paths = mock_data
    page = LibraryPage()
    page.all_resources = resources
    page.learning_paths = paths
    page.grid_container = MagicMock()
    page.search_input = MagicMock()
    page.search_input.value = ""

    with patch("frontend.app.library.resource_card") as mock_card:
        # Filter NOT_STARTED
        page.status_filter = "NOT_STARTED"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert rendered_ids == ["r3"]

        # Filter IN_PROGRESS
        mock_card.reset_mock()
        page.status_filter = "IN_PROGRESS"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert len(rendered_ids) == 2
        assert "r1" in rendered_ids
        assert "r2" in rendered_ids

        # Filter COMPLETED
        mock_card.reset_mock()
        page.status_filter = "COMPLETED"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert rendered_ids == ["r4"]


def test_library_page_text_search(mock_data, mock_ui):
    resources, paths = mock_data
    page = LibraryPage()
    page.all_resources = resources
    page.learning_paths = paths
    page.grid_container = MagicMock()
    page.search_input = MagicMock()

    with patch("frontend.app.library.resource_card") as mock_card:
        # Match title partially (case-insensitive)
        page.search_input.value = "mastery"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert rendered_ids == ["r1"]

        # Match category partially
        mock_card.reset_mock()
        page.search_input.value = "personal"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert rendered_ids == ["r2"]

        # Match multiple
        mock_card.reset_mock()
        page.search_input.value = "avanzado"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert rendered_ids == ["r4"]


def test_library_page_sorting(mock_data, mock_ui):
    resources, paths = mock_data
    page = LibraryPage()
    page.all_resources = resources
    page.learning_paths = paths
    page.grid_container = MagicMock()
    page.search_input = MagicMock()
    page.search_input.value = ""

    with patch("frontend.app.library.resource_card") as mock_card:
        # 1. Sort by recent (updated_at desc)
        # r4 (11:00) -> r2 (10:05) -> r1 (10:00) -> r3 (09:00)
        page.sort_by = "recent"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert rendered_ids == ["r4", "r2", "r1", "r3"]

        # 2. Sort by title (alphabetical)
        # Clean Code (r3) -> El Arte (r2) -> FastAPI (r1) -> SQLAlchemy (r4)
        mock_card.reset_mock()
        page.sort_by = "title"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert rendered_ids == ["r3", "r2", "r1", "r4"]

        # 3. Sort by progress
        # Courses: COMPLETED (r4) = 100%, IN_PROGRESS (r1) = 50%, NOT_STARTED = 0%
        # Books: r2 = 35%, r3 = 0%
        # Order: r4 (100) -> r1 (50) -> r2 (35) -> r3 (0)
        mock_card.reset_mock()
        page.sort_by = "progress"
        page.apply_filters()
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert rendered_ids == ["r4", "r1", "r2", "r3"]


def test_library_page_grouping_category(mock_data, mock_ui):
    resources, paths = mock_data
    page = LibraryPage()
    page.all_resources = resources
    page.learning_paths = paths
    page.grid_container = MagicMock()
    page.search_input = MagicMock()
    page.search_input.value = ""

    # Group by category
    page.group_by = "category"
    with patch("frontend.app.library.resource_card") as mock_card:
        page.apply_filters()
        # Verify all resources are rendered
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert len(rendered_ids) == 4
        # Categorías: Bases de Datos, Desarrollo Personal, Programación
        # Under sorted categories, order should be Bases de Datos (r4) -> Desarrollo Personal (r2) -> Programación (r1, r3)
        assert rendered_ids == ["r4", "r2", "r1", "r3"]


def test_library_page_grouping_status(mock_data, mock_ui):
    resources, paths = mock_data
    page = LibraryPage()
    page.all_resources = resources
    page.learning_paths = paths
    page.grid_container = MagicMock()
    page.search_input = MagicMock()
    page.search_input.value = ""

    # Group by status
    page.group_by = "status"
    with patch("frontend.app.library.resource_card") as mock_card:
        page.apply_filters()
        # Status groups rendering order: NOT_STARTED -> IN_PROGRESS -> COMPLETED
        # NOT_STARTED: r3
        # IN_PROGRESS: r1, r2 (ordered by recent within the group: r2 then r1)
        # COMPLETED: r4
        rendered_ids = [call[0][0]["id"] for call in mock_card.call_args_list]
        assert len(rendered_ids) == 4
        assert rendered_ids == ["r3", "r2", "r1", "r4"]


def test_library_page_grouping_path(mock_data, mock_ui):
    resources, paths = mock_data
    page = LibraryPage()
    page.all_resources = resources
    page.learning_paths = paths
    page.grid_container = MagicMock()
    page.search_input = MagicMock()
    page.search_input.value = ""

    # Group by path (Agrupación personalizada)
    page.group_by = "path"
    with patch("frontend.app.library.resource_card") as mock_card:
        page.apply_filters()
        
        # Call details
        calls = [call[0][0]["id"] for call in mock_card.call_args_list]
        
        # Path 1 (Ruta de Programación) contains: r1, r3
        # Path 2 (Desarrollo y Hábitos) contains: r2, r3 (note r3 is in both!)
        # Unassigned contains: r4
        # Total renders: r1 (p1), r3 (p1), r2 (p2), r3 (p2), r4 (unassigned)
        assert len(calls) == 5
        assert calls == ["r1", "r3", "r2", "r3", "r4"]
