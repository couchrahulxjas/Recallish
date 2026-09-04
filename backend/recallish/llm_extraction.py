from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any

from .prompts import (
    CHUNK_SUMMARIZE_PROMPT,
    CONTENT_TYPE_SECTIONS,
    EXTRACTION_SYSTEM_PROMPT,
    MEMORY_SCHEMA,
    MERGE_SUMMARIES_PROMPT,
    SUMMARIZE_SYSTEM_PROMPT,
)


# ---------------------------------------------------------------------------
# Content-type classification (heuristic, runs locally / offline)
# ---------------------------------------------------------------------------

CODE_STRONG_HINTS = re.compile(
    r"\b(function|def|class|async def|import |=>|endpoint|algorithm|"
    r"vector database|const |let |var |sizeof|recursion|"
    r"time complexity|space complexity|big.o)\b",
    re.IGNORECASE,
)
CODE_WEAK_HINTS = re.compile(
    r"\b(bug|error|schema|json|csv|code|database|query|column|table|"
    r"variable|loop|complexity|api|endpoint|sql|runtime|syntax)\b",
    re.IGNORECASE,
)
RESEARCH_HINTS = re.compile(
    r"\b(study|paper|research|experiment|finding|method|hypothesis|"
    r"evidence|data|result|conclusion|limitation|sample|survey|statistical)\b",
    re.IGNORECASE,
)
DISCUSSION_HINTS = re.compile(
    r"\b(we should|let.s|plan to|goal|project|deadline|meeting|task|"
    r"decide|decision|prefer|i use|i want|we decided|decided to)\b",
    re.IGNORECASE,
)


def classify_content_type(text: str) -> str:
    """Heuristically classify the input into one of:
    'code', 'technical', 'research', 'general', 'discussion'.
    """
    if not text or not text.strip():
        return "general"
    sample = text[:4000]
    strong_code = len(CODE_STRONG_HINTS.findall(sample))
    weak_code = len(CODE_WEAK_HINTS.findall(sample))
    research = len(RESEARCH_HINTS.findall(sample))
    discussion = len(DISCUSSION_HINTS.findall(sample))

    # A single strong code signal => code.
    if strong_code >= 1:
        return "code"
    if research >= 2 and research >= discussion:
        return "research"
    if discussion >= 2 and discussion >= research:
        return "discussion"
    if weak_code >= 2:
        return "technical"
    return "general"


# ---------------------------------------------------------------------------
# Structured summary result
# ---------------------------------------------------------------------------

# Mapping of StructuredSummary field → (default label, content-type-specific labels)
# Kept outside the dataclass to avoid mutable default issues.
FIELD_LABELS: dict[str, tuple[str, dict[str, str]]] = {
    "title":           ("Title", {}),
    "summary":         ("Summary", {
        "code": "Problem",
        "technical": "Core Concept",
        "research": "Problem",
        "discussion": "Summary",
    }),
    "key_points":      ("Key Points", {
        "code": "Algorithm",
        "technical": "Key Components",
        "research": "Main Findings",
        "discussion": "Goals",
    }),
    "important_details": ("Important Details", {
        "code": "Important Logic",
        "technical": "How It Works",
        "research": "Important Evidence",
        "discussion": "Important Facts",
    }),
    "action_items":    ("Action Items", {}),
    "decisions":       ("Decisions", {}),
    "memory_candidates": ("Potential Memories", {}),
}


