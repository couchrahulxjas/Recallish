from pathlib import Path

from recallish.config import RecallishConfig
from recallish.engine import MemoryEngine


def _engine(tmp_path: Path) -> MemoryEngine:
    config = RecallishConfig()
    config.storage.data_dir = str(tmp_path)
    return MemoryEngine(config)


def test_empty_store_search_returns_empty_list(tmp_path: Path) -> None:
    engine = _engine(tmp_path)
    assert engine.search_memory("anything at all") == []


def test_save_then_search_finds_memory(tmp_path: Path) -> None:
    engine = _engine(tmp_path)
    saved = engine.save_memory(
        "Rahul prefers compact code reviews",
        category="preference",
        source="test",
        explicit_signal=True,
    )
    hits = engine.search_memory("code review preferences")
    assert hits
    assert any(item.id == saved["id"] for item in hits)


def test_similar_memory_is_superseded(tmp_path: Path) -> None:
    engine = _engine(tmp_path)
    first = engine.save_memory("Use ChromaDB for the local vector store", category="project_fact")
    second = engine.save_memory("Use ChromaDB for the local vector store", category="project_fact")

    assert second["superseded"] is True
    assert second["superseded_id"] == first["id"]

    active = engine.search_memory("ChromaDB vector store")
    assert active
    assert all(item.id != first["id"] for item in active)
