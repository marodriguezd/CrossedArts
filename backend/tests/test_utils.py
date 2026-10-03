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
