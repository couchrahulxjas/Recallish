from __future__ import annotations

import argparse
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from .config import default_config_path, load_config
from .engine import MemoryEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("recallish.mcp")


def create_server(config_path: str | None = None) -> FastMCP:
    config = load_config(config_path or default_config_path())
    engine = MemoryEngine(config)
    engine.initialize()

    mcp = FastMCP(name="recallish")

    @mcp.tool()
    def save_memory(
        content: str,
        category: str | None = None,
        source: str = "unknown",
        explicit_signal: bool = True,
    ) -> dict[str, Any]:
        """Save one memory entry from a client.

        Args:
            content: The memory text to store
            category: Category - one of: fact, skill, project, goal, preference, temporary
            source: Source/provider label (e.g., 'claude', 'cursor', 'manual')
            explicit_signal: Whether this was explicitly requested to be remembered
        """
        try:
            return engine.save_memory(
                content=content,
                category=category,
                source=source,
                explicit_signal=explicit_signal,
            )
        except Exception as exc:
            logger.exception("save_memory failed")
            raise RuntimeError(f"Failed to save memory: {exc}") from exc

    @mcp.tool()
    def ingest_conversation(content: str, source: str = "unknown") -> dict[str, Any]:
        """Extract and save durable memories from a raw conversation chunk.

        Args:
            content: Raw conversation text to extract memories from
            source: Source/provider label
        """
        try:
            return engine.save_conversation_chunk(content=content, source=source)
        except Exception as exc:
            logger.exception("ingest_conversation failed")
            raise RuntimeError(f"Failed to ingest conversation: {exc}") from exc

    @mcp.tool()
    def summarize_content(
        label: str,
        chunks: list[str],
        content_type: str | None = None,
        max_lines: int = 4,
    ) -> dict[str, Any]:
        """Summarize the provided text via the configured OpenAI-compatible model.

        Runs the content-aware, hierarchical summarization pipeline and returns
        a structured summary (title, summary, key_points, important_details,
        action_items, decisions, memory_candidates). Use this when you already
        have the raw text to summarize.

        Args:
            label: Short human-readable label/title for the topic
            chunks: One or more text chunks to summarize (raw conversation text)
            content_type: Optional hint - one of: code, technical, research,
                general, discussion. Auto-detected if omitted.
            max_lines: Max plain-text lines to include in the fallback 'lines'
        """
        try:
            structured = engine.summarize_structured(
                label=label,
                chunks=chunks[:16],
                content_type=content_type,
            )
            if structured is not None:
                return structured
            lines = engine.summarize_topic(
                label=label,
                chunks=chunks[:16],
                max_lines=max_lines,
            )
            error = engine.summarizer_error()
            if not error:
                info = engine.summarizer_server_info()
                error = info.get("error") or (
                    "No summary could be produced. Configure LLM_API_KEY and LLM_BASE_URL (or OPENAI_* aliases), or start a local llama.cpp server."
                )
            return {"error": error, "lines": lines}
        except Exception as exc:
            logger.exception("summarize_content failed")
            raise RuntimeError(f"Failed to summarize content: {exc}") from exc

    @mcp.tool()
    def summarize_memories(
        query: str,
        top_k: int = 5,
        content_type: str | None = None,
        max_lines: int = 4,
    ) -> dict[str, Any]:
        """Summarize stored memories matching a query.

        Retrieves the most relevant stored memories for the query, joins their
        content, and runs the local summarization pipeline on them. Use this to
        condense what Recallish already knows about a topic before passing the
        result to another agent/model.

        Args:
            query: Search query to find relevant stored memories
            top_k: Number of memories to retrieve and summarize (1-50)
            content_type: Optional hint - one of: code, technical, research,
                general, discussion. Auto-detected if omitted.
            max_lines: Max plain-text lines to include in the fallback 'lines'
        """
        try:
            records = engine.search_memory(query=query, top_k=top_k, include_superseded=False)
            if not records:
                return {"error": f"No memories found for query: {query!r}", "lines": []}
            chunks = [getattr(r, "content", "") or "" for r in records]
            label = query
            structured = engine.summarize_structured(
                label=label,
                chunks=chunks[:16],
                content_type=content_type,
            )
            if structured is not None:
                return structured
            lines = engine.summarize_topic(
                label=label,
                chunks=chunks[:16],
                max_lines=max_lines,
            )
            error = engine.summarizer_error()
            if not error:
                info = engine.summarizer_server_info()
                error = info.get("error") or (
                    "No summary could be produced. Check that llama.cpp "
                    "(llama-server) is running on port 8080."
                )
            return {"error": error, "lines": lines}
        except Exception as exc:
            logger.exception("summarize_memories failed")
            raise RuntimeError(f"Failed to summarize memories: {exc}") from exc

    @mcp.tool()
    def search_memory(
        query: str,
        top_k: int = 5,
        include_superseded: bool = False,
    ) -> list[dict[str, Any]]:
        """Search memory with semantic retrieval and importance-aware ranking.

        Args:
            query: Search query text
            top_k: Number of results to return (1-50)
            include_superseded: Whether to include superseded memories
        """
        try:
            records = engine.search_memory(
                query=query,
                top_k=top_k,
                include_superseded=include_superseded,
            )
            return [asdict(record) for record in records]
        except Exception as exc:
            logger.exception("search_memory failed")
            raise RuntimeError(f"Search failed: {exc}") from exc

    @mcp.tool()
    def list_memories(
        category: str | None = None,
        min_importance: float | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
        include_superseded: bool = False,
    ) -> list[dict[str, Any]]:
        """List memories with optional filters.

        Args:
            category: Filter by category
            min_importance: Minimum importance score (0.0-1.0)
            from_date: ISO date lower bound (inclusive)
            to_date: ISO date upper bound (inclusive)
            include_superseded: Whether to include superseded memories
        """
        try:
            records = engine.list_memories(
                category=category,
                min_importance=min_importance,
                from_date=from_date,
                to_date=to_date,
                include_superseded=include_superseded,
            )
            return [asdict(record) for record in records]
        except Exception as exc:
            logger.exception("list_memories failed")
            raise RuntimeError(f"List failed: {exc}") from exc

    @mcp.tool()
    def update_memory(
        id: str,
        content: str | None = None,
        importance_override: float | None = None,
    ) -> dict[str, Any]:
        """Update memory content or override importance.

        Args:
            id: Memory ID to update
            content: New memory content (optional)
            importance_override: Override importance score 0.0-1.0 (optional)
        """
        try:
            return engine.update_memory(
                memory_id=id,
                content=content,
                importance_override=importance_override,
            )
        except Exception as exc:
            logger.exception("update_memory failed")
            raise RuntimeError(f"Update failed: {exc}") from exc

    @mcp.tool()
    def delete_memory(id: str) -> dict[str, Any]:
        """Delete one memory by id.

        Args:
            id: Memory ID to delete
        """
        try:
            return engine.delete_memory(memory_id=id)
        except Exception as exc:
            logger.exception("delete_memory failed")
            raise RuntimeError(f"Delete failed: {exc}") from exc

    @mcp.tool()
    def get_memory_stats() -> dict[str, Any]:
        """Return memory statistics for local store."""
        try:
            return engine.get_memory_stats()
        except Exception as exc:
            logger.exception("get_memory_stats failed")
            raise RuntimeError(f"Stats failed: {exc}") from exc

    @mcp.tool()
    def apply_decay() -> dict[str, Any]:
        """Apply importance decay to idle memories.

        Reduces importance of memories not accessed recently.
        """
        try:
            return engine.apply_decay()
        except Exception as exc:
            logger.exception("apply_decay failed")
            raise RuntimeError(f"Decay failed: {exc}") from exc

    return mcp


def run() -> None:
    parser = argparse.ArgumentParser(description="Recallish MCP server")
    parser.add_argument("--config", default=str(default_config_path()), help="Path to YAML config")
    args = parser.parse_args()

    server = create_server(args.config)
    server.run(transport="stdio")


if __name__ == "__main__":
    run()