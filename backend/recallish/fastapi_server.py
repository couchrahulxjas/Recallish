from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import RecallishConfig, default_config_path, load_config
from .engine import MemoryEngine
from .models import (
    ConversationIngest,
    DecayResponse,
    HealthResponse,
    ListMemoriesRequest,
    MemoryCreate,
    MemoryUpdate,
    SearchRequest,
    SearchResponse,
    StatsResponse,
    SummarizeRequest,
    SummarizeResponse,
)
from .scoring import combined_rank_score, compute_importance_score, days_since, recency_decay_factor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("recallish.api")


def _structured_to_lines(structured: dict[str, Any] | None, max_lines: int) -> list[str]:
    """Convert a structured summary dict into plain-text display lines."""
    if not structured:
        return []
    lines: list[str] = []
    if structured.get("title"):
        lines.append(structured["title"])
    if structured.get("summary"):
        summary_val = structured["summary"]
        lines.append(summary_val if isinstance(summary_val, str) else str(summary_val))
    for key, label_name in (
        ("key_points", "Key points"),
        ("important_details", "Important details"),
        ("action_items", "Action items"),
        ("decisions", "Decisions"),
    ):
        vals = structured.get(key) or []
        if vals:
            lines.append(f"{label_name}:")
            for v in vals:
                lines.append(f"- {v}")
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    return lines

engine: MemoryEngine | None = None
_config_path: str | Path | None = None


def configure(config_path: str | Path | None = None) -> None:
    global _config_path
    _config_path = config_path if config_path is not None else default_config_path()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    config = load_config(_config_path)
    engine = MemoryEngine(config)
    engine.initialize()
    logger.info("Recallish API started using store at %s", config.storage.data_dir)
    yield
    logger.info("Recallish API stopped")


