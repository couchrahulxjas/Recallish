"""Recallish local-first memory engine."""

from .config import RecallishConfig, load_config
from .engine import MemoryEngine
from .llm_extraction import LLMExtractor, LLMExtractedMemory, create_llm_extractor_from_config
from .prompts import (
    EXTRACTION_SYSTEM_PROMPT,
    MEMORY_SCHEMA,
    CONTEXT_INJECTION_TEMPLATE,
    format_memories_for_context,
)

__all__ = [
    "RecallishConfig",
    "load_config",
    "MemoryEngine",
    "LLMExtractor",
    "LLMExtractedMemory",
    "create_llm_extractor_from_config",
    "EXTRACTION_SYSTEM_PROMPT",
    "MEMORY_SCHEMA",
    "CONTEXT_INJECTION_TEMPLATE",
    "format_memories_for_context",
]
