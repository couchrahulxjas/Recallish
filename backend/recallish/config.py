from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass(slots=True)
class StorageConfig:
    data_dir: str = "./.recallish-store"
    collection_name: str = "memories"
    conversations_log: str = "conversations.jsonl"


@dataclass(slots=True)
class DedupConfig:
    similarity_threshold: float = 0.86


@dataclass(slots=True)
class ScoringConfig:
    explicit_signal_weight: float = 0.65
    recency_weight: float = 0.2
    access_weight: float = 0.1
    category_weight: float = 0.05
    category_weights: dict[str, float] = field(
        default_factory=lambda: {
            "preference": 1.0,
            "project_fact": 0.9,
            "decision": 0.9,
            "profile": 0.8,
            "misc": 0.5,
        }
    )


@dataclass(slots=True)
class RankingConfig:
    strategy: str = "multiplicative"
    similarity_weight: float = 1.0
    importance_weight: float = 1.0
    recency_weight: float = 1.0
    recency_decay_per_day: float = 0.01
    exclude_superseded: bool = True


@dataclass(slots=True)
class DecayConfig:
    decay_per_day: float = 0.01
    min_importance: float = 0.1
    idle_days_before_decay: int = 7


@dataclass(slots=True)
class RetrievalConfig:
    candidate_multiplier: int = 4


@dataclass(slots=True)
class LLMConfig:
    enabled: bool = False
    summarize_enabled: bool = False
    api_key: str | None = None
    base_url: str | None = None
    model: str = "gpt-4o-mini"
    timeout: int = 30


@dataclass(slots=True)
class RecallishConfig:
    storage: StorageConfig = field(default_factory=StorageConfig)
    dedup: DedupConfig = field(default_factory=DedupConfig)
    scoring: ScoringConfig = field(default_factory=ScoringConfig)
    ranking: RankingConfig = field(default_factory=RankingConfig)
    decay: DecayConfig = field(default_factory=DecayConfig)
    retrieval: RetrievalConfig = field(default_factory=RetrievalConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _to_config(data: dict[str, Any]) -> RecallishConfig:
    return RecallishConfig(
        storage=StorageConfig(**data.get("storage", {})),
        dedup=DedupConfig(**data.get("dedup", {})),
        scoring=ScoringConfig(**data.get("scoring", {})),
        ranking=RankingConfig(**data.get("ranking", {})),
        decay=DecayConfig(**data.get("decay", {})),
        retrieval=RetrievalConfig(**data.get("retrieval", {})),
        llm=LLMConfig(**data.get("llm", {})),
    )


def _resolve_storage_paths(config: RecallishConfig, base: Path) -> None:
    data_dir = Path(config.storage.data_dir)
    if not data_dir.is_absolute():
        config.storage.data_dir = str((base / data_dir).resolve())


def default_config_path() -> Path:
    """Resolve the config path portably.

    Priority:
      1. RECALLISH_CONFIG environment variable (absolute or relative to CWD)
      2. <package parent>/config/recallish.yaml (matches a `pip install -e ./backend` layout)
    """
    env = os.environ.get("RECALLISH_CONFIG")
    if env:
        return Path(env).expanduser().resolve()
    return (Path(__file__).resolve().parent.parent / "config" / "recallish.yaml").resolve()


def load_config(config_path: str | Path | None = None) -> RecallishConfig:
    default = RecallishConfig()
    fallback_base = Path.home() / ".recallish"
    if config_path is None:
        config_path = default_config_path()

    path = Path(config_path)
    if not path.exists():
        _resolve_storage_paths(default, fallback_base)
        return default

    path = Path(config_path)
    if not path.exists():
        _resolve_storage_paths(default, fallback_base)
        return default

    loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    loaded_data = loaded if isinstance(loaded, dict) else {}
    merged = _deep_merge(asdict(default), loaded_data)
    config = _to_config(merged)
    _apply_env_overrides(config)
    _resolve_storage_paths(config, path.parent)
    return config


def _apply_env_overrides(config: RecallishConfig) -> None:
    """Apply optional environment variable overrides for LLM settings.

    LLM_* names are preferred, while the OPENAI_* aliases make any
    OpenAI-compatible free-tier provider work without putting a secret in YAML:
      - LLM_BASE_URL / OPENAI_BASE_URL
      - LLM_MODEL / OPENAI_MODEL
      - LLM_API_KEY / OPENAI_API_KEY
      - LLM_TIMEOUT (seconds)
    """
    url = os.environ.get("LLM_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
    if url:
        config.llm.base_url = url.strip().rstrip("/")
    model = os.environ.get("LLM_MODEL") or os.environ.get("OPENAI_MODEL")
    if model:
        config.llm.model = model.strip()
    api_key = os.environ.get("LLM_API_KEY")
    if api_key is None:
        api_key = os.environ.get("OPENAI_API_KEY")
    if api_key is not None:
        config.llm.api_key = api_key.strip() or None
    timeout = os.environ.get("LLM_TIMEOUT")
    if timeout:
        try:
            config.llm.timeout = int(timeout)
        except ValueError:
            pass
