"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

type Item = Record<string, unknown>;
type Overview = { metrics: Record<string, string | number>; recent: Item[] };

const nav = [
  ["overview", "平台总览", "⌂", "OPERATIONS"],
  ["users", "用户管理", "♙", "OPERATIONS"],
  ["models", "模型管理", "◇", "AI ROUTING"],
  ["channels", "渠道管理", "⇄", "AI ROUTING"],
  ["orders", "订单管理", "▧", "COMMERCE"],
  ["cards", "卡密管理", "⌁", "COMMERCE"],
  ["usage-logs", "调用日志", "≡", "GOVERNANCE"],
  ["moderation", "内容审核", "◉", "GOVERNANCE"],
  ["agents", "代理管理", "♧", "PARTNERS"],
  ["withdrawals", "提现管理", "⇩", "PARTNERS"],
  ["finance", "组织财务 / 月结", "＄", "FINANCE"],
  ["alerts", "系统告警", "△", "SYSTEM"],
  ["tasks", "后台任务", "◌", "SYSTEM"],
  ["audit-logs", "审计日志", "⌕", "SYSTEM"],
] as const;

const titles: Record<string, [string, string]> = {
  overview: ["Command Center", "平台运行总览"],
  users: ["Identity", "用户管理"],
  models: ["Catalog", "模型管理"],
  channels: ["Routing", "渠道管理"],
  orders: ["Payments", "订单管理"],
  cards: ["Prepaid", "卡密管理"],
  "usage-logs": ["Observability", "调用日志"],
  moderation: ["Trust & Safety", "内容审核"],
  agents: ["Partners", "代理管理"],
  withdrawals: ["Settlement", "提现管理"],
  finance: ["Enterprise Billing", "组织财务与月结账单"],
  alerts: ["Incident Center", "系统告警"],
  tasks: ["Async Runtime", "后台任务"],
  "audit-logs": ["Compliance", "审计日志"],
};

async function api<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw new Error(
      data?.error?.message || `Request failed (${response.status})`,
    );
  return data as T;
}

function fmt(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "YES" : "NO";
  if (typeof value === "object") return JSON.stringify(value);
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw))
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(raw));
  return raw.length > 65 ? `${raw.slice(0, 62)}…` : raw;
}

function flatten(item: Item) {
  const row: Item = {};
  for (const [key, value] of Object.entries(item)) {
    if (
      [
        "passwordHash",
        "apiKeyEncrypted",
        "definition",
        "metadata",
        "capabilities",
        "lineItems",
      ].includes(key)
    )
      continue;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      for (const [nested, nestedValue] of Object.entries(value as Item))
        row[`${key}.${nested}`] = nestedValue;
    } else if (!Array.isArray(value)) row[key] = value;
  }
  return row;
}