@dataclass(slots=True)
class StructuredSummary:
    title: str = ""
    content_type: str = "general"
    summary: str = ""
    key_points: list[str] = field(default_factory=list)
    important_details: list[str] = field(default_factory=list)
    action_items: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    memory_candidates: list[str] = field(default_factory=list)

    def relevance_sections(self) -> list[tuple[str, str, str]]:
        """Return populated fields in content-type-aware order.

        Each tuple is ``(field_key, display_label, display_value)``.
        """
        order = CONTENT_TYPE_SECTIONS.get(self.content_type) or CONTENT_TYPE_SECTIONS["general"]
        fields = {
            "title": self.title,
            "summary": self.summary,
            "key_points": self.key_points,
            "important_details": self.important_details,
            "action_items": self.action_items,
            "decisions": self.decisions,
            "memory_candidates": self.memory_candidates,
        }

        def _label(key: str) -> str:
            default_label, overrides = FIELD_LABELS.get(key, (key.replace("_", " ").title(), {}))
            return overrides.get(self.content_type, default_label)

        def _format(key: str) -> str | None:
            val = fields.get(key)
            if val is None:
                return None
            if isinstance(val, str):
                return val or None
            if isinstance(val, list):
                items = [str(v).strip() for v in val if str(v).strip()]
                return "\n".join(f"- {item}" for item in items) if items else None
            return str(val) if val else None

        seen = set()
        out: list[tuple[str, str, str]] = []
        for key in order:
            fmt = _format(key)
            if fmt:
                seen.add(key)
                out.append((key, _label(key), fmt))
        # Append any remaining populated fields not listed in the content-type order.
        for key in ("title", "summary", "key_points", "important_details", "action_items", "decisions", "memory_candidates"):
            if key in seen:
                continue
            fmt = _format(key)
            if fmt:
                seen.add(key)
                out.append((key, _label(key), fmt))
        return out

    def user_facing_lines(self, max_lines: int | None = None) -> list[str]:
        """Convert to the plain text lines the UI currently displays."""
        lines: list[str] = []
        if self.title:
            lines.append(self.title)
        if self.summary:
            lines.append(self.summary)
        for label, values in (
            ("Key points", self.key_points),
            ("Important details", self.important_details),
            ("Action items", self.action_items),
            ("Decisions", self.decisions),
        ):
            if values:
                lines.append(f"{label}:")
                for item in values:
                    lines.append(f"- {item}")
        if max_lines is not None and len(lines) > max_lines:
            lines = lines[:max_lines]
        return lines

    def memory_lines(self) -> list[str]:
        """Separate, memory-oriented output (for the existing memory system)."""
        if not self.memory_candidates:
            return []
        return [f"- {m}" for m in self.memory_candidates]


# ---------------------------------------------------------------------------
# LLM extractor
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class LLMExtractedMemory:
    content: str
    category: str
    importance_score: float
    supersedes: str | None = None


