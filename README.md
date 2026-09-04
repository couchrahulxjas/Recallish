# Recallish

Recallish is a local-first AI memory system for capturing conversations, extracting useful facts, and retrieving context across chats, models, and developer tools. It combines a Python memory engine, a React web inspector, an optional browser extension, and MCP integrations for AI assistants.

The goal is simple: keep important project context available after a conversation ends, without requiring a hosted database or sending your entire memory store to a third party.

## What Recallish does

AI conversations are useful, but important decisions and project context are often trapped inside one chat session. Recallish provides a local memory layer that keeps that context available across conversations, AI providers, and developer tools.

Typical uses include:

- Save an explicit fact, decision, preference, goal, or project detail.
- Ingest a conversation and extract durable memories from it.
- Search memories semantically instead of matching exact keywords.
- Rank results using similarity, importance, recency, and access history.
- Mark newer memories as superseding older information.
- Summarize a group of memories or a captured conversation.
- Continue work in Claude, Cursor, ChatGPT, Gemini, or another MCP-compatible client.

## Architecture

Recallish is organized into three cooperating layers:

1. **Memory engine**: The Python backend validates memory records, extracts candidates, stores embeddings in ChromaDB, and performs retrieval and ranking.
2. **Local interfaces**: The CLI, HTTP API, FastAPI server, and MCP server expose the same engine to scripts, the web inspector, and AI clients.
3. **Capture clients**: The React inspector and Chromium extension provide manual and automatic ways to capture, browse, and manage context.

```text
AI chat pages / MCP clients / Web inspector
                  |
                  v
        Python API and Memory Engine
          |          |            |
          v          v            v
      ChromaDB   Conversation   Optional LLM
                 JSONL log      summarization
```

The default embedding model is `all-MiniLM-L6-v2`. It runs locally and stores its vector collection under `backend/.recallish-store/chroma`. Raw conversation chunks are also recorded in the configured JSONL conversation log.

## Memory lifecycle

### 1. Capture

You can create a memory with the CLI, web inspector, HTTP API, browser extension, or MCP. Conversation ingestion accepts raw text and keeps a conversation record while extracting candidate durable memories.

### 2. Normalize and score

Each memory receives a category, source, timestamps, importance score, access statistics, and optional supersession metadata. Explicitly requested memories can receive a stronger importance signal.

### 3. Store locally

The content and its embedding are persisted in ChromaDB. No hosted database is required. The local store is ignored by Git so personal memories are not accidentally uploaded.

### 4. Retrieve

Search uses vector similarity and then combines relevance with importance and recency. Superseded entries are hidden by default, but can be included when auditing historical context.

### 5. Maintain

You can update or delete memories, inspect statistics, and run the manual decay command to reduce the importance of memories that have not been used recently.

## Using the web inspector

Start the backend and frontend as described above, then open:

```text
http://localhost:3000/memories
```

The inspector supports browsing stored memories, semantic search, category filtering, adding new entries, editing content or importance, and deleting entries. It communicates with the local API at `http://127.0.0.1:8765`.

## Using the HTTP API

Start the API with:

```powershell
cd backend
.venv\Scripts\python -m recallish.cli --config config/recallish.yaml serve
```

Example requests:

```powershell
# Save a memory
curl.exe -X POST http://127.0.0.1:8765/api/memories `
  -H "Content-Type: application/json" `
  -d '{"content":"The API uses local storage","category":"project_fact","source":"manual"}'

# Search memories
curl.exe "http://127.0.0.1:8765/api/search?q=local%20storage&top_k=5"

# View statistics
curl.exe http://127.0.0.1:8765/api/stats
```

The API also exposes health, list, update, delete, conversation ingestion, and summarization endpoints. Request and response models are defined with Pydantic in the backend.

## MCP workflow

MCP is the recommended integration for AI assistants. Once configured, an assistant can save context during a conversation and search it in a later conversation without manually copying large transcripts.

The main MCP tools are:

