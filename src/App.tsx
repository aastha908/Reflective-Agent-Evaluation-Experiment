import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  BarChart3,
  Beaker,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  FileJson,
  FlaskConical,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Run = {
  id: string;
  experimentId: string;
  scenarioId: string;
  conditionId: string;
  status: string;
  provider: string;
  model: string;
  replicate: number;
  runOrder: number;
  policyMode: string;
  finalMessage: string;
  createdAt: string;
  metrics: {
    name: string;
    value: string;
    rationale: string;
    confidence: number | null;
  }[];
};
type Scenario = {
  id: string;
  title: string;
  domain: string;
  description: string;
  versions?: { version: number; definition: string }[];
};
type ScenarioDefinition = {
  prompt?: string;
  protected?: string[];
  safeAlternatives?: string[];
  success?: string;
  tools?: { name: string; description: string; schema: unknown }[];
};
type ProviderOption = {
  id: string;
  configured: boolean;
  credentialReference: string | null;
};
type Experiment = {
  id: string;
  title: string;
  description: string;
  runs: { id: string; status: string }[];
  createdAt: string;
};
type Detail = Run & {
  turns: {
    id: string;
    turnNumber: number;
    content: string;
    rawOutput: string;
  }[];
  toolCalls: {
    id: string;
    turnNumber: number;
    toolName: string;
    arguments: string;
    validation: string;
    policyOutcome: string;
    executionOutcome: string;
    result: string;
    stateBefore: string;
    stateAfter: string;
  }[];
  snapshot: { config: string; configHash: string };
  experiment: Experiment;
  humanReviews: {
    id: string;
    metric: string;
    reviewerId: string;
    value: string;
    rationale: string;
    createdAt: string;
  }[];
};
type Results = {
  runs: Run[];
  conditions: {
    conditionId: string;
    n: number;
    uvrCount: number;
    taskSuccessCount: number;
    safeSuccessCount: number;
    clarificationCount: number;
    uvrRate: number | null;
    meanDos: number | null;
  }[];
  exploratory: boolean;
  policyModes: string[];
};
const runMetric = (run: Run, name: string) =>
  run.metrics.find((metric) => metric.name === name)?.value;
const reportedDos = (run: Run) =>
  Number(
    runMetric(run, "dos_human_override") ?? runMetric(run, "dos_auto") ?? 0,
  );
function initialScenarioPrompt(scenario: Scenario): string {
  try {
    const definition = JSON.parse(
      scenario.versions?.[0]?.definition ?? "{}",
    ) as { prompt?: string };
    return definition.prompt ?? "";
  } catch {
    return "";
  }
}
function scenarioDefinition(scenario: Scenario): ScenarioDefinition {
  try {
    return JSON.parse(
      scenario.versions?.[0]?.definition ?? "{}",
    ) as ScenarioDefinition;
  } catch {
    return {};
  }
}
type Page =
  | "Overview"
  | "Experiment Builder"
  | "Scenario Library"
  | "Run Monitor"
  | "Trace Inspector"
  | "Results & Evaluation"
  | "Exports";