class LLMExtractor:
    # Heuristic thresholds tuned for small local models (e.g. qwen2.5:7b).
    # Smaller per-pass budgets keep small models from echoing long input
    # verbatim; they compress more reliably on ~2000-char windows.
    CHUNK_CHARS = 2000        # per-pass text budget for chunk-level summary
    DIRECT_CHARS = 4000       # text budget that can be summarized in one pass
    MAX_CHUNKS = 16           # cap on number of chunks summarized hierarchically
    JSON_FLAGS = re.compile(r"^```(?:json)?\s*|\s*```$")

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str = "gpt-4o-mini",
        timeout: int = 30,
    ) -> None:
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.base_url = base_url or os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.model = model
        self.timeout = timeout
        self._client = None
        self.last_error: str | None = None

    def _get_client(self):
        if self._client is None:
            try:
                import openai
            except ImportError as e:
                raise RuntimeError(
                    "openai package not installed. Install with: pip install openai"
                ) from e
            # llama.cpp's OpenAI-compatible server does not require a real API key.
            # Use any non-empty placeholder so the SDK's auth check passes.
            api_key = self.api_key or "local"
            self._client = openai.OpenAI(
                api_key=api_key,
                base_url=self.base_url,
                timeout=self.timeout,
            )
        return self._client

    def client_available(self) -> bool:
        """Probe whether the local llama.cpp server is reachable and has a model."""
        if not self.base_url:
            return False
        try:
            client = self._get_client()
            models = client.models.list()
            items = getattr(models, "data", None)
            if items is None:
                return True
            return True
        except Exception:
            return False

    def get_server_info(self) -> dict[str, Any]:
        """Return server/model info, or an error summary when unavailable."""
        try:
            client = self._get_client()
            models = client.models.list()
            items = getattr(models, "data", None) or []
            ids = [getattr(m, "id", None) for m in items if getattr(m, "id", None)]
            return {
                "available": True,
                "base_url": self.base_url,
                "configured_model": self.model,
                "server_models": ids,
            }
        except Exception as exc:
            return {
                "available": False,
                "base_url": self.base_url,
                "configured_model": self.model,
                "error": self._describe_completion_error(exc),
            }


    # --- Memory extraction --------------------------------------------------

    def extract_memories(
        self,
        conversation: str,
        existing_memories: list[dict[str, Any]] | None = None,
    ) -> list[LLMExtractedMemory]:
        if not self.api_key:
            return []

        existing_memories_json = json.dumps(existing_memories or [], ensure_ascii=False)
        prompt = EXTRACTION_SYSTEM_PROMPT.format(
            existing_memories_json=existing_memories_json,
            conversation_transcript=conversation,
        )

        try:
            client = self._get_client()
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": prompt},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content
            if not content:
                return []
            data = json.loads(content)
            memories = data.get("memories", data if isinstance(data, list) else [])
            result: list[LLMExtractedMemory] = []
            for item in memories:
                if not isinstance(item, dict):
                    continue
                content_str = item.get("content", "").strip()
                if not content_str:
                    continue
                category = item.get("category", "misc")
                if category not in ("preference", "project_fact", "decision", "profile", "misc"):
                    category = "misc"
                importance = float(item.get("importance_score", 0.5))
                importance = max(0.0, min(1.0, importance))
                supersedes = item.get("supersedes")
                result.append(
                    LLMExtractedMemory(
                        content=content_str,
                        category=category,
                        importance_score=importance,
                        supersedes=supersedes if isinstance(supersedes, str) else None,
                    )
                )
            return result
        except Exception:
            return []

    # --- Summarization ------------------------------------------------------

    def summarize_topic(
        self,
        label: str,
        chunks: list[str],
        max_lines: int = 4,
    ) -> list[str]:
        """Content-aware, hierarchical, structured summarization.

        Returns plain text lines for backward compatibility with the UI. A
        richer structured result is available via :meth:`summarize_structured`.
        """
        structured = self.summarize_structured(label, chunks)
        if structured is None:
            return []
        return structured.user_facing_lines(max_lines=max_lines)

    def summarize_structured(
        self,
        label: str,
        chunks: list[str],
        content_type: str | None = None,
    ) -> StructuredSummary | None:
        """Full pipeline:

        1. Clean + concatenate the chunks.
        2. Classify content type.
        3. If text fits in the direct budget, summarize in one pass.
           Otherwise hierarchy: chunk -> per-chunk summary -> merge.
        4. Return a StructuredSummary.
        """
        if not chunks:
            return None
        if not self.api_key:
            return None

        text = self._clean_and_join(chunks)
        if not text:
            return None
        text = text[: self.MAX_CHUNKS * self.CHUNK_CHARS]

        ctype = content_type or classify_content_type(text)
        title_fallback = label[:120]

        if len(text) <= self.DIRECT_CHARS:
            prompt = SUMMARIZE_SYSTEM_PROMPT.format(
                content_type=ctype,
                topic_label=label,
                text=text,
                title_fallback=title_fallback,
            )
            # Retry up to 3 times if the local model returns invalid JSON or
            # merely copies the source verbatim.
            for _ in range(3):
                raw = self._complete(prompt, temperature=0.3)
                result = self._parse_structured(raw, ctype, title_fallback, source=text)
                if result is not None:
                    return result
            return None

        # Hierarchical (map-reduce) summarization.
        partial = self._hierarchical_summarize(text, ctype, title_fallback, label)
        if partial is None:
            return None
        return partial

    def _hierarchical_summarize(
        self,
        text: str,
        ctype: str,
        title_fallback: str,
        label: str,
    ) -> StructuredSummary | None:
        """Split long text into chunks, summarize each, then merge."""
        chunks = self._split_text(text, self.CHUNK_CHARS)
        summaries: list[dict[str, Any]] = []
        for chunk in chunks:
            prompt = CHUNK_SUMMARIZE_PROMPT.format(
                content_type=ctype,
                topic_label=label,
                text=chunk,
                title_fallback=title_fallback,
            )
            raw = self._complete(prompt, temperature=0.3)
            parsed = self._try_parse_json(raw)
            if isinstance(parsed, dict):
                # Skip chunk summaries that just echo the chunk verbatim.
                summary_val = parsed.get("summary") or ""
                if not self._is_garbage_summary(str(summary_val), chunk):
                    summaries.append(parsed)
                # Otherwise try once more for this chunk before moving on.
                else:
                    retry = self._complete(prompt, temperature=0.5)
                    reparsed = self._try_parse_json(retry)
                    if isinstance(reparsed, dict) and not self._is_garbage_summary(
                        str(reparsed.get("summary") or ""), chunk
                    ):
                        summaries.append(reparsed)
            if len(summaries) >= self.MAX_CHUNKS:
                break

        if not summaries:
            return None

        if len(summaries) == 1:
            return self._to_structured(summaries[0], ctype, title_fallback)

        # Merge the partial summaries, deduplicating across chunks.
        partials_text = "\n\n".join(
            f"[Summary {i+1}]\n{json.dumps(s, ensure_ascii=False, indent=2)}"
            for i, s in enumerate(summaries)
        )
        prompt = MERGE_SUMMARIES_PROMPT.format(
            content_type=ctype,
            topic_label=label,
            partials=partials_text,
            title_fallback=title_fallback,
        )
        raw = self._complete(prompt, temperature=0.2)
        merged = self._try_parse_json(raw)
        if not isinstance(merged, dict):
            # Fall back to a local merge if the model merge fails.
            merged = self._merge_local(summaries)
        merged = self._dedup_lists(merged)
        result = self._to_structured(merged, ctype, title_fallback)
        # Guard the final merged summary against copying the source verbatim.
        if result is None or self._is_garbage_summary(result.summary, text):
            return None
        return result

    @staticmethod
    def _merge_local(summaries: list[dict[str, Any]]) -> dict[str, Any]:
        """Simple local merge fallback when the model merge fails."""
        merged: dict[str, Any] = {}
        for key in ("key_points", "important_details", "action_items", "decisions", "memory_candidates"):
            values: list[str] = []
            for s in summaries:
                values.extend(s.get(key) or [])
            merged[key] = values
        merged["summary"] = "\n".join(
            (s.get("summary") or "") for s in summaries if s.get("summary")
        )
        return merged

    @staticmethod
    def _dedup_lists(obj: dict[str, Any]) -> dict[str, Any]:
        """Remove duplicate strings (case-insensitive) from list fields."""
        for key in ("key_points", "important_details", "action_items", "decisions", "memory_candidates"):
            vals = obj.get(key)
            if isinstance(vals, list):
                seen = set()
                out = []
                for v in vals:
                    if not isinstance(v, str):
                        continue
                    norm = v.strip().lower()
                    if not norm or norm in seen:
                        continue
                    seen.add(norm)
                    out.append(v.strip())
                obj[key] = out
        return obj

    # --- Helpers ------------------------------------------------------------

    @staticmethod
    def _is_garbage_summary(summary: str, source: str) -> bool:
        """Detect summarizer output that is garbage or just copy-pasted input.

        Small local models often echo the source text verbatim or emit
        boilerplate. These are treated as failures so the caller can retry or
        fall back instead of surfacing junk to the user.
        """
        if not summary or not summary.strip():
            return True

        s = summary.strip().lower()
        src = source.strip().lower()

        # Hard echo: the summary is (nearly) the whole source verbatim.
        if len(src) > 200 and s in src:
            return True
        # The summary is way too large relative to a large source (no real
        # compression happened). Only enforce on genuinely long sources.
        if len(src) >= 1500 and len(s) >= int(len(src) * 0.6):
            return True
        # Repetitive single-token / stutter output.
        if len(set(s.split())) <= 2 and len(s) > 20:
            tokens = s.split()
            if len(set(tokens)) <= 2:
                return True
        # Boilerplate refusal/no-op phrasing.
        low = s
        if any(phrase in low for phrase in (
            "i cannot", "i can't", "i am unable", "unable to summarize",
            "no content", "nothing to summarize", "no input",
            "as an ai", "here is the summary:" , "here is a summary",
        )):
            return True
        # Unusually long single dash-line that reproduces a whole sentence.
        for line in s.splitlines():
            if line.count(" ") >= 60 and len(line) > 400:
                return True
        return False

    @staticmethod
    def _clean_and_join(chunks: list[str]) -> str:
        """Clean + dedupe + join raw chunks into a single text blob."""
        seen = set()
        parts = []
        for chunk in chunks:
            if not chunk or not isinstance(chunk, str):
                continue
            chunk = chunk.strip()
            if len(chunk) < 3:
                continue
            norm = chunk.lower()
            if norm in seen:
                continue
            seen.add(norm)
            parts.append(chunk)
        if not parts:
            return ""
        return "\n\n".join(parts)

    @staticmethod
    def _split_text(text: str, size: int) -> list[str]:
        """Split text into roughly `size`-character chunks on paragraph/line breaks."""
        if len(text) <= size:
            return [text]
        # Prefer splitting on blank lines (paragraphs), then on line ends.
        paragraphs = re.split(r"\n\s*\n", text)
        chunks: list[str] = []
        current = ""
        for para in paragraphs:
            if para and len(current) + len(para) > size and current:
                chunks.append(current.strip())
                current = para
            else:
                current = f"{current}\n\n{para}" if current else para
        if current.strip():
            chunks.append(current.strip())
        return chunks

    def _complete(self, prompt: str, temperature: float, *, json_mode: bool = True) -> str:
        """Send a single chat completion to the local LLM.

        Returns the raw text content, or an empty string on failure.
        """
        try:
            client = self._get_client()
            kwargs: dict[str, Any] = {
                "model": self.model,
                "messages": [{"role": "system", "content": prompt}],
                "temperature": temperature,
            }
            if json_mode:
                # llama.cpp supports schema-constrained JSON output.
                kwargs["response_format"] = {"type": "json_object"}
            response = client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content or ""
            if content:
                self.last_error = None
            else:
                reasoning = ""
                msg = response.choices[0].message
                if hasattr(msg, "reasoning_content"):
                    reasoning = msg.reasoning_content or ""
                if not reasoning:
                    extra = getattr(msg, "model_extra", None) or {}
                    reasoning = extra.get("reasoning_content") or ""
                if reasoning:
                    self.last_error = (
                        "The local model is in reasoning/thinking mode and returned only thinking "
                        "tokens (empty answer). Restart llama-server with `--reasoning off` so it "
                        "returns normal responses."
                    )
                else:
                    self.last_error = "The local model returned an empty response."
            return content
        except Exception as exc:  # noqa: BLE001
            self.last_error = self._describe_completion_error(exc)
            return ""

    def _describe_completion_error(self, exc: Exception) -> str:
        """Return a human-readable, useful error for the local server case."""
        name = type(exc).__name__
        msg = str(exc) or ""
        lowered = msg.lower()
        conn_refused = any(
            token in lowered
            for token in ("connectionrefused", "connection refused", "cannot connect",
                          "nodename nor servname", "errno 10061", "failed to resolve")
        )
        timeout = any(token in lowered for token in ("timed out", "timeout", "read timed out"))
        model_missing = any(
            token in lowered
            for token in ("model", "not found", "404", "no model", "unable to load model")
        )
        if conn_refused:
            return (
                f"llama.cpp server is not reachable at {self.base_url}. "
                "Start it with `llama-server -m <model>.gguf -c 4096` before summarizing."
            )
        if timeout:
            return f"The local LLM request timed out after {self.timeout}s ({name}). The prompt may be too large or the model is still loading."
        if model_missing:
            return f"The local LLM could not load the model '{self.model}' ({name}). Check that llama.cpp was started with this model file."
        return f"Local LLM error ({name}): {msg if msg else 'no detail'} at {self.base_url}"

    def _try_parse_json(self, raw: str) -> Any:
        if not raw:
            return None
        text = self.JSON_FLAGS.sub("", raw.strip())
        # Try to extract a JSON object if there's surrounding prose.
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start : end + 1]
        try:
            return json.loads(text)
        except Exception:
            return None

    def _parse_structured(
        self, raw: str, ctype: str, title_fallback: str, source: str = ""
    ) -> StructuredSummary | None:
        parsed = self._try_parse_json(raw)
        if not isinstance(parsed, dict):
            return None
        summary_val = parsed.get("summary") or ""
        if self._is_garbage_summary(str(summary_val), source):
            return None
        return self._to_structured(parsed, ctype, title_fallback)

    def _to_structured(
        self, data: dict[str, Any], ctype: str, title_fallback: str
    ) -> StructuredSummary:
        def as_list(key: str) -> list[str]:
            val = data.get(key)
            if val is None:
                return []
            if isinstance(val, str):
                return [line.strip(" -•*") for line in val.splitlines() if line.strip(" -•*")]
            if isinstance(val, list):
                return [str(v).strip() for v in val if str(v).strip()]
            return []

        title = str(data.get("title") or title_fallback).strip()
        content_type = str(data.get("content_type") or ctype).strip() or "general"

        return StructuredSummary(
            title=title,
            content_type=content_type,
            summary=str(data.get("summary") or "").strip(),
            key_points=as_list("key_points"),
            important_details=as_list("important_details"),
            action_items=as_list("action_items"),
            decisions=as_list("decisions"),
            memory_candidates=as_list("memory_candidates"),
        )


def create_llm_extractor_from_config(
    config: dict[str, Any],
    *,
    for_summarization: bool = False,
) -> LLMExtractor | None:
    llm_config = config.get("llm", {})
    if for_summarization:
        if not llm_config.get("summarize_enabled", False):
            return None
    elif not llm_config.get("enabled", False):
        return None
    api_key = llm_config.get("api_key")
    base_url = llm_config.get("base_url")
    model = llm_config.get("model", "gpt-4o-mini")
    timeout = int(llm_config.get("timeout", 30))
    return LLMExtractor(
        api_key=api_key or ("ollama" if for_summarization else None),
        base_url=base_url,
        model=model,
        timeout=timeout,
    )