| Tool | Purpose |
| --- | --- |
| `save_memory` | Store one explicit memory with a category and source. |
| `ingest_conversation` | Process raw conversation text and extract memories. |
| `search_memory` | Find relevant memories with semantic ranking. |
| `list_memories` | Browse memories with filters. |
| `update_memory` | Change memory content or importance. |
| `delete_memory` | Remove a memory. |
| `get_memory_stats` | Inspect totals, categories, and storage size. |
| `apply_decay` | Apply manual importance decay to older, unused memories. |
| `summarize_content` | Create a structured summary from supplied text. |
| `summarize_memories` | Search stored memories and summarize the results. |

The server communicates over stdio. It does not need a separate web server:

```powershell
<repo>\backend\.venv\Scripts\python.exe -m recallish.mcp_server
```

Use the equivalent `.venv/bin/python` path on macOS/Linux. Configure the command in Cursor, Claude Desktop, VS Code, or another MCP-compatible host.

## Browser extension behavior

The optional extension can detect supported AI chat pages and capture conversation text. It supports ChatGPT, Claude, Gemini, and Cursor-related pages through platform-specific selectors.

The extension includes:

- Automatic conversation detection with a mutation observer.
- Debounced extraction to avoid repeated captures while a page is changing.
- Content hashing and conversation IDs to avoid duplicate ingestion.
- A context menu for saving selected text or the current page.
- Manual extraction from the extension popup.

Build it with `npm run build:extension`, then load `dist-extension/` as an unpacked extension from `chrome://extensions`.

## Optional summarization

Memory storage and semantic search work without an external LLM. Summarization is optional and can use either an OpenAI-compatible hosted endpoint configured with `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`, or a local llama.cpp server configured in `backend/config/recallish.yaml`.

Structured summaries can include a title, overview, key points, important details, action items, decisions, and memory candidates. Do not commit API keys or private provider URLs to the repository.

## Categories and metadata

Categories are flexible. Common categories include:

- `project_fact`: Technical details, architecture, or current implementation state.
- `decision`: A choice that should remain available later.
- `preference`: A personal or team preference.
- `profile`: Environment or workflow information.
- `goal`: A desired outcome or next milestone.
- `temporary`: Short-lived context that may decay quickly.
- `misc`: Information that does not fit another category.

Every stored entry includes timestamps, source, importance, access count, and optional links to replaced memories. This makes the store useful both as a personal memory layer and as an inspectable project archive.

## Privacy and security

Recallish is designed for local-first use:

- Memory content is stored in the local `.recallish-store` directory.
- The default embedding model runs locally after its initial download.
- The backend binds to localhost by default.
- API keys should be supplied through environment variables.
- Local stores, virtual environments, dependencies, and logs are excluded by `.gitignore`.

Review configuration files before committing. Do not upload private MCP client configuration containing absolute paths, credentials, or tokens.

## Project layout

```text
Recallish/
|-- backend/
|   |-- config/recallish.yaml       Backend configuration
|   |-- recallish/                  Python engine, APIs, CLI, and MCP server
|   `-- tests/                      Backend tests
|-- src/
|   |-- content/                    Extension capture and platform adapters
|   |-- components/                 React UI components
|   |-- lib/                        API and shared utilities
|   `-- routes/                     Inspector and guide routes
|-- public/                         Extension and web assets
|-- dist-extension/                 Built unpacked extension output
|-- package.json                    Frontend scripts and dependencies
|-- vite.config.ts                  Web application build configuration
`-- vite.config.extension.ts        Browser extension build configuration
```

## Troubleshooting

**The backend cannot start**

Activate the backend virtual environment and reinstall the package:

```powershell
cd backend
.venv\Scripts\activate
pip install -e .
```

**The inspector shows no memories**

Make sure the backend API is running on port 8765 and initialize the store:

```powershell
python -m recallish.cli --config config/recallish.yaml init
python -m recallish.cli --config config/recallish.yaml serve
```

**The embedding model is downloading**

The first engine startup downloads `all-MiniLM-L6-v2`. This is expected. Later starts reuse the local model cache.

**An MCP client cannot connect**

Check that its `command` points to the Python executable where Recallish was installed. Use an absolute path to `backend/.venv/Scripts/python.exe` on Windows and restart the client after changing its MCP configuration.

## Contributing

Before opening a change, run the relevant checks:

```powershell
npm run lint
npm run build
cd backend
pip install -e ".[test]"
pytest
```

Keep changes focused, avoid committing generated stores or credentials, and update this README when setup or user-facing behavior changes.

Recallish is a local-first AI memory system for capturing conversations, extracting useful facts, and retrieving context across chats, models, and tools. Memories are stored locally in ChromaDB with local sentence-transformer embeddings.

## Requirements

- Python 3.10+
- Node.js and npm
- Chrome or another Chromium browser for the optional extension

## Install

From the repository root:

```powershell
npm install
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e .
python -m recallish.cli --config config/recallish.yaml init
```

On macOS/Linux, activate the virtual environment with `source .venv/bin/activate`.
The first initialization downloads `all-MiniLM-L6-v2`; normal operation and stored memories remain local.

## Run the app

Start the backend API and frontend in separate terminals:

```powershell
# Terminal 1
cd backend
.venv\Scripts\python -m recallish.cli --config config/recallish.yaml serve