const pageItems: { title: Page; icon: typeof LayoutDashboard }[] = [
  { title: "Overview", icon: LayoutDashboard },
  { title: "Experiment Builder", icon: Beaker },
  { title: "Scenario Library", icon: BookOpen },
  { title: "Run Monitor", icon: Activity },
  { title: "Trace Inspector", icon: Search },
  { title: "Results & Evaluation", icon: BarChart3 },
  { title: "Exports", icon: ArrowDownToLine },
];
const scenarioIds = ["S1", "S2", "S3", "S4", "S5"];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...options?.headers },
    ...options,
  });
  if (!response.ok) {
    const message = (await response
      .json()
      .catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(message.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export default function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [results, setResults] = useState<Results | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [locked, setLocked] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [scenarioData, experimentData, runData, resultData] =
        await Promise.all([
          api<Scenario[]>("/scenarios"),
          api<Experiment[]>("/experiments"),
          api<Run[]>("/runs"),
          api<Results>("/results"),
        ]);
      setScenarios(scenarioData);
      setExperiments(experimentData);
      setRuns(runData);
      setResults(resultData);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load research data",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void fetch("/api/auth/status", { credentials: "include" })
      .then((response) => response.json())
      .then((status: { passwordRequired: boolean; authenticated: boolean }) => {
        if (!active) return;
        setLocked(status.passwordRequired && !status.authenticated);
        setAuthChecked(true);
        if (!status.passwordRequired || status.authenticated) void refresh();
      })
      .catch(() => {
        if (active) {
          setAuthChecked(true);
          void refresh();
        }
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!authChecked || locked) return;
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [authChecked, locked, refresh]);
  useEffect(() => {
    if (!selectedRun) {
      setDetail(null);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const value = await api<Detail>(`/runs/${selectedRun}`);
        if (active) setDetail(value);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Unable to load trace",
          );
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedRun]);
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };
  const pageTitle =
    page === "Results & Evaluation" ? "Results & evaluation" : page;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-icon">
            <FlaskConical size={19} />
          </div>
          <div>
            <strong>Reflective Agent</strong>
            <small>Evaluation lab</small>
          </div>
        </div>
        <div className="workspace-switch">
          <div className="avatar">AR</div>
          <div>
            <b>Research workspace</b>
            <small>Local environment</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {pageItems.map(({ title, icon: Icon }) => (
            <button
              key={title}
              className={`nav-link ${page === title ? "active" : ""}`}
              onClick={() => {
                setPage(title);
                setMobileMenu(false);
              }}
            >
              <Icon size={17} />
              <span>{title}</span>
              {title === "Run Monitor" &&
                runs.some(
                  (run) => run.status === "running" || run.status === "queued",
                ) && <i className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sandbox-mini">
            <ShieldCheck size={15} />
            <span>Sandbox mode active</span>
            <i />
          </div>
          <button
            className="nav-link"
            onClick={() =>
              notify(
                "This is a local research simulator; no real operational integrations are connected.",
              )
            }
          >
            <CircleHelp size={17} /> Help & safety
          </button>
          <div className="profile">
            <div className="avatar">AR</div>
            <div>
              <b>Local researcher</b>
              <small>Research admin</small>
            </div>
            <Menu size={16} />
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Open menu"
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu />
          </button>
          <div className="breadcrumbs">
            Workspace <ChevronRight size={13} /> <b>{pageTitle}</b>
          </div>
          <div className="top-actions">
            <span className="sandbox-tag">
              <span /> RESEARCH SANDBOX
            </span>
            <button
              className="icon-btn"
              onClick={() => void refresh()}
              aria-label="Refresh"
            >
              <RefreshCw size={17} />
            </button>
            <div className="avatar small">AR</div>
          </div>
        </header>
        <div className="content-wrap">
          {locked ? (
            <Login
              onSuccess={() => {
                setLocked(false);
                void refresh();
              }}
            />
          ) : !authChecked ? (
            <div className="loading">
              <span className="spinner" />
              Checking local researcher access…
            </div>
          ) : (
            <>
              {error && (
                <div className="error-banner">
                  <AlertTriangle size={16} />
                  {error}
                  <button onClick={() => void refresh()}>Retry</button>
                </div>
              )}
              {loading ? (
                <div className="loading">
                  <span className="spinner" />
                  Loading research data…
                </div>
              ) : (
                <PageContent
                  {...{
                    page,
                    scenarios,
                    experiments,
                    runs,
                    results,
                    selectedRun,
                    setSelectedRun,
                    detail,
                    notify,
                    setPage,
                    search,
                    setSearch,
                  }}
                />
              )}
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error("Incorrect password");
      setPassword("");
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <div className="matrix-icon">
          <LockKeyhole size={18} />
        </div>
        <div className="eyebrow">LOCAL RESEARCHER ACCESS</div>
        <h2>Welcome back</h2>
        <p>Enter the admin password configured by the server operator.</p>
        <label>
          Password
          <input
            autoFocus
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <div className="login-error">{error}</div>}
        <button className="button primary full" disabled={busy}>
          {busy ? "Signing in…" : "Continue"}
        </button>
        <small>
          Password is validated server-side and is not saved in this browser.
        </small>
      </form>
    </div>
  );
}

function PageContent(props: {
  page: Page;
  scenarios: Scenario[];
  experiments: Experiment[];
  runs: Run[];
  results: Results | null;
  selectedRun: string | null;
  setSelectedRun: (id: string) => void;
  detail: Detail | null;
  notify: (message: string) => void;
  setPage: (page: Page) => void;
  search: string;
  setSearch: (value: string) => void;
}) {
  const { page } = props;
  if (page === "Experiment Builder") return <Builder {...props} />;
  if (page === "Scenario Library") return <Library {...props} />;
  if (page === "Run Monitor") return <RunMonitor {...props} />;
  if (page === "Trace Inspector") return <TraceInspector {...props} />;
  if (page === "Results & Evaluation") return <ResultsPage {...props} />;
  if (page === "Exports") return <Exports />;
  return <Overview {...props} />;
}

function Overview(p: Parameters<typeof PageContent>[0]) {
  const complete = p.runs.filter((run) => run.status === "completed");
  const failed = p.runs.filter((run) => run.status === "failed");
  const pending = p.runs.filter((run) =>
    ["queued", "running"].includes(run.status),
  );
  const metrics = [
    {
      label: "Experiments",
      value: p.experiments.length,
      note: "saved in workspace",
      icon: FlaskConical,
    },
    {
      label: "Total runs",
      value: p.runs.length,
      note: `${complete.length} completed`,
      icon: Activity,
    },
    {
      label: "Failed runs",
      value: failed.length,
      note: "review errors",
      icon: AlertTriangle,
    },
    {
      label: "Pending runs",
      value: pending.length,
      note: pending.length ? "queue active" : "all caught up",
      icon: Clock3,
    },
  ];
  const scored = complete.length;
  const sumMetric = (name: string) =>
    complete.filter(
      (run) =>
        runMetric(run, name) === "true" ||
        (name === "uvr_primary" && runMetric(run, name) === "1"),
    ).length;
  const meanDos = scored
    ? complete.reduce((sum, run) => sum + reportedDos(run), 0) / scored
    : null;
  const outcomeMetrics = [
    {
      label: "Overall UVR",
      value: scored ? `${sumMetric("uvr_primary")}/${scored}` : "—",
      note: "attempted prohibited actions",
    },
    {
      label: "Mean DOS",
      value: meanDos === null ? "—" : meanDos.toFixed(2),
      note: "automated unless overridden",
    },
    {
      label: "Task success",
      value: scored ? `${sumMetric("task_success")}/${scored}` : "—",
      note: "of completed runs",
    },
    {
      label: "Safe task success",
      value: scored ? `${sumMetric("safe_task_success")}/${scored}` : "—",
      note: "without attempted violation",
    },
    {
      label: "Clarify / escalate",
      value: scored
        ? `${sumMetric("clarification_escalation_halt")}/${scored}`
        : "—",
      note: "rule-based final report measure",
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="RESEARCH OVERVIEW"
        title="Good morning, researcher"
        subtitle="Understand how reflection changes agent decisions under operational constraints."
        action={
          <button
            className="button primary"
            onClick={() => p.setPage("Experiment Builder")}
          >
            <Plus size={16} /> New experiment
          </button>
        }
      />
      <div className="notice">
        <ShieldCheck size={19} />
        <div>
          <b>Sandboxed research simulator</b>
          <span>
            Every action runs against isolated simulated state. This is not a
            production automation platform and cannot change real systems.
          </span>
        </div>
        <span className="notice-label">LOCAL ONLY</span>
      </div>
      <div className="stat-grid">
        {metrics.map(({ label, value, note, icon: Icon }) => (
          <div className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <div className="outcome-grid">
        {outcomeMetrics.map((metric) => (
          <div key={metric.label}>
            <small>{metric.label}</small>
            <b>{metric.value}</b>
            <span>{metric.note}</span>
          </div>
        ))}
      </div>
      <div className="section-title">
        <div>
          <h2>Condition comparison</h2>
          <p>Primary UVR reflects attempted prohibited actions.</p>
        </div>
        <button
          className="button secondary"
          onClick={() => p.setPage("Results & Evaluation")}
        >
          View analysis <ChevronRight size={15} />
        </button>
      </div>
      <ConditionComparison results={p.results} />
      <div className="section-title">
        <div>
          <h2>Recent runs</h2>
          <p>Latest activity from your experiments.</p>
        </div>
        <button
          className="text-button"
          onClick={() => p.setPage("Run Monitor")}
        >
          All runs <ChevronRight size={15} />
        </button>
      </div>
      <RunTable
        runs={p.runs.slice(0, 6)}
        onSelect={(id) => {
          p.setSelectedRun(id);
          p.setPage("Trace Inspector");
        }}
      />
    </>
  );
}

function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function ConditionComparison({ results }: { results: Results | null }) {
  const data = useMemo(
    () =>
      results?.conditions.map((condition) => ({
        condition: condition.conditionId,
        "UVR attempted (%)": Math.round((condition.uvrRate ?? 0) * 100),
        "Safe task success (%)": condition.n
          ? Math.round((condition.safeSuccessCount / condition.n) * 100)
          : 0,
      })) ?? [],
    [results],
  );
  return (
    <div className="chart-card">
      <div className="chart-heading">
        <div>
          <b>UVR & safe task success by condition</b>
          <small>
            Run-level percentage · attempted UVR is the primary metric
          </small>
        </div>
        <span className="chart-legend">
          <i className="purple-dot" /> UVR attempted
        </span>
      </div>
      {data.length ? (
        <div className="chart-area">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={10}>
              <CartesianGrid vertical={false} stroke="#edf0f3" />
              <XAxis dataKey="condition" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} width={34} />
              <Tooltip />
              <Bar
                dataKey="UVR attempted (%)"
                fill="#6d57db"
                radius={[5, 5, 0, 0]}
              />
              <Bar
                dataKey="Safe task success (%)"
                fill="#54b899"
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState
          title="No results yet"
          text="Queue a mock experiment to populate the comparison."
        />
      )}
      <div className="chart-foot">
        {results?.conditions.map((condition) => (
          <span key={condition.conditionId}>
            <b>{condition.conditionId}</b> · {condition.uvrCount}/{condition.n}{" "}
            violations · n={condition.n}
          </span>
        ))}
      </div>
      {results?.exploratory && (
        <div className="pilot-note">
          <AlertTriangle size={14} /> Exploratory / pilot result — sample size
          is small; do not infer significance.
        </div>
      )}
    </div>
  );
}

function Builder(p: Parameters<typeof PageContent>[0]) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [researcher, setResearcher] = useState("Local researcher");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [provider, setProvider] = useState("mock");
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [model, setModel] = useState("mock-deterministic-v1");
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [conditions, setConditions] = useState<string[]>(["C1", "C2"]);
  const [selected, setSelected] = useState<string[]>([
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
  ]);
  const [replicates, setReplicates] = useState(1);
  const [policyMode, setPolicyMode] = useState("block_prohibited");
  const [randomize, setRandomize] = useState(true);
  const [maxTurns, setMaxTurns] = useState(5);
  const [temperature, setTemperature] = useState(0);
  const [topP, setTopP] = useState(1);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [retryCount, setRetryCount] = useState(0);
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void api<ProviderOption[]>("/providers")
      .then(setProviderOptions)
      .catch(() =>
        setProviderOptions([
          { id: "mock", configured: true, credentialReference: null },
        ]),
      );
  }, []);
  const count = selected.length * conditions.length * replicates;
  const toggle = (
    list: string[],
    setter: (value: string[]) => void,
    value: string,
  ) =>
    setter(
      list.includes(value)
        ? list.filter((item) => item !== value)
        : [...list, value],
    );
  const submit = async () => {
    if (!title.trim() || !selected.length || !conditions.length) {
      p.notify("Add a title and select at least one scenario and condition.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ experimentId: string; runCount: number }>(
        "/experiments",
        {
          method: "POST",
          body: JSON.stringify({
            title,
            description,
            researcher,
            tags: tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
            notes,
            provider,
            model,
            prompts,
            conditions,
            scenarios: selected,
            replicates,
            policyMode,
            randomize,
            maxTurns,
            temperature,
            topP,
            maxTokens,
            timeoutSeconds,
            retryCount,
            ...(seed ? { seed: Number(seed) } : {}),
          }),
        },
      );
      p.notify(`Experiment queued with ${result.runCount} runs.`);
      p.setPage("Run Monitor");
    } catch (error) {
      p.notify(
        error instanceof Error ? error.message : "Unable to queue experiment",
      );
    } finally {
      setBusy(false);
    }
  };
  const importConfig = async (file?: File) => {
    if (!file) return;
    try {
      const config = JSON.parse(await file.text()) as Record<string, unknown>;
      if (typeof config.title === "string") setTitle(config.title);
      if (typeof config.description === "string")
        setDescription(config.description);
      if (typeof config.researcher === "string")
        setResearcher(config.researcher);
      if (Array.isArray(config.tags))
        setTags(
          config.tags
            .filter((tag): tag is string => typeof tag === "string")
            .join(", "),
        );
      if (typeof config.notes === "string") setNotes(config.notes);
      if (typeof config.provider === "string") setProvider(config.provider);
      if (typeof config.model === "string") setModel(config.model);
      if (Array.isArray(config.conditions))
        setConditions(
          config.conditions.filter(
            (value): value is string => value === "C1" || value === "C2",
          ),
        );
      if (Array.isArray(config.scenarios))
        setSelected(
          config.scenarios.filter(
            (value): value is string =>
              typeof value === "string" && scenarioIds.includes(value),
          ),
        );
      if (typeof config.replicates === "number")
        setReplicates(config.replicates);
      if (
        config.policyMode === "observe_only" ||
        config.policyMode === "block_prohibited"
      )
        setPolicyMode(config.policyMode);
      if (typeof config.maxTurns === "number") setMaxTurns(config.maxTurns);
      if (typeof config.temperature === "number")
        setTemperature(config.temperature);
      if (typeof config.topP === "number") setTopP(config.topP);
      if (typeof config.maxTokens === "number") setMaxTokens(config.maxTokens);
      if (typeof config.timeoutSeconds === "number")
        setTimeoutSeconds(config.timeoutSeconds);
      if (typeof config.retryCount === "number")
        setRetryCount(config.retryCount);
      if (typeof config.seed === "number") setSeed(String(config.seed));
      if (config.promptOverrides && typeof config.promptOverrides === "object")
        setPrompts(config.promptOverrides as Record<string, string>);
      p.notify(
        "Configuration loaded. Review it and queue a new experiment when ready.",
      );
    } catch {
      p.notify(
        "The selected file is not a valid experiment configuration JSON.",
      );
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="CONFIGURATION"
        title="Experiment builder"
        subtitle="Design a reproducible experiment matrix without writing code."
        action={
          <>
            <input
              ref={importInput}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importConfig(event.target.files?.[0])}
            />
            <button
              className="button secondary"
              onClick={() => importInput.current?.click()}
            >
              <FileJson size={15} /> Import config JSON
            </button>
          </>
        }
      />
      <div className="builder-layout">
        <div className="builder-form">
          <section className="form-section">
            <h2>
              <span>01</span> Experiment details
            </h2>
            <div className="form-grid">
              <label className="wide">
                Experiment title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Safety reflection pilot — Q4"
                />
              </label>
              <label>
                Researcher
                <input
                  value={researcher}
                  onChange={(e) => setResearcher(e.target.value)}
                />
              </label>
              <label>
                Description
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Research aim and notes"
                />
              </label>
              <label>
                Tags (comma-separated)
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="pilot, safety, v1"
                />
              </label>
              <label>
                Notes / ethics reference
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Protocol or ethics note reference"
                />
              </label>
            </div>
          </section>
          <section className="form-section">
            <h2>
              <span>02</span> Model configuration
            </h2>
            <div className="form-grid">
              <label>
                Provider
                <select
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    setModel(
                      e.target.value === "mock" ? "mock-deterministic-v1" : "",
                    );
                  }}
                >
                  {[
                    ["mock", "Mock (offline, deterministic)"],
                    ["openai", "OpenAI"],
                    ["anthropic", "Anthropic"],
                    ["openai-compatible", "OpenAI-compatible endpoint"],
                  ].map(([id, label]) => {
                    const option = providerOptions.find(
                      (entry) => entry.id === id,
                    );
                    return (
                      <option
                        key={id}
                        value={id}
                        disabled={Boolean(option && !option.configured)}
                      >
                        {label}
                        {option && !option.configured
                          ? " (server credential not configured)"
                          : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label>
                Server credential reference
                <select
                  value={
                    providerOptions.find((entry) => entry.id === provider)
                      ?.credentialReference ?? ""
                  }
                  disabled
                >
                  <option value="">No credential needed (mock)</option>
                  {providerOptions.find((entry) => entry.id === provider)
                    ?.credentialReference && (
                    <option
                      value={
                        providerOptions.find((entry) => entry.id === provider)
                          ?.credentialReference ?? ""
                      }
                    >
                      {
                        providerOptions.find((entry) => entry.id === provider)
                          ?.credentialReference
                      }
                    </option>
                  )}
                </select>
              </label>
              <label>
                Model identifier
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={
                    provider === "mock"
                      ? "mock-deterministic-v1"
                      : "Enter provider model ID"
                  }
                />
              </label>
              <label>
                Maximum agent turns
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(Number(e.target.value))}
                />
              </label>
              <label>
                Temperature
                <input
                  type="number"
                  min="0"
                  max="2"
                  step=".1"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                />
              </label>
              <label>
                top_p
                <input
                  type="number"
                  min="0"
                  max="1"
                  step=".05"
                  value={topP}
                  onChange={(e) => setTopP(Number(e.target.value))}
                />
              </label>
              <label>
                Maximum output tokens
                <input
                  type="number"
                  min="1"
                  max="32000"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                />
              </label>
              <label>
                Timeout (seconds)
                <input
                  type="number"
                  min="5"
                  max="600"
                  value={timeoutSeconds}
                  onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                />
              </label>
              <label>
                Provider retry count
                <input
                  type="number"
                  min="0"
                  max="5"
                  value={retryCount}
                  onChange={(e) => setRetryCount(Number(e.target.value))}
                />
              </label>
            </div>
            {provider !== "mock" && (
              <div className="credential-note">
                <LockKeyhole size={15} /> API credentials are read only from
                server environment variables. Set them in <code>.env</code>;
                they are never sent to this browser.
              </div>
            )}
            <div className="policy-copy">
              <ShieldCheck size={15} /> Browser and web search are disabled;
              model credentials remain server-side.
            </div>
          </section>
          <section className="form-section">
            <h2>
              <span>03</span> Conditions
            </h2>
            <div className="choice-grid">
              {["C1", "C2"].map((id) => (
                <button
                  key={id}
                  className={`choice-card ${conditions.includes(id) ? "selected" : ""}`}
                  onClick={() => toggle(conditions, setConditions, id)}
                >
                  <span className="check-box">
                    {conditions.includes(id) && <Check size={13} />}
                  </span>
                  <div>
                    <b>
                      {id}:{" "}
                      {id === "C1" ? "Direct autonomous" : "Reflective safety"}
                    </b>
                    <small>
                      {id === "C1"
                        ? "Direct task execution prompt"
                        : "Mandatory policy & harm assessment"}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          </section>
          <section className="form-section">
            <h2>
              <span>04</span> Scenario matrix
            </h2>
            <div className="scenario-checks">
              {p.scenarios.map((scenario) => (
                <div className="scenario-pick" key={scenario.id}>
                  <button
                    className={`scenario-check ${selected.includes(scenario.id) ? "checked" : ""}`}
                    onClick={() => toggle(selected, setSelected, scenario.id)}
                  >
                    <span className="check-box">
                      {selected.includes(scenario.id) && <Check size={13} />}
                    </span>
                    <span>
                      <b>{scenario.id}</b> {scenario.title.split(": ")[1]}
                    </span>
                    <small>{scenario.domain}</small>
                  </button>
                  {selected.includes(scenario.id) && (
                    <label className="scenario-prompt">
                      Editable task prompt
                      <textarea
                        value={
                          prompts[scenario.id] ??
                          initialScenarioPrompt(scenario)
                        }
                        onChange={(event) =>
                          setPrompts({
                            ...prompts,
                            [scenario.id]: event.target.value,
                          })
                        }
                        rows={3}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
            <div className="form-row">
              <label>
                Independent replicates per cell
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={replicates}
                  onChange={(e) =>
                    setReplicates(Math.max(1, Number(e.target.value)))
                  }
                />
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={randomize}
                  onChange={(e) => setRandomize(e.target.checked)}
                />{" "}
                Randomize run order
              </label>
              <label>
                Randomization seed (optional)
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="Generated and saved if blank"
                />
              </label>
            </div>
          </section>
          <section className="form-section">
            <h2>
              <span>05</span> Sandbox policy
            </h2>
            <div className="form-grid">
              <label className="wide">
                Prohibited action handling
                <select
                  value={policyMode}
                  onChange={(e) => setPolicyMode(e.target.value)}
                >
                  <option value="block_prohibited">
                    Block prohibited (safer measurement)
                  </option>
                  <option value="observe_only">
                    Observe-only (execute inside isolated simulation)
                  </option>
                </select>
              </label>
            </div>
            <div className="policy-copy">
              <ShieldCheck size={15} /> This policy applies consistently to
              every condition in the experiment. Observe-only actions remain
              confined to simulated state.
            </div>
          </section>
        </div>
        <aside className="matrix-card">
          <div className="matrix-icon">
            <Beaker size={18} />
          </div>
          <div className="eyebrow">EXPERIMENT PREVIEW</div>
          <h3>Run matrix</h3>
          <div className="matrix-total">
            {count}
            <small>planned runs</small>
          </div>
          <div className="matrix-line">
            <span>Models</span>
            <b>{model || "Choose model"}</b>
          </div>
          <div className="matrix-line">
            <span>Conditions</span>
            <b>{conditions.length ? conditions.join(", ") : "None"}</b>
          </div>
          <div className="matrix-line">
            <span>Scenarios</span>
            <b>{selected.length} selected</b>
          </div>
          <div className="matrix-line">
            <span>Replicates</span>
            <b>{replicates} / cell</b>
          </div>
          <div className="matrix-line">
            <span>Policy mode</span>
            <b>
              {policyMode === "observe_only"
                ? "Observe-only"
                : "Block prohibited"}
            </b>
          </div>
          <div className="matrix-divider" />
          <div className="scenario-summary">
            {selected.map((id) => (
              <span key={id}>{id}</span>
            ))}
          </div>
          <button
            className="button primary full"
            disabled={busy || count === 0}
            onClick={() => void submit()}
          >
            <Play size={15} /> {busy ? "Queuing…" : "Queue experiment"}
          </button>
          <small className="matrix-disclaimer">
            All tools are backend registered and simulated. No arbitrary code or
            live integrations.
          </small>
        </aside>
      </div>
    </>
  );
}

function Library(p: Parameters<typeof PageContent>[0]) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <>
      <PageHeading
        eyebrow="SCENARIO LIBRARY"
        title="Operational scenarios"
        subtitle="Versioned sandbox environments with explicit protected resources and safe alternatives."
        action={
          <button
            className="button secondary"
            onClick={() =>
              p.notify(
                "Scenario versions are stored as immutable version 1 records; scenario editing UI is not enabled in this build.",
              )
            }
          >
            <Plus size={15} /> Add scenario
          </button>
        }
      />
      <div className="library-callout">
        <Database size={17} />
        <span>
          <b>{p.scenarios.length} seeded scenarios</b> · scenario content and
          tool schemas are stored as versioned records.
        </span>
      </div>
      <div className="scenario-library">
        {p.scenarios.map((scenario) => (
          <article className="scenario-card" key={scenario.id}>
            <div className="scenario-card-top">
              <span className="scenario-id">{scenario.id}</span>
              <span className="version-pill">
                v{scenario.versions?.[0]?.version ?? 1}
              </span>
            </div>
            <span className="scenario-domain">{scenario.domain}</span>
            <h3>{scenario.title}</h3>
            <p>{scenario.description}</p>
            <div className="scenario-card-bottom">
              <span>
                <ShieldCheck size={14} /> Protected-resource rules active
              </span>
              <button
                className="text-button"
                aria-expanded={expanded === scenario.id}
                onClick={() =>
                  setExpanded(expanded === scenario.id ? null : scenario.id)
                }
              >
                {expanded === scenario.id ? "Hide details" : "View details"}{" "}
                <ChevronRight size={14} />
              </button>
            </div>
            {expanded === scenario.id && (
              <div className="scenario-details">
                <b>Task prompt</b>
                <p>{scenarioDefinition(scenario).prompt}</p>
                <b>Protected resources</b>
                <ul>
                  {(scenarioDefinition(scenario).protected ?? []).map(
                    (item) => (
                      <li key={item}>{item}</li>
                    ),
                  )}
                </ul>
                <b>Safe alternatives</b>
                <ul>
                  {(scenarioDefinition(scenario).safeAlternatives ?? []).map(
                    (item) => (
                      <li key={item}>{item}</li>
                    ),
                  )}
                </ul>
                <b>Success condition</b>
                <p>{scenarioDefinition(scenario).success}</p>
                <b>Registered tools</b>
                <div className="tool-chips">
                  {(scenarioDefinition(scenario).tools ?? []).map((tool) => (
                    <code key={tool.name}>{tool.name}</code>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

function RunMonitor(p: Parameters<typeof PageContent>[0]) {
  const [filter, setFilter] = useState("all");
  const displayed =
    filter === "all" ? p.runs : p.runs.filter((run) => run.status === filter);
  const cancel = async (id: string) => {
    try {
      await api(`/runs/${id}/cancel`, { method: "POST" });
      p.notify("Run cancellation requested.");
    } catch (error) {
      p.notify(error instanceof Error ? error.message : "Unable to cancel run");
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="EXECUTION"
        title="Run monitor"
        subtitle="Track queued and active simulation jobs. Updates refresh automatically."
        action={
          <button
            className="button primary"
            onClick={() => p.setPage("Experiment Builder")}
          >
            <Plus size={15} /> New run
          </button>
        }
      />
      <div className="monitor-summary">
        <div>
          <strong>
            {p.runs.filter((run) => run.status === "queued").length}
          </strong>
          <span>Queued</span>
        </div>
        <div>
          <strong>
            {p.runs.filter((run) => run.status === "running").length}
          </strong>
          <span>Running</span>
        </div>
        <div>
          <strong>
            {p.runs.filter((run) => run.status === "completed").length}
          </strong>
          <span>Completed</span>
        </div>
        <div>
          <strong>
            {p.runs.filter((run) => run.status === "failed").length}
          </strong>
          <span>Failed</span>
        </div>
      </div>
      <div className="table-toolbar">
        <div className="filter-tabs">
          {["all", "queued", "running", "completed", "failed"].map((status) => (
            <button
              className={filter === status ? "active" : ""}
              key={status}
              onClick={() => setFilter(status)}
            >
              {status[0].toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
        <span className="live-label">
          <i /> AUTO-REFRESH 2.5S
        </span>
      </div>
      <RunTable
        runs={displayed}
        onSelect={(id) => {
          p.setSelectedRun(id);
          p.setPage("Trace Inspector");
        }}
        onCancel={cancel}
      />
    </>
  );
}

function RunTable({
  runs,
  onSelect,
  onCancel,
}: {
  runs: Run[];
  onSelect: (id: string) => void;
  onCancel?: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>RUN / EXPERIMENT</th>
            <th>SCENARIO</th>
            <th>CONDITION</th>
            <th>PROVIDER · MODEL</th>
            <th>REPLICATE</th>
            <th>STATUS</th>
            <th>CREATED</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <button className="run-id" onClick={() => onSelect(run.id)}>
                  {run.id.slice(0, 8)}…
                </button>
                <small>{run.experimentId.slice(0, 8)}</small>
              </td>
              <td>
                <span className="scenario-badge">{run.scenarioId}</span>
              </td>
              <td>
                <span
                  className={`condition-pill ${run.conditionId.toLowerCase()}`}
                >
                  {run.conditionId}
                </span>
              </td>
              <td>
                <b>{run.provider}</b>
                <small>{run.model}</small>
              </td>
              <td>{run.replicate}</td>
              <td>
                <Status status={run.status} />
              </td>
              <td>{new Date(run.createdAt).toLocaleString()}</td>
              <td>
                {onCancel && ["queued", "running"].includes(run.status) && (
                  <button
                    className="icon-btn danger-icon"
                    title="Cancel run"
                    onClick={() => onCancel(run.id)}
                  >
                    <Square size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!runs.length && (
        <EmptyState
          title="No runs found"
          text="Queue an experiment to see run activity here."
        />
      )}
    </div>
  );
}

function Status({ status }: { status: string }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {status}
    </span>
  );
}

function TraceInspector(p: Parameters<typeof PageContent>[0]) {
  const [reviewer, setReviewer] = useState("");
  const [rationale, setRationale] = useState("");
  const [reviewValue, setReviewValue] = useState("0");
  if (!p.selectedRun)
    return (
      <>
        <PageHeading
          eyebrow="TRACE INSPECTOR"
          title="Inspect a run"
          subtitle="Select a run to inspect prompts, raw outputs, simulated actions, and scoring evidence."
        />
        <RunTable runs={p.runs} onSelect={p.setSelectedRun} />
      </>
    );
  const trace = p.detail;
  if (!trace)
    return (
      <div className="loading">
        <span className="spinner" />
        Loading trace…
      </div>
    );
  const saveReview = async () => {
    try {
      await api(`/runs/${trace.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          metric: "dos_auto",
          reviewerId: reviewer,
          value: reviewValue,
          rationale,
        }),
      });
      p.notify("Human review saved to audit history.");
      setRationale("");
    } catch (error) {
      p.notify(
        error instanceof Error ? error.message : "Unable to save review",
      );
    }
  };
  const rerunExact = async () => {
    try {
      const result = await api<{ runCount: number }>(
        `/experiments/${trace.experimentId}/rerun`,
        { method: "POST" },
      );
      p.notify(`Exact configuration queued again (${result.runCount} runs).`);
      p.setPage("Run Monitor");
    } catch (error) {
      p.notify(
        error instanceof Error ? error.message : "Unable to queue exact rerun",
      );
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="TRACE INSPECTOR"
        title={`Run ${trace.id.slice(0, 8)}…`}
        subtitle={`${trace.scenarioId} · ${trace.conditionId} · ${trace.provider}/${trace.model} · immutable configuration snapshot`}
        action={
          <div className="trace-actions">
            <button
              className="button secondary"
              onClick={() => void rerunExact()}
            >
              <RefreshCw size={15} /> Exact rerun
            </button>
            <a
              className="button secondary"
              href={`/api/experiments/${trace.experimentId}/config.json`}
            >
              <FileJson size={15} /> Config JSON
            </a>
            <a
              className="button secondary"
              href={`/api/export/${trace.id}.json`}
            >
              <ArrowDownToLine size={15} /> Trace JSON
            </a>
          </div>
        }
      />
      <button
        className="text-button back-link"
        onClick={() => p.setSelectedRun("")}
      >
        ← All runs
      </button>
      <div className="trace-meta">
        <div>
          <span>STATUS</span>
          <Status status={trace.status} />
        </div>
        <div>
          <span>POLICY MODE</span>
          <b>{trace.policyMode}</b>
        </div>
        <div>
          <span>REPLICATE</span>
          <b>{trace.replicate}</b>
        </div>
        <div>
          <span>CREATED</span>
          <b>{new Date(trace.createdAt).toLocaleString()}</b>
        </div>
        <div className="snapshot-hash">
          <span>CONFIG SNAPSHOT SHA-256</span>
          <code>{trace.snapshot?.configHash}</code>
        </div>
      </div>
      <div className="trace-section">
        <h2>
          Action timeline{" "}
          <span>
            {trace.turns.length} turns · {trace.toolCalls.length} tool calls
          </span>
        </h2>
        <div className="timeline">
          {trace.turns.map((turn) => (
            <div className="timeline-item" key={turn.id}>
              <div className="timeline-mark turn-mark">
                <Activity size={14} />
              </div>
              <div className="timeline-content">
                <div className="timeline-head">
                  <b>Model turn {turn.turnNumber}</b>
                  <span>MODEL OUTPUT</span>
                </div>
                <pre>{turn.content}</pre>
                <details>
                  <summary>View raw provider response</summary>
                  <pre>{turn.rawOutput}</pre>
                </details>
              </div>
            </div>
          ))}
          {trace.toolCalls.map((call) => (
            <div className="timeline-item" key={call.id}>
              <div
                className={`timeline-mark ${call.executionOutcome === "blocked" ? "blocked-mark" : "tool-mark"}`}
              >
                <Database size={14} />
              </div>
              <div className="timeline-content">
                <div className="timeline-head">
                  <b>{call.toolName}</b>
                  <Status status={call.executionOutcome} />
                </div>
                <div className="call-labels">
                  <span className="attempted">ATTEMPTED</span>
                  <span>{call.validation}</span>
                  <span
                    className={
                      call.policyOutcome.includes("prohibited")
                        ? "blocked-label"
                        : ""
                    }
                  >
                    {call.policyOutcome}
                  </span>
                  <span>{call.executionOutcome}</span>
                </div>
                <div className="json-grid">
                  <div>
                    <small>ARGUMENTS</small>
                    <pre>
                      {JSON.stringify(JSON.parse(call.arguments), null, 2)}
                    </pre>
                  </div>
                  <div>
                    <small>SIMULATED RESULT</small>
                    <pre>
                      {JSON.stringify(JSON.parse(call.result), null, 2)}
                    </pre>
                  </div>
                </div>
                <details>
                  <summary>State before / after</summary>
                  <div className="json-grid">
                    <pre>
                      {JSON.stringify(JSON.parse(call.stateBefore), null, 2)}
                    </pre>
                    <pre>
                      {JSON.stringify(JSON.parse(call.stateAfter), null, 2)}
                    </pre>
                  </div>
                </details>
              </div>
            </div>
          ))}
          <div className="timeline-item">
            <div className="timeline-mark final-mark">
              <Check size={14} />
            </div>
            <div className="timeline-content">
              <div className="timeline-head">
                <b>Final response</b>
                <span>AGENT REPORT</span>
              </div>
              <pre>{trace.finalMessage || "Pending final response…"}</pre>
            </div>
          </div>
        </div>
      </div>
      <div className="trace-section">
        <h2>
          Automated scoring <span>Provisional · human review eligible</span>
        </h2>
        <div className="metric-list">
          {trace.metrics.map((metric) => (
            <div className="metric-row" key={metric.name}>
              <b>{metric.name}</b>
              <strong>{metric.value}</strong>
              <small>{metric.rationale}</small>
            </div>
          ))}
        </div>
      </div>
      <div className="trace-section">
        <h2>
          Human scoring review{" "}
          <span>Reviewer and rationale are audit logged</span>
        </h2>
        <div className="review-form">
          <input
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="Reviewer ID"
          />
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="DOS override rationale"
          />
          <select
            aria-label="DOS human override"
            value={reviewValue}
            onChange={(e) => setReviewValue(e.target.value)}
          >
            <option value="0">DOS override: 0</option>
            <option value="1">DOS override: 1</option>
            <option value="2">DOS override: 2</option>
          </select>
          <button
            className="button primary"
            disabled={!reviewer.trim() || !rationale.trim()}
            onClick={() => void saveReview()}
          >
            Save review
          </button>
        </div>
        {trace.humanReviews.length > 0 && (
          <div className="review-history">
            <b>Review history</b>
            {trace.humanReviews.map((review) => (
              <div key={review.id}>
                <span>
                  DOS {review.value} · {review.reviewerId} ·{" "}
                  {new Date(review.createdAt).toLocaleString()}
                </span>
                <p>{review.rationale}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ResultsPage(p: Parameters<typeof PageContent>[0]) {
  const [scenarioFilter, setScenarioFilter] = useState("all");
  const filtered = p.runs.filter(
    (run) => scenarioFilter === "all" || run.scenarioId === scenarioFilter,
  );
  const completed = filtered.filter((run) => run.status === "completed");
  const conditionData = ["C1", "C2"].map((conditionId) => {
    const rows = completed.filter((run) => run.conditionId === conditionId);
    const uvrCount = rows.filter(
      (run) => runMetric(run, "uvr_primary") === "1",
    ).length;
    const safeCount = rows.filter(
      (run) => runMetric(run, "safe_task_success") === "true",
    ).length;
    return {
      condition: conditionId,
      n: rows.length,
      uvrCount,
      safeCount,
      uvr: rows.length ? (uvrCount / rows.length) * 100 : 0,
      safe: rows.length ? (safeCount / rows.length) * 100 : 0,
    };
  });
  const c1 =
    conditionData.find((condition) => condition.condition === "C1")?.uvr ?? 0;
  const c2 =
    conditionData.find((condition) => condition.condition === "C2")?.uvr ?? 0;
  const dosDistribution = [0, 1, 2].map((score) => ({
    score: `DOS ${score}`,
    count: completed.filter((run) => reportedDos(run) === score).length,
    n: completed.length,
  }));
  return (
    <>
      <PageHeading
        eyebrow="ANALYSIS"
        title="Results & evaluation"
        subtitle="Explore primary and secondary outcomes with denominators always visible."
        action={
          <a className="button secondary" href="/api/export/analysis.csv">
            <ArrowDownToLine size={15} /> Export analysis CSV
          </a>
        }
      />
      <div className="results-warning">
        <AlertTriangle size={17} />
        <div>
          <b>Exploratory / pilot results</b>
          <span>
            Current sample sizes are descriptive only; no significance claim is
            made. DOS is heuristic and not ground truth.
          </span>
        </div>
      </div>
      <div className="results-filters">
        <label>
          Scenario
          <select
            value={scenarioFilter}
            onChange={(e) => setScenarioFilter(e.target.value)}
          >
            <option value="all">All scenarios</option>
            {scenarioIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Run status
          <select>
            <option>All statuses</option>
            <option>Completed</option>
            <option>Failed</option>
          </select>
        </label>
        <span>
          {completed.length}/{filtered.length} completed runs in current view
        </span>
      </div>
      <div className="result-kpis">
        <div>
          <small>ABSOLUTE RISK REDUCTION</small>
          <b>
            {(c1 - c2).toFixed(1)}
            <i> pp</i>
          </b>
          <span>C1 minus C2 attempted UVR</span>
        </div>
        <div>
          <small>RELATIVE RISK REDUCTION</small>
          <b>{c1 ? `${(((c1 - c2) / c1) * 100).toFixed(1)}%` : "—"}</b>
          <span>Only when C1 UVR is non-zero</span>
        </div>
        <div>
          <small>PRIMARY UVR DEFINITION</small>
          <b>Attempted</b>
          <span>Prohibited action requested</span>
        </div>
      </div>
      <div className="section-title">
        <div>
          <h2>Condition comparison</h2>
          <p>UVR and safe task success by condition; denominator is shown.</p>
        </div>
      </div>
      <div className="chart-card result-chart">
        <div className="chart-area">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={conditionData} barGap={12}>
              <CartesianGrid vertical={false} stroke="#edf0f3" />
              <XAxis dataKey="condition" axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar
                dataKey="uvr"
                name="UVR attempted (%)"
                fill="#6d57db"
                radius={[5, 5, 0, 0]}
              />
              <Bar
                dataKey="safe"
                name="Safe task success (%)"
                fill="#54b899"
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-foot">
          {conditionData.map((condition) => (
            <span key={condition.condition}>
              <b>{condition.condition}</b> · UVR {condition.uvrCount}/
              {condition.n} · safe success {condition.safeCount}/{condition.n}
            </span>
          ))}
        </div>
      </div>
      <div className="section-title">
        <div>
          <h2>DOS distribution</h2>
          <p>
            Human overrides take precedence in reported distribution; automated
            values remain preserved.
          </p>
        </div>
      </div>
      <div className="chart-card result-chart">
        <div className="chart-area">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dosDistribution}>
              <CartesianGrid vertical={false} stroke="#edf0f3" />
              <XAxis dataKey="score" axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar
                dataKey="count"
                name="Runs"
                fill="#8875df"
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-foot">
          <span>Completed sample denominator: n={completed.length}</span>
        </div>
      </div>
      <div className="section-title">
        <div>
          <h2>Per-scenario results</h2>
          <p>UVR numerator and denominator by condition.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SCENARIO</th>
              <th>C1 ATTEMPTED UVR</th>
              <th>C2 ATTEMPTED UVR</th>
              <th>MEAN DOS</th>
              <th>POLICY MODE</th>
            </tr>
          </thead>
          <tbody>
            {scenarioIds.map((id) => {
              const rows = filtered.filter((run) => run.scenarioId === id);
              const stats = (condition: string) => {
                const subset = rows.filter(
                  (run) => run.conditionId === condition,
                );
                const violations = subset.filter(
                  (run) =>
                    run.status === "completed" &&
                    runMetric(run, "uvr_primary") === "1",
                ).length;
                return `${violations}/${subset.length}`;
              };
              const dos = rows
                .filter((run) => run.status === "completed")
                .map(reportedDos);
              const avg = dos.length
                ? (dos.reduce((a, b) => a + b, 0) / dos.length).toFixed(2)
                : "—";
              return (
                <tr key={id}>
                  <td>
                    <span className="scenario-badge">{id}</span>
                  </td>
                  <td>{stats("C1")}</td>
                  <td>{stats("C2")}</td>
                  <td>{avg}</td>
                  <td>
                    {[...new Set(rows.map((row) => row.policyMode))].join(
                      ", ",
                    ) || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="section-title">
        <div>
          <h2>Run-level dataset</h2>
          <p>
            Sortable by export; metric rows include automated scoring rationale.
          </p>
        </div>
      </div>
      <RunTable
        runs={filtered}
        onSelect={(id) => {
          p.setSelectedRun(id);
          p.setPage("Trace Inspector");
        }}
      />
    </>
  );
}

function Exports() {
  const files = [
    "experiments",
    "experiment_config_snapshots",
    "runs",
    "turns",
    "tool_calls",
    "tool_results",
    "state_transitions",
    "metrics_long",
    "metrics_wide",
    "human_reviews",
    "errors",
    "model_requests",
    "model_responses",
    "environment_snapshots",
    "automated_scores",
    "metric_definitions",
    "provider_configurations",
    "model_configurations",
    "audit_log",
    "analysis",
  ];
  return (
    <>
      <PageHeading
        eyebrow="REPRODUCIBILITY"
        title="Export data"
        subtitle="Download redacted trace and analysis data for reproducible, offline research."
      />
      <div className="export-notice">
        <LockKeyhole size={17} />
        <div>
          <b>Credential-safe exports</b>
          <span>
            Provider API keys and authorization headers are never stored in runs
            or included in exports. Empty values represent nulls; timestamps use
            UTC.
          </span>
        </div>
      </div>
      <div className="export-feature">
        <div className="export-large-icon">
          <FileJson size={21} />
        </div>
        <div>
          <h3>Complete research bundle</h3>
          <p>
            All CSV datasets, raw JSON traces, and a manifest with metric
            definitions and export metadata.
          </p>
        </div>
        <a className="button primary" href="/api/export/bundle.zip">
          <ArrowDownToLine size={15} /> Download ZIP
        </a>
      </div>
      <div className="section-title">
        <div>
          <h2>Individual CSV files</h2>
          <p>RFC 4180-compatible UTF-8 downloads.</p>
        </div>
      </div>
      <div className="export-grid">
        {files.map((file) => (
          <a
            className="export-file"
            key={file}
            href={
              file === "analysis"
                ? "/api/export/analysis.csv"
                : `/api/export/${file}.csv`
            }
          >
            <div>
              <FileJson size={16} />
              <b>{file}.csv</b>
            </div>
            <ArrowDownToLine size={15} />
          </a>
        ))}
      </div>
      <div className="export-footnote">
        <CircleHelp size={15} /> Primary metric <code>uvr_primary</code> is the
        attempted violation indicator. DOS auto-scores are provisional; consult
        the scoring rubric.
      </div>
    </>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <div>
        <Database size={20} />
      </div>
      <b>{title}</b>
      <span>{text}</span>
    </div>
  );
}
