from datetime import datetime


def test_utc_now_naive_returns_datetime():
    from backend.app.core.utils import utc_now_naive
    result = utc_now_naive()
    assert isinstance(result, datetime)


def test_utc_now_naive_is_naive():
    from backend.app.core.utils import utc_now_naive
    result = utc_now_naive()
    assert result.tzinfo is None


def test_utc_now_naive_approx_utc():
    from backend.app.core.utils import utc_now_naive
    from datetime import timezone
    import time
    result = utc_now_naive()
    # Should be within a few seconds of UTC
    utc_now = datetime.now(timezone.utc).replace(tzinfo=None)
    diff = abs((result - utc_now).total_seconds())
    assert diff < 5, f"utc_now_naive() deviated {diff}s from UTC"


def test_utc_now_naive_increments():
    from backend.app.core.utils import utc_now_naive
    import time
    t1 = utc_now_naive()
    time.sleep(0.01)
    t2 = utc_now_naive()
    assert t2 >= t1


def test_remove_accents_normalization():
    from backend.app.core.database import remove_accents

    assert remove_accents("crème brûlée") == "creme brulee"
    assert remove_accents("Álgebra Lineal y Geometría") == "Algebra Lineal y Geometria"
    assert remove_accents("canción, pingüino, niño") == "cancion, pinguino, nino"
    assert remove_accents(None) == ""
    assert remove_accents("") == ""


def test_is_sqlite_connection_detection():
    import sqlite3
    from backend.app.core.database import is_sqlite_connection, set_sqlite_pragma

    conn = sqlite3.connect(":memory:")
    assert is_sqlite_connection(conn) is True

    # Connect listener executes safely on SQLite connection
    set_sqlite_pragma(conn, None)

    # Custom function remove_accents is callable in SQL queries
    cursor = conn.cursor()
    cursor.execute("SELECT remove_accents('programación')")
    row = cursor.fetchone()
    assert row is not None and row[0] == "programacion"
    conn.close()

    # Non-SQLite mock connection is safely ignored
    class DummyDBAPI:
        pass

    dummy = DummyDBAPI()
    assert is_sqlite_connection(dummy) is False
    # Calling listener does not raise AttributeError
    set_sqlite_pragma(dummy, None)