app = FastAPI(
    title="Recallish API",
    description="Local-first personal AI memory layer",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_engine() -> MemoryEngine:
    if engine is None:
        raise HTTPException(status_code=503, detail="Engine not initialized")
    return engine


def _handle_engine_error(exc: Exception) -> JSONResponse:
    logger.exception("Engine error")
    if isinstance(exc, KeyError):
        return JSONResponse(status_code=404, content={"error": str(exc)})
    if isinstance(exc, ValueError):
        return JSONResponse(status_code=400, content={"error": str(exc)})
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


@app.get("/api/health", response_model=HealthResponse)
async def health():
    return HealthResponse(ok=True, service="recallish")


@app.get("/api/stats", response_model=StatsResponse)
async def get_stats():
    try:
        eng = _get_engine()
        return eng.get_memory_stats()
    except Exception as exc:
        return _handle_engine_error(exc)


@app.post("/api/memories", status_code=201)
async def create_memory(payload: MemoryCreate):
    try:
        eng = _get_engine()
        return eng.save_memory(
            content=payload.content,
            category=payload.category,
            source=payload.source,
            explicit_signal=payload.explicit_signal,
            importance_override=payload.importance_override,
            supersedes=payload.supersedes,
        )
    except Exception as exc:
        return _handle_engine_error(exc)


@app.get("/api/memories")
async def list_memories(
    category: str | None = Query(None),
    min_importance: float | None = Query(None, ge=0.0, le=1.0),
    from_date: str | None = Query(None),
    to_date: str | None = Query(None),
    include_superseded: bool = Query(False),
):
    try:
        eng = _get_engine()
        records = eng.list_memories(
            category=category,
            min_importance=min_importance,
            from_date=from_date,
            to_date=to_date,
            include_superseded=include_superseded,
        )
        records.sort(
            key=lambda item: float(item.metadata.get("importance_score", 0.0)),
            reverse=True,
        )
        return [_jsonable(asdict(r)) for r in records]
    except Exception as exc:
        return _handle_engine_error(exc)


@app.get("/api/search")
async def search_memories(
    q: str = Query(..., min_length=1),
    top_k: int = Query(8, ge=1, le=50),
    include_superseded: bool = Query(False),
):
    try:
        eng = _get_engine()
        records = eng.search_memory(
            query=q,
            top_k=top_k,
            include_superseded=include_superseded,
        )
        return [_jsonable(asdict(r)) for r in records]
    except Exception as exc:
        return _handle_engine_error(exc)


@app.post("/api/search")
async def search_memories_post(payload: SearchRequest):
    try:
        eng = _get_engine()
        records = eng.search_memory(
            query=payload.query,
            top_k=payload.top_k,
            include_superseded=payload.include_superseded,
        )
        return [_jsonable(asdict(r)) for r in records]
    except Exception as exc:
        return _handle_engine_error(exc)


@app.get("/api/conversations/recent")
async def recent_conversations(limit: int = Query(2, ge=1, le=50)):
    try:
        eng = _get_engine()
        return [_jsonable(c) for c in eng.recent_conversations(limit=limit)]
    except Exception as exc:
        return _handle_engine_error(exc)


@app.post("/api/summarize", response_model=SummarizeResponse)
async def summarize_topic(payload: SummarizeRequest):
    try:
        eng = _get_engine()
        structured = eng.summarize_structured(
            label=payload.label,
            chunks=payload.chunks[:16],
            content_type=payload.content_type,
        )
        if structured is None:
            lines = eng.summarize_topic(
                label=payload.label,
                chunks=payload.chunks[:16],
                max_lines=payload.max_lines,
            )
            error = eng.summarizer_error()
            if not error:
                # No LLM error recorded but summarization produced nothing:
                # likely the local server is down/unreachable.
                info = eng.summarizer_server_info()
                error = info.get("error") or (
                    "No summary could be produced. Configure LLM_API_KEY and LLM_BASE_URL (or OPENAI_* aliases), or start a local llama.cpp server."
                )
            return SummarizeResponse(
                lines=lines,
                structured=None,
                content_type=payload.content_type,
                error=error,
            )
        lines = _structured_to_lines(structured, payload.max_lines)
        return SummarizeResponse(
            lines=lines,
            structured=structured,
            content_type=structured.get("content_type"),
        )
    except Exception as exc:
        return _handle_engine_error(exc)


@app.patch("/api/memories/{memory_id}")
async def update_memory(memory_id: str, payload: MemoryUpdate):
    try:
        eng = _get_engine()
        return eng.update_memory(
            memory_id=memory_id,
            content=payload.content,
            importance_override=payload.importance_override,
        )
    except Exception as exc:
        return _handle_engine_error(exc)


@app.delete("/api/memories/{memory_id}")
async def delete_memory(memory_id: str):
    try:
        eng = _get_engine()
        return eng.delete_memory(memory_id=memory_id)
    except Exception as exc:
        return _handle_engine_error(exc)


@app.post("/api/conversations")
async def ingest_conversation(payload: ConversationIngest):
    try:
        eng = _get_engine()
        return eng.save_conversation_chunk(
            content=payload.content,
            source=payload.source,
            conversation_id=payload.conversation_id,
            content_hash=payload.content_hash,
        )
    except Exception as exc:
        return _handle_engine_error(exc)


@app.post("/api/decay", response_model=DecayResponse)
async def apply_decay():
    try:
        eng = _get_engine()
        return eng.apply_decay()
    except Exception as exc:
        return _handle_engine_error(exc)


@app.get("/debug/memories")
async def debug_memories(
    include_embeddings: bool = Query(False),
    query: str | None = Query(None),
    top_k: int = Query(10, ge=1, le=50),
):
    """Debug endpoint showing all stored memories with embeddings and scoring breakdown."""
    try:
        eng = _get_engine()
        
        result = eng.memories.get(include=["metadatas", "documents"])
        ids = result.get("ids", [])
        docs = result.get("documents", [])
        metas = result.get("metadatas", [])
        embeddings = []
        
        if include_embeddings:
            # Fetch embeddings separately using query with all IDs
            if ids:
                emb_result = eng.memories.get(ids=ids, include=["embeddings"])
                embeddings = emb_result.get("embeddings", [])
        
        memories = []
        for idx, memory_id in enumerate(ids):
            metadata = metas[idx] if idx < len(metas) and metas[idx] is not None else {}
            if not isinstance(metadata, dict):
                metadata = {}
            
            memory = {
                "id": memory_id,
                "content": docs[idx] if idx < len(docs) else "",
                "metadata": metadata,
            }
            
            if include_embeddings and idx < len(embeddings) and embeddings[idx] is not None:
                memory["embedding"] = embeddings[idx][:10]  # First 10 dims
                memory["embedding_dim"] = len(embeddings[idx])
            
            memories.append(memory)
        
        debug_info = {
            "total_count": len(memories),
            "memories": memories,
        }
        
        if query:
            collection_size = eng.memories.count()
            candidate_count = max(top_k * eng.config.retrieval.candidate_multiplier, top_k)
            safe_n = max(1, min(candidate_count, collection_size))
            search_result = eng.memories.query(
                query_texts=[query],
                n_results=safe_n,
                include=["metadatas", "documents", "distances", "embeddings"],
            )
            
            search_ids = search_result.get("ids", [[]])[0]
            search_docs = search_result.get("documents", [[]])[0]
            search_metas = search_result.get("metadatas", [[]])[0]
            search_distances = search_result.get("distances", [[]])[0]
            search_embeddings = search_result.get("embeddings", [[]])[0] if include_embeddings else []
            
            scored_results = []
            for idx, memory_id in enumerate(search_ids):
                metadata = search_metas[idx] if idx < len(search_metas) and search_metas[idx] is not None else {}
                if not isinstance(metadata, dict):
                    metadata = {}
                
                distance = float(search_distances[idx]) if idx < len(search_distances) and search_distances[idx] is not None else 1.0
                similarity = max(0.0, min(1.0, 1.0 - distance))
                importance = float(metadata.get("importance_score", 0.5))
                
                recency = recency_decay_factor(eng.config, metadata.get("updated_at"))
                
                combined = combined_rank_score(
                    eng.config,
                    similarity=similarity,
                    importance_score=importance,
                    updated_at=str(metadata.get("updated_at", "")),
                )
                
                importance_details = compute_importance_score(
                    eng.config,
                    explicit_signal=bool(metadata.get("explicit_signal", False)),
                    category=str(metadata.get("category", "misc")),
                    access_count=int(metadata.get("access_count", 0) or 0),
                    last_accessed_at=str(metadata.get("last_accessed_at", "")),
                )
                
                scoring_breakdown = {
                    "similarity": round(similarity, 4),
                    "importance_score": round(importance, 4),
                    "importance_recalculated": round(importance_details, 4),
                    "recency_factor": round(recency, 4),
                    "combined_score": round(combined, 4),
                    "weights": {
                        "similarity_weight": eng.config.ranking.similarity_weight,
                        "importance_weight": eng.config.ranking.importance_weight,
                        "recency_weight": eng.config.ranking.recency_weight,
                        "strategy": eng.config.ranking.strategy,
                    },
                    "importance_components": {
                        "explicit_signal": 1.0 if metadata.get("explicit_signal") else 0.2,
                        "recency_component": round(recency, 4),
                        "access_component": round(
                            (importance_details - 
                             eng.config.scoring.explicit_signal_weight * (1.0 if metadata.get("explicit_signal") else 0.2) -
                             eng.config.scoring.recency_weight * recency -
                             eng.config.scoring.category_weight * eng.config.scoring.category_weights.get(metadata.get("category", "misc"), 0.5)
                            ) / eng.config.scoring.access_weight, 4),
                        "category_weight": eng.config.scoring.category_weights.get(metadata.get("category", "misc"), 0.5),
                    },
                }
                
                scored_results.append({
                    "id": memory_id,
                    "content": search_docs[idx] if idx < len(search_docs) else "",
                    "metadata": metadata,
                    "scoring_breakdown": scoring_breakdown,
                })
            
            scored_results.sort(key=lambda x: x["scoring_breakdown"]["combined_score"], reverse=True)
            debug_info["search_query"] = query
            debug_info["search_results"] = scored_results[:top_k]
        
        return debug_info
    except Exception as exc:
        return _handle_engine_error(exc)


def _jsonable(value: Any) -> Any:
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    return value


def run(host: str = "127.0.0.1", port: int = 8765, config_path: str | Path | None = None) -> None:
    import uvicorn

    configure(config_path)

    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Recallish FastAPI server")
    parser.add_argument("--config", default=None, help="Path to YAML config")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    run(host=args.host, port=args.port, config_path=args.config)