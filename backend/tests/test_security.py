import os
from pathlib import Path
from backend.app.core.security import is_safe_path
from backend.app.core.settings import settings


def test_is_safe_path_valid():
    assert is_safe_path(str(settings.data_dir))


def test_is_safe_path_subdirectory():
    subpath = str(settings.data_dir / "content")
    assert is_safe_path(subpath)


def test_is_safe_path_deeply_nested():
    deep = str(settings.data_dir / "content" / "courses" / "lesson1")
    assert is_safe_path(deep)


def test_is_safe_path_system_dirs_blocked():
    assert not is_safe_path("/etc")
    assert not is_safe_path("/var")
    assert not is_safe_path("/usr")
    assert not is_safe_path("/bin")
    assert not is_safe_path("/sbin")
    assert not is_safe_path("/proc")
    assert not is_safe_path("/sys")


def test_is_safe_path_home_not_allowed():
    assert not is_safe_path(os.path.expanduser("~"))


def test_is_safe_path_external_drives_allowed():
    assert is_safe_path("/media/my_external_drive")
    assert is_safe_path("/run/media/my_external_drive")
    assert is_safe_path("/mnt/usb_mount")
    assert is_safe_path(os.path.expanduser("~/Downloads"))
    assert is_safe_path(os.path.expanduser("~/Videos/my_course"))


def test_is_safe_path_tmp_not_allowed():
    assert not is_safe_path("/tmp")
    assert not is_safe_path("/tmp/something")


def test_is_safe_path_dotdot_traversal():
    # Attempt to escape data_dir with ..
    evil = str(settings.data_dir / ".." / ".." / "etc" / "passwd")
    assert not is_safe_path(evil)


def test_is_safe_path_hidden_dirs_blocked():
    hidden = str(settings.data_dir / ".ssh" / "id_rsa")
    assert not is_safe_path(hidden)


def test_is_safe_path_empty_string():
    assert not is_safe_path("")


def test_is_safe_path_relative_path():
    # Relative paths resolve against cwd; if cwd is not inside data_dir, it should fail
    assert not is_safe_path("relative/path/file.txt")
