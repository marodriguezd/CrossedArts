# Taskboard - DomestiK Bug Fixes

## Backlog

- [x] **TSK-01** (p0): Corregir desempaquetado de consulta SQLAlchemy en `EmbeddingService.index_all_unindexed` (Verificado: tests unitarios pasados)
- [x] **TSK-02** (p1): Pasar llamadas síncronas de `extract_and_index` a tareas asíncronas en `scanner.py` (Verificado: tests unitarios pasados, compatibilidad asíncrona validada)
- [x] **TSK-03** (p1): Agrupar commits (`db.commit()`) en bucles de escaneo para `scanner.py` (Verificado: optimizado rendimiento sin romper consistencia de datos)
- [x] **TSK-04** (p1): Resolver discrepancias de dimensiones en huellas semánticas en `semantic_search.py` (Verificado: filtro por modelo implementado)
- [x] **TSK-05** (p2): Aplicar decodificación URL a rutas internas del EPUB en `extractor.py` (Verificado: unquote integrado con éxito)
- [x] **TSK-06** (p2): Descargar y servir `vis-network.min.js` localmente para soporte 100% offline (Verificado: archivo descargado en static/js y link de HTML actualizado)
