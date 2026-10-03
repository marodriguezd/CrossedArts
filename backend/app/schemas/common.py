import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict

class BaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

class ErrorDetail(BaseModel):
    code: str
    message: str

class ErrorResponse(BaseModel):
    error: ErrorDetail
