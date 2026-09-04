from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field, ConfigDict


class Memory(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    content: str
    category: str
    importance: float = Field(ge=0.0, le=1.0)
    created_at: datetime
    updated_at: datetime
    supersedes_id: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryCreate(BaseModel):
    content: str = Field(min_length=1)
    category: Optional[str] = None
    source: str = "unknown"
    explicit_signal: bool = True
    importance_override: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    supersedes: Optional[str] = None


class MemoryUpdate(BaseModel):
    content: Optional[str] = None
    importance_override: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class ConversationIngest(BaseModel):
    content: str = Field(min_length=1)
    source: str = "unknown"
    conversation_id: Optional[str] = None
    content_hash: Optional[str] = None


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=50)
    include_superseded: bool = False


class SearchResponse(BaseModel):
    id: str
    content: str
    metadata: dict[str, Any]
    similarity: float
    combined_score: float


class SummarizeRequest(BaseModel):
    label: str = "topic"
    chunks: list[str] = Field(min_length=1)
    max_lines: int = Field(default=4, ge=1, le=20)
    content_type: Optional[str] = None


class SummarizeResponse(BaseModel):
    lines: list[str] = Field(default_factory=list)
    structured: Optional[dict[str, Any]] = None
    content_type: Optional[str] = None
    error: Optional[str] = None


class ListMemoriesRequest(BaseModel):
    category: Optional[str] = None
    min_importance: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    include_superseded: bool = False


class StatsResponse(BaseModel):
    total_count: int
    avg_importance: float
    top_categories: dict[str, int]
    storage_size_bytes: int


class DecayResponse(BaseModel):
    decayed: int


class HealthResponse(BaseModel):
    ok: bool
    service: str