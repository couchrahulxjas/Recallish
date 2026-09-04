from __future__ import annotations

from datetime import datetime, timezone
from math import exp, log1p

from .config import RecallishConfig


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def days_since(timestamp_iso: str | None) -> float:
    dt = parse_iso_datetime(timestamp_iso)
    if dt is None:
        return 0.0
    delta = utc_now() - dt
    return max(delta.total_seconds() / 86400.0, 0.0)


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def compute_importance_score(
    config: RecallishConfig,
    *,
    explicit_signal: bool,
    category: str,
    access_count: int = 0,
    last_accessed_at: str | None = None,
) -> float:
    scoring = config.scoring

    explicit_component = 1.0 if explicit_signal else 0.2
    recency_component = exp(-config.ranking.recency_decay_per_day * days_since(last_accessed_at))
    access_component = clamp(log1p(max(access_count, 0)) / 4.0)
    category_component = scoring.category_weights.get(category, scoring.category_weights.get("misc", 0.5))

    score = (
        scoring.explicit_signal_weight * explicit_component
        + scoring.recency_weight * recency_component
        + scoring.access_weight * access_component
        + scoring.category_weight * category_component
    )
    return clamp(score)


def recency_decay_factor(config: RecallishConfig, updated_at: str | None) -> float:
    return exp(-config.ranking.recency_decay_per_day * days_since(updated_at))


def combined_rank_score(
    config: RecallishConfig,
    *,
    similarity: float,
    importance_score: float,
    updated_at: str | None,
) -> float:
    ranking = config.ranking
    recency = recency_decay_factor(config, updated_at)

    if ranking.strategy == "weighted_sum":
        total = ranking.similarity_weight + ranking.importance_weight + ranking.recency_weight
        if total <= 0:
            return 0.0
        score = (
            ranking.similarity_weight * similarity
            + ranking.importance_weight * importance_score
            + ranking.recency_weight * recency
        ) / total
        return clamp(score)

    # Default multiplicative strategy.
    return clamp(
        (similarity ** ranking.similarity_weight)
        * (importance_score ** ranking.importance_weight)
        * (recency ** ranking.recency_weight)
    )
