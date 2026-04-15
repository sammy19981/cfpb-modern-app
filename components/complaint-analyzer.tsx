"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Brain,
  Heart,
  GitBranch,
  FileText,
  Send,
  Mail,
  TrendingUp,
  Clock,
  Scale,
  Zap,
  Database,
  Radio,
  Power,
  Building2,
  MapPin,
} from "lucide-react";
import type { AgentKey } from "@/lib/prompts";

type AgentStatus = "idle" | "running" | "complete" | "error";

type ResolutionPackage = {
  complaint_id: string;
  classifier: Record<string, any>;
  compliance: Record<string, any>;
  rootCause: Record<string, any>;
  sentiment: Record<string, any>;
  router: Record<string, any>;
  resolution: Record<string, any>;
  requires_human_review: boolean;
};

type LiveSource = {
  id: string;
  product: string;
  sub_product?: string;
  company?: string;
  state?: string;
  date_received?: string;
};

type ProcessedItem = {
  id: string;
  source: LiveSource | null;
  pkg: ResolutionPackage;
  elapsed: number;
  ts: number;
};

const SAMPLES: { label: string; narrative: string }[] = [
  {
    label: "Credit Card Dispute",
    narrative:
      "I noticed a charge of $487.32 on my November statement from a merchant I have never done business with. I contacted my credit card company on November 3rd to dispute the charge. They said they would investigate but it has been over 45 days and I have not received any update. Meanwhile, they are charging me interest on the disputed amount and threatening to report me to credit bureaus. I have called 6 times. This is a violation of the Fair Credit Billing Act which requires resolution within 30 days.",
  },
  {
    label: "Mortgage Escrow Error",
    narrative:
      "My mortgage servicer incorrectly calculated my escrow account and is now demanding $3,200 to cover the shortage. When I called to dispute this, they admitted there was an error in their system but said I still have to pay. I am a single mother of two and this will cause severe financial hardship. I have been current on all my payments for 5 years. I need this fixed immediately before my next payment is due.",
  },
  {
    label: "Debt Collection Harassment",
    narrative:
      "A debt collector has been calling me 8-10 times per day for the past two weeks about a debt I don't even recognize. They call my work despite me telling them not to, and they've threatened to garnish my wages and have me arrested. I'm a 68 year old widow living on social security. I'm having panic attacks and can't sleep. I asked them to verify the debt in writing and they refused. This feels like a scam.",
  },
];

const AGENT_META: Record<
  AgentKey,
  { label: string; icon: typeof Brain; gradient: string; description: string }
> = {
  classifier: {
    label: "Classifier",
    icon: Brain,
    gradient: "from-blue-500 to-cyan-500",
    description: "Categorizing product & severity",
  },
  compliance: {
    label: "Compliance",
    icon: ShieldAlert,
    gradient: "from-red-500 to-orange-500",
    description: "Checking regulatory risks",
  },
  rootCause: {
    label: "Root Cause",
    icon: AlertTriangle,
    gradient: "from-purple-500 to-fuchsia-500",
    description: "Finding underlying failure",
  },
  sentiment: {
    label: "Sentiment",
    icon: Heart,
    gradient: "from-pink-500 to-rose-500",
    description: "Reading emotional state",
  },
  router: {
    label: "Router",
    icon: GitBranch,
    gradient: "from-amber-500 to-orange-500",
    description: "Routing to right team",
  },
  resolution: {
    label: "Resolution",
    icon: FileText,
    gradient: "from-emerald-500 to-teal-500",
    description: "Drafting response letter",
  },
};

const AGENT_ORDER: AgentKey[] = [
  "classifier",
  "compliance",
  "rootCause",
  "sentiment",
  "router",
  "resolution",
];

const IDLE_STATUSES: Record<AgentKey, AgentStatus> = {
  classifier: "idle",
  compliance: "idle",
  rootCause: "idle",
  sentiment: "idle",
  router: "idle",
  resolution: "idle",
};

