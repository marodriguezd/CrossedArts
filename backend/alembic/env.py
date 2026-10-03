import os
import sys
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

# Añadir el directorio raíz al path de Python para que Alembic encuentre 'backend'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

# Importación de la base de datos y modelos del proyecto
from backend.app.core.database import Base
from backend.app.core.settings import settings
from backend.app.models import *

# Configuración de Alembic
config = context.config

# Configurar logs
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Asignar los metadatos de los modelos
target_metadata = Base.metadata

def run_migrations_offline() -> None:
    """Ejecutar migraciones en modo offline."""
    url = settings.database_url
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Ejecutar migraciones en modo online."""
    # Sobrescribir la URL de conexión de alembic.ini con la URL real de la app
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = settings.database_url

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # Activar el renderizado por lotes (render_as_batch) si estamos en SQLite
        # Esto permite realizar operaciones de alteración de tablas sin fallar
        is_sqlite = settings.database_url.startswith("sqlite")
        
        context.configure(
            connection=connection, 
            target_metadata=target_metadata,
            render_as_batch=is_sqlite
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
