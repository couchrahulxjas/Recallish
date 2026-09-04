"""Test script for all MCP tools independently."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from recallish.config import load_config
from recallish.engine import MemoryEngine
from recallish.mcp_server import create_server


def parse_tool_result(result):
    """Parse MCP tool result - returns the JSON data."""
    if isinstance(result, tuple) and len(result) >= 2:
        # Second element is the actual result dict
        return result[1]
    elif isinstance(result, list) and result:
        # First element might be TextContent
        first = result[0]
        if hasattr(first, 'text'):
            return json.loads(first.text)
    return result


def parse_list_result(result):
    """Parse list-type results (search, list_memories) which return a list of TextContent."""
    if isinstance(result, tuple) and len(result) >= 1:
        first = result[0]
        if isinstance(first, list) and first:
            # List of TextContent objects
            return [json.loads(item.text) for item in first if hasattr(item, 'text')]
    elif isinstance(result, list) and result:
        first = result[0]
        if hasattr(first, 'text'):
            return json.loads(first.text)
    return result


async def test_mcp_tools():
    config = load_config()
    config.storage.data_dir = str(Path(__file__).resolve().parent / "test_mcp_store")
    
    import shutil
    if Path(config.storage.data_dir).exists():
        shutil.rmtree(config.storage.data_dir)
    
    engine = MemoryEngine(config)
    engine.initialize()
    
    mcp = create_server()
    
    print("=" * 60)
    print("Testing MCP Tools")
    print("=" * 60)
    
    # Test 1: save_memory
    print("\n1. Testing save_memory...")
    result = await mcp.call_tool("save_memory", {
        "content": "Test memory for MCP testing",
        "category": "project_fact",
        "source": "test",
        "explicit_signal": True,
    })
    result_json = parse_tool_result(result)
    print(f"   Result: {json.dumps(result_json, indent=2)}")
    assert "id" in result_json
    memory_id = result_json["id"]
    print("   PASS save_memory works")
    
    # Test 2: save_memory with different category
    print("\n2. Testing save_memory with skill category...")
    result2 = await mcp.call_tool("save_memory", {
        "content": "Python async/await patterns for concurrent tasks",
        "category": "skill",
        "source": "test",
        "explicit_signal": True,
    })
    result2_json = parse_tool_result(result2)
    print(f"   Result: {json.dumps(result2_json, indent=2)}")
    memory_id2 = result2_json["id"]
    print("   PASS save_memory with skill category works")
    
    # Test 3: ingest_conversation
    print("\n3. Testing ingest_conversation...")
    conversation = """
    User: How do I use asyncio in Python?
    Assistant: asyncio is a library for writing concurrent code using async/await syntax.
    User: Can you show me an example?
    Assistant: Sure! Here's a basic example...
    """
    result3 = await mcp.call_tool("ingest_conversation", {
        "content": conversation,
        "source": "test_conversation",
    })
    result3_json = parse_tool_result(result3)
    print(f"   Result: {json.dumps(result3_json, indent=2)}")
    assert "conversation_id" in result3_json
    assert "saved_memories" in result3_json
    print("   PASS ingest_conversation works")
    
    # Test 4: search_memory
    print("\n4. Testing search_memory...")
    results = await mcp.call_tool("search_memory", {
        "query": "asyncio python",
        "top_k": 5,
        "include_superseded": False,
    })
    results_json = parse_list_result(results)
    print(f"   Found {len(results_json)} results")
    for r in results_json:
        print(f"   - {r['id'][:8]}... | score: {r['combined_score']:.3f} | {r['content'][:60]}...")
    assert len(results_json) > 0
    print("   PASS search_memory works")
    
    # Test 5: list_memories
    print("\n5. Testing list_memories...")
    all_memories = await mcp.call_tool("list_memories", {})
    all_memories_json = parse_list_result(all_memories)
    print(f"   Total memories: {len(all_memories_json)}")
    for m in all_memories_json:
        print(f"   - {m['id'][:8]}... | cat: {m['metadata']['category']} | imp: {m['metadata']['importance_score']:.2f}")
    assert len(all_memories_json) >= 2
    print("   PASS list_memories works")
    
    # Test 6: list_memories with filters
    print("\n6. Testing list_memories with category filter...")
    filtered = await mcp.call_tool("list_memories", {"category": "skill"})
    filtered_json = parse_list_result(filtered)
    print(f"   Skill memories: {len(filtered_json)}")
    assert len(filtered_json) >= 1
    assert all(m["metadata"]["category"] == "skill" for m in filtered_json)
    print("   PASS list_memories with filter works")
    
    # Test 7: update_memory
    print("\n7. Testing update_memory...")
    update_result = await mcp.call_tool("update_memory", {
        "id": memory_id,
        "content": "Updated test memory content",
        "importance_override": 0.9,
    })
    update_json = parse_tool_result(update_result)
    print(f"   Result: {json.dumps(update_json, indent=2)}")
    assert update_json["updated"] is True
    
    # Verify update
    updated = await mcp.call_tool("list_memories", {})
    updated_json = parse_list_result(updated)
    updated_mem = next(m for m in updated_json if m["id"] == memory_id)
    assert updated_mem["content"] == "Updated test memory content"
    assert updated_mem["metadata"]["importance_score"] == 0.9
    print("   PASS update_memory works")
    
    # Test 8: get_memory_stats
    print("\n8. Testing get_memory_stats...")
    stats = await mcp.call_tool("get_memory_stats", {})
    stats_json = parse_tool_result(stats)
    print(f"   Stats: {json.dumps(stats_json, indent=2)}")
    assert stats_json["total_count"] >= 2
    print("   PASS get_memory_stats works")
    
    # Test 9: apply_decay
    print("\n9. Testing apply_decay...")
    decay_result = await mcp.call_tool("apply_decay", {})
    decay_json = parse_tool_result(decay_result)
    print(f"   Result: {json.dumps(decay_json, indent=2)}")
    assert "decayed" in decay_json
    print("   PASS apply_decay works")
    
    # Test 10: delete_memory
    print("\n10. Testing delete_memory...")
    delete_result = await mcp.call_tool("delete_memory", {"id": memory_id})
    delete_json = parse_tool_result(delete_result)
    print(f"   Result: {json.dumps(delete_json, indent=2)}")
    assert delete_json["deleted"] is True
    
    # Verify deletion
    remaining = await mcp.call_tool("list_memories", {})
    remaining_json = parse_list_result(remaining)
    assert not any(m["id"] == memory_id for m in remaining_json)
    print("   PASS delete_memory works")
    
    print("\n" + "=" * 60)
    print("ALL MCP TOOL TESTS PASSED!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_mcp_tools())