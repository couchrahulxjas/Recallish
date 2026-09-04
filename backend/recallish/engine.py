from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import json
from dataclasses import asdict
from math import exp
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

# Suppress the ChromaDB 0.6.x posthog telemetry bug that prints
# "Failed to send telemetry event ... capture() takes 1 positional argument"
# to stderr. This is a known upstream issue; the line below is safe to remove
# once ChromaDB fixes the posthog client signature mismatch.
try:
    import posthog  # noqa: F401
    posthog.capture = lambda *args, **kwargs: None  # type: ignore[attr-defined]
except Exception:  # pragma: no cover
    pass

from chromadb import PersistentClient
from chromadb.config import Settings
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction

from .config import RecallishConfig
from .extraction import CandidateMemory, extract_candidate_memories
from .llm_extraction import LLMExtractedMemory, create_llm_extractor_from_config
from .scoring import combined_rank_score, compute_importance_score, days_since, utc_now


@dataclass(slots=True)
class MemoryRecord:
    id: str
    content: str
    metadata: dict[str, Any]
    similarity: float
    combined_score: float


class MemoryEngine:
    def __init__(self, config: RecallishConfig) -> None:
        self.config = config

        # Keep embedding initialization local and avoid optional TF imports.
        os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
        os.environ.setdefault("USE_TF", "0")

        data_dir = Path(config.storage.data_dir).resolve()
        data_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir = data_dir

        self.conversation_log_path = data_dir / config.storage.conversations_log

        embedding_function = SentenceTransformerEmbeddingFunction(
            model_name="all-MiniLM-L6-v2"
        )
        self.client = PersistentClient(
            path=str(data_dir / "chroma"),
            settings=Settings(anonymized_telemetry=False),
        )
        self.memories = self.client.get_or_create_collection(
            name=config.storage.collection_name,
            embedding_function=embedding_function,
            metadata={"hnsw:space": "cosine"},
        )
        self._llm_extractor = create_llm_extractor_from_config(
            {"llm": asdict(config.llm)}
        )
        self._llm_summarizer = create_llm_extractor_from_config(
            {"llm": asdict(config.llm)},
            for_summarization=True,
        )

    def initialize(self) -> dict[str, Any]:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.conversation_log_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.conversation_log_path.exists():
            self.conversation_log_path.write_text("", encoding="utf-8")
        return {
            "storage_dir": str(self.data_dir),
            "collection": self.memories.name,
            "conversation_log": str(self.conversation_log_path),
        }

    def summarize_topic(self, label: str, chunks: list[str], max_lines: int = 4) -> list[str]:
        if self._llm_summarizer is None or not chunks:
            return []
        return self._llm_summarizer.summarize_topic(
            label=label,
            chunks=[str(chunk) for chunk in chunks],
            max_lines=max_lines,
        )

    def summarize_structured(
        self,
        label: str,
        chunks: list[str],
        content_type: str | None = None,
    ) -> dict[str, Any] | None:
        """Content-aware structured summary. Returns None when unavailable."""
        if self._llm_summarizer is None or not chunks:
            return None
        result = self._llm_summarizer.summarize_structured(
            label=label,
            chunks=[str(chunk) for chunk in chunks],
            content_type=content_type,
        )
        if result is None:
            return None
        grouped = result.relevance_sections()
        structured = {
            "title": result.title,
            "content_type": result.content_type,
            "summary": result.summary,
            "key_points": result.key_points,
            "important_details": result.important_details,
            "action_items": result.action_items,
            "decisions": result.decisions,
            "memory_candidates": result.memory_candidates,
        }
        structured["sections"] = [
            {"key": key, "label": label_, "value": value}
            for key, label_, value in grouped
        ]
        return structured

    def summarizer_error(self) -> str | None:
        """Return the most recent summarizer error message, if any."""
        if self._llm_summarizer is None:
            return "Summarization is not enabled (no LLM configured)."
        return self._llm_summarizer.last_error

    def summarizer_server_info(self) -> dict[str, Any]:
        """Probe llama.cpp and report availability + model info."""
        if self._llm_summarizer is None:
            return {"available": False, "error": "Summarization is not enabled."}
        return self._llm_summarizer.get_server_info()

    def save_memory(
        self,
        content: str,
        category: str | None = None,
        *,
        source: str = "unknown",
        explicit_signal: bool = False,
        importance_override: float | None = None,
        supersedes: str | None = None,
    ) -> dict[str, Any]:
        memory_id = str(uuid4())
        now = utc_now().isoformat()
        normalized_category = category or "misc"

        if importance_override is not None:
            importance_score = max(0.0, min(1.0, importance_override))
        else:
            importance_score = compute_importance_score(
                self.config,
                explicit_signal=explicit_signal,
                category=normalized_category,
                access_count=0,
                last_accessed_at=now,
            )

        metadata: dict[str, Any] = {
            "source": source,
            "created_at": now,
            "updated_at": now,
            "importance_score": importance_score,
            "category": normalized_category,
            "last_accessed_at": now,
            "access_count": 0,
            "superseded_by": "",
            "explicit_signal": explicit_signal,
        }

        replaced_id = supersedes or self._find_and_supersede_if_needed(content, memory_id)

        if supersedes:
            existing = self.memories.get(ids=[supersedes], include=["metadatas", "documents"])
            existing_meta = (existing.get("metadatas") or [{}])[0] or {}
            existing_doc = (existing.get("documents") or [""])[0] or ""
            if isinstance(existing_meta, dict):
                existing_meta["superseded_by"] = memory_id
                existing_meta["updated_at"] = now
                self.memories.update(ids=[supersedes], documents=[existing_doc], metadatas=[existing_meta])

        self.memories.add(ids=[memory_id], documents=[content], metadatas=[metadata])

        return {
            "id": memory_id,
            "superseded": replaced_id is not None,
            "superseded_id": replaced_id,
            "importance_score": importance_score,
        }

    def save_conversation_chunk(
        self,
        content: str,
        source: str,
        conversation_id: str | None = None,
        content_hash: str | None = None,
    ) -> dict[str, Any]:
        """Persist a raw conversation.

        When ``conversation_id`` is provided, this acts as an *upsert*: it
        looks up the most recent previous record for that conversation and
        updates its content in place instead of appending a new row. This
        keeps a single evolving record per conversation and avoids creating a
        duplicate every time an AI site mutates its DOM.

        If ``content_hash`` also matches, no write happens at all (the latest
        record is already up to date), so unrelated DOM changes never spawn
        duplicate extractions.
        """
        now = utc_now().isoformat()

        existing_id = None
        if conversation_id:
            existing_id = self._find_conversation_id(conversation_id)
            if existing_id is not None and content_hash is not None:
                stored_hash = self._get_conversation_hash(existing_id)
                if stored_hash == content_hash:
                    return {
                        "conversation_id": existing_id,
                        "updated": False,
                        "duplicate": True,
                        "saved_memories": [],
                    }

        if existing_id is not None:
            record = {
                "id": existing_id,
                "conversation_id": conversation_id,
                "source": source,
                "created_at": self._get_conversation_created(existing_id) or now,
                "updated_at": now,
                "content_hash": content_hash,
                "content": content,
            }
            self._upsert_conversation(record, replace_id=existing_id)
            extracted = self.extract_and_save_memories(content=content, source=source)
            return {
                "conversation_id": existing_id,
                "updated": True,
                "duplicate": False,
                "saved_memories": extracted,
            }

        record = {
            "id": str(uuid4()),
            "conversation_id": conversation_id,
            "source": source,
            "created_at": now,
            "updated_at": now,
            "content_hash": content_hash,
            "content": content,
        }
        self.conversation_log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.conversation_log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=True) + "\n")

        extracted = self.extract_and_save_memories(content=content, source=source)
        return {"conversation_id": record["id"], "updated": True, "duplicate": False, "saved_memories": extracted}

    @staticmethod
    def _read_conversation_records(path: Path) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        if not path.exists():
            return records
        try:
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except (json.JSONDecodeError, TypeError):
                        continue
                    if isinstance(record, dict):
                        records.append(record)
        except OSError:
            return []
        return records

    def _find_conversation_id(self, conversation_id: str) -> str | None:
        """Return the record id of the most recent record with the given id."""
        records = self._read_conversation_records(self.conversation_log_path)
        for record in reversed(records):
            if record.get("conversation_id") == conversation_id:
                return record.get("id")
        return None

    def _get_conversation_hash(self, record_id: str) -> str | None:
        records = self._read_conversation_records(self.conversation_log_path)
        for record in records:
            if record.get("id") == record_id:
                return record.get("content_hash")
        return None

    def _get_conversation_created(self, record_id: str) -> str | None:
        records = self._read_conversation_records(self.conversation_log_path)
        for record in records:
            if record.get("id") == record_id:
                return record.get("created_at")
        return None

    def _upsert_conversation(self, new_record: dict[str, Any], replace_id: str) -> None:
        """Rewrite the JSONL, replacing the record ``replace_id`` in place."""
        records = self._read_conversation_records(self.conversation_log_path)
        replaced = False
        with self.conversation_log_path.open("w", encoding="utf-8") as handle:
            for record in records:
                if record.get("id") == replace_id:
                    handle.write(json.dumps(new_record, ensure_ascii=True) + "\n")
                    replaced = True
                elif record.get("content"):
                    handle.write(json.dumps(record, ensure_ascii=True) + "\n")
            if not replaced:
                handle.write(json.dumps(new_record, ensure_ascii=True) + "\n")

    def recent_conversations(self, limit: int = 2) -> list[dict[str, Any]]:
        """Return the most recent conversation chunks from the JSONL log.

        Records are returned newest-first, limited to ``limit`` entries with
        non-empty content.
        """
        if not self.conversation_log_path.exists():
            return []
        records: list[dict[str, Any]] = []
        try:
            with self.conversation_log_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except (json.JSONDecodeError, TypeError):
                        continue
                    if isinstance(record, dict) and str(record.get("content") or "").strip():
                        records.append(record)
        except OSError:
            return []
        records.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        return records[: max(1, int(limit))]

    def extract_and_save_memories(self, content: str, source: str) -> list[dict[str, Any]]:
        if self._llm_extractor is not None:
            existing_memories = self._get_recent_memories_for_context()
            llm_memories = self._llm_extractor.extract_memories(
                conversation=content,
                existing_memories=existing_memories,
            )
            saved: list[dict[str, Any]] = []
            for mem in llm_memories:
                saved.append(
                    self.save_memory(
                        content=mem.content,
                        category=mem.category,
                        source=source,
                        explicit_signal=mem.importance_score >= 0.7,
                        importance_override=mem.importance_score,
                        supersedes=mem.supersedes,
                    )
                )
            return saved

        candidates = extract_candidate_memories(content)
        saved: list[dict[str, Any]] = []
        for candidate in candidates:
            saved.append(
                self.save_memory(
                    content=candidate.text,
                    category=candidate.category,
                    source=source,
                    explicit_signal=candidate.explicit_signal,
                )
            )
        return saved

    def _get_recent_memories_for_context(self, limit: int = 20) -> list[dict[str, Any]]:
        try:
            result = self.memories.get(include=["metadatas", "documents"], limit=limit)
            ids = result.get("ids", [])
            docs = result.get("documents", [])
            metas = result.get("metadatas", [])
            memories = []
            for idx, memory_id in enumerate(ids):
                metadata = metas[idx] if idx < len(metas) and metas[idx] is not None else {}
                if not isinstance(metadata, dict):
                    continue
                memories.append(
                    {
                        "id": memory_id,
                        "content": docs[idx] if idx < len(docs) else "",
                        "category": metadata.get("category", "misc"),
                        "importance_score": metadata.get("importance_score", 0.5),
                    }
                )
            return memories
        except Exception:
            return []

    def search_memory(
        self,
        query: str,
        top_k: int = 5,
        *,
        include_superseded: bool = False,
    ) -> list[MemoryRecord]:
        collection_size = self.memories.count()
        if collection_size == 0:
            return []

        candidate_count = max(top_k * self.config.retrieval.candidate_multiplier, top_k)
        # Cap n_results to the current collection size to avoid potential
        # errors in future ChromaDB versions that may reject n_results > count.
        safe_n = max(1, min(candidate_count, collection_size))
        result = self.memories.query(
            query_texts=[query],
            n_results=safe_n,
            include=["metadatas", "documents", "distances"],
        )

        ids = result.get("ids", [[]])[0]
        docs = result.get("documents", [[]])[0]
        metas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]

        ranked: list[MemoryRecord] = []
        for idx, memory_id in enumerate(ids):
            metadata = metas[idx] if idx < len(metas) and metas[idx] is not None else {}
            if not isinstance(metadata, dict):
                metadata = {}

            if (
                self.config.ranking.exclude_superseded
                and not include_superseded
                and metadata.get("superseded_by")
            ):
                continue

            distance = float(distances[idx]) if idx < len(distances) and distances[idx] is not None else 1.0
            similarity = max(0.0, min(1.0, 1.0 - distance))
            importance = float(metadata.get("importance_score", 0.5))

            combined = combined_rank_score(
                self.config,
                similarity=similarity,
                importance_score=importance,
                updated_at=str(metadata.get("updated_at", "")),
            )

            ranked.append(
                MemoryRecord(
                    id=memory_id,
                    content=docs[idx] if idx < len(docs) else "",
                    metadata=metadata,
                    similarity=similarity,
                    combined_score=combined,
                )
            )

        ranked.sort(key=lambda item: item.combined_score, reverse=True)
        top = ranked[:top_k]

        if top:
            self._touch_access([item.id for item in top])

        return top

    def list_memories(
        self,
        *,
        category: str | None = None,
        min_importance: float | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
        include_superseded: bool = False,
    ) -> list[MemoryRecord]:
        result = self.memories.get(include=["metadatas", "documents"])
        ids = result.get("ids", [])
        docs = result.get("documents", [])
        metas = result.get("metadatas", [])

        records: list[MemoryRecord] = []
        for idx, memory_id in enumerate(ids):
            metadata = metas[idx] if idx < len(metas) and metas[idx] is not None else {}
            if not isinstance(metadata, dict):
                metadata = {}

            if self.config.ranking.exclude_superseded and not include_superseded and metadata.get("superseded_by"):
                continue
            if category and metadata.get("category") != category:
                continue

            importance = float(metadata.get("importance_score", 0.0))
            if min_importance is not None and importance < min_importance:
                continue

            created_at = str(metadata.get("created_at", ""))
            if from_date and created_at and created_at < from_date:
                continue
            if to_date and created_at and created_at > to_date:
                continue

            records.append(
                MemoryRecord(
                    id=memory_id,
                    content=docs[idx] if idx < len(docs) else "",
                    metadata=metadata,
                    similarity=0.0,
                    combined_score=importance,
                )
            )

        return records

    def update_memory(
        self,
        memory_id: str,
        *,
        content: str | None = None,
        importance_override: float | None = None,
    ) -> dict[str, Any]:
        current = self.memories.get(ids=[memory_id], include=["metadatas", "documents"])
        if not current.get("ids"):
            raise KeyError(f"Memory {memory_id} not found")

        existing_document = (current.get("documents") or [""])[0] or ""
        existing_metadata = (current.get("metadatas") or [{}])[0] or {}
        if not isinstance(existing_metadata, dict):
            existing_metadata = {}

        next_content = content if content is not None else existing_document
        next_metadata = dict(existing_metadata)
        next_metadata["updated_at"] = utc_now().isoformat()

        if importance_override is not None:
            next_metadata["importance_score"] = max(0.0, min(1.0, importance_override))
        else:
            next_metadata["importance_score"] = compute_importance_score(
                self.config,
                explicit_signal=bool(next_metadata.get("explicit_signal", False)),
                category=str(next_metadata.get("category", "misc")),
                access_count=int(next_metadata.get("access_count", 0) or 0),
                last_accessed_at=str(next_metadata.get("last_accessed_at", "")),
            )

        self.memories.update(ids=[memory_id], documents=[next_content], metadatas=[next_metadata])
        return {"id": memory_id, "updated": True}

    def delete_memory(self, memory_id: str) -> dict[str, Any]:
        self.memories.delete(ids=[memory_id])
        return {"id": memory_id, "deleted": True}

    def apply_decay(self) -> dict[str, Any]:
        result = self.memories.get(include=["metadatas", "documents"])
        ids = result.get("ids", [])
        metas = result.get("metadatas", [])
        docs = result.get("documents", [])

        updated_count = 0
        now = utc_now()

        for idx, memory_id in enumerate(ids):
            metadata = metas[idx] if idx < len(metas) and metas[idx] is not None else {}
            if not isinstance(metadata, dict):
                continue
            if metadata.get("superseded_by"):
                continue

            last_accessed = metadata.get("last_accessed_at") or metadata.get("updated_at")
            if not isinstance(last_accessed, str):
                last_accessed = None
            idle_days = days_since(last_accessed)

            if idle_days < self.config.decay.idle_days_before_decay:
                continue

            current_importance = float(metadata.get("importance_score", 0.5))
            decayed_importance = current_importance * exp(-self.config.decay.decay_per_day * idle_days)
            next_importance = max(self.config.decay.min_importance, decayed_importance)

            if abs(next_importance - current_importance) < 1e-4:
                continue

            metadata["importance_score"] = next_importance
            metadata["updated_at"] = now.isoformat()
            self.memories.update(
                ids=[memory_id],
                documents=[docs[idx] if idx < len(docs) else ""],
                metadatas=[metadata],
            )
            updated_count += 1

        return {"decayed": updated_count}

    def get_memory_stats(self) -> dict[str, Any]:
        result = self.memories.get(include=["metadatas"])
        metas = result.get("metadatas", [])

        total = len(metas)
        if total == 0:
            return {
                "total_count": 0,
                "avg_importance": 0.0,
                "top_categories": {},
                "storage_size_bytes": self._folder_size(self.data_dir),
            }

        importance_values: list[float] = []
        categories: list[str] = []
        for metadata in metas:
            if isinstance(metadata, dict):
                importance_values.append(float(metadata.get("importance_score", 0.0)))
                categories.append(str(metadata.get("category", "misc")))

        category_counts = dict(Counter(categories).most_common(8))
        average_importance = sum(importance_values) / max(len(importance_values), 1)

        return {
            "total_count": total,
            "avg_importance": round(average_importance, 4),
            "top_categories": category_counts,
            "storage_size_bytes": self._folder_size(self.data_dir),
        }

    def _find_and_supersede_if_needed(self, content: str, new_id: str) -> str | None:
        # Nothing to compare against if the collection is empty.
        if self.memories.count() == 0:
            return None
        result = self.memories.query(
            query_texts=[content],
            n_results=1,
            include=["metadatas", "distances"],
        )
        ids = result.get("ids", [[]])[0]
        distances = result.get("distances", [[]])[0]

        if not ids:
            return None

        existing_id = ids[0]
        if existing_id == new_id:
            return None

        distance = float(distances[0]) if distances else 1.0
        similarity = max(0.0, min(1.0, 1.0 - distance))
        if similarity < self.config.dedup.similarity_threshold:
            return None

        existing = self.memories.get(ids=[existing_id], include=["metadatas", "documents"])
        existing_meta = (existing.get("metadatas") or [{}])[0] or {}
        existing_doc = (existing.get("documents") or [""])[0] or ""

        if isinstance(existing_meta, dict):
            existing_meta["superseded_by"] = new_id
            existing_meta["updated_at"] = utc_now().isoformat()
            self.memories.update(ids=[existing_id], documents=[existing_doc], metadatas=[existing_meta])
            return existing_id

        return None

    def _touch_access(self, ids: list[str]) -> None:
        fetched = self.memories.get(ids=ids, include=["metadatas", "documents"])
        current_ids = fetched.get("ids", [])
        docs = fetched.get("documents", [])
        metas = fetched.get("metadatas", [])

        for idx, memory_id in enumerate(current_ids):
            metadata = metas[idx] if idx < len(metas) and metas[idx] is not None else {}
            if not isinstance(metadata, dict):
                continue

            metadata["last_accessed_at"] = utc_now().isoformat()
            metadata["access_count"] = int(metadata.get("access_count", 0) or 0) + 1
            metadata["importance_score"] = compute_importance_score(
                self.config,
                explicit_signal=bool(metadata.get("explicit_signal", False)),
                category=str(metadata.get("category", "misc")),
                access_count=int(metadata.get("access_count", 0) or 0),
                last_accessed_at=str(metadata.get("last_accessed_at", "")),
            )

            self.memories.update(
                ids=[memory_id],
                documents=[docs[idx] if idx < len(docs) else ""],
                metadatas=[metadata],
            )

    @staticmethod
    def _folder_size(path: Path) -> int:
        total = 0
        for child in path.rglob("*"):
            if child.is_file():
                total += child.stat().st_size
        return total