export default function ComplaintAnalyzer() {
  const [narrative, setNarrative] = useState("");
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<Record<AgentKey, AgentStatus>>(IDLE_STATUSES);
  const [results, setResults] = useState<Record<string, any>>({});
  const [finalPackage, setFinalPackage] = useState<ResolutionPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);

  // Live / auto-pilot state
  const [liveSource, setLiveSource] = useState<LiveSource | null>(null);
  const [fetchingLive, setFetchingLive] = useState(false);
  const [autoPilot, setAutoPilot] = useState(false);
  const [processed, setProcessed] = useState<ProcessedItem[]>([]);

  const autoPilotRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    autoPilotRef.current = autoPilot;
  }, [autoPilot]);

  const resetRunState = () => {
    setStatuses(IDLE_STATUSES);
    setResults({});
    setFinalPackage(null);
    setError(null);
    setElapsed(0);
  };

  const fetchLiveComplaint = useCallback(async (): Promise<{
    narrative: string;
    source: LiveSource;
  } | null> => {
    setFetchingLive(true);
    setError(null);
    try {
      const exclude = Array.from(seenIdsRef.current).slice(-50).join(",");
      const res = await fetch(`/api/cfpb${exclude ? `?exclude=${exclude}` : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Fetch failed" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      seenIdsRef.current.add(data.id);
      const source: LiveSource = {
        id: data.id,
        product: data.product,
        sub_product: data.sub_product,
        company: data.company,
        state: data.state,
        date_received: data.date_received,
      };
      return { narrative: data.narrative, source };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch live complaint");
      return null;
    } finally {
      setFetchingLive(false);
    }
  }, []);

  const runPipeline = useCallback(
    async (
      narrativeText: string,
      source: LiveSource | null
    ): Promise<{ pkg: ResolutionPackage; elapsed: number } | null> => {
      if (!narrativeText.trim()) return null;
      resetRunState();
      setLiveSource(source);
      setNarrative(narrativeText);
      setRunning(true);

      const startTs = Date.now();
      const timer = setInterval(() => {
        setElapsed((Date.now() - startTs) / 1000);
      }, 100);

      let finalPkg: ResolutionPackage | null = null;
      let totalElapsed = 0;

      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            narrative: narrativeText,
            complaintId: source ? `CFPB-${source.id}` : undefined,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: "Request failed" }));
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === "start") {
                setStatuses((s) => ({ ...s, [event.agent]: "running" }));
              } else if (event.type === "complete") {
                setStatuses((s) => ({ ...s, [event.agent]: "complete" }));
                setResults((r) => ({ ...r, [event.agent]: event.result }));
              } else if (event.type === "done") {
                finalPkg = event.package as ResolutionPackage;
                setFinalPackage(finalPkg);
              } else if (event.type === "error") {
                setError(event.message);
                if (event.agent) {
                  setStatuses((s) => ({ ...s, [event.agent]: "error" }));
                }
              }
            } catch (e) {
              console.error("Failed to parse event", line, e);
            }
          }
        }

        totalElapsed = (Date.now() - startTs) / 1000;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        return null;
      } finally {
        clearInterval(timer);
        setRunning(false);
      }

      if (finalPkg) {
        const item: ProcessedItem = {
          id: finalPkg.complaint_id,
          source,
          pkg: finalPkg,
          elapsed: totalElapsed,
          ts: Date.now(),
        };
        setProcessed((p) => [item, ...p].slice(0, 20));
        return { pkg: finalPkg, elapsed: totalElapsed };
      }
      return null;
    },
    []
  );

  // Auto-pilot loop: after each completed run, if still enabled, fetch the
  // next live complaint and process it.
  useEffect(() => {
    if (!autoPilot) return;
    if (running || fetchingLive) return;

    let cancelled = false;
    (async () => {
      // Tiny breath between runs so the UI can settle.
      await new Promise((r) => setTimeout(r, 600));
      if (cancelled || !autoPilotRef.current) return;

      const live = await fetchLiveComplaint();
      if (cancelled || !autoPilotRef.current || !live) return;

      await runPipeline(live.narrative, live.source);
    })();

    return () => {
      cancelled = true;
    };
    // We intentionally re-run when finalPackage changes (a run finished) or autoPilot toggles.
  }, [autoPilot, finalPackage, fetchLiveComplaint, runPipeline, running, fetchingLive]);

  const onManualAnalyze = () => {
    if (!narrative.trim() || running) return;
    setAutoPilot(false);
    runPipeline(narrative, liveSource);
  };

  const onFetchLiveOnce = async () => {
    if (running || fetchingLive) return;
    setAutoPilot(false);
    const live = await fetchLiveComplaint();
    if (live) {
      await runPipeline(live.narrative, live.source);
    }
  };

  const onToggleAutoPilot = () => {
    setAutoPilot((v) => !v);
  };

  const onLoadSample = (sampleNarrative: string) => {
    if (running) return;
    setAutoPilot(false);
    setLiveSource(null);
    setNarrative(sampleNarrative);
  };

  const anyActivity = running || Object.keys(results).length > 0;
  const busy = running || fetchingLive;

  return (
    <div className="space-y-8">
      {/* Mode Bar */}
      <ModeBar
        autoPilot={autoPilot}
        running={running}
        fetchingLive={fetchingLive}
        processedCount={processed.length}
        onToggleAutoPilot={onToggleAutoPilot}
        onFetchLiveOnce={onFetchLiveOnce}
      />

      {/* Input Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 p-6 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:p-8"
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="text-sm font-medium text-zinc-400">
            {liveSource
              ? "Live complaint loaded from CFPB"
              : "Load a sample, paste your own, or pull a live complaint"}
          </div>
          {running && (
            <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
              <Clock className="h-3.5 w-3.5" />
              {elapsed.toFixed(1)}s
            </div>
          )}
        </div>

        {/* Live source chip */}
        <AnimatePresence>
          {liveSource && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-blue-500/30 bg-gradient-to-r from-blue-950/40 to-indigo-950/30 px-4 py-2.5 text-xs"
            >
              <div className="flex items-center gap-1.5 font-semibold text-blue-300">
                <Database className="h-3.5 w-3.5" />
                CFPB #{liveSource.id}
              </div>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-300">{liveSource.product}</span>
              {liveSource.company && (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="flex items-center gap-1 text-zinc-400">
                    <Building2 className="h-3 w-3" />
                    {liveSource.company}
                  </span>
                </>
              )}
              {liveSource.state && (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="flex items-center gap-1 text-zinc-400">
                    <MapPin className="h-3 w-3" />
                    {liveSource.state}
                  </span>
                </>
              )}
              {liveSource.date_received && (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-500">
                    {new Date(liveSource.date_received).toLocaleDateString()}
                  </span>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mb-4 flex flex-wrap gap-2">
          {SAMPLES.map((s, i) => (
            <button
              key={i}
              onClick={() => onLoadSample(s.narrative)}
              disabled={busy}
              className="rounded-full border border-zinc-700/80 bg-zinc-800/40 px-4 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-blue-500/60 hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {s.label}
            </button>
          ))}
        </div>

        <textarea
          value={narrative}
          onChange={(e) => {
            setNarrative(e.target.value);
            if (liveSource) setLiveSource(null);
          }}
          placeholder="Paste a consumer financial complaint narrative, or click 'Fetch Live Complaint' to pull one from the CFPB database..."
          rows={6}
          disabled={busy}
          className="w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 transition focus:border-blue-500/60 focus:outline-none focus:ring-4 focus:ring-blue-500/10 disabled:opacity-50"
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-zinc-500">{narrative.length} characters</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onFetchLiveOnce}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-700/80 bg-zinc-900/60 px-5 py-3 text-sm font-semibold text-zinc-200 backdrop-blur-xl transition hover:border-blue-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {fetchingLive ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Database className="h-4 w-4 text-blue-400" />
              )}
              <span>{fetchingLive ? "Fetching..." : "Fetch Live Complaint"}</span>
            </button>
            <button
              onClick={onManualAnalyze}
              disabled={busy || narrative.trim().length < 20}
              className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:shadow-xl hover:shadow-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 transition-opacity group-hover:opacity-100" />
              {running ? (
                <Loader2 className="relative h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="relative h-4 w-4" />
              )}
              <span className="relative">{running ? "Analyzing..." : "Run Pipeline"}</span>
            </button>
          </div>
        </div>
      </motion.div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-3 rounded-2xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-300 backdrop-blur-xl"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>{error}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agent Grid */}
      {anyActivity && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {AGENT_ORDER.map((key) => (
            <AgentCard
              key={key}
              agentKey={key}
              status={statuses[key]}
              result={results[key]}
            />
          ))}
        </motion.div>
      )}

      {/* Final Resolution Report */}
      <AnimatePresence>
        {finalPackage && <FinalReport pkg={finalPackage} elapsed={elapsed} />}
      </AnimatePresence>

      {/* Processed feed (auto-pilot history) */}
      {processed.length > 0 && (
        <ProcessedFeed items={processed} />
      )}
    </div>
  );
}

function ModeBar({
  autoPilot,
  running,
  fetchingLive,
  processedCount,
  onToggleAutoPilot,
  onFetchLiveOnce,
}: {
  autoPilot: boolean;
  running: boolean;
  fetchingLive: boolean;
  processedCount: number;
  onToggleAutoPilot: () => void;
  onFetchLiveOnce: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 px-5 py-3 backdrop-blur-2xl"
    >
      <div className="flex items-center gap-3">
        <div
          className={`relative flex h-8 w-8 items-center justify-center rounded-xl ${
            autoPilot
              ? "bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/30"
              : "bg-zinc-800"
          }`}
        >
          <Radio
            className={`h-4 w-4 ${autoPilot ? "text-white" : "text-zinc-500"}`}
            strokeWidth={2.4}
          />
          {autoPilot && (
            <span className="absolute inset-0 animate-ping rounded-xl bg-emerald-500/40" />
          )}
        </div>
        <div className="flex flex-col">
          <div className="text-sm font-semibold text-white">
            {autoPilot ? "Auto-Pilot Engaged" : "Manual Mode"}
          </div>
          <div className="text-[11px] text-zinc-500">
            {autoPilot
              ? running
                ? "Processing live complaint..."
                : fetchingLive
                ? "Fetching next from CFPB..."
                : "Continuously pulling from CFPB Consumer Complaint Database"
              : `Pull live complaints or paste your own · ${processedCount} processed this session`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {processedCount > 0 && (
          <div className="hidden items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 sm:flex">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            {processedCount} resolved
          </div>
        )}
        <button
          onClick={onToggleAutoPilot}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition ${
            autoPilot
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-500/40 hover:text-white"
          }`}
        >
          <Power className="h-3.5 w-3.5" />
          {autoPilot ? "Stop Auto-Pilot" : "Start Auto-Pilot"}
        </button>
      </div>
    </motion.div>
  );
}

function ProcessedFeed({ items }: { items: ProcessedItem[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 p-6 backdrop-blur-2xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Processed This Session</h3>
          <p className="text-[11px] text-zinc-500">
            Each entry is a real complaint pulled from CFPB and resolved by the 6-agent pipeline.
          </p>
        </div>
        <span className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id + item.ts}
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-800/60 bg-zinc-950/40 px-4 py-3 text-xs"
          >
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-blue-400">
              <Database className="h-3 w-3" />
              {item.source ? `#${item.source.id}` : item.id}
            </div>
            <span className="text-zinc-600">·</span>
            <span className="line-clamp-1 max-w-[280px] text-zinc-300">
              {item.source?.product || item.pkg.classifier?.product || "Complaint"}
            </span>
            {item.source?.company && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="line-clamp-1 max-w-[180px] text-zinc-500">
                  {item.source.company}
                </span>
              </>
            )}
            <span className="text-zinc-600">·</span>
            <RiskBadge level={String(item.pkg.compliance?.risk_level || "LOW")} />
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">{item.elapsed.toFixed(1)}s</span>
            {item.pkg.requires_human_review && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="flex items-center gap-1 font-semibold text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Review
                </span>
              </>
            )}
            <div className="ml-auto text-[10px] text-zinc-600">
              {new Date(item.ts).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function AgentCard({
  agentKey,
  status,
  result,
}: {
  agentKey: AgentKey;
  status: AgentStatus;
  result: any;
}) {
  const meta = AGENT_META[agentKey];
  const Icon = meta.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className={`group relative overflow-hidden rounded-3xl border bg-zinc-900/40 p-5 backdrop-blur-2xl transition-all ${
        status === "complete"
          ? "border-zinc-700/60"
          : status === "running"
          ? "border-blue-500/40"
          : status === "error"
          ? "border-red-500/40"
          : "border-zinc-800/60"
      }`}
    >
      {/* Background gradient accent */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${meta.gradient} opacity-[0.05] transition-opacity group-hover:opacity-[0.08]`}
      />

      {/* Running state shimmer */}
      {status === "running" && (
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
      )}

      <div className="relative">
        <div className="mb-4 flex items-start justify-between">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.gradient} shadow-lg`}
          >
            <Icon className="h-5 w-5 text-white" strokeWidth={2.2} />
          </div>
          <StatusIndicator status={status} />
        </div>

        <h3 className="mb-1 text-base font-semibold text-white">{meta.label}</h3>
        <p className="mb-4 text-xs text-zinc-500">{meta.description}</p>

        <div className="min-h-[48px]">
          {status === "idle" && (
            <div className="text-xs italic text-zinc-600">Waiting...</div>
          )}
          {status === "running" && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800/80">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-blue-500 to-purple-500" />
              </div>
              <div className="h-2 w-3/4 overflow-hidden rounded-full bg-zinc-800/80">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-blue-500 to-purple-500" />
              </div>
            </div>
          )}
          {status === "complete" && result && (
            <AgentResultSummary agentKey={agentKey} result={result} />
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatusIndicator({ status }: { status: AgentStatus }) {
  if (status === "running") {
    return <Loader2 className="h-5 w-5 animate-spin text-blue-400" />;
  }
  if (status === "complete") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
  }
  if (status === "error") {
    return <AlertTriangle className="h-5 w-5 text-red-400" />;
  }
  return <div className="h-2 w-2 rounded-full bg-zinc-700" />;
}

function AgentResultSummary({
  agentKey,
  result,
}: {
  agentKey: AgentKey;
  result: any;
}) {
  if (agentKey === "classifier") {
    return (
      <div className="space-y-2.5">
        <div className="line-clamp-1 text-xs font-medium text-zinc-200">
          {result.product}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Severity
          </span>
          <SeverityBar value={Number(result.severity) || 0} />
        </div>
      </div>
    );
  }

  if (agentKey === "compliance") {
    return (
      <div className="space-y-2.5">
        <RiskBadge level={result.risk_level} />
        <div className="line-clamp-2 text-xs text-zinc-400">
          {result.relevant_regulations?.[0]?.regulation || "No specific regulation flagged"}
        </div>
      </div>
    );
  }

  if (agentKey === "rootCause") {
    return (
      <div className="space-y-2">
        <div className="inline-flex rounded-md bg-purple-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
          {String(result.primary_root_cause || "").replace(/_/g, " ")}
        </div>
        {result.systemic_indicator && (
          <div className="flex items-center gap-1 text-[10px] text-amber-400">
            <TrendingUp className="h-3 w-3" />
            Systemic pattern detected
          </div>
        )}
      </div>
    );
  }

  if (agentKey === "sentiment") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-md bg-pink-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-pink-300">
            {result.overall_sentiment}
          </span>
          <span className="rounded-md bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-300">
            {result.urgency_level}
          </span>
        </div>
        {result.is_vulnerable_consumer && (
          <div className="flex items-center gap-1 text-[10px] text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            Vulnerable consumer
          </div>
        )}
      </div>
    );
  }

  if (agentKey === "router") {
    return (
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-200">
          {String(result.assigned_team || "").replace(/_/g, " ")}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
          <PriorityBadge priority={result.priority} />
          <span>·</span>
          <span>{result.sla_hours}h SLA</span>
        </div>
      </div>
    );
  }

  if (agentKey === "resolution") {
    return (
      <div className="space-y-2">
        <div className="line-clamp-3 text-xs text-zinc-400">
          {result.resolution_summary}
        </div>
        {result.financial_remediation?.refund_recommended && (
          <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
            <Zap className="h-3 w-3" />
            Refund: {result.financial_remediation.estimated_amount}
          </div>
        )}
      </div>
    );
  }

  return null;
}

function SeverityBar({ value }: { value: number }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`h-1.5 w-4 rounded-full transition-colors ${
            i <= value
              ? value >= 4
                ? "bg-gradient-to-r from-red-500 to-rose-500"
                : value === 3
                ? "bg-gradient-to-r from-orange-500 to-amber-500"
                : "bg-gradient-to-r from-yellow-500 to-lime-500"
              : "bg-zinc-800"
          }`}
        />
      ))}
      <span className="ml-1 text-[10px] font-semibold text-zinc-400">
        {value}/5
      </span>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    LOW: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    MEDIUM: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
    HIGH: "bg-orange-500/10 text-orange-300 border-orange-500/30",
    CRITICAL: "bg-red-500/10 text-red-300 border-red-500/30",
  };
  const cls = colors[String(level || "").toUpperCase()] || colors.LOW;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      <Scale className="h-2.5 w-2.5" />
      {level}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    P1: "text-red-400",
    P2: "text-orange-400",
    P3: "text-yellow-400",
    P4: "text-zinc-400",
  };
  return (
    <span className={`font-semibold ${colors[priority] || "text-zinc-400"}`}>
      {priority}
    </span>
  );
}

