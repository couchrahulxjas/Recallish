from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass(slots=True)
class CandidateMemory:
    text: str
    category: str
    explicit_signal: bool


EXPLICIT_KEYWORDS = (
    "remember",
    "important",
    "dont forget",
    "do not forget",
    "note that",
    "always",
    "never",
)

PREFERENCE_MARKERS = (
    "prefer",
    "preference",
    "likes",
    "liked",
    "dislikes",
    "disliked",
    "favorite",
    "favourite",
    "prefer to",
)
DECISION_MARKERS = (
    "decided",
    "decision",
    "agreed",
    "we will",
    "i will",
    "going to use",
    "gonna use",
    "chose",
    "chosen",
    "opted",
)
PROJECT_MARKERS = (
    "project",
    "repo",
    "repository",
    "stack",
    "backend",
    "frontend",
    "codebase",
    "api",
    "database",
    "deployment",
)
PROFILE_MARKERS = (
    "i am",
    "i'm a",
    "my name",
    "i work",
    "i use",
    "i have",
    "i live",
    "my job",
    "developer",
    "engineer",
    "designer",
    "student",
    "role",
)
SKILL_MARKERS = (
    "i know",
    "i can",
    "i build",
    "i write",
    "i develop",
    "skill",
    "experienced",
    "familiar with",
    "proficient",
    "working with",
    "use python",
    "use react",
)
GOAL_MARKERS = (
    "goal",
    "objective",
    "want to",
    "aim to",
    "working toward",
    "trying to",
    "plan to",
    "i'm building",
    "i am building",
    "aiming",
)

# Conversational filler / lead-ins that should not be the start of a clean
# memory statement. These are stripped from the front of extracted text.
_LEAD_FILLERS = (
    "so ",
    "and ",
    "also ",
    "but ",
    "actually ",
    "basically ",
    "basically,",
    "well ",
    "anyway ",
    "yeah ",
    "yep ",
    "ok ",
    "okay ",
    "ok,",
    "hmm ",
    "i think ",
    "i think that ",
    "i feel ",
    "i feel that ",
    "i believe ",
    "i believe that ",
    "i'm pretty sure ",
    "i dunno but ",
    "also, ",
    "by the way, ",
    "btw, ",
)

# Verbatim conversational endings that carry no durable meaning.
_TAIL_NOISE = (
    " please",
    " thanks",
    " thank you",
    " let me know",
    " by the way",
    " btw",
    " ok?",
    "?",
)

# Keys that indicate a fragment is a question or a request, not a durable fact.
_QUESTION_STARTS = ("what ", "how ", "why ", "can you ", "could you ", "is it ", "are you ", "do you ", "did you ", "should i ", "when ", "where ", "who ")
_REQUEST_STARTS = ("please ", "help me ", "fix ", "add ", "debug ", "explain ", "show me ", "write ", "tell me ", "give me ", "can you")


