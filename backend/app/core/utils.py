from datetime import datetime, timezone

def utc_now_naive() -> datetime:
    """Returns a timezone-naive UTC datetime for safe SQLite interaction."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
