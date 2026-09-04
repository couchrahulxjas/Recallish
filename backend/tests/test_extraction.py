from recallish.extraction import extract_candidate_memories


def test_extracts_preference_and_decision() -> None:
    chunk = (
        "I prefer compact code reviews. "
        "We decided to keep storage local-only. "
        "Hello there."
    )
    candidates = extract_candidate_memories(chunk)
    categories = {item.category for item in candidates}
    texts = " ".join(item.text.lower() for item in candidates)

    assert "preference" in categories
    assert "decision" in categories
    assert "compact code reviews" in texts
    assert "local-only" in texts


def test_explicit_remember_signal() -> None:
    candidates = extract_candidate_memories("Remember that Rahul uses Windows 11 for development.")
    assert candidates
    assert candidates[0].explicit_signal is True


def test_empty_chunk_returns_nothing() -> None:
    assert extract_candidate_memories("   \n  ") == []