export default function Admin() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [data, setData] = useState<Item[]>([]);
  const [extra, setExtra] = useState<Record<string, Item[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  const load = useCallback(
    async (section: string, session = token) => {
      if (!session) return;
      setBusy(true);
      setError("");
      try {
        const result = await api<
          Overview | { data?: Item[]; [key: string]: unknown }
        >(`/api/admin/${section}`, session);
        if (section === "overview") {
          setOverview(result as Overview);
          setData([]);
        } else {
          const object = result as { data?: Item[]; [key: string]: unknown };
          if (object.data) {
            setData(object.data);
            setExtra({});
          } else {
            const collections = Object.fromEntries(
              Object.entries(object).filter(([, value]) =>
                Array.isArray(value),
              ),
            ) as Record<string, Item[]>;
            setExtra(collections);
            setData(Object.values(collections)[0] || []);
          }
        }
      } catch (err) {
        if (err instanceof Error && /authentication/i.test(err.message)) {
          localStorage.removeItem("tf_admin");
          setToken("");
        }
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        setBusy(false);
        setReady(true);
      }
    },
    [token],
  );

  useEffect(() => {
    const saved = localStorage.getItem("tf_admin") || "";
    setToken(saved);
    if (saved) void load("overview", saved);
    else setReady(true);
  }, []);
  useEffect(() => {
    if (token && ready) void load(active);
  }, [active]);

  async function mutate(path: string, init: RequestInit) {
    setBusy(true);
    setError("");
    try {
      await api(path, token, init);
      await load(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      setBusy(false);
    }
  }
  function logout() {
    localStorage.removeItem("tf_admin");
    setToken("");
  }

  if (!ready)
    return (
      <div className="loading">
        <span>SZ</span>Loading operations console…
      </div>
    );
  if (!token)
    return (
      <Login
        onToken={(session) => {
          localStorage.setItem("tf_admin", session);
          setToken(session);
          setReady(false);
          void load("overview", session);
        }}
      />
    );

  const [eyebrow, title] = titles[active] || ["", active];
  return (
    <div className="admin-shell">
      <aside className={navOpen ? "open" : ""}>
        <div className="admin-logo">
          <b>SZ</b>
          <div>
            <strong>SZRouter</strong>
            <small>ADMIN CONSOLE</small>
          </div>
        </div>
        <nav>
          {[...new Set(nav.map((item) => item[3]))].map((group) => (
            <div className="nav-group" key={group}>
              <label>{group}</label>
              {nav
                .filter((item) => item[3] === group)
                .map(([id, label, icon]) => (
                  <button
                    className={active === id ? "active" : ""}
                    key={id}
                    onClick={() => {
                      setActive(id);
                      setNavOpen(false);
                    }}
                  >
                    <span>{icon}</span>
                    {label}
                    {id === "alerts" &&
                      Number(overview?.metrics.openAlerts || 0) > 0 && (
                        <em>{overview?.metrics.openAlerts}</em>
                      )}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <footer>
          <i /> Gateway connected
        </footer>
      </aside>
      <main>
        <header>
          <button className="menu" onClick={() => setNavOpen(!navOpen)}>
            ☰
          </button>
          <div className="breadcrumb">
            SZROUTER <span>/</span> {title.toUpperCase()}
          </div>
          <div className="operator">
            <span>SUPER ADMIN</span>
            <b>A</b>
            <button onClick={logout}>退出</button>
          </div>
        </header>
        <div className="content">
          <div className="page-title">
            <div>
              <span>{eyebrow}</span>
              <h1>{title}</h1>
              <p>SZRouter 平台管理与运营控制面。</p>
            </div>
            <div className="page-actions">
              <button onClick={() => void load(active)}>↻ 刷新</button>
              {active !== "overview" && (
                <CreateAction active={active} busy={busy} onMutate={mutate} />
              )}
            </div>
          </div>
          {error && <div className="error">{error}</div>}
          {busy && <div className="thin-loader" />}
          {active === "overview" ? (
            <OverviewView value={overview} />
          ) : (
            <SectionView
              active={active}
              data={data}
              extra={extra}
              busy={busy}
              onMutate={mutate}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Login({ onToken }: { onToken: (token: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const data = await api<{ token: string }>("/api/auth/admin/login", "", {
        method: "POST",
        body: JSON.stringify({ password: form.get("password") }),
      });
      onToken(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <section>
        <div className="admin-logo light">
          <b>SZ</b>
          <div>
            <strong>SZRouter</strong>
            <small>ADMIN CONSOLE</small>
          </div>
        </div>
        <div className="login-graphic">
          <div className="rings">
            <i />
            <i />
            <i />
            <b>SZ</b>
          </div>
        </div>
        <div>
          <span>CONTROL PLANE</span>
          <h1>
            平台运营，
            <br />
            尽在掌控。
          </h1>
          <p>统一管理用户、模型路由、企业财务、内容安全与系统运行状态。</p>
        </div>
      </section>
      <form onSubmit={submit}>
        <span>SECURE ACCESS</span>
        <h2>管理员登录</h2>
        <p>使用部署环境中配置的 ADMIN_PASSWORD。</p>
        <label>
          管理员密码
          <input
            name="password"
            type="password"
            placeholder="••••••••••••"
            minLength={8}
            required
            autoFocus
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>{busy ? "验证中…" : "进入控制台 →"}</button>
        <small>建议在生产环境前置 SSO、VPN 或 Zero Trust Access。</small>
      </form>
    </div>
  );
}

function OverviewView({ value }: { value: Overview | null }) {
  const cards: Array<[string, string, string]> = [
    ["users", "用户总数", "Identity"],
    ["requests24h", "24h 请求", "Traffic"],
    ["revenue24h", "24h 用量金额", "Revenue"],
    ["models", "可用模型", "Catalog"],
    ["channels", "活跃渠道", "Routing"],
    ["openAlerts", "未处理告警", "Incidents"],
  ];
  return (
    <>
      {!value ? (
        <div className="empty">暂无指标</div>
      ) : (
        <>
          <div className="metrics">
            {cards.map(([key, label, hint]) => (
              <article key={key}>
                <small>{hint}</small>
                <strong>
                  {key.includes("revenue")
                    ? `$${Number(value.metrics[key] || 0).toFixed(6)}`
                    : fmt(value.metrics[key])}
                </strong>
                <span>{label}</span>
              </article>
            ))}
          </div>
          <div className="overview-grid">
            <article className="panel traffic">
              <div className="panel-head">
                <div>
                  <span>REQUEST VOLUME</span>
                  <h3>平台流量趋势</h3>
                </div>
                <em>Last 24 hours</em>
              </div>
              <div className="bars">
                {[
                  28, 42, 36, 58, 49, 67, 54, 76, 88, 73, 91, 64, 82, 96, 78,
                  90, 72, 85, 61, 79, 93, 86, 98, 83,
                ].map((height, index) => (
                  <i key={index} style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className="axis">
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>NOW</span>
              </div>
            </article>
            <article className="panel health">
              <div className="panel-head">
                <div>
                  <span>SERVICE HEALTH</span>
                  <h3>核心服务</h3>
                </div>
              </div>
              {[
                ["API Gateway", "Operational"],
                ["PostgreSQL + pgvector", "Operational"],
                ["Redis / BullMQ", "Operational"],
                ["Worker Scheduler", "Operational"],
              ].map(([name, status]) => (
                <div className="health-row" key={name}>
                  <i />
                  <strong>{name}</strong>
                  <span>{status}</span>
                </div>
              ))}
            </article>
          </div>
          <article className="panel table-panel">
            <div className="panel-head">
              <div>
                <span>LIVE REQUESTS</span>
                <h3>最近调用</h3>
              </div>
            </div>
            <DataTable rows={value.recent.map(flatten)} />
          </article>
        </>
      )}
    </>
  );
}

function SectionView({
  active,
  data,
  extra,
  busy,
  onMutate,
}: {
  active: string;
  data: Item[];
  extra: Record<string, Item[]>;
  busy: boolean;
  onMutate: (path: string, init: RequestInit) => void;
}) {
  const sections = Object.keys(extra);
  const [tab, setTab] = useState("");
  useEffect(() => setTab(sections[0] || ""), [active, sections.join(",")]);
  const rows = sections.length ? extra[tab] || [] : data;
  return (
    <article className="panel table-panel">
      <div className="panel-head">
        <div>
          <span>{rows.length} RECORDS</span>
          <h3>{titles[active]?.[1]}</h3>
        </div>
        {sections.length > 0 && (
          <div className="tabs">
            {sections.map((name) => (
              <button
                className={tab === name ? "active" : ""}
                onClick={() => setTab(name)}
                key={name}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
      <DataTable
        rows={rows.map(flatten)}
        actions={(row) => {
          const id = String(row.id || "");
          if (active === "users")
            return (
              <button
                className="row-action"
                disabled={busy}
                onClick={() =>
                  onMutate(`/api/admin/users/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      status: row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                    }),
                  })
                }
              >
                {row.status === "ACTIVE" ? "停用" : "启用"}
              </button>
            );
          if (active === "models")
            return (
              <button
                className="row-action"
                disabled={busy}
                onClick={() =>
                  onMutate(`/api/admin/models/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ enabled: !row.enabled }),
                  })
                }
              >
                {row.enabled ? "下线" : "上线"}
              </button>
            );
          if (active === "channels")
            return (
              <button
                className="row-action"
                disabled={busy}
                onClick={() =>
                  onMutate(`/api/admin/channels/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      status: row.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
                    }),
                  })
                }
              >
                {row.status === "ACTIVE" ? "停用" : "启用"}
              </button>
            );
          if (active === "withdrawals" && row.status === "PENDING")
            return (
              <button
                className="row-action"
                disabled={busy}
                onClick={() =>
                  onMutate(`/api/admin/withdrawals/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "APPROVED" }),
                  })
                }
              >
                通过
              </button>
            );
          if (active === "alerts" && row.status !== "RESOLVED")
            return (
              <button
                className="row-action"
                disabled={busy}
                onClick={() =>
                  onMutate(`/api/admin/alerts/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "RESOLVED" }),
                  })
                }
              >
                解决
              </button>
            );
          return null;
        }}
      />
    </article>
  );
}

function DataTable({
  rows,
  actions,
}: {
  rows: Item[];
  actions?: (row: Item) => React.ReactNode;
}) {
  const columns = useMemo(() => {
    const priority = [
      "id",
      "name",
      "email",
      "slug",
      "status",
      "type",
      "amount",
      "cost",
      "model.slug",
      "channel.name",
      "createdAt",
    ];
    const all = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return [
      ...priority.filter((key) => all.includes(key)),
      ...all.filter((key) => !priority.includes(key)),
    ].slice(0, 9);
  }, [rows]);
  if (!rows.length)
    return (
      <div className="empty">
        <span>◇</span>
        <p>暂无数据记录</p>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
            {actions && <th>ACTION</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id || index)}>
              {columns.map((column) => (
                <td
                  key={column}
                  title={
                    typeof row[column] === "string"
                      ? String(row[column])
                      : undefined
                  }
                >
                  {column === "status" ? (
                    <span
                      className={`status ${["ACTIVE", "SUCCESS", "COMPLETED", "DELIVERED", "ISSUED"].includes(String(row[column])) ? "ok" : ""}`}
                    >
                      {fmt(row[column])}
                    </span>
                  ) : column === "id" ? (
                    <code>{fmt(row[column]).slice(0, 12)}</code>
                  ) : (
                    fmt(row[column])
                  )}
                </td>
              ))}
              {actions && <td>{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateAction({
  active,
  busy,
  onMutate,
}: {
  active: string;
  busy: boolean;
  onMutate: (path: string, init: RequestInit) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!["models", "cards", "moderation"].includes(active)) return null;
  function create() {
    if (active === "models")
      onMutate("/api/admin/models", {
        method: "POST",
        body: JSON.stringify({
          slug: name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name,
          provider: "openai-compatible",
          inputPrice: 0.15,
          outputPrice: 0.6,
        }),
      });
    if (active === "cards")
      onMutate("/api/admin/cards", {
        method: "POST",
        body: JSON.stringify({ amount: 10, count: 1 }),
      });
    if (active === "moderation")
      onMutate("/api/admin/moderation/rules", {
        method: "POST",
        body: JSON.stringify({
          name: `Block ${name}`,
          pattern: name,
          type: "KEYWORD",
          action: "BLOCK",
        }),
      });
    setOpen(false);
  }
  return (
    <div className="create">
      <button className="accent" onClick={() => setOpen(!open)}>
        ＋ 新建
      </button>
      {open && (
        <div className="popover">
          <strong>
            {active === "cards"
              ? "生成 $10 卡密"
              : active === "models"
                ? "添加模型"
                : "添加拦截关键词"}
          </strong>
          {active !== "cards" && (
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={active === "models" ? "Model name" : "Keyword"}
            />
          )}
          <button
            disabled={busy || (active !== "cards" && !name)}
            onClick={create}
          >
            确认创建
          </button>
        </div>
      )}
    </div>
  );
}
