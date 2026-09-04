from __future__ import annotations

import argparse
import json
import sys
import threading
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .config import default_config_path, load_config
from .engine import MemoryEngine, MemoryRecord


def _jsonable(value: Any) -> Any:
    if isinstance(value, MemoryRecord):
        return _jsonable(asdict(value))
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    if isinstance(value, Path):
        return str(value)
    return value


def create_handler(engine: MemoryEngine) -> type[BaseHTTPRequestHandler]:
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, status: int, payload: Any) -> None:
            body = json.dumps(_jsonable(payload), indent=2, ensure_ascii=True).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            if not raw:
                return {}
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("JSON body must be an object")
            return data

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            query = parse_qs(parsed.query)

            try:
                if path in {"/", "/api/health"}:
                    self._send(200, {"ok": True, "service": "recallish"})
                    return
                with lock:
                    if path == "/api/stats":
                        self._send(200, engine.get_memory_stats())
                        return
                    if path == "/api/memories":
                        records = engine.list_memories(
                            category=query.get("category", [None])[0],
                            min_importance=_optional_float(query.get("min_importance", [None])[0]),
                            include_superseded=_truthy(query.get("include_superseded", ["false"])[0]),
                        )
                        records.sort(
                            key=lambda item: float(item.metadata.get("importance_score", 0.0)),
                            reverse=True,
                        )
                        self._send(200, records)
                        return
                    if path == "/api/search":
                        q = (query.get("q") or query.get("query") or [""])[0]
                        top_k = int((query.get("top_k") or ["8"])[0])
                        records = engine.search_memory(query=q, top_k=top_k)
                        self._send(200, records)
                        return
                    if path == "/api/conversations/recent":
                        limit = int((query.get("limit") or ["2"])[0])
                        self._send(200, engine.recent_conversations(limit=limit))
                        return
            except Exception as exc:
                self._send(500, {"error": str(exc)})
                return

            self._send(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            try:
                body = self._read_json()
                if path == "/api/summarize":
                    with lock:
                        label = str(body.get("label") or "topic")[:200]
                        chunks = [str(item) for item in (body.get("chunks") or []) if str(item).strip()]
                        max_lines = min(int(body.get("max_lines") or 4), 20)
                        content_type = body.get("content_type") or None
                        structured = engine.summarize_structured(
                            label=label,
                            chunks=chunks[:16],
                            content_type=content_type,
                        )
                        lines = _structured_to_lines(structured, max_lines)
                        error = None
                        if structured is None:
                            error = engine.summarizer_error()
                            if not error:
                                info = engine.summarizer_server_info()
                                error = info.get("error") or (
                                    "No summary could be produced. Configure LLM_API_KEY and LLM_BASE_URL (or OPENAI_* aliases), or start a local llama.cpp server."
                                )
                        resp = {
                            "lines": lines,
                            "structured": structured,
                            "content_type": structured.get("content_type") if structured else content_type,
                        }
                        if error:
                            resp["error"] = error
                        self._send(200, resp)
                        return
                with lock:
                    if path == "/api/memories":
                        content = str(body.get("content") or "").strip()
                        if not content:
                            self._send(400, {"error": "content is required"})
                            return
                        result = engine.save_memory(
                            content=content,
                            category=body.get("category"),
                            source=str(body.get("source") or "inspector"),
                            explicit_signal=bool(body.get("explicit_signal", True)),
                            importance_override=_optional_float(body.get("importance_override")),
                            supersedes=body.get("supersedes"),
                        )
                        self._send(201, result)
                        return
                    if path == "/api/search":
                        records = engine.search_memory(
                            query=str(body.get("query") or ""),
                            top_k=int(body.get("top_k") or 8),
                            include_superseded=bool(body.get("include_superseded", False)),
                        )
                        self._send(200, records)
                        return
                    if path == "/api/conversations":
                        content = str(body.get("content") or "").strip()
                        if not content:
                            self._send(400, {"error": "content is required"})
                            return
                        result = engine.save_conversation_chunk(
                            content=content,
                            source=str(body.get("source") or "inspector"),
                            conversation_id=body.get("conversation_id"),
                            content_hash=body.get("content_hash"),
                        )
                        self._send(201, result)
                        return
                    if path == "/api/decay":
                        result = engine.apply_decay()
                        self._send(200, result)
                        return
            except Exception as exc:
                self._send(400, {"error": str(exc)})
                return

            self._send(404, {"error": "not found"})

        def do_PATCH(self) -> None:  # noqa: N802
            memory_id = _memory_id_from_path(urlparse(self.path).path)
            if not memory_id:
                self._send(404, {"error": "not found"})
                return
            try:
                body = self._read_json()
                with lock:
                    result = engine.update_memory(
                        memory_id=memory_id,
                        content=body.get("content"),
                        importance_override=_optional_float(body.get("importance_override")),
                    )
                self._send(200, result)
            except KeyError as exc:
                self._send(404, {"error": str(exc)})
            except Exception as exc:
                self._send(400, {"error": str(exc)})

        def do_DELETE(self) -> None:  # noqa: N802
            memory_id = _memory_id_from_path(urlparse(self.path).path)
            if not memory_id:
                self._send(404, {"error": "not found"})
                return
            try:
                with lock:
                    result = engine.delete_memory(memory_id=memory_id)
                self._send(200, result)
            except Exception as exc:
                self._send(400, {"error": str(exc)})

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    return Handler


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


def _memory_id_from_path(path: str) -> str | None:
    parts = [part for part in path.split("/") if part]
    if len(parts) == 3 and parts[0] == "api" and parts[1] == "memories":
        return parts[2]
    return None


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _truthy(value: str | None) -> bool:
    return str(value or "").lower() in {"1", "true", "yes", "on"}


def serve(engine: MemoryEngine, host: str = "127.0.0.1", port: int = 8765) -> None:
    engine.initialize()
    handler = create_handler(engine)
    server = ThreadingHTTPServer((host, port), handler)
    print(f"Recallish inspector API listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping inspector API")
        server.server_close()


def run() -> None:
    parser = argparse.ArgumentParser(description="Recallish inspector HTTP API")
    parser.add_argument("--config", default=str(default_config_path()), help="Path to YAML config")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    config = load_config(args.config)
    engine = MemoryEngine(config)
    engine.initialize()
    serve(engine, host=args.host, port=args.port)


if __name__ == "__main__":
    run()
