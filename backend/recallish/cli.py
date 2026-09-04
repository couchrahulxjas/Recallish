from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from pathlib import Path
from typing import Any

from .config import default_config_path, load_config
from .engine import MemoryEngine


def _json_print(payload: Any) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=True))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="recallish", description="Recallish local-first memory engine CLI")
    parser.add_argument("--config", default=str(default_config_path()), help="Path to YAML config")

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init", help="Initialize local Chroma store")

    add = subparsers.add_parser("add", help="Add a memory")
    add.add_argument("text", help="Memory content")
    add.add_argument("--category", default=None, help="Memory category")
    add.add_argument("--source", default="manual", help="Source/provider label")
    add.add_argument("--explicit", action="store_true", help="Mark as explicit remember signal")

    ingest = subparsers.add_parser("ingest", help="Ingest raw conversation chunk and extract memories")
    ingest.add_argument("text", help="Conversation chunk")
    ingest.add_argument("--source", default="unknown", help="Source/provider label")

    search = subparsers.add_parser("search", help="Search memories")
    search.add_argument("query", help="Search query")
    search.add_argument("--top-k", type=int, default=5, help="Top result count")
    search.add_argument("--include-superseded", action="store_true", help="Include superseded memories")

    list_cmd = subparsers.add_parser("list", help="List memories")
    list_cmd.add_argument("--category", default=None, help="Filter by category")
    list_cmd.add_argument("--min-importance", type=float, default=None, help="Minimum importance")
    list_cmd.add_argument("--from-date", default=None, help="ISO date lower bound")
    list_cmd.add_argument("--to-date", default=None, help="ISO date upper bound")
    list_cmd.add_argument(
        "--sort",
        choices=["importance", "recency"],
        default="importance",
        help="Sort field",
    )

    update = subparsers.add_parser("update", help="Update memory")
    update.add_argument("id", help="Memory id")
    update.add_argument("--content", default=None, help="New memory content")
    update.add_argument("--importance-override", type=float, default=None, help="Override importance 0..1")

    delete = subparsers.add_parser("delete", help="Delete memory")
    delete.add_argument("id", help="Memory id")

    subparsers.add_parser("decay", help="Run decay job")
    subparsers.add_parser("stats", help="Memory stats")

    serve = subparsers.add_parser("serve", help="Run local inspector HTTP API")
    serve.add_argument("--host", default="127.0.0.1", help="Bind host")
    serve.add_argument("--port", type=int, default=8765, help="Bind port")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    config = load_config(args.config)
    engine = MemoryEngine(config)

    if args.command == "init":
        _json_print(engine.initialize())
        return

    if args.command == "add":
        payload = engine.save_memory(
            content=args.text,
            category=args.category,
            source=args.source,
            explicit_signal=bool(args.explicit),
        )
        _json_print(payload)
        return

    if args.command == "ingest":
        payload = engine.save_conversation_chunk(content=args.text, source=args.source)
        _json_print(payload)
        return

    if args.command == "search":
        items = engine.search_memory(
            query=args.query,
            top_k=args.top_k,
            include_superseded=bool(args.include_superseded),
        )
        _json_print([asdict(item) for item in items])
        return

    if args.command == "list":
        records = engine.list_memories(
            category=args.category,
            min_importance=args.min_importance,
            from_date=args.from_date,
            to_date=args.to_date,
        )

        if args.sort == "importance":
            records.sort(key=lambda item: float(item.metadata.get("importance_score", 0.0)), reverse=True)
        else:
            records.sort(key=lambda item: str(item.metadata.get("updated_at", "")), reverse=True)

        _json_print([asdict(item) for item in records])
        return

    if args.command == "update":
        payload = engine.update_memory(
            memory_id=args.id,
            content=args.content,
            importance_override=args.importance_override,
        )
        _json_print(payload)
        return

    if args.command == "delete":
        _json_print(engine.delete_memory(memory_id=args.id))
        return

    if args.command == "decay":
        _json_print(engine.apply_decay())
        return

    if args.command == "stats":
        _json_print(engine.get_memory_stats())
        return

    if args.command == "serve":
        from .http_api import serve as serve_api

        serve_api(engine, host=args.host, port=args.port)
        return

    parser.error(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