def _clean_text(segment: str) -> str:
    """Turn a raw conversational sentence into a clean, standalone statement."""
    text = segment.strip()

    # Strip leading filler / hedges repeatedly (e.g. "And actually I prefer...").
    previous = None
    while previous != text:
        previous = text
        lowered = text.lower()
        for filler in _LEAD_FILLERS:
            if lowered.startswith(filler):
                text = text[len(filler):].strip()
                break

    # Squash stray internal filler (e.g. "I decided that we're going to use...").
    # Common project-stack pattern: "I decided that for our project we're going
    # to use X" -> "I decided to use X" (cleaner and avoids a doubled subject).
    text = re.sub(
        r"\bthat for (our|the|this|my) [a-z]+ we(?:['’]?re| are| will)? (?:going to use|gonna use|will use|use|going to)\b",
        "to use",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(i?['’]?m? ?(just|kind of|sort of|pretty|basically|actually))? i decided that\b",
        "I decided",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\bwe['’]?re going to\b", "I will", text, flags=re.IGNORECASE)
    text = re.sub(r"\bwe are going to\b", "I will", text, flags=re.IGNORECASE)
    text = re.sub(r"\bwe['’]?re gonna\b", "I will", text, flags=re.IGNORECASE)
    text = re.sub(r"\bi['’]?m going to\b", "I will", text, flags=re.IGNORECASE)
    text = re.sub(r"\bwe have decided\b", "I decided", text, flags=re.IGNORECASE)

    # Drop trailing conversational noise.
    lowered = text.lower()
    for noise in _TAIL_NOISE:
        if lowered.endswith(noise) and len(text) - len(noise) >= 12:
            text = text[: -len(noise)].rstrip()
            break

    # Collapse whitespace and stray punctuation at the boundaries.
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    text = text.rstrip(",").rstrip(".").strip()
    return text[:800]


def _normalize_to_standalone(text: str) -> str:
    """Rewrite first-person fragments so the memory reads as a standalone fact."""
    # "I use...", "I prefer..." -> "User uses / prefers". Keep it a clean statement.
    replacements = (
        (re.compile(r"\bWe decided\b", re.IGNORECASE), "User decided"),
        (re.compile(r"\bWe prefer\b", re.IGNORECASE), "User prefers"),
        (re.compile(r"\bWe will use\b", re.IGNORECASE), "User will use"),
        (re.compile(r"\bWe use\b", re.IGNORECASE), "User uses"),
        (re.compile(r"\bWe're using\b", re.IGNORECASE), "User uses"),
        (re.compile(r"\bWe have decided\b", re.IGNORECASE), "User decided"),
        (re.compile(r"\bWe agreed\b", re.IGNORECASE), "User agreed"),
        (re.compile(r"\bI['’]?m\b", re.IGNORECASE), "User is"),
        (re.compile(r"\bI am\b", re.IGNORECASE), "User is"),
        (re.compile(r"\bI have\b", re.IGNORECASE), "User has"),
        (re.compile(r"\bI use\b", re.IGNORECASE), "User uses"),
        (re.compile(r"\bI prefer\b", re.IGNORECASE), "User prefers"),
        (re.compile(r"\bI decided\b", re.IGNORECASE), "User decided"),
        (re.compile(r"\bI will\b", re.IGNORECASE), "User will"),
        (re.compile(r"\bI don't\b", re.IGNORECASE), "User does not"),
        (re.compile(r"\bI do not\b", re.IGNORECASE), "User does not"),
        (re.compile(r"\bI can\b", re.IGNORECASE), "User can"),
        (re.compile(r"\bI know\b", re.IGNORECASE), "User knows"),
        (re.compile(r"\bI like\b", re.IGNORECASE), "User likes"),
        (re.compile(r"\bI dislike\b", re.IGNORECASE), "User dislikes"),
        (re.compile(r"\bI work\b", re.IGNORECASE), "User works"),
        (re.compile(r"\bI live\b", re.IGNORECASE), "User lives"),
        (re.compile(r"\bmy\b", re.IGNORECASE), "User's"),
        (re.compile(r"\bme\b", re.IGNORECASE), "the user"),
        (re.compile(r"\bI\b"), "User"),
    )
    for pattern, replacement in replacements:
        text = pattern.sub(replacement, text)
    return _normalize_subject_adverbs(text)


_ADVERBS = r"(really|definitely|honestly|personally|always|never|mostly|usually|just)"
_ADVERB_VERB = {
    "prefer": "prefers",
    "like": "likes",
    "use": "uses",
    "work": "works",
    "know": "knows",
    "have": "has",
    "build": "builds",
    "write": "writes",
    "develop": "develops",
}


def _normalize_subject_adverbs(text: str) -> str:
    """Rewrite 'User really prefer ...' -> 'User really prefers ...'."""
    for verb, inflected in _ADVERB_VERB.items():
        text = re.sub(
            rf"\bUser {_ADVERBS} {verb}\b",
            lambda m, v=inflected: f"User {m.group(1)} {v}",
            text,
            flags=re.IGNORECASE,
        )
    return text


def classify_category(text: str) -> str:
    lowered = text.lower()
    stripped = _clean_text(text).lower()

    if any(marker in lowered for marker in PREFERENCE_MARKERS):
        return "preference"
    if any(marker in lowered for marker in DECISION_MARKERS):
        return "decision"
    if any(marker in lowered for marker in SKILL_MARKERS):
        return "profile"
    if any(marker in lowered for marker in GOAL_MARKERS):
        # Goals about shipping/building/delivering something concrete are
        # project facts; otherwise treat as profile info about the user.
        if any(m in stripped for m in PROJECT_MARKERS) or re.search(
            r"\b(ship|build|launch|release|deliver|finish|complete)\b", stripped
        ):
            return "project_fact"
        return "profile"
    if any(marker in lowered for marker in PROFILE_MARKERS):
        return "profile"
    if any(marker in lowered for marker in PROJECT_MARKERS):
        return "project_fact"
    return "misc"


def has_explicit_signal(text: str) -> bool:
    normalized = text.lower().replace("'", "")
    return any(keyword in normalized for keyword in EXPLICIT_KEYWORDS)


def _is_transient(text: str) -> bool:
    """Return True for fragments that aren't durable memory-worthy (drop them)."""
    lowered = text.lower().strip()
    if not lowered:
        return True
    # Questions / requests are transient even if prefixed by chatter
    # (e.g. "By the way, can you ...").
    core = lowered
    previous = None
    while previous != core:
        previous = core
        for filler in _LEAD_FILLERS:
            if core.startswith(filler):
                core = core[len(filler):].strip()
                break
    if lowered.endswith("?") or core.startswith(_QUESTION_STARTS):
        return True
    if core.startswith(_REQUEST_STARTS):
        return True
    # Pure short conversational filler with no signal.
    if len(lowered) < 12:
        return True
    transient = (
        "thanks",
        "thank you",
        "i'm hungry",
        "im hungry",
        "i'm tired",
        "im tired",
        "hello",
        "hi ",
        "good morning",
        "good night",
        "how are you",
        "can you help",
        "no problem",
        "you're welcome",
        "you are welcome",
        "let me know",
        "i don't know",
    )
    return any(lowered.startswith(t) or lowered.endswith(t) for t in transient)


def extract_candidate_memories(chunk: str) -> list[CandidateMemory]:
    compact = " ".join(part.strip() for part in chunk.splitlines() if part.strip())
    if not compact:
        return []

    segments = [s.strip() for s in re.split(r"[.!?]\s+", compact) if s.strip()]
    candidates: list[CandidateMemory] = []

    for segment in segments:
        if len(segment) < 12:
            continue
        if _is_transient(segment):
            continue

        explicit = has_explicit_signal(segment)
        category = classify_category(segment)

        # If nothing signals durable value, still keep concise explicit asks.
        is_likely_memory = explicit or category in {
            "preference",
            "decision",
            "project_fact",
            "profile",
            "misc",
        }
        if not is_likely_memory and category == "misc":
            continue

        cleaned = _clean_text(segment)
        if len(cleaned) < 10:
            continue

        # Only normalize first-person when there's a real subject to rewrite;
        # keep explicit "Remember that X" instructions short.
        standalone = _normalize_to_standalone(cleaned)

        candidates.append(
            CandidateMemory(
                text=standalone,
                category=category,
                explicit_signal=explicit,
            )
        )

    if candidates:
        return candidates

    # Fallback: keep one concise summary-like candidate, but only when the
    # chunk actually carries durable content (not pure chatter/requests).
    if _is_transient(compact):
        return []
    cleaned = _clean_text(compact)
    if len(cleaned) < 12 or _is_transient(cleaned):
        return []
    return [
        CandidateMemory(
            text=cleaned,
            category="misc",
            explicit_signal=has_explicit_signal(cleaned),
        )
    ]