# Terminal 2, from the repository root
npm run dev
```

Open `http://localhost:3000/memories` for the memory inspector. The API listens on `http://127.0.0.1:8765`.

For a production build:

```powershell
npm run build
npm run serve
```

## CLI

Run these from `backend` with the virtual environment active:

```powershell
python -m recallish.cli --config config/recallish.yaml add "We use local-only storage" --category project_fact --source claude --explicit
python -m recallish.cli --config config/recallish.yaml ingest "Conversation text" --source claude
python -m recallish.cli --config config/recallish.yaml search "local storage"
python -m recallish.cli --config config/recallish.yaml list --sort importance
python -m recallish.cli --config config/recallish.yaml stats
python -m recallish.cli --config config/recallish.yaml decay
```

The store is created at `backend/.recallish-store`.

## MCP integrations

Recallish exposes `save_memory`, `ingest_conversation`, `search_memory`, `list_memories`, `update_memory`, `delete_memory`, `get_memory_stats`, and `apply_decay` through MCP.

Install the backend first, then configure the client that you use. Replace `<repo>` with the absolute repository path.

### Cursor

Create `.cursor/mcp.json` in the project or use Cursor's user-level MCP configuration:

```json
{
  "mcpServers": {
    "recallish": {
      "command": "<repo>/backend/.venv/Scripts/python.exe",
      "args": ["-m", "recallish.mcp_server"]
    }
  }
}
```

Use `<repo>/backend/.venv/bin/python` on macOS/Linux.

### Claude Desktop

Add the same `mcpServers` block to:

- Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

Restart Claude Desktop after saving the configuration.

### Other MCP clients

Use this command wherever the client accepts an MCP stdio server:

```text
<repo>/backend/.venv/Scripts/python.exe -m recallish.mcp_server
```

The server also discovers `backend/config/recallish.yaml` automatically when installed editable. Set `RECALLISH_CONFIG` to override it.

## Optional AI summaries

Summaries can use any OpenAI-compatible endpoint. Set credentials in the shell environment rather than committing them to configuration:

```powershell
$env:LLM_API_KEY = "your-key"
$env:LLM_BASE_URL = "https://your-provider.example/v1"
$env:LLM_MODEL = "your-model"
```

`OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` are also supported. Fully local llama.cpp settings remain available in `backend/config/recallish.yaml`.

## Browser extension

The extension captures conversations and selected text from ChatGPT, Claude, Gemini, and Cursor-compatible pages.

```powershell
npm run build:extension
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist-extension/`.

## Development commands

```powershell
npm run lint
npm run build
cd backend
pip install -e ".[test]"
pytest
```

## Configuration

Edit `backend/config/recallish.yaml` for storage, embedding, extraction, and local LLM settings. Keep API keys in environment variables. The repository includes `mcp_config.json` and `mcp_config.example.json` as generic configuration references; they are not required for the app to run.
#
