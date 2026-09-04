import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Reveal, SectionMark } from "@/components/pixel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Recallish — One memory. Every assistant." },
      {
        name: "description",
        content:
          "Recallish is a local-first memory layer for AI assistants. Start with Claude, continue with Gemini — your context never leaves your machine.",
      },
      { property: "og:title", content: "Recallish — One memory. Every assistant." },
      {
        property: "og:description",
        content:
          "Local-first memory that travels between Claude, Gemini and any MCP-compatible assistant. No cloud, no accounts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const GH = "#install";
const MCP_SNIPPET = `{
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

function Rule() {
  return <div className="h-px w-full bg-rule" />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-6 md:px-10">{children}</div>;
}

function Button({
  children,
  href,
  variant = "primary",
}: {
  children: React.ReactNode;
  href: string;
  variant?: "primary" | "ghost";
}) {
  const base =
    "brackets inline-flex items-center justify-center gap-2 border px-6 py-3 font-mono text-sm transition-colors";
  const styles =
    variant === "primary"
      ? "border-ink bg-ink text-background hover:bg-foreground/85"
      : "border-border bg-background text-foreground hover:bg-muted";
  return (
    <a href={href} className={`${base} ${styles}`}>
      {children}
    </a>
  );
}

function Node({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="brackets flex min-w-[9rem] flex-col items-center gap-1 border border-border bg-background px-5 py-4">
      <span className="font-mono text-sm text-foreground">{title}</span>
      <span className="label-mono">{sub}</span>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center gap-1 text-muted-foreground">
      <span className="h-px w-8 bg-rule" />
      <span className="font-mono text-xs">→</span>
      <span className="h-px w-8 bg-rule" />
    </div>
  );
}

function Home() {
  const [copied, setCopied] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const cmd = `cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -e .
python -m recallish.cli --config config/recallish.yaml init`;

  return (
    <div className="min-h-screen bg-background">
      {/* nav */}
      <header className="sticky top-0 z-20 border-b border-rule bg-background/90 backdrop-blur">
        <Shell>
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center border border-ink bg-ink font-mono text-[11px] font-medium text-background">
                R
              </span>
              <span className="font-mono text-sm font-semibold tracking-tight">Recallish</span>
            </div>
            <nav className="hidden gap-6 md:flex">
              {[
                ["Overview", "#overview"],
                ["Features", "#features"],
                ["How it works", "#how"],
                ["Install", "#install"],
              ].map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  className="font-mono text-xs text-muted-foreground hover:text-foreground"
                >
                  {label}
                </a>
              ))}
              <Link
                to="/guide"
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                How to use
              </Link>
              <Link
                to="/memories"
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                Memories
              </Link>
            </nav>
            <Link
              to="/memories"
              className="font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              Inspector
            </Link>
          </div>
        </Shell>
      </header>

      {/* hero */}
      <section className="border-b border-rule">
        <Shell>
          <div className="mx-auto max-w-3xl py-20 text-center md:py-28">
            <Reveal>
              <h1 className="font-mono text-3xl leading-tight font-bold tracking-tight md:text-5xl">
                Your memory shouldn't
                <br />
                <span className="text-accent">belong to one AI.</span>
              </h1>
            </Reveal>
            <Reveal delay={80}>
              <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
                Recallish stores what your AI conversations teach it, locally on your machine, so
                any assistant you open next already knows you.
              </p>
            </Reveal>
            <Reveal delay={160}>
              <div className="mt-10 flex flex-col items-center gap-3">
                <Button href="#install">Get Recallish</Button>
                <Button href="/memories" variant="ghost">
                  Open the inspector
                </Button>
                <p className="label-mono mt-2">macOS · Linux · Windows · source-available</p>
              </div>
            </Reveal>
          </div>

          <Reveal delay={220}>
            <div className="brackets mb-20 border border-border p-6 md:p-10">
              <p className="label-mono mb-6 text-center">Same memory, different assistant</p>
              <div className="flex flex-col items-center justify-center gap-4 md:flex-row">
                <Node title="Claude" sub="Today" />
                <Arrow />
                <Node title="recallish" sub="Local store" />
                <Arrow />
                <Node title="Gemini" sub="Tomorrow" />
              </div>
            </div>
          </Reveal>
        </Shell>
      </section>

      {/* problem */}
      <section id="overview" className="border-b border-rule">
        <Shell>
          <div className="py-20">
            <Reveal>
              <SectionMark n="00" label="The problem" />
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-8 max-w-2xl text-2xl leading-snug font-semibold tracking-tight md:text-4xl">
                Every assistant makes you start over.
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Your context, preferences and past conversations are stuck inside whichever app you
                happened to open. Switch tools and you're a stranger again.
              </p>
            </Reveal>
          </div>
        </Shell>
      </section>

      {/* what it does */}
      <section className="border-b border-rule">
        <Shell>
          <div className="py-20">
            <Reveal>
              <SectionMark n="01" label="What Recallish does" />
            </Reveal>
            <div className="mt-10 grid gap-px border border-border bg-rule sm:grid-cols-2">
              {[
                ["Runs on your machine", "Nothing goes to the cloud. Ever."],
                ["Remembers what matters", "Not a transcript dump — the durable facts."],
                ["Works across assistants", "Claude, Gemini and anything else speaking MCP."],
                ["You stay in control", "Inspect or delete anything, anytime."],
              ].map(([t, d], i) => (
                <Reveal key={t} delay={i * 60}>
                  <div className="h-full bg-background p-6">
                    <p className="label-mono">{String(i + 1).padStart(2, "0")}</p>
                    <h3 className="mt-3 font-mono text-sm font-medium">{t}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{d}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Shell>
      </section>

      {/* features */}
      <section id="features" className="border-b border-rule">
        <Shell>
          <div className="py-20">
            <Reveal>
              <SectionMark n="02" label="Features" />
            </Reveal>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {[
                [
                  "Cross-assistant memory",
                  "The same memory follows you between Claude, Gemini and other MCP tools.",
                ],
                [
                  "Browser extension",
                  "Capture conversations across supported AI chats and move context with one click.",
                ],
                ["Local-first storage", "Everything lives in a local database on your device."],
                ["Semantic search", "Memories are retrieved by meaning, not just keywords."],
                ["MCP native", "Built on the open Model Context Protocol. No lock-in."],
                ["Full control", "Inspect, edit or delete any memory at any time."],
                ["Zero cloud", "No servers, no accounts, no data collection."],
              ].map(([t, d], i) => (
                <Reveal key={t} delay={(i % 3) * 60}>
                  <div className="brackets h-full border border-border p-6">
                    <h3 className="font-mono text-sm font-medium">{t}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Shell>
      </section>

      {/* how it works */}
      <section id="how" className="border-b border-rule">
        <Shell>
          <div className="py-20">
            <Reveal>
              <SectionMark n="03" label="How it works" />
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-8 max-w-2xl text-2xl leading-snug font-semibold tracking-tight md:text-4xl">
                Four steps, none of them a server.
              </h2>
            </Reveal>
            <div className="mt-10 grid gap-px border border-border bg-rule sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Conversation", "Any assistant, any topic."],
                ["Extract memory", "Durable facts get pulled out."],
                ["Store locally", "ChromaDB + embeddings on your disk."],
                ["Next assistant", "Retrieves it over MCP."],
              ].map(([t, d], i) => (
                <Reveal key={t} delay={i * 60}>
                  <div className="h-full bg-background p-6">
                    <p className="label-mono">Step {i + 1}</p>
                    <h3 className="mt-3 font-mono text-sm font-medium">{t}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{d}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Shell>
      </section>

      {/* stack */}
      <section className="border-b border-rule">
        <Shell>
          <div className="py-14">
            <Reveal>
              <p className="label-mono text-center">Built with</p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                {["Python", "ChromaDB", "all-MiniLM-L6-v2", "sentence-transformers", "MCP SDK"].map(
                  (s) => (
                    <span
                      key={s}
                      className="border border-border px-4 py-2 font-mono text-xs text-muted-foreground"
                    >
                      {s}
                    </span>
                  ),
                )}
              </div>
            </Reveal>
          </div>
        </Shell>
      </section>

      {/* install */}
      <section id="install" className="border-b border-rule">
        <Shell>
          <div className="py-20">
            <Reveal>
              <SectionMark n="04" label="Get started" />
            </Reveal>
            <Reveal delay={60}>
              <h2 className="mt-8 text-2xl leading-snug font-semibold tracking-tight md:text-4xl">
                Four commands and it's yours.
              </h2>
            </Reveal>
            <Reveal delay={120}>
              <div className="mt-8 border border-ink bg-ink text-background">
                <div className="flex items-center justify-between border-b border-background/20 px-4 py-2">
                  <span className="font-mono text-[10px] tracking-[0.18em] text-background/60 uppercase">
                    terminal
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(cmd);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    }}
                    className="border border-background/30 px-3 py-1 font-mono text-[10px] text-background/80 hover:bg-background/10"
                  >
                    {copied ? "copied" : "copy"}
                  </button>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed md:text-sm">
                  {cmd.split("\n").map((line) => (
                    <div key={line}>
                      <span className="text-background/40">$ </span>
                      {line}
                    </div>
                  ))}
                  <div>
                    <span className="text-background/40">$ </span>
                    <span className="cursor-blink">▌</span>
                  </div>
                </pre>
              </div>
              <p className="label-mono mt-4">
                Windows shown. On macOS/Linux:{" "}
                <code className="text-foreground">source .venv/bin/activate</code>
              </p>
            </Reveal>
            <Reveal delay={180}>
              <div className="mt-12 border border-border p-6 md:flex md:items-center md:justify-between md:gap-8">
                <div>
                  <h3 className="font-mono text-lg font-medium">Use the browser extension</h3>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                    Download the Chrome extension, unzip it, and load the folder from
                    <code className="mx-1 text-foreground">chrome://extensions</code>.
                  </p>
                </div>
                <a
                  href="/recallish-extension.zip"
                  download
                  className="mt-5 inline-block shrink-0 border border-ink bg-ink px-5 py-3 font-mono text-sm text-background hover:bg-foreground/85 md:mt-0"
                >
                  Download extension
                </a>
              </div>
            </Reveal>
            <Reveal delay={220}>
              <h3 className="mt-12 font-mono text-lg font-medium">
                Wire it into Cursor or Claude Desktop
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Point the MCP host at this repo’s venv Python and{" "}
                <code className="text-foreground">recallish.mcp_server</code>. Cursor:{" "}
                <code className="text-foreground">.cursor/mcp.json</code>. Claude Desktop:{" "}
                <code className="text-foreground">claude_desktop_config.json</code>. On macOS/Linux,
                use <code className="text-foreground">.venv/bin/python</code> instead of{" "}
                <code className="text-foreground">.venv/Scripts/python.exe</code>.
              </p>
              <div className="mt-6 border border-ink bg-ink text-background">
                <div className="flex items-center justify-between border-b border-background/20 px-4 py-2">
                  <span className="font-mono text-[10px] tracking-[0.18em] text-background/60 uppercase">
                    mcp.json
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(MCP_SNIPPET);
                      setCopiedMcp(true);
                      setTimeout(() => setCopiedMcp(false), 1600);
                    }}
                    className="border border-background/30 px-3 py-1 font-mono text-[10px] text-background/80 hover:bg-background/10"
                  >
                    {copiedMcp ? "copied" : "copy"}
                  </button>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed md:text-sm">
                  {MCP_SNIPPET}
                </pre>
              </div>
              <p className="label-mono mt-4">
                Tools: save_memory, ingest_conversation, search_memory, list_memories,
                update_memory, delete_memory, get_memory_stats, apply_decay
              </p>
            </Reveal>
          </div>
        </Shell>
      </section>

      {/* closing cta */}
      <section className="border-b border-rule">
        <Shell>
          <div className="py-24 text-center">
            <Reveal>
              <h2 className="font-mono text-2xl font-bold tracking-tight md:text-4xl">
                One memory. Every assistant.
              </h2>
              <p className="label-mono mt-4">macOS · Windows · Linux · source-available</p>
              <div className="mt-8 flex justify-center">
                <Button href={GH}>Get Recallish</Button>
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
              <a
                href="#install"
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                Install
              </a>
              <Link
                to="/guide"
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                How to use
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
