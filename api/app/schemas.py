from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ToolBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    quantity: int = Field(default=1, ge=0)


class ToolCreate(ToolBase):
    pass


class ToolUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    category: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    quantity: Optional[int] = Field(default=None, ge=0)


class ToolResponse(ToolBase):
    id: int
    available_quantity: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BorrowerResponse(BaseModel):
    id: int
    class_name: str
    name: str

    model_config = ConfigDict(from_attributes=True)


class LoanCreate(BaseModel):
    class_name: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=100)
    tool_id: int
    quantity: int = Field(default=1, ge=1)


class LoanResponse(BaseModel):
    id: int
    borrower_id: int
    tool_id: int
    quantity: int
    borrowed_at: datetime
    returned_at: Optional[datetime]
    status: str

    class_name: str
    borrower_name: str
    tool_name: str

    model_config = ConfigDict(from_attributes=True)


class ReturnRequest(BaseModel):
    loan_id: int
