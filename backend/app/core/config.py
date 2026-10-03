"""
Backward-compatible config module.
All configuration is now centralized in settings.py.
This module re-exports for legacy imports.
"""
from backend.app.core.settings import settings

PORT = settings.port
API_BASE_URL = settings.api_base_url
DATABASE_URL = settings.database_url
