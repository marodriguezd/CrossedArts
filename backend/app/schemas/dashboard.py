import uuid
from datetime import date, datetime
from typing import List, Literal, Optional
from pydantic import BaseModel

class DashboardSummaryResponse(BaseModel):
    total_resources: int
    courses_count: int
    books_count: int
    completed_resources: int
    in_progress_resources: int
    pending_tasks_count: int
    total_study_time_minutes: int

class RecentActivityItem(BaseModel):
    """One entry of the unified recent-activity feed.

    The identifiers are honest: `resource_id` is a REAL `learning_resource.id`
    or `None`, never the id of the activity itself used as a surrogate (which
    made a consumer unable to tell a resource from a session). `title` is the
    entry's own headline, so an anchorless session or a standalone note does not
    need to borrow a fake `resource_title`/`resource_type`.

    `scope` is the session's EFFECTIVE scope (`resolve_effective_session_scope`:
    the declared scope re-derived from the anchors actually present). It is
    `None` for notes, which are not sessions; their anchors travel in
    `resource_id`/`lesson_id`.
    """
    id: uuid.UUID
    #: Closed domain: this feed only reports sessions and notes.
    activity_type: Literal["session", "note"]
    timestamp: datetime
    #: Headline of the entry itself (note title, resource title or scope label).
    title: str
    description: Optional[str] = None
    #: Sessions only: effective scope (`global`/`resource`/`lesson`), never a
    #: fourth value and never an invented type. `None` on notes.
    scope: Optional[Literal["global", "resource", "lesson"]] = None
    #: Nullable by contract: an unlinked session or a standalone note has no
    # resource and must still be representable (see Note in models/activity.py).
    resource_id: Optional[uuid.UUID] = None
    resource_title: Optional[str] = None
    resource_type: Optional[str] = None
    lesson_id: Optional[uuid.UUID] = None
    lesson_title: Optional[str] = None
    duration_minutes: Optional[int] = None

class StudyTimeDayReport(BaseModel):
    date: date
    minutes: int

class StudyTimeReportResponse(BaseModel):
    history: List[StudyTimeDayReport]
