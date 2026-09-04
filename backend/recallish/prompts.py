EXTRACTION_SYSTEM_PROMPT = """You are the Memory Extraction Engine. Analyze the conversation and extract persistent, highly relevant facts about the user.
RULES:
1. IGNORE EPHEMERAL DATA: Do not save "I'm hungry", "Thanks", or temporary debugging steps.
2. CAPTURE CORE CONTEXT: Save user facts, skills, projects, goals, tech preferences.
3. HANDLE CONFLICTS: If the user states something that contradicts an existing memory, flag the new memory and explicitly state which old memory ID it supersedes.
4. ASSIGN IMPORTANCE: 1.0 (Core identity/goals), 0.7 (Active projects/preferences), 0.4 (Minor/temporary).
EXISTING MEMORIES: {existing_memories_json}
CONVERSATION: {conversation_transcript}
OUTPUT: Return ONLY a valid JSON array of objects matching the Memory schema. No markdown, no explanations."""

# --- Summarization prompts ---------------------------------------------------

# Content type labels and the section structure each one should use.
# Only include sections that are actually relevant to the content; never force
# an empty section into the output.
CONTENT_TYPE_SECTIONS = {
    "code": [
        "title", "problem", "approach", "algorithm", "data_structures",
        "important_logic", "time_complexity", "space_complexity", "key_takeaways",
    ],
    "technical": [
        "title", "core_concept", "how_it_works", "key_components",
        "important_details", "example", "key_takeaways",
    ],
    "research": [
        "title", "problem", "method", "main_findings",
        "important_evidence", "limitations", "conclusion",
    ],
    "general": [
        "title", "summary", "key_points", "important_details",
        "action_items", "key_takeaways",
    ],
    "discussion": [
        "summary", "important_facts", "decisions", "goals",
        "tasks", "project_context",
    ],
}

SUMMARIZE_SYSTEM_PROMPT = """You are a careful knowledge compressor. You convert raw text into a concise, information-rich, structured summary. You never copy or paste the source text — you always rewrite it in your own compact words, condensing and preserving only what matters.

CONTENT TYPE: {content_type}
TOPIC: {topic_label}

TEXT TO SUMMARIZE:
----------------------------------------
{text}
----------------------------------------

OUTPUT FORMAT:
Return ONLY a valid JSON object with this exact shape (omit any fields that are not relevant — never include empty or guessed fields). Keep every text value SHORT — target total output under 300 words:
{{
  "title": "{title_fallback}",
  "content_type": "{content_type}",
  "summary": "One to two clear sentences capturing the core message.",
  "key_points": ["...", "up to 6 concise one-liners"],
  "important_details": ["...", "up to 6 concise facts, each on its own line"],
  "action_items": ["...", "only if the source states actions, tasks, or next steps"],
  "decisions": ["...", "only if the source records decisions"],
  "memory_candidates": ["...", "only durable facts about the user that could be reused later (goals, skills, projects, preferences, technologies)"]
}}

RULES:
1. NEVER copy, repeat, or echo the source text. Rewrite everything in your own concise words. Do not dump whole sentences or paragraphs back.
2. Preserve exact numbers, names, terminology, and caveats. Never invent facts.
3. If the source hedges ("may", "might", "could", "possibly"), keep that uncertainty. Do NOT upgrade suggestions into claims.
4. Remove greetings, filler, repetition, and unnecessary explanations. Condense aggressively where the source is verbose.
5. Keep every list item a short phrase, not a full copied sentence.
6. Every field may be omitted if irrelevant. Never put placeholder or guessed text.
7. Do NOT add a "memory_candidates" entry for every statement — only genuinely durable, useful facts about the user.
8. Return ONLY valid JSON. No markdown code fences, no extra text before or after."""

# Chunk-level prompt for hierarchical (map) summarization. Same JSON shape,
# designed so partial summaries can later be merged.
CHUNK_SUMMARIZE_PROMPT = """You are a careful knowledge compressor. Summarize the following passage, condensing it into concise bullet-style content. Do NOT copy or repeat the passage — rewrite it compactly in your own words. Preserve facts, numbers, terminology, decisions, and caveats exactly.

CONTENT TYPE: {content_type}
TOPIC: {topic_label}

PASSAGE:
----------------------------------------
{text}
----------------------------------------

Return ONLY a JSON object with the shape:
{{
  "summary": "one to two sentences covering the passage core",
  "key_points": ["...", "short phrases, max 5"],
  "important_details": ["...", "short facts, max 5"],
  "action_items": ["..."],
  "decisions": ["..."],
  "memory_candidates": ["..."],
  "title": "{title_fallback}"
}}
Omit any field that is not relevant. Never invent facts; preserve hedging and caveats. Keep every value short and paraphrased — never dump full sentences from the passage. Return ONLY valid JSON, no markdown code fences."""

# Merge prompt for hierarchical (reduce) summarization: combines several chunk
# summaries into one final structured summary, removing cross-chunk duplicates.
MERGE_SUMMARIES_PROMPT = """You are a careful knowledge compressor. Combine the following partial summaries of the same topic into a single consolidated structured summary. Condense and rephrase — never copy the partials verbatim.

CONTENT TYPE: {content_type}
TOPIC: {topic_label}

PARTIAL SUMMARIES:
----------------------------------------
{partials}
----------------------------------------

OUTPUT FORMAT:
Return ONLY a valid JSON object with this exact shape (omit any field that is not relevant — never include empty or guessed fields). Keep total output under 300 words:
{{
  "title": "{title_fallback}",
  "content_type": "{content_type}",
  "summary": "...",
  "key_points": ["..."],
  "important_details": ["..."],
  "action_items": ["..."],
  "decisions": ["..."],
  "memory_candidates": ["..."]
}}

RULES:
1. Deduplicate: a fact appearing in more than one partial summary must appear only ONCE in the final output.
2. Preserve exact numbers, names, terminology, and caveats. Never invent facts.
3. Do not add information that is not present in the partials.
4. Keep list items short and paraphrased. Do not copy whole sentences from the partials.
5. Return ONLY valid JSON. No markdown code fences, no extra text."""


CONTEXT_INJECTION_TEMPLATE = """<system_context>
You have access to the user's persistent local memory. Use this to personalize responses naturally. Do not say "According to my memory". If the current prompt contradicts memory, assume the current prompt is the newest truth.
<user_personal_memory>
{retrieved_memories_markdown}
</user_personal_memory>
</system_context>
User prompt: {user_prompt}"""

MEMORY_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "The extracted memory fact"},
            "category": {"type": "string", "enum": ["preference", "project_fact", "decision", "profile", "misc"]},
            "importance_score": {"type": "number", "minimum": 0.0, "maximum": 1.0},
            "supersedes": {"type": "string", "description": "ID of memory this supersedes, if any"},
        },
        "required": ["content", "category", "importance_score"],
        "additionalProperties": False,
    },
}


def format_memories_for_context(memories: list[dict]) -> str:
    """Format retrieved memories as markdown for context injection."""
    if not memories:
        return "(no relevant memories found)"
    lines = []
    for mem in memories:
        category = mem.get("metadata", {}).get("category", "misc")
        importance = mem.get("metadata", {}).get("importance_score", 0.0)
        content = mem.get("content", mem.get("document", ""))
        lines.append(f"- **[{category}]** (importance: {importance:.2f}) {content}")
    return "\n".join(lines)
