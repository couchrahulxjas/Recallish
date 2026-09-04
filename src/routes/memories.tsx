import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

const API =
  (import.meta.env["VITE_RECALLISH_API"] as string | undefined)?.replace(/\/$/, "") ??
  "http://127.0.0.1:8765";

type MemoryRecord = {
  id: string;
  content: string;
  metadata: {
    category?: string;
    importance_score?: number;
    source?: string;
    created_at?: string;
    updated_at?: string;
    superseded_by?: string;
  };
  similarity?: number;
};

type Stats = {
  total_count: number;
  avg_importance: number;
  top_categories: Record<string, number>;
};

type Chunk = { record: MemoryRecord; duplicates: MemoryRecord[] };

type Topic = {
  source: string;
  label: string;
  from: string;
  to: string;
  chunks: Chunk[];
  totalCount: number;
  summaryLines: string[];
  dupGroups: Chunk[];
};

type DupGroup = { representative: MemoryRecord; members: MemoryRecord[] };

type SummarySection = { key: string; label: string; value: string };

type StructuredSummary = {
  title?: string;
  content_type?: string;
  summary?: string;
  key_points?: string[];
  important_details?: string[];
  action_items?: string[];
  decisions?: string[];
  memory_candidates?: string[];
  sections?: SummarySection[];
};

type LowSignal = { record: MemoryRecord; reasons: string[] };

export const Route = createFileRoute("/memories")({
  head: () => ({
    meta: [{ title: "Memories — Recallish" }],
  }),
  component: MemoriesPage,
});

async function readApi<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T | { error?: string };
  if (!res.ok) {
    const message = json && typeof json === "object" && "error" in json ? json.error : null;
    throw new Error(
      message ||
        `Inspector API returned ${res.status}. Start it with python -m recallish.cli serve.`,
    );
  }
  return json as T;
}

const ROLE_WORDS = new Set(["user", "assistant"]);
const STOPWORDS = new Set([
  "the",
  "and",
  "that",
  "were",
  "you",
  "your",
  "this",
  "with",
  "from",
  "have",
  "they",
  "will",
  "what",
  "about",
  "would",
  "there",
  "their",
  "which",
  "when",
  "what's",
  "into",
  "just",
  "like",
  "some",
  "them",
  "than",
  "then",
  "these",
  "things",
  "through",
  "too",
  "very",
  "want",
  "well",
  "where",
  "while",
  "with",
  "a",
  "an",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "if",
  "in",
  "is",
  "it",
  "no",
  "not",
  "of",
  "on",
  "or",
  "so",
  "to",
  "up",
  "was",
  "get",
  "got",
  "can",
  "one",
  "youre",
  "ive",
  "im",
  "dont",
  "cant",
  "its",
  "that's",
  "there's",
  "theres",
]);

function tokenSet(text: string): Set<string> {
  const out = new Set<string>();
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f'\- ]/g, " ")
    .split(/\s+/);
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (/^\d+$/.test(token)) continue;
    if (STOPWORDS.has(token) || ROLE_WORDS.has(token)) continue;
    out.add(token);
  }
  return out;
}

function setSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const word of a) if (b.has(word)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function jaccardText(a: string, b: string): number {
  return setSim(tokenSet(a), tokenSet(b));
}

function sharedContentWords(text: string, corpus: Set<string>): number {
  let count = 0;
  for (const word of tokenSet(text)) if (corpus.has(word)) count += 1;
  return count;
}

function extendCorpus(corpus: Set<string>, text: string): Set<string> {
  for (const word of tokenSet(text)) corpus.add(word);
  return corpus;
}

function dateMs(iso: string | undefined): number {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? 0 : t;
}

function fmtDate(iso: string | undefined): string {
  const t = dateMs(iso);
  if (!t) return iso?.slice(0, 10) ?? "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return iso?.slice(0, 10) ?? "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSource(source: string): string {
  return source.replace(/^extension:/i, "").replace(/^chatgpt$/i, "ChatGPT");
}

function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const line = paragraph.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const turns = line.split(/\s+(?=(?:user|assistant)\s*[:.])/i);
    for (const turn of turns) {
      const parts = turn.split(/(?<=[.!?"…])\s+(?=["'([{A-Z\u00c0-\u024f0-9*#-])/);
      for (const part of parts) {
        const s = part.trim();
        if (s) out.push(s);
      }
    }
  }
  return out.filter((s) => s.length > 1);
}

function extractKeywords(records: MemoryRecord[], max = 4): string[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const words = record.content.toLowerCase().split(/[^a-z0-9'\u00c0-\u024f-]+/);
    for (const word of words) {
      if (word.length < 3 || /^\d+$/.test(word)) continue;
      if (STOPWORDS.has(word) || ROLE_WORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word);
  const picked: string[] = [];
  for (const word of ranked) {
    if (picked.length >= max) break;
    const stem = word.slice(0, 5);
    if (picked.some((p) => p.slice(0, 5) === stem)) continue;
    picked.push(word);
  }
  return picked;
}

function topicLabel(records: MemoryRecord[]): string {
  const userTurn = records.find((r) => /^user\s*[:.]/i.test(r.content.trim()));
  const first = records[0];
  const base = userTurn
    ? userTurn.content.replace(/^user\s*[:.]\s*/i, "").trim()
    : first
      ? first.content.trim()
      : "";
  const clean = base.replace(/\s+/g, " ").trim();
  if (clean.length > 12) {
    return clean.length > 72 ? `${clean.slice(0, 72)}…` : clean;
  }
  const keywords = extractKeywords(records);
  if (keywords.length > 0) {
    const kw = keywords.join(" ");
    return kw.length > 72 ? `${kw.slice(0, 72)}…` : kw;
  }
  return clean.slice(0, 72);
}

function summarizeTopic(chunks: Chunk[], limit = 3): string[] {
  interface Sentence {
    text: string;
    tokens: Set<string>;
    score: number;
  }
  const NOISE =
    /(\*:\/\/[^*\s]*|\.(?:svg|png|jpe?g|webp|gif)\b|Inspect views|\bWorker\b|ID [a-z0-9]{16,}|[A-Za-z]:\\|manifest\.json|Content Scripts|chrome-extension)/i;
  const sentences: (Sentence & { index: number })[] = [];
  let nextIndex = 0;
  let hasUserQuestion = false;

  for (const chunk of chunks) {
    const record = chunk.record;
    const role = /^user\s*[:.]/i.test(record.content)
      ? "user"
      : /^assistant\s*[:.]/i.test(record.content)
        ? "assistant"
        : null;
    const body = role
      ? record.content.replace(/^(?:user|assistant)\s*[:.]\s*/i, "").trim()
      : record.content;
    const importance = record.metadata.importance_score ?? 0;
    const roleBase = role === "assistant" ? 0.55 : role === "user" ? 0.2 : 0.3;

    for (const sentence of splitSentences(body)) {
      const tokens = tokenSet(sentence);
      if (tokens.size < 3) continue;
      if (tokens.size > 90) continue;
      const question = /[?]/.test(sentence);
      if (question && role === "user") hasUserQuestion = true;
      const filler =
        /^(okay|ok|got it|sure|thanks|thank you|great|perfect|no problem|understood|yep|yeah|right)\b/i.test(
          sentence,
        );
      const noise = NOISE.test(sentence);
      const length = sentence.length;
      const score =
        Math.min(tokens.size, 18) * 0.06 +
        (Math.min(length, 240) - 40) * 0.002 +
        roleBase +
        importance * 0.4 +
        (question ? (role === "user" ? 0.45 : 0.15) : 0) +
        (filler ? -1.2 : 0) +
        (noise ? -1.8 : 0);
      sentences.push({ text: sentence, tokens, score, index: nextIndex++ });
    }
  }

  if (sentences.length === 0) return [];

  const picked: (Sentence & { index: number })[] = [];
  for (let i = 0; i < limit; i++) {
    let best: (Sentence & { index: number }) | null = null;
    let bestGain = -Infinity;
    for (const candidate of sentences) {
      if (picked.includes(candidate)) continue;
      let gain = candidate.score;
      const redundancy = picked.reduce(
        (max, p) => Math.max(max, setSim(p.tokens, candidate.tokens)),
        0,
      );
      gain -= redundancy * 1.6;
      if (hasUserQuestion && !picked.some((p) => /\?/.test(p.text))) {
        if (/\?/.test(candidate.text)) gain += 0.9;
        else gain -= 0.35;
      }
      if (gain > bestGain) {
        bestGain = gain;
        best = candidate;
      }
    }
    if (!best || bestGain < 0.05) break;
    picked.push(best);
  }

  const order = new Map(sentences.map((s, i) => [s, i]));
  return [...picked]
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map((s) => s.text.trim());
}

const TOPIC_TIGHT_MS = 10_000;
const TOPIC_MAX_MS = 300_000;
const MIN_SHARED_WORDS = 2;

function makeTopic(records: MemoryRecord[]): Topic {
  const source = records[0]?.metadata.source ?? "unknown";
  const chunks: Chunk[] = [];
  for (const record of records) {
    const existing = chunks.find((c) => jaccardText(c.record.content, record.content) >= 0.9);
    if (existing) existing.duplicates.push(record);
    else chunks.push({ record, duplicates: [] });
  }
  const dates = records.map((r) => r.metadata.created_at ?? "");
  const from = dates.reduce((min, d) => (d && (!min || d < min) ? d : min), "");
  const to = dates.reduce((max, d) => (d && (!max || d > max) ? d : max), "");
  const sortedChunks = [...chunks].sort(
    (a, b) => dateMs(b.record.metadata.created_at) - dateMs(a.record.metadata.created_at),
  );
  return {
    source,
    label: topicLabel(records),
    from,
    to,
    chunks: sortedChunks,
    totalCount: records.length,
    summaryLines: chunks.length > 3 ? summarizeTopic(sortedChunks) : [],
    dupGroups: sortedChunks.filter((c) => c.duplicates.length > 0),
  };
}
function buildTopics(records: MemoryRecord[]): Topic[] {
  const bySource = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    const key = record.metadata.source ?? "unknown";
    const list = bySource.get(key) ?? [];
    list.push(record);
    bySource.set(key, list);
  }
  const topics: Topic[] = [];
  for (const sourceRecords of bySource.values()) {
    topics.push(...buildTopicsForSource(sourceRecords));
  }
  return topics.sort((a, b) => dateMs(b.from) - dateMs(a.from));
}

function buildTopicsForSource(records: MemoryRecord[]): Topic[] {
  const sorted = [...records].sort(
    (a, b) => dateMs(a.metadata.created_at) - dateMs(b.metadata.created_at),
  );

  const topics: Topic[] = [];
  let current: MemoryRecord[] = [];
  let corpus = new Set<string>();
  const flush = () => {
    if (current.length > 0) topics.push(makeTopic(current));
    current = [];
    corpus = new Set<string>();
  };

  for (const record of sorted) {
    if (current.length === 0) {
      current = [record];
      corpus = extendCorpus(corpus, record.content);
      continue;
    }
    const prev = current[current.length - 1];
    if (!prev) {
      current = [record];
      corpus = extendCorpus(corpus, record.content);
      continue;
    }
    const gap = dateMs(record.metadata.created_at) - dateMs(prev.metadata.created_at);
    const shared = sharedContentWords(record.content, corpus);
    const join = gap <= TOPIC_TIGHT_MS || (gap <= TOPIC_MAX_MS && shared >= MIN_SHARED_WORDS);
    if (join) {
      current.push(record);
      corpus = extendCorpus(corpus, record.content);
    } else {
      flush();
      current = [record];
      corpus = extendCorpus(corpus, record.content);
    }
  }
  flush();

  return topics;
}

function newestFirst(records: MemoryRecord[]): string[] {
  return [...records]
    .sort((a, b) => {
      const ab = dateMs(a.metadata.updated_at || a.metadata.created_at);
      const bb = dateMs(b.metadata.updated_at || b.metadata.created_at);
      return bb - ab;
    })
    .map((r) => r.id);
}

function findDuplicateGroups(records: MemoryRecord[]): DupGroup[] {
  const groups: DupGroup[] = [];
  for (const record of records) {
    const group = groups.find((g) => jaccardText(g.representative.content, record.content) >= 0.8);
    if (group) group.members.push(record);
    else groups.push({ representative: record, members: [record] });
  }
  return groups.filter((g) => g.members.length > 1);
}

function lowSignalReasons(record: MemoryRecord): string[] {
  const reasons: string[] = [];
  const content = record.content.trim();
  const source = record.metadata.source ?? "";
  if (record.metadata.superseded_by) reasons.push("superseded");
  if (source === "test" || source === "test_conversation") reasons.push("test data");
  if (/^selected text from /i.test(content)) reasons.push("selection template");
  if (content.split(/\s+/).filter(Boolean).length < 5) reasons.push("too short");
  if ((record.metadata.importance_score ?? 1) < 0.2) reasons.push("low importance");
  return reasons;
}

function MemoriesPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState("misc");
  const [status, setStatus] = useState("Connecting to local API…");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sourceFilter, setSourceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [importanceFilter, setImportanceFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showSuperseded, setShowSuperseded] = useState(false);

  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const [showCleanup, setShowCleanup] = useState(false);

  const load = useCallback(async (search = "") => {
    setBusy(true);
    setError(null);
    try {
      const [listJson, statsJson] = await Promise.all([
        readApi<MemoryRecord[]>(
          await fetch(
            search ? `${API}/api/search?q=${encodeURIComponent(search)}` : `${API}/api/memories`,
          ),
        ),
        readApi<Stats>(await fetch(`${API}/api/stats`)),
      ]);
      if (!Array.isArray(listJson)) {
        throw new Error("Inspector API returned an unexpected list payload.");
      }
      setItems(listJson);
      setStats(statsJson);
      setStatus(search ? `Search results for “${search}”` : "All memories");
    } catch (err) {
      setItems([]);
      setStats(null);
      const message = err instanceof Error ? err.message : "Failed to load memories";
      setError(
        /failed to fetch|networkerror|load failed/i.test(message)
          ? "Cannot reach 127.0.0.1:8765. In the backend folder run: python -m recallish.cli --config config/recallish.yaml serve"
          : message,
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(id: string) {
    if (!window.confirm("Delete this memory?")) return;
    try {
      await readApi<{ deleted?: boolean }>(
        await fetch(`${API}/api/memories/${id}`, { method: "DELETE" }),
      );
      await load(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function onDeleteMany(ids: string[]) {
    if (ids.length === 0) return;
    const what = ids.length === 1 ? "memory" : `${ids.length} memories`;
    if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;
    let firstError: string | null = null;
    for (const id of ids) {
      try {
        await readApi<{ deleted?: boolean }>(
          await fetch(`${API}/api/memories/${id}`, { method: "DELETE" }),
        );
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : "Delete failed";
      }
    }
    if (firstError) setError(firstError);
    await load(query);
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    try {
      await readApi<{ id?: string }>(
        await fetch(`${API}/api/memories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: draft.trim(),
            category,
            source: "inspector",
            explicit_signal: true,
          }),
        }),
      );
      setDraft("");
      await load(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  const categories = useMemo(() => stats?.top_categories ?? {}, [stats]);

  const sources = useMemo(
    () =>
      Array.from(new Set(items.map((i) => i.metadata.source ?? "unknown"))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [items],
  );

  const allCategories = useMemo(
    () =>
      Array.from(
        new Set([...Object.keys(categories), ...items.map((i) => i.metadata.category ?? "misc")]),
      ).sort((a, b) => a.localeCompare(b)),
    [items, categories],
  );

  const filtered = useMemo(
    () =>
      items.filter((record) => {
        if (!showSuperseded && record.metadata.superseded_by) return false;
        if (sourceFilter !== "all" && (record.metadata.source ?? "unknown") !== sourceFilter)
          return false;
        if (categoryFilter !== "all" && (record.metadata.category ?? "misc") !== categoryFilter)
          return false;
        const importance = record.metadata.importance_score ?? 0;
        if (importanceFilter === "0.5" && importance < 0.5) return false;
        if (importanceFilter === "0.7" && importance < 0.7) return false;
        if (importanceFilter === "low" && importance >= 0.5) return false;
        const date = record.metadata.created_at ?? "";
        if (fromDate && date.slice(0, 10) < fromDate) return false;
        if (toDate && date.slice(0, 10) > toDate) return false;
        return true;
      }),
    [items, showSuperseded, sourceFilter, categoryFilter, importanceFilter, fromDate, toDate],
  );

  const topics = useMemo(() => buildTopics(filtered), [filtered]);

  const groupedBySource = useMemo(() => {
    const map = new Map<string, Topic[]>();
    for (const topic of topics) {
      const list = map.get(topic.source) ?? [];
      list.push(topic);
      map.set(topic.source, list);
    }
    return map;
  }, [topics]);

  const duplicateGroups = useMemo(() => findDuplicateGroups(items), [items]);
  const duplicateCount = useMemo(
    () => duplicateGroups.reduce((total, g) => total + g.members.length, 0),
    [duplicateGroups],
  );
  const lowSignal = useMemo(
    () =>
      items
        .map((record) => ({ record, reasons: lowSignalReasons(record) }))
        .filter((item) => item.reasons.length > 0),
    [items],
  );

  const activeCount = useMemo(() => items.filter((r) => !r.metadata.superseded_by).length, [items]);

  const toggleTopic = (key: string) =>
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const filtersActive =
    sourceFilter !== "all" ||
    categoryFilter !== "all" ||
    importanceFilter !== "all" ||
    fromDate !== "" ||
    toDate !== "" ||
    showSuperseded;

  const clearFilters = () => {
    setSourceFilter("all");
    setCategoryFilter("all");
    setImportanceFilter("all");
    setFromDate("");
    setToDate("");
    setShowSuperseded(false);
  };

  const topicKey = (topic: Topic) => `${topic.source}|${topic.from}|${topic.label}`;

  const [llmSummary, setLlmSummary] = useState<Record<string, string[]>>({});
  const [llmStructured, setLlmStructured] = useState<Record<string, StructuredSummary>>({});
  const [summarizerWarning, setSummarizerWarning] = useState<string | null>(null);
  const llmAttemptedRef = useRef(new Set<string>());

  useEffect(() => {
    const pending = topics.filter(
      (topic) => topic.chunks.length > 0 && !llmAttemptedRef.current.has(topicKey(topic)),
    );
    if (pending.length === 0) return;
    const attempted = new Set(llmAttemptedRef.current);
    for (const topic of pending) attempted.add(topicKey(topic));
    llmAttemptedRef.current = attempted;
    let cancelled = false;
    void (async () => {
      const updates: Record<string, string[]> = {};
      const structUpdates: Record<string, StructuredSummary> = {};
      let firstError: string | null = null;
      for (const topic of pending) {
        try {
          const res = await readApi<{
            lines?: string[];
            structured?: StructuredSummary;
            error?: string;
          }>(
            await fetch(`${API}/api/summarize`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                label: topic.label,
                chunks: topic.chunks.map((c) => c.record.content).slice(0, 16),
                max_lines: 4,
              }),
            }),
          );
          if (cancelled) break;
          if (res.error && !firstError) firstError = res.error;
          if (Array.isArray(res.lines) && res.lines.length > 0) {
            updates[topicKey(topic)] = res.lines;
          }
          if (res.structured?.summary || res.structured?.key_points?.length) {
            structUpdates[topicKey(topic)] = res.structured;
          }
        } catch {
          // LLM summarization unavailable — keep the extractive fallback.
        }
      }
      if (!cancelled) {
        if (Object.keys(updates).length > 0) {
          setLlmSummary((prev) => ({ ...prev, ...updates }));
        }
        if (Object.keys(structUpdates).length > 0) {
          setLlmStructured((prev) => ({ ...prev, ...structUpdates }));
        }
        if (firstError) setSummarizerWarning(firstError);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topics]);

  const plural = (count: number, singular: string, pluralForm: string) =>
    count === 1 ? singular : pluralForm;

  function deleteKeepingNewest(group: DupGroup) {
    void onDeleteMany(newestFirst(group.members).slice(1));
  }

  function deleteTopicDupes(topic: Topic) {
    const ids: string[] = [];
    for (const chunk of topic.chunks) {
      const group = [chunk.record, ...chunk.duplicates];
      if (group.length > 1) ids.push(...newestFirst(group).slice(1));
    }
    void onDeleteMany(ids);
  }

  function deleteTopic(topic: Topic) {
    void onDeleteMany(
      [...topic.chunks.flatMap((c) => [c.record, ...c.duplicates])].map((r) => r.id),
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-rule bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6 md:px-10">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center border border-ink bg-ink font-mono text-[11px] font-medium text-background">
              R
            </span>
            <span className="font-mono text-sm font-semibold tracking-tight">Recallish</span>
          </Link>
          <nav className="flex gap-6">
            <Link to="/" className="font-mono text-xs text-muted-foreground hover:text-foreground">
              Home
            </Link>
            <Link
              to="/guide"
              className="font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              How to use
            </Link>
            <span className="font-mono text-xs text-foreground">Memories</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
        <p className="label-mono">Local inspector</p>
        <h1 className="mt-3 font-mono text-2xl font-bold tracking-tight md:text-4xl">
          You stay in control.
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Grouped by source, newest first, with AI summaries for long conversation topics. The API
          must be running locally on port 8765.
        </p>

        <div className="mt-8 grid gap-px border border-border bg-rule sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total loaded" value={items.length ? String(items.length) : "—"} />
          <Stat label="Active" value={items.length ? String(activeCount) : "—"} />
          <Stat label="Avg importance" value={stats ? stats.avg_importance.toFixed(2) : "—"} />
          <Stat label="Near-dup saves" value={items.length ? String(duplicateCount) : "—"} />
        </div>

        <form
          className="mt-8 flex flex-col gap-3 md:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void load(query);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by meaning"
            className="flex-1 border border-border bg-background px-4 py-3 font-mono text-sm"
          />
          <button
            type="submit"
            className="border border-ink bg-ink px-5 py-3 font-mono text-sm text-background"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              void load("");
            }}
            className="border border-border px-5 py-3 font-mono text-sm"
          >
            List all
          </button>
        </form>

        <form
          onSubmit={onAdd}
          className="mt-4 grid gap-3 border border-border p-4 md:grid-cols-[1fr_10rem_auto]"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a memory"
            className="border border-border bg-background px-4 py-3 font-mono text-sm"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border border-border bg-background px-3 py-3 font-mono text-sm"
          >
            {["preference", "project_fact", "decision", "profile", "misc"].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button type="submit" className="border border-ink px-5 py-3 font-mono text-sm">
            Save
          </button>
        </form>

        <div className="mt-4 grid gap-3 border border-border p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="flex flex-col gap-1">
            <span className="label-mono">Source</span>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="border border-border bg-background px-2 py-2 font-mono text-xs"
            >
              <option value="all">all</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {formatSource(source)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-mono">Category</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="border border-border bg-background px-2 py-2 font-mono text-xs"
            >
              <option value="all">all</option>
              {allCategories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-mono">Importance</span>
            <select
              value={importanceFilter}
              onChange={(e) => setImportanceFilter(e.target.value)}
              className="border border-border bg-background px-2 py-2 font-mono text-xs"
            >
              <option value="all">any</option>
              <option value="low">&#8804; 0.5</option>
              <option value="0.5">&#8805; 0.5</option>
              <option value="0.7">&#8805; 0.7</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-mono">From date</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="border border-border bg-background px-2 py-2 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-mono">To date</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="border border-border bg-background px-2 py-2 font-mono text-xs"
            />
          </label>
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={showSuperseded}
              onChange={(e) => setShowSuperseded(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="font-mono text-xs text-muted-foreground">Show superseded</span>
          </label>
          {filtersActive ? (
            <button
              type="button"
              onClick={clearFilters}
              className="col-span-full border border-border px-3 py-2 font-mono text-xs"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <p className="label-mono mt-6">{busy ? "Loading…" : status}</p>
        {!busy && !error ? (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {filtered.length} {plural(filtered.length, "memory", "memories")} · {topics.length}{" "}
            {plural(topics.length, "topic", "topics")} · {groupedBySource.size}{" "}
            {plural(groupedBySource.size, "source", "sources")}
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

        {summarizerWarning ? (
          <div className="mt-4 border border-dashed border-border p-4 text-sm text-muted-foreground">
            <p className="font-mono text-[11px] tracking-widest uppercase text-foreground">
              AI summarizer unavailable
            </p>
            <p className="mt-1">{summarizerWarning}</p>
            <p className="mt-2 text-xs">
              Start it from your terminal, e.g.{" "}
              Set <code className="font-mono">LLM_API_KEY</code> and <code className="font-mono">LLM_BASE_URL</code> (or the <code className="font-mono">OPENAI_*</code> aliases), then restart the backend.
              Topics will keep showing the extractive fallback summary until then. Local llama.cpp is also supported.
            </p>
          </div>
        ) : null}

        <div className="mt-4 grid gap-8">
          {Array.from(groupedBySource.entries()).map(([source, sourceTopics]) => (
            <section key={source} aria-label={`Source ${source}`}>
              <div className="flex items-baseline justify-between gap-3 border-b border-ink pb-2">
                <h2 className="font-mono text-sm font-semibold tracking-tight">
                  {formatSource(source)}
                </h2>
                <p className="label-mono">
                  {sourceTopics.reduce((n, t) => n + t.totalCount, 0)}{" "}
                  {plural(
                    sourceTopics.reduce((n, t) => n + t.totalCount, 0),
                    "memory",
                    "memories",
                  )}{" "}
                  · {sourceTopics.length} {plural(sourceTopics.length, "topic", "topics")}
                </p>
              </div>
              <div className="mt-4 grid gap-3">
                {sourceTopics.map((topic) => (
                  <TopicCard
                    key={topicKey(topic)}
                    topic={topic}
                    summaryLines={llmSummary[topicKey(topic)] ?? topic.summaryLines}
                    structured={llmStructured[topicKey(topic)]}
                    expanded={expandedTopics.has(topicKey(topic))}
                    onToggle={() => toggleTopic(topicKey(topic))}
                    onDelete={(id) => void onDelete(id)}
                    onDeleteTopic={() => deleteTopic(topic)}
                    onDeleteDups={() => deleteTopicDupes(topic)}
                  />
                ))}
              </div>
            </section>
          ))}
          {!busy && !error && items.length === 0 ? (
            <p className="border border-dashed border-border p-8 text-sm text-muted-foreground">
              No memories yet. Add one above or ingest a conversation from the CLI / MCP.
            </p>
          ) : null}
          {!busy && !error && items.length > 0 && filtered.length === 0 ? (
            <p className="border border-dashed border-border p-8 text-sm text-muted-foreground">
              Nothing matches the current filters.
            </p>
          ) : null}
        </div>

        <div className="mt-10">
          <CleanupPanel
            open={showCleanup}
            onToggle={() => setShowCleanup((v) => !v)}
            groups={duplicateGroups}
            lowSignal={lowSignal}
            onDelete={(id) => void onDelete(id)}
            onKeepNewest={(group) => deleteKeepingNewest(group)}
            onDeleteAllLow={() => void onDeleteMany(lowSignal.map((item) => item.record.id))}
          />
        </div>
      </main>
    </div>
  );
}

function TopicCard({
  topic,
  summaryLines,
  structured,
  expanded,
  onToggle,
  onDelete,
  onDeleteTopic,
  onDeleteDups,
}: {
  topic: Topic;
  summaryLines: string[];
  structured: StructuredSummary | undefined;
  expanded: boolean;
  onToggle: () => void;
  onDelete: (id: string) => void;
  onDeleteTopic: () => void;
  onDeleteDups: () => void;
}) {
  const isSingleton = topic.chunks.length === 1 && topic.totalCount === 1;
  const hasDups = topic.dupGroups.length > 0;
  const single = topic.chunks[0];

  if (isSingleton && single) {
    const singletonSummary = summaryLines.length > 0 || (structured?.sections?.length ?? 0) > 0;
    return (
      <article className="border border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-mono text-sm leading-snug font-medium">{topic.label}</h3>
            <p className="label-mono mt-1">1 topic chunk · {fmtDate(topic.to)}</p>
          </div>
          <button
            type="button"
            onClick={() => onDelete(single.record.id)}
            className="shrink-0 border border-border px-3 py-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase hover:text-foreground"
          >
            Delete
          </button>
        </div>
        {singletonSummary ? (
          <div className="mt-3 border-t border-border pt-3">
            {structured?.sections && structured.sections.length > 0 ? (
              <div className="grid gap-3">
                {structured.sections.map((section, i) => (
                  <div key={i}>
                    <p className="label-mono mb-1 text-[10px] tracking-widest uppercase">
                      {section.label}
                    </p>
                    {section.value.includes("\n") ? (
                      <div className="grid gap-1">
                        {section.value.split("\n").map((line, j) => (
                          <p key={j} className="text-sm leading-relaxed">
                            {line.startsWith("- ") ? line : `- ${line}`}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed">{section.value}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-2">
                {summaryLines.map((line, i) => (
                  <p key={i} className="text-sm leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <p className="mt-3 border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
          {single.record.content}
        </p>
        <MetaLine record={single.record} />
      </article>
    );
  }

  const showSummary = summaryLines.length > 0 || (structured?.sections?.length ?? 0) > 0;
  const showAll = showSummary ? expanded : true;

  return (
    <article className="border border-border">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-mono text-sm leading-snug font-medium">{topic.label}</h3>
          <p className="label-mono mt-1">
            {topic.chunks.length} {topic.chunks.length === 1 ? "topic chunk" : "topic chunks"}
            {topic.totalCount !== topic.chunks.length
              ? ` · ${topic.totalCount} raw saves`
              : ""} · {fmtDate(topic.to)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {hasDups ? (
            <button
              type="button"
              onClick={onDeleteDups}
              className="border border-border px-3 py-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase hover:text-foreground"
            >
              Drop duplicates
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDeleteTopic}
            className="border border-border px-3 py-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase hover:text-destructive"
          >
            Delete topic
          </button>
        </div>
      </header>

      <div className="px-5 py-4">
        {showSummary ? (
          structured?.sections && structured.sections.length > 0 ? (
            <div className="grid gap-3">
              {structured.sections.map((section, i) => (
                <div key={i}>
                  <p className="label-mono mb-1 text-[10px] tracking-widest uppercase">
                    {section.label}
                  </p>
                  {section.value.includes("\n") ? (
                    <div className="grid gap-1">
                      {section.value.split("\n").map((line, j) => (
                        <p key={j} className="text-sm leading-relaxed">
                          {line.startsWith("- ") ? line : `- ${line}`}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed">{section.value}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-2">
              {summaryLines.map((line, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  {line}
                </p>
              ))}
            </div>
          )
        ) : null}
        {topic.chunks.length > 1 ? (
          <div className={showAll || !showSummary ? "mt-0" : "mt-3"}>
            {topic.chunks.map((chunk) => (
              <ChunkRow
                key={chunk.record.id}
                chunk={chunk}
                shown={showAll || !showSummary}
                onDelete={() => onDelete(chunk.record.id)}
              />
            ))}
          </div>
        ) : single ? (
          <ChunkRow
            chunk={single}
            shown={!showSummary}
            onDelete={() => onDelete(single.record.id)}
          />
        ) : null}
      </div>

      {showSummary ? (
        <button
          type="button"
          onClick={onToggle}
          className="w-full border-t border-border px-5 py-3 text-left font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Hide raw chunks" : `Show all ${topic.chunks.length} raw chunks`}
        </button>
      ) : null}
    </article>
  );
}

function ChunkRow({
  chunk,
  shown,
  onDelete,
}: {
  chunk: Chunk;
  shown: boolean;
  onDelete: () => void;
}) {
  if (!shown) return null;
  const saved = 1 + chunk.duplicates.length;
  return (
    <div className="border-b border-rule py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm leading-relaxed text-foreground/90">{chunk.record.content}</p>
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 border border-border px-3 py-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase hover:text-foreground"
        >
          Delete
        </button>
      </div>
      <MetaLine record={chunk.record} savedCount={saved} />
      {chunk.duplicates.length > 0 ? (
        <p className="label-mono mt-1 text-accent">
          +{chunk.duplicates.length} identical save{chunk.duplicates.length === 1 ? "" : "s"} hidden
        </p>
      ) : null}
    </div>
  );
}

function MetaLine({ record, savedCount }: { record: MemoryRecord; savedCount?: number }) {
  return (
    <p className="label-mono mt-2">
      {record.metadata.category ?? "misc"} · {(record.metadata.importance_score ?? 0).toFixed(3)} ·{" "}
      {fmtDate(record.metadata.created_at)}
      {savedCount && savedCount > 1 ? ` · saved ×${savedCount}` : ""}
      {record.metadata.superseded_by ? " · superseded" : ""}
    </p>
  );
}

function CleanupPanel({
  open,
  onToggle,
  groups,
  lowSignal,
  onDelete,
  onKeepNewest,
  onDeleteAllLow,
}: {
  open: boolean;
  onToggle: () => void;
  groups: DupGroup[];
  lowSignal: LowSignal[];
  onDelete: (id: string) => void;
  onKeepNewest: (group: DupGroup) => void;
  onDeleteAllLow: () => void;
}) {
  const dupSaves = groups.reduce((n, g) => n + g.members.length, 0);
  return (
    <section className="border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="font-mono text-sm font-medium">Cleanup &amp; review</span>
        <span className="label-mono">
          {groups.length} duplicate group{groups.length === 1 ? "" : "s"} · {lowSignal.length}{" "}
          low-signal
        </span>
      </button>
      {open ? (
        <div className="grid gap-6 border-t border-border px-5 py-5 md:grid-cols-2">
          <div>
            <p className="label-mono">Near-identical duplicates</p>
            {groups.length === 0 ? (
              <p className="mt-3 border border-dashed border-border p-4 text-sm text-muted-foreground">
                No near-identical memories detected.
              </p>
            ) : (
              <div className="mt-3 grid gap-2">
                {groups.map((group) => (
                  <div
                    key={group.representative.id}
                    className="flex items-start justify-between gap-3 border border-border p-3"
                  >
                    <p className="min-w-0 text-sm leading-relaxed">
                      {group.representative.content}
                    </p>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="label-mono">{group.members.length} saves</span>
                      <button
                        type="button"
                        onClick={() => onKeepNewest(group)}
                        className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest uppercase hover:text-foreground"
                      >
                        Keep newest
                      </button>
                    </div>
                  </div>
                ))}
                <p className="label-mono mt-1">
                  Keeping the newest hides {dupSaves - groups.length} duplicate saves.
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="label-mono">Low-signal review</p>
              {lowSignal.length > 0 ? (
                <button
                  type="button"
                  onClick={onDeleteAllLow}
                  className="border border-border px-2 py-1 font-mono text-[10px] tracking-widest uppercase hover:text-destructive"
                >
                  Delete all ({lowSignal.length})
                </button>
              ) : null}
            </div>
            {lowSignal.length === 0 ? (
              <p className="mt-3 border border-dashed border-border p-4 text-sm text-muted-foreground">
                No low-signal memories found.
              </p>
            ) : (
              <div className="mt-3 grid gap-2">
                {lowSignal.map((item) => (
                  <div
                    key={item.record.id}
                    className="flex items-start justify-between gap-3 border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm leading-relaxed text-foreground/90">
                        {item.record.content}
                      </p>
                      <p className="label-mono mt-1">{item.reasons.join(" · ")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDelete(item.record.id)}
                      className="shrink-0 border border-border px-2 py-1 font-mono text-[10px] tracking-widest uppercase hover:text-destructive"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background p-5">
      <p className="label-mono">{label}</p>
      <p className="mt-2 font-mono text-xl">{value}</p>
    </div>
  );
}
