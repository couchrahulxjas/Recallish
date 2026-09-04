import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type MemoryRecord, type Stats, type RecentConversation } from "../lib/api";
import { Copy, Download, Loader2, ChevronDown, ChevronRight, History } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const CATEGORIES = ["preference", "project_fact", "decision", "profile", "misc"] as const;

const TRANSFER_PLATFORMS = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "grok", label: "Grok" },
  { id: "perplexity", label: "Perplexity" },
] as const;

function formatDate(isoString?: string): string {
  if (!isoString) return "Unknown";
  try {
    return new Date(isoString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Invalid date";
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}

function downloadMarkdown(extraction: RecentConversation): void {
  const source = extraction.source || "AI chat";
  const date = extraction.created_at ? new Date(extraction.created_at) : new Date();
  const dateLabel = Number.isNaN(date.getTime()) ? "" : `\n\n_Captured ${date.toLocaleString()}_`;
  const markdown = `# Conversation from ${source}\n\n${extraction.content.trim()}${dateLabel}\n`;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `recallish-${source.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "conversation"}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background p-4 rounded border border-border">
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold">{value}</p>
    </div>
  );
}

function MemoryItem({
  item,
  onDelete,
}: {
  item: MemoryRecord;
  onDelete: (id: string) => void;
}) {
  const isSuperseded = !!item.metadata.superseded_by;
  const importance = item.metadata.importance_score ?? 0;
  const category = item.metadata.category ?? "misc";
  const source = item.metadata.source ?? "unknown";

  return (
    <article
      className={`border border-border p-4 rounded ${isSuperseded ? "opacity-50" : ""}`}
      style={{ borderLeft: `3px solid ${importance > 0.7 ? "#22c55e" : importance > 0.4 ? "#eab308" : "#ef4444"}` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm leading-relaxed flex-1 min-w-0">{item.content}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(item.id)}
          className="text-destructive hover:bg-destructive/10"
        >
          Delete
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant={isSuperseded ? "secondary" : "default"} className="text-[10px]">
          {category}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {importance.toFixed(2)}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {source}
        </Badge>
        {item.similarity !== undefined && (
          <Badge variant="outline" className="text-[10px]">
            {Math.round(item.similarity * 100)}%
          </Badge>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
          {formatDate(item.metadata.updated_at)}
        </span>
      </div>
    </article>
  );
}

export function PopupApp() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [recent, setRecent] = useState<MemoryRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<typeof CATEGORIES[number]>("misc");
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<"search" | "all">("search");

  const [recentExtractions, setRecentExtractions] = useState<RecentConversation[]>([]);
  const [extractionSummaries, setExtractionSummaries] = useState<Record<string, { summary: string; error?: string }>>(
    {},
  );
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recentCollapsed, setRecentCollapsed] = useState(true);
  const [selectedExtractionId, setSelectedExtractionId] = useState<string | null>(null);
  const [transferringTo, setTransferringTo] = useState<string | null>(null);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);

  const sortByRecency = (list: MemoryRecord[]) =>
    [...list]
      .filter((m) => !m.metadata.superseded_by)
      .sort(
        (a, b) =>
          new Date(b.metadata.updated_at ?? 0).getTime() -
          new Date(a.metadata.updated_at ?? 0).getTime(),
      );

  const loadRecent = useCallback(async () => {
    try {
      const all = await api.listMemories();
      setRecent(sortByRecency(all).slice(0, 2));
    } catch {
      setRecent([]);
    }
  }, []);

  const loadRecentExtractions = useCallback(async () => {
    try {
      const records = await api.getRecentConversations(12);
      // Deduplicate by conversation id on the client as well, keeping the newest first.
      const seen = new Set<string>();
      const unique: RecentConversation[] = [];
      for (const r of records) {
        const key = r.conversation_id || r.id;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(r);
      }
      setRecentExtractions(unique);
    } catch {
      setRecentExtractions([]);
    }
  }, []);

  const flattenSummary = (result: {
    lines?: string[];
    structured?: {
      title?: string;
      content_type?: string;
      summary?: string | string[];
      key_points?: string[];
      important_details?: string[];
      action_items?: string[];
      decisions?: string[];
      memory_candidates?: string[];
    } | null;
    error?: string | null;
  }): { summary: string; error?: string } => {
    const structured = result.structured;
    if (structured && structured.summary) {
      const sum = Array.isArray(structured.summary)
        ? structured.summary.join("\n")
        : String(structured.summary);
      if (sum.trim()) {
        const blocks: string[] = [sum];
        if (structured.key_points?.length) {
          blocks.push("Key points:\n" + structured.key_points.map((k) => `- ${k}`).join("\n"));
        }
        if (structured.action_items?.length) {
          blocks.push("Action items:\n" + structured.action_items.map((a) => `- ${a}`).join("\n"));
        }
        if (structured.decisions?.length) {
          blocks.push("Decisions:\n" + structured.decisions.map((d) => `- ${d}`).join("\n"));
        }
        return { summary: blocks.join("\n\n") };
      }
    }
    if (result.lines && result.lines.length) {
      return { summary: result.lines.join("\n") };
    }
    return { summary: "", error: result.error || "No summary produced." };
  };

  const onSummarize = async (id: string) => {
    const extraction = recentExtractions.find((e) => e.id === id);
    if (!extraction) return;
    setSummarizingId(id);
    try {
      const label = `Recent extraction from ${extraction.source || "unknown"}`;
      const result = await api.summarizeContent(label, [extraction.content], undefined, 8);
      const flattened = flattenSummary(result);
      setExtractionSummaries((prev) => ({ ...prev, [id]: flattened }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Summarization failed";
      setExtractionSummaries((prev) => ({ ...prev, [id]: { summary: "", error: message } }));
    } finally {
      setSummarizingId(null);
    }
  };

  const onCopyExtraction = async (id: string) => {
    const extraction = recentExtractions.find((e) => e.id === id);
    if (!extraction) return;
    const ok = await copyToClipboard(extraction.content);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  const onTransfer = async (targetPlatform: string) => {
    setTransferringTo(targetPlatform);
    setTransferMessage(null);
    try {
      const result = await api.transferChat(targetPlatform);
      setTransferMessage(
        result.messageCount
          ? `Transferred ${result.messageCount} message(s) to ${targetPlatform} ✓`
          : `Transferred to ${targetPlatform} ✓`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transfer failed";
      setTransferMessage(`Transfer failed: ${message}`);
    } finally {
      setTransferringTo(null);
      setTimeout(() => setTransferMessage(null), 6000);
    }
  };

  const load = useCallback(async (search = "") => {
    setBusy(true);
    setError(null);
    try {
      let listJson: MemoryRecord[];
      if (search) {
        listJson = await api.searchMemories(search, 20);
      } else {
        listJson = await api.listMemories();
      }
      const statsJson = await api.getStats();
      setItems(listJson);
      setStats(statsJson);
      setRecent(sortByRecency(listJson).slice(0, 2));
      setStatus(search ? `Search results for "${search}"` : `All memories (${listJson.length})`);
    } catch (err) {
      setItems([]);
      setRecent([]);
      setStats(null);
      const message = err instanceof Error ? err.message : "Failed to load memories";
      setError(/failed to fetch|network|connection/i.test(message)
        ? "Cannot reach backend at 127.0.0.1:8765. Start it with: python -m recallish.cli serve"
        : message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    void loadRecentExtractions();
  }, [loadRecentExtractions]);

  const onDelete = async (id: string) => {
    if (!confirm("Delete this memory?")) return;
    try {
      await api.deleteMemory(id);
      await load(query);
      await loadRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    try {
      await api.createMemory({
        content: draft.trim(),
        category,
        source: "extension",
        explicit_signal: true,
      });
      setDraft("");
      await load(query);
      await loadRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await load(query);
  };

  const topCategory = useMemo(() => {
    if (!stats) return "—";
    const entries = Object.entries(stats.top_categories);
    return entries.length > 0 ? entries[0]?.[0] ?? "—" : "—";
  }, [stats]);

  const latestExtraction = recentExtractions.length > 0 ? recentExtractions[0] : null;
  const currentExtraction =
    recentExtractions.find((e) => e.id === selectedExtractionId) || latestExtraction;
  const previousExtractions = recentExtractions.filter(
    (e) => e.id !== (currentExtraction?.id ?? ""),
  );

  const renderExtractionCard = (extraction: RecentConversation, prominent: boolean) => {
    const entry = extractionSummaries[extraction.id];
    const isSummarizing = summarizingId === extraction.id;
    return (
      <article key={extraction.id} className="border border-border p-3 rounded">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {extraction.source || "unknown"}
          </Badge>
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
            {formatDate(extraction.created_at)}
          </span>
        </div>

        <div
          className={`mt-2 overflow-hidden text-xs leading-relaxed ${
            prominent ? "" : "text-muted-foreground max-h-[80px]"
          }`}
        >
          <pre className="whitespace-pre-wrap font-sans">{extraction.content}</pre>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSummarize(extraction.id)}
            disabled={isSummarizing}
          >
            {isSummarizing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Summarising...
              </>
            ) : entry && !entry.error && entry.summary ? (
              "Summarised"
            ) : (
              "Summarise"
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCopyExtraction(extraction.id)}
            className="gap-1"
            disabled={isSummarizing}
          >
            <Copy className="h-3.5 w-3.5" />
            {copiedId === extraction.id ? "Copied!" : "Copy"}
          </Button>
        </div>

        {entry && (
          <div className="mt-2">
            {entry.error ? (
              <p className="text-[11px] text-destructive">
                {entry.error}
                <br />
                <span className="text-muted-foreground">
                  Configure `LLM_API_KEY` and `LLM_BASE_URL` (or the `OPENAI_*` aliases), then restart the backend.
                </span>
              </p>
            ) : (
              <>
                <p className="mb-1 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                  Summary
                </p>
                <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground font-sans border border-border bg-muted/40 p-2 rounded max-h-[200px] overflow-y-auto">
                  {entry.summary}
                </pre>
              </>
            )}
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="min-h-[400px] w-[380px] bg-background text-foreground font-sans text-sm">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center border border-foreground bg-foreground font-mono text-[10px] font-medium text-background">
            R
          </div>
          <span className="font-mono text-sm font-semibold tracking-tight">Recallish</span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">v0.1.0</span>
      </header>

      {stats && (
        <div className="grid grid-cols-3 gap-2 p-4 border-b border-border">
          <StatCard label="Total" value={String(stats.total_count)} />
          <StatCard label="Avg" value={stats.avg_importance.toFixed(2)} />
          <StatCard label="Top" value={topCategory} />
        </div>
      )}

      <div className="mx-4 mt-3">
        <p className="mb-1 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
          Transfer conversation
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TRANSFER_PLATFORMS.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => onTransfer(p.id)}
              disabled={transferringTo !== null}
            >
              {transferringTo === p.id ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" /> Transferring...
                </>
              ) : (
                <>
                  <span className="mr-1">⇄</span> {p.label}
                </>
              )}
            </Button>
          ))}
        </div>
        {transferMessage && (
          <p
            className={`mt-1.5 text-[11px] ${
              transferMessage.startsWith("Transfer failed")
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {transferMessage}
          </p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground/70">
          Reads the current AI chat and drops it into the destination's input — no copy-paste.
        </p>
      </div>

      <div className="mx-4 mt-3">
        <p className="mb-2 text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
          Latest capture
        </p>
        <div className="space-y-2">
          {currentExtraction ? (
            <>
              {selectedExtractionId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-1"
                  onClick={() => setSelectedExtractionId(null)}
                >
                  ← Back to latest capture
                </Button>
              )}
              {renderExtractionCard(currentExtraction, true)}
            </>
          ) : (
            <div className="border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              No capture yet. Open a supported AI chat (ChatGPT, Claude, Gemini, DeepSeek, Qwen,
              Cursor) and start talking — Recallish captures automatically.
            </div>
          )}
        </div>
      </div>

      {previousExtractions.length > 0 && (
        <div className="mx-4 mt-3">
          <Collapsible open={!recentCollapsed} onOpenChange={(o) => setRecentCollapsed(!o)}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between border border-border px-3 py-2"
              >
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                  <History className="h-3.5 w-3.5" /> Recent extractions
                </span>
                {recentCollapsed ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-1">
                {previousExtractions.map((extraction) => (
                  <Button
                    key={extraction.id}
                    variant="outline"
                    size="sm"
                    className="w-full justify-between px-3"
                    onClick={() => {
                      setSelectedExtractionId(extraction.id);
                      setRecentCollapsed(true);
                    }}
                  >
                    <span className="truncate text-[11px]">
                      {extraction.source || "unknown"}
                    </span>
                    <span className="ml-2 shrink-0 text-[10px] text-muted-foreground font-mono">
                      {formatDate(extraction.created_at)}
                    </span>
                  </Button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mx-4 mt-3">
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between border border-border px-3 py-2"
              >
                <span className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                  Recent context
                </span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="max-h-[160px] pr-2">
                <div className="mt-2 space-y-2">
                  {recent.map((item) => (
                    <MemoryItem key={item.id} item={item} onDelete={onDelete} />
                  ))}
                </div>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "search" | "all")}
        className="mx-4 mt-3"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="mt-3 px-4">
          <form onSubmit={onSearch} className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by meaning..."
              className="flex-1"
            />
            <Button type="submit" disabled={busy || !query.trim()} size="sm">
              Search
            </Button>
          </form>
          {query && !busy && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => { setQuery(""); load(""); }}>
              Clear
            </Button>
          )}
        </TabsContent>

        <TabsContent value="all" className="mt-3 px-4">
          <Button variant="outline" size="sm" onClick={() => load("")} disabled={busy}>
            {busy ? "Loading..." : "Load All Memories"}
          </Button>
        </TabsContent>
      </Tabs>

      <Separator className="mx-4 my-3" />

      <form onSubmit={onAdd} className="mx-4 mb-3 space-y-2">
        <div className="space-y-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a memory..."
            className="min-h-[60px]"
          />
          <div className="flex gap-2">
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as typeof CATEGORIES[number])}
            >
              <SelectTrigger className="w-[100px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={busy || !draft.trim()} className="flex-1" size="sm">
              Save
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => currentExtraction && downloadMarkdown(currentExtraction)}
            disabled={!currentExtraction}
            className="gap-1"
            title="Download as Markdown"
          >
            <Download className="h-3.5 w-3.5" />
            Markdown
          </Button>
        </div>
      </form>

      <Separator className="mx-4 my-3" />

      <div className="mx-4 mb-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
          {busy ? "Loading..." : status}
        </p>
      </div>

      {error && (
        <div className="mx-4 mb-3 p-3 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded">
          {error}
        </div>
      )}

      <ScrollArea className="mx-4 h-[280px] pr-2">
        <div className="space-y-2">
          {items.map((item) => (
            <MemoryItem key={item.id} item={item} onDelete={onDelete} />
          ))}
          {!busy && !error && items.length === 0 && (
            <div className="border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No memories yet. Add one above or search to find existing memories.
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="mx-4 mt-3 p-3 text-[10px] text-muted-foreground border-t border-border">
        <p className="font-mono">Local-first · Privacy-first · Your machine only</p>
        <p className="mt-1">Backend: <code className="font-mono">http://127.0.0.1:8765</code></p>
      </div>
    </div>
  );
}