import json
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

from recallish.config import RecallishConfig
from recallish.engine import MemoryEngine
from recallish.http_api import create_handler


def test_http_list_add_search_delete(tmp_path: Path) -> None:
    config = RecallishConfig()
    config.storage.data_dir = str(tmp_path)
    engine = MemoryEngine(config)
    server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(engine))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]

    try:
        conn = HTTPConnection(host, port, timeout=120)

        conn.request("GET", "/api/memories")
        listed = conn.getresponse()
        assert listed.status == 200
        assert json.loads(listed.read()) == []

        payload = json.dumps(
            {
                "content": "We use ChromaDB locally",
                "category": "project_fact",
                "source": "test",
                "explicit_signal": True,
            }
        ).encode("utf-8")
        conn.request("POST", "/api/memories", body=payload, headers={"Content-Type": "application/json"})
        created = conn.getresponse()
        created_body = json.loads(created.read())
        assert created.status == 201
        memory_id = created_body["id"]

        conn.request("GET", "/api/search?q=chroma")
        search = conn.getresponse()
        hits = json.loads(search.read())
        assert search.status == 200
        assert any(item["id"] == memory_id for item in hits)

        conn.request("DELETE", f"/api/memories/{memory_id}")
        deleted = conn.getresponse()
        assert deleted.status == 200
        assert json.loads(deleted.read())["deleted"] is True

        conn.request("GET", "/api/stats")
        stats = conn.getresponse()
        stats_body = json.loads(stats.read())
        assert stats.status == 200
        assert stats_body["total_count"] == 0
    finally:
        server.shutdown()
        server.server_close()


def test_http_conversation_upsert_preserves_id(tmp_path: Path) -> None:
    config = RecallishConfig()
    config.storage.data_dir = str(tmp_path)
    engine = MemoryEngine(config)
    server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(engine))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]

    try:
        conn = HTTPConnection(host, port, timeout=120)
        headers = {"Content-Type": "application/json"}

        conn.request(
            "POST",
            "/api/conversations",
            body=json.dumps(
                {
                    "content": "User: Initial project question",
                    "source": "extension:ChatGPT",
                    "conversation_id": "chatgpt-conv-1",
                    "content_hash": "hash-1",
                }
            ),
            headers=headers,
        )
        first = conn.getresponse()
        first_body = json.loads(first.read())
        assert first.status == 201

        conn.request(
            "POST",
            "/api/conversations",
            body=json.dumps(
                {
                    "content": "User: Initial project question\n\nAssistant: Updated answer",
                    "source": "extension:ChatGPT",
                    "conversation_id": "chatgpt-conv-1",
                    "content_hash": "hash-2",
                }
            ),
            headers=headers,
        )
        second = conn.getresponse()
        second_body = json.loads(second.read())
        assert second.status == 201
        assert second_body["conversation_id"] == first_body["conversation_id"]
        assert second_body["updated"] is True

        conn.request("GET", "/api/conversations/recent?limit=10")
        recent = conn.getresponse()
        recent_body = json.loads(recent.read())
        assert recent.status == 200
        assert len(recent_body) == 1
        assert recent_body[0]["content"].endswith("Assistant: Updated answer")
    finally:
        server.shutdown()
        server.server_close()
