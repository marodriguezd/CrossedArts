import os
from pathlib import Path
from typing import Union
from backend.app.core.settings import settings

# Directorios del sistema prohibidos (se resolverán de forma absoluta y multiplataforma)
BLOCKED_SYSTEM_DIRS = [
    "/etc", "/var", "/proc", "/sys", "/dev", "/boot", "/root",
    "/home/lost+found", "/usr/local/etc", "/tmp", "/var/tmp"
]

# Agregar carpetas del sistema en Windows si aplica
if os.name == 'nt':
    system_root = os.environ.get('SystemRoot') or "C:\\Windows"
    program_files = os.environ.get('ProgramFiles') or "C:\\Program Files"
    program_files_x86 = os.environ.get('ProgramFiles(x86)') or "C:\\Program Files (x86)"
    program_data = os.environ.get('ProgramData') or "C:\\ProgramData"
    
    BLOCKED_SYSTEM_DIRS.extend([
        system_root,
        program_files,
        program_files_x86,
        program_data,
        "C:\\tmp",
        "D:\\tmp"
    ])

# Carpetas ocultas sensibles prohibidas en cualquier parte de la ruta
BLOCKED_HIDDEN_DIR_NAMES = [
    ".ssh", ".gnupg", ".aws", ".gemini", ".config", ".env", ".git"
]

def is_safe_path(path: Union[str, Path]) -> bool:
    """
    Verifica si una ruta de archivo o directorio es segura de forma multiplataforma (Windows y Linux).
    Evita acceder a directorios del sistema críticos o carpetas de configuración ocultas.
    Permite acceder al directorio de datos de la app, subcarpetas del home de usuario,
    y almacenamientos externos (discos en Windows, /media o /mnt en Linux).
    """
    try:
        path_str = str(path).strip()
        if not path_str:
            return False
            
        # Exigir que sea una ruta absoluta para evitar resolución implícita contra CWD
        if not os.path.isabs(path_str):
            return False
            
        resolved_path = os.path.abspath(os.path.realpath(path_str))
        
        # 1. Validar si está en el espacio de trabajo de la app (siempre permitido por definición)
        workspace_dir = os.path.abspath(os.path.realpath(str(settings.data_dir)))
        if os.name == 'nt':
            in_workspace = resolved_path.lower() == workspace_dir.lower() or resolved_path.lower().startswith(workspace_dir.lower() + os.sep)
        else:
            in_workspace = resolved_path == workspace_dir or resolved_path.startswith(workspace_dir + os.sep)
            
        # Si está en el workspace, solo verificamos componentes ocultos sensibles y permitimos
        if in_workspace:
            parts = Path(resolved_path).parts
            for part in parts:
                if part.startswith('.') and part != '.domestik':
                    return False
                if part in BLOCKED_HIDDEN_DIR_NAMES:
                    return False
            return True

        # 2. Validar contra directorios del sistema bloqueados
        for blocked_dir in BLOCKED_SYSTEM_DIRS:
            blocked_resolved = os.path.abspath(os.path.realpath(blocked_dir))
            if os.name == 'nt':
                if resolved_path.lower() == blocked_resolved.lower() or resolved_path.lower().startswith(blocked_resolved.lower() + os.sep):
                    return False
            else:
                if resolved_path == blocked_resolved or resolved_path.startswith(blocked_resolved + os.sep):
                    return False
                
        # 3. Validar que no contenga carpetas/archivos ocultos en sus componentes
        # Bloquea cualquier parte que empiece con '.' excepto '.domestik'
        parts = Path(resolved_path).parts
        for part in parts:
            if part.startswith('.') and part != '.domestik':
                return False
            if part in BLOCKED_HIDDEN_DIR_NAMES:
                return False
                
        # 4. Validar alcance permitido fuera del workspace:
        # - Subcarpetas del home de usuario (excluyendo el home directamente por seguridad)
        # - Discos/medios externos en /media o /mnt (Linux) o cualquier disco en Windows
        home_dir = os.path.abspath(os.path.realpath(os.path.expanduser("~")))
        
        if os.name == 'nt':
            in_home_sub = resolved_path.lower().startswith(home_dir.lower() + os.sep)
            is_exactly_home = resolved_path.lower() == home_dir.lower()
        else:
            in_home_sub = resolved_path.startswith(home_dir + os.sep)
            is_exactly_home = resolved_path == home_dir
            
        if is_exactly_home:
            return False
            
        if in_home_sub:
            return True

        if os.name == 'nt':
            # En Windows, cualquier disco o almacenamiento externo (C:\, D:\, E:\, etc.)
            # es válido siempre que no pertenezca a las carpetas protegidas del sistema
            import re
            if re.match(r'^[a-zA-Z]:\\', resolved_path):
                return True
        else:
            # En Linux, permitimos explícitamente /media, /run/media y /mnt
            in_media = resolved_path == "/media" or resolved_path.startswith("/media" + os.sep)
            in_run_media = resolved_path == "/run/media" or resolved_path.startswith("/run/media" + os.sep)
            in_mnt = resolved_path == "/mnt" or resolved_path.startswith("/mnt" + os.sep)
            if in_media or in_run_media or in_mnt:
                return True
                
        return False
    except Exception:
        return False
