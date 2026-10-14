from fastapi import HTTPException, status

def get_http_exception(code: str, message: str, status_code: int = status.HTTP_404_NOT_FOUND) -> HTTPException:
    """
    Return an HTTP exception in CrossedArts' unified JSON error standard.
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
