from fastapi import HTTPException, status

def get_http_exception(code: str, message: str, status_code: int = status.HTTP_404_NOT_FOUND) -> HTTPException:
    """
    Retorna una excepción HTTP formateada con el estándar JSON de errores unificado de CrossedArts.
    """
    return HTTPException(
        status_code=status_code,
        detail={
            "error": {
                "code": code,
                "message": message
            }
        }
    )
