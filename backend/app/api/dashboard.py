from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.schemas.dashboard import (
    DashboardSummaryResponse, RecentActivityItem, StudyTimeReportResponse
)
from backend.app.services.dashboard import DashboardService

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(db: Session = Depends(get_db)):
    """
    Return global-progress KPIs and aggregate metrics for the main dashboard.
    """
    return DashboardService.get_summary(db)


@router.get("/recent-activity", response_model=List[RecentActivityItem])
def get_recent_activity(db: Session = Depends(get_db)):
    """
    Return the unified recent-activity list (finalized study sessions plus created notes).
    """
    return DashboardService.get_recent_activity(db)


@router.get("/study-time", response_model=StudyTimeReportResponse)
def get_study_time_report(db: Session = Depends(get_db)):
    """
    Return the daily study-minutes history for stats charts.
    """
    return DashboardService.get_study_time_report(db)
