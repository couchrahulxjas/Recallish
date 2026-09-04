import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Reveal, SectionMark } from "@/components/pixel";

export const Route = createFileRoute("/guide")({
  head: () => ({
    meta: [
      { title: "How to use — Recallish" },
      {
        name: "description",
        content:
          "Step-by-step guide to download, install, and use Recallish: the local-first memory layer that moves context between Claude, Gemini, and any MCP-compatible assistant.",
      },
      { property: "og:title", content: "How to use — Recallish" },
    ],
  }),
  component: Guide,
});

function Rule() {
  return <div className="h-px w-full bg-rule" />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-6 md:px-10">{children}</div>;
}

function CopyBlock({
  label,
  code,
  note,
}: {
  label: string;
  code: string;
  note?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 border border-ink bg-ink text-background">
      <div className="flex items-center justify-between border-b border-background/20 px-4 py-2">
        <span className="font-mono text-[10px] tracking-[0.18em] text-background/60 uppercase">
          {label}
        </span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="border border-background/30 px-3 py-1 font-mono text-[10px] text-background/80 hover:bg-background/10"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed md:text-sm">
        {code.split("\n").map((line, i) => (
          <div key={i}>
            {line ? (
              <>
                <span className="text-background/40">$ </span>
                {line}
              </>
            ) : (
              "\u00a0"
            )}
          </div>
        ))}
      </pre>
      {note ? <p className="label-mono px-5 pb-4 pt-1">{note}</p> : null}
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border bg-background p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-border font-mono text-xs text-foreground">
          {n}
        </span>
        <h3 className="font-mono text-sm font-medium">{title}</h3>
      </div>
      <div className="mt-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

function Guide() {
  const winInstall = `powershell -ExecutionPolicy Bypass -File install.ps1
powershell -ExecutionPolicy Bypass -File start.ps1`;
  const macInstall = `bash install.sh
bash start.sh`;

  const loadExtension = `1. Open chrome://extensions
2. Turn on "Developer mode" (top-right)
3. Click "Load unpacked"
4. Select the dist-extension/ folder`;

  const mcp = `{
  "mcpServers": {
    "recallish": {
      "command": "<repo>/backend/.venv/Scripts/python.exe",
      "args": [
        "-m",
        "recallish.mcp_server",
        "--config",
        "<repo>/backend/config/recallish.yaml"
      ]
    }
  }
}`;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-rule bg-background/90 backdrop-blur">
        <Shell>
          <div className="flex h-14 items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center border border-ink bg-ink font-mono text-[11px] font-medium text-background">
                R
              </span>
              <span className="font-mono text-sm font-semibold tracking-tight">Recallish</span>
            </Link>
            <nav className="hidden gap-6 md:flex">
              <Link
                to="/"
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                Overview
              </Link>
              <span className="font-mono text-xs text-foreground">How to use</span>
              <Link
                to="/memories"
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                Memories
              </Link>
            </nav>
            <Link
              to="/memories"
              className="font-mono text-xs text-muted-foreground hover:text-foreground md:hidden"
            >
              Inspector
            </Link>
          </div>
        </Shell>
      </header>

      {/* hero */}
      <section className="border-b border-rule">
        <Shell>
          <div className="mx-auto max-w-3xl py-16 text-center md:py-20">
            <Reveal>
              <h1 className="font-mono text-3xl leading-tight font-bold tracking-tight md:text-4xl">
                How to use Recallish
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground md:text-base">
                Local-first memory that moves your context between Claude, Gemini, DeepSeek, Qwen,
                Cursor, and any MCP-compatible assistant. Use a user-owned free-tier API key for
                AI summaries, or keep summarization fully local with llama.cpp.
              </p>
            </Reveal>
          </div>
        </Shell>
      </section>

      {/* quick guide */}
      <section className="border-b border-rule">
        <Shell>
          <div className="py-16">
            <Reveal>
              <SectionMark n="01" label="Install" />
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-8 text-2xl font-semibold tracking-tight">
                One command to get everything running.
              </h2>
            </Reveal>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="font-mono text-sm font-medium">Windows</h3>
                <CopyBlock label="terminal" code={winInstall} />
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  The installer sets up the Python backend and builds the Chrome extension. Add a
                  user-owned OpenAI-compatible key for summaries, or optionally use local Qwen3.
                </p>
              </div>
              <div>
                <h3 className="font-mono text-sm font-medium">macOS / Linux</h3>
                <CopyBlock label="terminal" code={macInstall} />
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Uses <code className="text-foreground">backend/.venv/bin/python</code> and{" "}
                  <code className="text-foreground">bash start.sh</code>. The web UI opens at
                  http://localhost:3000/memories and the API at http://localhost:8765.
                </p>
              </div>
            </div>

            <div className="mt-10">
              <h3 className="font-mono text-lg font-medium">What the installer does</h3>
              <div className="mt-4 grid gap-px border border-border bg-rule sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Backend", "Python venv + pip install -e backend"],
                  ["Frontend", "npm install + builds the web UI"],
                  ["Extension", "Builds dist-extension/ for Chrome"],
                  ["Summaries", "OpenAI-compatible free-tier key or local Qwen3 (optional)"],
                ].map(([t, d]) => (
                  <div key={t} className="h-full bg-background p-5">
                    <h4 className="font-mono text-xs font-medium">{t}</h4>
                    <p className="mt-2 text-xs text-muted-foreground">{d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Shell>
      </section>

      {/* workflow */}
      <section className="border-b border-rule">
        <Shell>
          <div className="py-16">
            <Reveal>
              <SectionMark n="02" label="Daily workflow" />
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-8 text-2xl font-semibold tracking-tight">
                Four steps from one assistant to the next.
              </h2>
            </Reveal>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <Step n="1" title="Load the extension">
                <p>
                  Open{" "}
                  <Link
                    to="/memories"
                    className="font-mono text-foreground underline decoration-border underline-offset-2"
                  >
                    Memories
                  </Link>{" "}
                  or your dashboard. The Chrome extension auto-captures conversations on ChatGPT,
                  Claude, Gemini, DeepSeek, Qwen, and Cursor.
                </p>
              </Step>
              <Step n="2" title="Save context">
                <p>
                  Conversations are auto-ingested the moment you chat. Right-click any text to
                  “Save to Recallish Memory”, or add a memory manually from the Memories page.
                </p>
              </Step>
              <Step n="3" title="Summarise">
                <p>
                  Open the extension popup → Recent extractions. Hit{" "}
                  <span className="text-foreground">Summarise</span> to condense a capture with your
                  configured AI provider, then <span className="text-foreground">Copy</span> it.
                </p>
              </Step>
              <Step n="4" title="Resume anywhere">
                <p>
                  Paste the copied context into the next model or agent. Or let your assistant pull
                  it over MCP with <code className="text-foreground">search_memory</code> and{" "}
                  <code className="text-foreground">summarize_memories</code>.
                </p>
              </Step>
            </div>
          </div>
        </Shell>
      </section>

      {/* extension + MCP */}
      <section className="border-b border-rule">
        <Shell>
          <div className="py-16">
            <Reveal>
              <SectionMark n="03" label="Connect" />
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-8 text-2xl font-semibold tracking-tight">
                Hand off to any assistant.
              </h2>
            </Reveal>
            <div className="mt-10 grid gap-8 md:grid-cols-2">
              <div>
                <h3 className="font-mono text-sm font-medium">Load the Chrome extension</h3>

            <div className="mt-10 border border-ink bg-ink p-6 text-background md:flex md:items-center md:justify-between md:gap-8">
              <div>
                <h3 className="font-mono text-lg font-medium">Download the Chrome extension</h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-background/70">
                  Download the latest packaged extension, unzip it, then load the extracted folder
                  in Chrome. No store account is required.
                </p>
              </div>
              <a
                href="/recallish-extension.zip"
                download
                className="mt-5 inline-block shrink-0 border border-background px-5 py-3 font-mono text-sm hover:bg-background hover:text-ink md:mt-0"
              >
                Download extension (.zip)
              </a>
            </div>
                <CopyBlock label="steps" code={loadExtension} />
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Once loaded, the extension watches supported AI sites and ingests conversations
                  automatically.
                </p>
              </div>
              <div>
                <h3 className="font-mono text-sm font-medium">Wire in MCP (Cursor / Claude)</h3>
                <CopyBlock
                  label="mcp.json"
                  code={mcp}
                  note='Replace "<repo>" with your project path. On macOS/Linux use .venv/bin/python.'
                />
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Tools: <code className="text-foreground">save_memory</code>,{" "}
                  <code className="text-foreground">ingest_conversation</code>,{" "}
                  <code className="text-foreground">search_memory</code>,{" "}
                  <code className="text-foreground">list_memories</code>,{" "}
                  <code className="text-foreground">update_memory</code>,{" "}
                  <code className="text-foreground">delete_memory</code>,{" "}
                  <code className="text-foreground">get_memory_stats</code>,{" "}
                  <code className="text-foreground">apply_decay</code>,{" "}
                  <code className="text-foreground">summarize_content</code>,{" "}
                  <code className="text-foreground">summarize_memories</code>.
                </p>
              </div>
            </div>
          </div>
        </Shell>
      </section>

      {/* tips + privacy */}
      <section className="border-b border-rule">
        <Shell>
          <div className="py-16">
            <div className="grid gap-8 md:grid-cols-2">
              <Reveal>
                <SectionMark n="04" label="Tips" />
                <ul className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
                  {[
                    "Be specific: include tech stack, current task, and what's done.",
                    "Save checkpoint memories after completing major features.",
                    "Search with 3–5 words describing what you need.",
                    "Mark critical memories as more important to rank them higher.",
                  ].map((t) => (
                    <li key={t} className="flex gap-3">
                      <span className="text-foreground">→</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal delay={60}>
                <SectionMark n="05" label="Privacy" />
                <div className="mt-6 space-y-3 text-sm leading-relaxed text-muted-foreground">
                  <p>
                    100% local storage — your conversations never leave your device. The only
                    network activity is the one-time download of the summarizer model.
                  </p>
                  <p>
                    No cloud, no accounts, no data collection. Open source, so you can audit every
                    line.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </Shell>
      </section>

      {/* cta */}
      <section className="border-b border-rule">
        <Shell>
          <div className="py-16 text-center">
            <Reveal>
              <h2 className="font-mono text-xl font-bold tracking-tight md:text-2xl">
                Start fresh in the memory inspector.
              </h2>
              <div className="mt-6 flex justify-center gap-3">
                <Link
                  to="/memories"
                  className="brackets inline-flex items-center justify-center border border-ink bg-ink px-6 py-3 font-mono text-sm text-background hover:bg-foreground/85"
                >
                  Open Memories
                </Link>
                <Link
                  to="/"
                  className="brackets inline-flex items-center justify-center border border-border bg-background px-6 py-3 font-mono text-sm text-foreground hover:bg-muted"
                >
                  Back to overview
                </Link>
              </div>
            </Reveal>
          </div>
        </Shell>
      </section>

      {/* footer */}
      <footer>
        <Shell>
          <div className="flex flex-col items-center justify-between gap-4 py-10 md:flex-row">
            <span className="font-mono text-sm font-medium">recallish</span>
            <p className="text-xs text-muted-foreground">
              One memory. Every assistant. Always on your machine.
            </p>
            <div className="flex gap-5">
              <Link to="/" className="font-mono text-xs text-muted-foreground hover:text-foreground">
                Overview
              </Link>
              <Link
                to="/memories"
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                Memories
              </Link>
            </div>
          </div>
          <Rule />
        </Shell>
      </footer>
    </div>
  );
}