function FinalReport({
  pkg,
  elapsed,
}: {
  pkg: ResolutionPackage;
  elapsed: number;
}) {
  const res = pkg.resolution;

  // Email send state (kept local to the final report so each pipeline run gets its own).
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<
    | { kind: "idle" }
    | { kind: "success"; to: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim());
  const canSend =
    !pkg.requires_human_review && isValidEmail && !sending;

  const sendEmail = async () => {
    if (!canSend) return;
    setSending(true);
    setSendStatus({ kind: "idle" });
    try {
      const r = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipient.trim(),
          complaint_id: pkg.complaint_id,
          resolution: pkg.resolution,
          router: pkg.router,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setSendStatus({
          kind: "error",
          message: data.error || `Request failed (${r.status})`,
        });
      } else {
        setSendStatus({ kind: "success", to: recipient.trim() });
      }
    } catch (err) {
      setSendStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 26 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="rounded-3xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900/60 via-zinc-900/40 to-zinc-900/60 p-6 backdrop-blur-2xl sm:p-8">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/30">
              <CheckCircle2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Resolution Ready</h2>
              <p className="text-xs text-zinc-500">
                Pipeline complete · {elapsed.toFixed(1)}s · {pkg.complaint_id}
              </p>
            </div>
          </div>
          {pkg.requires_human_review && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Human Review Required
            </motion.div>
          )}
        </div>

        {/* Summary */}
        <div className="mb-4 rounded-2xl border border-zinc-800/60 bg-zinc-950/40 p-5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Resolution Summary
          </div>
          <p className="text-sm leading-relaxed text-zinc-200">
            {res.resolution_summary}
          </p>
        </div>

        {/* Customer Response Letter */}
        <div className="mb-4 rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-950/40 to-indigo-950/30 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/20">
              <Mail className="h-4 w-4 text-blue-400" />
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-300">
              Customer Response Letter
            </div>
          </div>
          <div className="mb-3 border-b border-blue-500/20 pb-3 text-sm font-semibold text-white">
            {res.customer_response?.subject_line}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
            {res.customer_response?.body}
          </p>
        </div>

        {/* Remediation Steps */}
        {res.remediation_steps?.length > 0 && (
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/40 p-5">
            <div className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Remediation Steps
            </div>
            <div className="space-y-3">
              {res.remediation_steps.map((step: any, i: number) => (
                <div
                  key={i}
                  className="flex gap-3 rounded-xl border border-zinc-800/40 bg-zinc-900/40 p-3"
                >
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-xs font-bold text-blue-300">
                    {step.step}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-100">{step.action}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                      <span className="rounded bg-zinc-800/60 px-1.5 py-0.5">
                        {String(step.responsible_team || "").replace(/_/g, " ")}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {step.deadline_days}d
                      </span>
                    </div>
                    {step.details && (
                      <div className="mt-1.5 text-xs text-zinc-400">{step.details}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Financial remediation */}
        {res.financial_remediation?.refund_recommended && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20">
              <Zap className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Financial Remediation
              </div>
              <div className="text-sm text-zinc-200">
                {res.financial_remediation.compensation_type} ·{" "}
                {res.financial_remediation.estimated_amount}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Email send panel */}
      <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 p-5 backdrop-blur-2xl sm:p-6">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/20">
            <Mail className="h-4 w-4 text-blue-400" />
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-300">
            Deliver Resolution
          </div>
        </div>

        {pkg.requires_human_review ? (
          <div className="flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>
              Human review required. Sending is blocked until a compliance officer approves this response.
            </span>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="customer@example.com"
                  value={recipient}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    if (sendStatus.kind !== "idle") setSendStatus({ kind: "idle" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSend) sendEmail();
                  }}
                  disabled={sending}
                  className="w-full rounded-2xl border border-zinc-800/80 bg-zinc-950/60 py-3 pl-10 pr-3 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={sendEmail}
                disabled={!canSend}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:from-blue-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send
                  </>
                )}
              </button>
            </div>

            {sendStatus.kind === "success" && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300"
              >
                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  Resolution email sent to <strong>{sendStatus.to}</strong>
                </span>
              </motion.div>
            )}
            {sendStatus.kind === "error" && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-300"
              >
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{sendStatus.message}</span>
              </motion.div>
            )}

            <div className="mt-3 text-[10px] text-zinc-600">
              The branded HTML resolution letter is rendered server-side and delivered via Resend. Subject line and body are generated by the Resolution agent.
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
