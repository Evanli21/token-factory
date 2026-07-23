"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

type Model = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  contextWindow: number;
  inputPrice: string;
  outputPrice: string;
  embeddingPrice: string;
  capabilities?: string[];
};
type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  lastUsedAt?: string;
  createdAt: string;
};
type Knowledge = {
  id: string;
  name: string;
  description?: string;
  status: string;
  _count: { documents: number };
};
type Agent = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  modelSlug: string;
  pricePerRun: string;
};
type Workflow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  updatedAt: string;
};
type ExportTask = {
  id: string;
  type: string;
  format: string;
  status: string;
  progress: number;
  fileUrl?: string;
  createdAt: string;
};
type Organization = {
  id: string;
  name: string;
  slug: string;
  wallet?: { balance: string; frozen: string };
  _count: { members: number };
};
type Me = {
  id: string;
  email: string;
  name?: string;
  wallet: { balance: string; frozen: string; currency: string };
};

const navigation = [
  ["overview", "总览", "⌂"],
  ["keys", "API Key", "⌁"],
  ["recharge", "余额充值", "＋"],
  ["models", "模型广场", "◇"],
  ["pricing", "价格中心", "＄"],
  ["playground", "Playground", "▷"],
  ["knowledge", "知识库", "▤"],
  ["agents", "Agent 市场", "✦"],
  ["workflows", "Workflow", "⌘"],
  ["tenant", "租户控制台", "◎"],
  ["exports", "导出中心", "⇩"],
] as const;

async function request<T>(
  path: string,
  token: string,
  init: RequestInit = {},
  apiKey?: string,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey || token}`,
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

function money(value: string | number | undefined) {
  return `$${Number(value || 0).toFixed(6)}`;
}

function date(value?: string) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
}

export default function Home() {
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(true);
  const [active, setActive] = useState("overview");
  const [me, setMe] = useState<Me | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; description?: string }>
  >([]);
  const [exports, setExports] = useState<ExportTask[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [orders, setOrders] = useState<
    Array<{
      id: string;
      orderNo: string;
      amount: string;
      status: string;
      createdAt: string;
    }>
  >([]);
  const [latestKey, setLatestKey] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  async function load(session: string) {
    try {
      const [
        profile,
        keyData,
        modelData,
        kbData,
        agentData,
        workflowData,
        exportData,
        orgData,
        orderData,
      ] = await Promise.all([
        request<Me>("/api/me", session),
        request<{ data: ApiKey[] }>("/api/api-keys", session),
        request<{ data: Model[] }>("/api/models", session),
        request<{ data: Knowledge[] }>("/api/knowledge-bases", session),
        request<{ data: Agent[] }>("/api/agent-apps", session),
        request<{
          data: Workflow[];
          templates: Array<{ id: string; name: string; description?: string }>;
        }>("/api/workflows", session),
        request<{ data: ExportTask[] }>("/api/exports", session),
        request<{ data: Organization[] }>("/api/organizations", session),
        request<{ data: typeof orders }>("/api/orders", session),
      ]);
      setMe(profile);
      setKeys(keyData.data);
      setModels(modelData.data);
      setKnowledge(kbData.data);
      setAgents(agentData.data);
      setWorkflows(workflowData.data);
      setTemplates(workflowData.templates);
      setExports(exportData.data);
      setOrganizations(orgData.data);
      setOrders(orderData.data);
    } catch {
      localStorage.removeItem("tf_token");
      setToken("");
      setMe(null);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem("tf_token") || "";
    setToken(saved);
    if (saved) void load(saved);
    else setChecking(false);
  }, []);

  function toast(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4200);
  }

  async function act(action: () => Promise<void>) {
    setLoading(true);
    try {
      await action();
    } catch (error) {
      toast(error instanceof Error ? error.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem("tf_token");
    setToken("");
    setMe(null);
  }

  if (checking)
    return (
      <div className="splash">
        <div className="brand-mark">SZ</div>
        <span>Loading your workspace…</span>
      </div>
    );
  if (!token || !me)
    return (
      <Auth
        onAuthenticated={(session) => {
          localStorage.setItem("tf_token", session);
          setToken(session);
          setChecking(true);
          void load(session);
        }}
      />
    );

  const title = navigation.find(([id]) => id === active)?.[1] || "控制台";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="logo">
          <div className="brand-mark">SZ</div>
          <div>
            <strong>SZRouter</strong>
            <small>AI Infrastructure</small>
          </div>
        </div>
        <nav>
          {navigation.map(([id, label, icon]) => (
            <button
              key={id}
              className={active === id ? "active" : ""}
              onClick={() => {
                setActive(id);
                setMobileNav(false);
              }}
            >
              <span>{icon}</span>
              {label}
              {id === "playground" && <em>LIVE</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="status-dot" /> All systems operational
        </div>
      </aside>
      <main>
        <header>
          <button className="menu" onClick={() => setMobileNav(!mobileNav)}>
            ☰
          </button>
          <div>
            <span className="eyebrow">WORKSPACE / {active.toUpperCase()}</span>
            <h1>{title}</h1>
          </div>
          <div className="header-actions">
            <button className="icon-button" aria-label="notifications">
              ♢
            </button>
            <div className="avatar">
              {(me.name || me.email).slice(0, 1).toUpperCase()}
            </div>
            <div className="identity">
              <strong>{me.name || "Developer"}</strong>
              <small>{me.email}</small>
            </div>
            <button className="link-button" onClick={logout}>
              退出
            </button>
          </div>
        </header>
        <div className="content">
          {active === "overview" && (
            <Overview
              me={me}
              keys={keys}
              models={models}
              knowledge={knowledge}
              onNavigate={setActive}
            />
          )}
          {active === "keys" && (
            <Keys
              keys={keys}
              latestKey={latestKey}
              loading={loading}
              onCreate={(name) =>
                act(async () => {
                  const result = await request<{ key: string }>(
                    "/api/api-keys",
                    token,
                    { method: "POST", body: JSON.stringify({ name }) },
                  );
                  setLatestKey(result.key);
                  await load(token);
                  toast("API Key 已创建，请立即复制");
                })
              }
              onDelete={(id) =>
                act(async () => {
                  await request(`/api/api-keys/${id}`, token, {
                    method: "DELETE",
                  });
                  await load(token);
                })
              }
            />
          )}
          {active === "recharge" && (
            <Recharge
              balance={me.wallet.balance}
              orders={orders}
              loading={loading}
              onCreate={(amount) =>
                act(async () => {
                  await request("/api/orders", token, {
                    method: "POST",
                    body: JSON.stringify({ amount }),
                  });
                  await load(token);
                  toast("充值订单已创建，接入支付服务后可完成支付");
                })
              }
              onRedeem={(code) =>
                act(async () => {
                  await request("/api/cards/redeem", token, {
                    method: "POST",
                    body: JSON.stringify({ code }),
                  });
                  await load(token);
                  toast("卡密兑换成功");
                })
              }
            />
          )}
          {active === "models" && <Models models={models} />}
          {active === "pricing" && <Pricing models={models} />}
          {active === "playground" && (
            <Playground
              models={models.filter(
                (model) => !model.capabilities?.includes("embedding"),
              )}
              apiKey={latestKey}
            />
          )}
          {active === "knowledge" && (
            <KnowledgePanel
              items={knowledge}
              apiKey={latestKey}
              loading={loading}
              onCreate={(name, description) =>
                act(async () => {
                  await request("/api/knowledge-bases", token, {
                    method: "POST",
                    body: JSON.stringify({ name, description }),
                  });
                  await load(token);
                  toast("知识库已创建");
                })
              }
              onUpload={(id, file) =>
                act(async () => {
                  const form = new FormData();
                  form.append("file", file);
                  const response = await fetch(
                    `${API}/api/knowledge-bases/${id}/documents`,
                    {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}` },
                      body: form,
                    },
                  );
                  const data = await response.json();
                  if (!response.ok)
                    throw new Error(data?.error?.message || "上传失败");
                  await load(token);
                  toast("文档已进入解析队列");
                })
              }
            />
          )}
          {active === "agents" && <Agents items={agents} />}
          {active === "workflows" && (
            <Workflows
              items={workflows}
              templates={templates}
              loading={loading}
              onCreate={(name) =>
                act(async () => {
                  const slug = `${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString().slice(-5)}`;
                  await request("/api/workflows", token, {
                    method: "POST",
                    body: JSON.stringify({
                      name,
                      slug,
                      definition: {
                        nodes: [
                          {
                            id: "draft",
                            type: "llm",
                            prompt: "Create a concise draft for: {{input}}",
                          },
                          {
                            id: "polish",
                            type: "llm",
                            prompt: "Polish this response: {{previous}}",
                          },
                        ],
                      },
                    }),
                  });
                  await load(token);
                  toast("Workflow 已创建");
                })
              }
            />
          )}
          {active === "tenant" && (
            <Tenant
              items={organizations}
              loading={loading}
              onCreate={(name, slug) =>
                act(async () => {
                  await request("/api/organizations", token, {
                    method: "POST",
                    body: JSON.stringify({ name, slug }),
                  });
                  await load(token);
                  toast("组织已创建");
                })
              }
            />
          )}
          {active === "exports" && (
            <Exports
              items={exports}
              loading={loading}
              onCreate={(type, format) =>
                act(async () => {
                  await request("/api/exports", token, {
                    method: "POST",
                    body: JSON.stringify({ type, format }),
                  });
                  await load(token);
                  toast("导出任务已提交");
                })
              }
            />
          )}
        </div>
      </main>
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function Auth({
  onAuthenticated,
}: {
  onAuthenticated: (token: string) => void;
}) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch(
        `${API}/api/auth/${register ? "register" : "login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.get("name") || undefined,
            email: form.get("email"),
            password: form.get("password"),
          }),
        },
      );
      const data = await result.json();
      if (!result.ok)
        throw new Error(data?.error?.message || "Authentication failed");
      onAuthenticated(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <div className="logo light">
          <div className="brand-mark">SZ</div>
          <div>
            <strong>SZRouter</strong>
            <small>AI Infrastructure</small>
          </div>
        </div>
        <div>
          <span className="eyebrow">BUILD ONCE. SCALE EVERYWHERE.</span>
          <h1>
            一站式 AI
            <br />
            <i>能力工厂</i>
          </h1>
          <p>
            统一接入模型、知识库、Agent 与 Workflow。一个
            API，覆盖从原型到生产的完整路径。
          </p>
          <div className="proof">
            <span>
              99.99%<small>API Uptime</small>
            </span>
            <span>
              1536D<small>Vector Search</small>
            </span>
            <span>
              SSE<small>Native Streaming</small>
            </span>
          </div>
        </div>
        <footer>Secure by design · Tenant aware · Observable</footer>
      </section>
      <section className="auth-form">
        <form onSubmit={submit}>
          <span className="eyebrow">WELCOME TO SZROUTER</span>
          <h2>{register ? "创建开发者账户" : "登录控制台"}</h2>
          <p>
            {register
              ? "注册后将获得 $5 演示额度。"
              : "管理你的 AI 基础设施与用量。"}
          </p>
          {register && (
            <label>
              显示名称
              <input name="name" placeholder="Evan" required />
            </label>
          )}
          <label>
            邮箱
            <input name="email" type="email" required />
          </label>
          <label>
            密码
            <input name="password" type="password" minLength={8} required />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary wide" disabled={busy}>
            {busy ? "请稍候…" : register ? "注册并进入" : "登录"}
          </button>
          <div className="switch">
            {register ? "已有账户？" : "还没有账户？"}{" "}
            <button type="button" onClick={() => setRegister(!register)}>
              {register ? "立即登录" : "免费注册"}
            </button>
          </div>
          <div className="demo-note">首次使用请先免费注册账户。</div>
        </form>
      </section>
    </div>
  );
}

function PageHead({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty">
      <span>◇</span>
      <p>{children}</p>
    </div>
  );
}

function Overview({
  me,
  keys,
  models,
  knowledge,
  onNavigate,
}: {
  me: Me;
  keys: ApiKey[];
  models: Model[];
  knowledge: Knowledge[];
  onNavigate: (id: string) => void;
}) {
  const metrics = [
    {
      label: "可用余额",
      value: money(me.wallet.balance),
      hint: `冻结 ${money(me.wallet.frozen)}`,
      tone: "lime",
    },
    {
      label: "API Keys",
      value: keys.filter((key) => key.status === "ACTIVE").length,
      hint: "活跃凭据",
      tone: "violet",
    },
    {
      label: "可用模型",
      value: models.length,
      hint: "统一 OpenAI 协议",
      tone: "blue",
    },
    {
      label: "知识库",
      value: knowledge.length,
      hint: `${knowledge.reduce((sum, item) => sum + item._count.documents, 0)} 份文档`,
      tone: "orange",
    },
  ];
  return (
    <>
      <div className="hero-card">
        <div>
          <span className="eyebrow">SZROUTER CLOUD</span>
          <h2>晚上好，{me.name || "Developer"}。</h2>
          <p>
            你的 AI 工作空间已就绪。从创建 API Key 开始，或直接在 Playground
            里测试第一个请求。
          </p>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => onNavigate("playground")}
            >
              打开 Playground →
            </button>
            <button className="secondary" onClick={() => onNavigate("keys")}>
              管理 API Key
            </button>
          </div>
        </div>
        <div className="hero-orbit">
          <span>LLM</span>
          <span>RAG</span>
          <span>AGENT</span>
          <b>SZ</b>
        </div>
      </div>
      <div className="metric-grid">
        {metrics.map((item) => (
          <article className={`metric ${item.tone}`} key={item.label}>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
            <span>{item.hint}</span>
          </article>
        ))}
      </div>
      <div className="two-column">
        <article className="panel">
          <PageHead eyebrow="QUICK START" title="三步发出第一个请求" />
          <ol className="steps">
            <li>
              <b>01</b>
              <div>
                <strong>创建 API Key</strong>
                <p>凭据仅在创建时完整显示。</p>
              </div>
              <button onClick={() => onNavigate("keys")}>开始</button>
            </li>
            <li>
              <b>02</b>
              <div>
                <strong>选择模型</strong>
                <p>从模型广场查看上下文与定价。</p>
              </div>
              <button onClick={() => onNavigate("models")}>浏览</button>
            </li>
            <li>
              <b>03</b>
              <div>
                <strong>调用 OpenAI Compatible API</strong>
                <p>现有 SDK 只需替换 base URL。</p>
              </div>
              <button onClick={() => onNavigate("playground")}>测试</button>
            </li>
          </ol>
        </article>
        <article className="panel terminal">
          <div className="terminal-top">
            <span />
            <span />
            <span />
            <small>quickstart.sh</small>
          </div>
          <pre>
            <code>
              <i># OpenAI Compatible API</i>
              {"\n"}curl {API}/v1/chat/completions \\{"\n"} -H{" "}
              <b>&quot;Authorization: Bearer tf_...&quot;</b> \\{"\n"} -H
              &quot;Content-Type: application/json&quot; \\{"\n"} -d {"'"}
              {"{"}
              {"\n"} &quot;model&quot;: &quot;gpt-4o-mini&quot;,{"\n"}{" "}
              &quot;messages&quot;: [{"{"}&quot;role&quot;:&quot;user&quot;,
              {"\n"} &quot;content&quot;:&quot;Hello SZRouter&quot;{"}"}]{"\n"}{" "}
              {"}"}
              {"'"}
            </code>
          </pre>
        </article>
      </div>
    </>
  );
}

function Keys({
  keys,
  latestKey,
  loading,
  onCreate,
  onDelete,
}: {
  keys: ApiKey[];
  latestKey: string;
  loading: boolean;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("Development");
  return (
    <>
      <PageHead
        eyebrow="DEVELOPER ACCESS"
        title="API Key 管理"
        action={
          <div className="inline-form">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Key name"
            />
            <button
              className="primary"
              disabled={loading}
              onClick={() => onCreate(name)}
            >
              ＋ 创建 Key
            </button>
          </div>
        }
      />
      {latestKey && (
        <div className="secret-reveal">
          <div>
            <strong>新 Key（仅显示一次）</strong>
            <code>{latestKey}</code>
          </div>
          <button onClick={() => navigator.clipboard.writeText(latestKey)}>
            复制
          </button>
        </div>
      )}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>前缀</th>
              <th>状态</th>
              <th>最后调用</th>
              <th>创建时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>
                  <strong>{key.name}</strong>
                </td>
                <td>
                  <code>{key.keyPrefix}••••</code>
                </td>
                <td>
                  <span className="pill good">{key.status}</span>
                </td>
                <td>{date(key.lastUsedAt)}</td>
                <td>{date(key.createdAt)}</td>
                <td>
                  <button
                    className="danger-link"
                    onClick={() => onDelete(key.id)}
                  >
                    吊销
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!keys.length && <Empty>还没有 API Key。</Empty>}
      </div>
    </>
  );
}

function Recharge({
  balance,
  orders,
  loading,
  onCreate,
  onRedeem,
}: {
  balance: string;
  orders: Array<{
    id: string;
    orderNo: string;
    amount: string;
    status: string;
    createdAt: string;
  }>;
  loading: boolean;
  onCreate: (amount: number) => void;
  onRedeem: (code: string) => void;
}) {
  const [amount, setAmount] = useState(20);
  const [code, setCode] = useState("");
  return (
    <>
      <div className="balance-banner">
        <span>账户可用余额</span>
        <strong>{money(balance)}</strong>
        <small>USD · 按实际 Token 用量结算</small>
      </div>
      <div className="two-column">
        <article className="panel form-card">
          <PageHead eyebrow="TOP UP" title="创建充值订单" />
          <div className="amounts">
            {[10, 20, 50, 100].map((item) => (
              <button
                className={amount === item ? "selected" : ""}
                key={item}
                onClick={() => setAmount(item)}
              >
                ${item}
              </button>
            ))}
          </div>
          <button
            className="primary wide"
            disabled={loading}
            onClick={() => onCreate(amount)}
          >
            充值 ${amount}
          </button>
          <p className="muted">
            此项目已预留支付服务与 Webhook
            流程。正式收款前请在服务端接入支付渠道。
          </p>
        </article>
        <article className="panel form-card">
          <PageHead eyebrow="PREPAID CARD" title="兑换卡密" />
          <label>
            卡密
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="TF-XXXXXXXXXXXXXXXXXXXX"
            />
          </label>
          <button
            className="secondary wide"
            disabled={loading || !code}
            onClick={() => onRedeem(code)}
          >
            立即兑换
          </button>
        </article>
      </div>
      <div className="panel table-wrap">
        <PageHead eyebrow="HISTORY" title="充值订单" />
        <table>
          <thead>
            <tr>
              <th>订单号</th>
              <th>金额</th>
              <th>状态</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <code>{order.orderNo}</code>
                </td>
                <td>{money(order.amount)}</td>
                <td>
                  <span className="pill">{order.status}</span>
                </td>
                <td>{date(order.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!orders.length && <Empty>暂无充值订单。</Empty>}
      </div>
    </>
  );
}

function Models({ models }: { models: Model[] }) {
  return (
    <>
      <PageHead eyebrow="MODEL CATALOG" title="模型广场" />
      <div className="card-grid">
        {models.map((model) => (
          <article className="model-card" key={model.id}>
            <div className="model-icon">
              {model.capabilities?.includes("embedding") ? "↗" : "AI"}
            </div>
            <div>
              <span className="pill">
                {model.capabilities?.includes("embedding")
                  ? "EMBEDDING"
                  : "CHAT"}
              </span>
              <h3>{model.name}</h3>
              <code>{model.slug}</code>
              <p>{model.description || "OpenAI Compatible model endpoint."}</p>
              <div className="model-meta">
                <span>
                  <small>上下文</small>
                  {model.contextWindow.toLocaleString()}
                </span>
                <span>
                  <small>输入 / 1M</small>
                  {money(model.inputPrice)}
                </span>
                <span>
                  <small>输出 / 1M</small>
                  {money(model.outputPrice)}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function Pricing({ models }: { models: Model[] }) {
  return (
    <>
      <PageHead eyebrow="TRANSPARENT PRICING" title="按实际用量付费" />
      <div className="pricing-intro">
        <h3>没有订阅，没有最低消费。</h3>
        <p>
          所有价格均为美元。聊天模型按每百万 Token 计费；工具调用与 Agent
          应用费会单独记录。
        </p>
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>模型</th>
              <th>输入 / 1M Token</th>
              <th>输出 / 1M Token</th>
              <th>Embedding / 1M</th>
              <th>上下文</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.id}>
                <td>
                  <strong>{model.name}</strong>
                  <br />
                  <code>{model.slug}</code>
                </td>
                <td>{money(model.inputPrice)}</td>
                <td>{money(model.outputPrice)}</td>
                <td>{money(model.embeddingPrice)}</td>
                <td>{model.contextWindow.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Playground({ models, apiKey }: { models: Model[]; apiKey: string }) {
  const [key, setKey] = useState(apiKey);
  const [model, setModel] = useState(models[0]?.slug || "gpt-4o-mini");
  const [prompt, setPrompt] = useState("用三句话介绍 SZRouter。");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (apiKey) setKey(apiKey);
  }, [apiKey]);
  async function run() {
    setBusy(true);
    setOutput("");
    setError("");
    try {
      const response = await fetch(`${API}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json();
        throw new Error(data?.error?.message || "调用失败");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        const events = pending.split("\n\n");
        pending = events.pop() || "";
        for (const event of events) {
          const value = event.replace(/^data:\s*/, "");
          if (!value || value === "[DONE]") continue;
          const data = JSON.parse(value);
          const delta = data.choices?.[0]?.delta?.content;
          if (delta) setOutput((current) => current + delta);
          if (data.error) throw new Error(data.error.message);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "调用失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="LIVE API CONSOLE"
        title="Playground"
        action={
          <button className="primary" disabled={busy || !key} onClick={run}>
            {busy ? "生成中…" : "▷ 运行"}
          </button>
        }
      />
      <div className="playground">
        <section className="panel controls">
          <label>
            API Key
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="先在 API Key 页面创建并粘贴"
            />
          </label>
          <label>
            模型
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              {models.map((item) => (
                <option key={item.id} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            用户消息
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={9}
            />
          </label>
          <small>响应将通过 Server-Sent Events 实时返回。</small>
        </section>
        <section className="panel response">
          <div className="response-head">
            <span>ASSISTANT</span>
            <i className={busy ? "pulse" : ""} />
          </div>
          {error ? (
            <div className="error">{error}</div>
          ) : output ? (
            <div className="answer">{output}</div>
          ) : (
            <Empty>运行请求后，流式响应会显示在这里。</Empty>
          )}
        </section>
      </div>
    </>
  );
}

function KnowledgePanel({
  items,
  apiKey,
  loading,
  onCreate,
  onUpload,
}: {
  items: Knowledge[];
  apiKey: string;
  loading: boolean;
  onCreate: (name: string, description: string) => void;
  onUpload: (id: string, file: File) => void;
}) {
  const [name, setName] = useState("产品文档");
  const [description, setDescription] = useState("面向客户的产品资料");
  const [selected, setSelected] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const kbId = selected || items[0]?.id || "";
  async function ask() {
    setAsking(true);
    setAnswer("");
    try {
      const data = await request<{
        answer: string;
        citations: Array<{ document_name: string; score: number }>;
      }>(
        `/v1/knowledge/${kbId}/ask`,
        "",
        { method: "POST", body: JSON.stringify({ question }) },
        apiKey,
      );
      setAnswer(
        `${data.answer}\n\n${data.citations.map((item, index) => `[${index + 1}] ${item.document_name} · ${(item.score * 100).toFixed(0)}%`).join("\n")}`,
      );
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : "问答失败");
    } finally {
      setAsking(false);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="RETRIEVAL AUGMENTED GENERATION"
        title="知识库"
        action={
          <div className="inline-form">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              className="primary"
              disabled={loading}
              onClick={() => onCreate(name, description)}
            >
              ＋ 新建
            </button>
          </div>
        }
      />
      <div className="card-grid knowledge-grid">
        {items.map((item) => (
          <article
            className={`kb-card ${kbId === item.id ? "selected-card" : ""}`}
            key={item.id}
            onClick={() => setSelected(item.id)}
          >
            <div className="kb-icon">▤</div>
            <span className="pill good">{item.status}</span>
            <h3>{item.name}</h3>
            <p>{item.description || "暂无描述"}</p>
            <div className="kb-foot">
              <span>{item._count.documents} 份文档</span>
              <label className="upload">
                上传
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUpload(item.id, file);
                  }}
                />
              </label>
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <div className="panel form-card">
          <p>还没有知识库。填写名称后点击“新建”。</p>
          <label>
            描述
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
      )}
      {items.length > 0 && (
        <div className="panel ask-box">
          <PageHead eyebrow="HYBRID SEARCH + RERANK" title="知识库问答" />
          <div className="ask-row">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="针对已上传并处理完成的文档提问…"
            />
            <button
              className="primary"
              disabled={!apiKey || !question || asking}
              onClick={ask}
            >
              {asking ? "检索中…" : "提问"}
            </button>
          </div>
          {answer && <pre className="rag-answer">{answer}</pre>}{" "}
          {!apiKey && <p className="muted">请先创建 API Key，再进行问答。</p>}
        </div>
      )}
    </>
  );
}

function Agents({ items }: { items: Agent[] }) {
  return (
    <>
      <PageHead eyebrow="AGENT APPLICATIONS" title="Agent 应用市场" />
      <div className="card-grid">
        {items.map((item, index) => (
          <article className="agent-card" key={item.id}>
            <div className={`agent-art art-${index % 3}`}>
              <span>✦</span>
            </div>
            <div>
              <span className="pill">PUBLIC</span>
              <h3>{item.name}</h3>
              <p>{item.description || "Composable agent application."}</p>
              <div className="agent-foot">
                <code>{item.modelSlug}</code>
                <strong>{money(item.pricePerRun)} / run</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!items.length && <Empty>暂无公开 Agent 应用。</Empty>}
    </>
  );
}

function Workflows({
  items,
  templates,
  loading,
  onCreate,
}: {
  items: Workflow[];
  templates: Array<{ id: string; name: string; description?: string }>;
  loading: boolean;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("内容加工流水线");
  return (
    <>
      <PageHead
        eyebrow="VISUAL ORCHESTRATION"
        title="Workflow 编排"
        action={
          <div className="inline-form">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              className="primary"
              disabled={loading}
              onClick={() => onCreate(name)}
            >
              ＋ 创建
            </button>
          </div>
        }
      />
      <div className="workflow-canvas">
        <div className="flow-node">
          <small>INPUT</small>
          <strong>用户输入</strong>
        </div>
        <i>→</i>
        <div className="flow-node active-node">
          <small>LLM</small>
          <strong>生成草稿</strong>
        </div>
        <i>→</i>
        <div className="flow-node">
          <small>LLM</small>
          <strong>润色输出</strong>
        </div>
      </div>
      <div className="two-column">
        <article className="panel">
          <PageHead eyebrow="MY WORKFLOWS" title="已创建" />
          {items.map((item) => (
            <div className="list-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <code>{item.slug}</code>
              </div>
              <span className="pill">{item.status}</span>
            </div>
          ))}
          {!items.length && <Empty>暂无 Workflow。</Empty>}
        </article>
        <article className="panel">
          <PageHead eyebrow="TEMPLATES" title="推荐模板" />
          {templates.map((item) => (
            <div className="list-row" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <p>{item.description}</p>
              </div>
              <span>→</span>
            </div>
          ))}
        </article>
      </div>
    </>
  );
}

function Tenant({
  items,
  loading,
  onCreate,
}: {
  items: Organization[];
  loading: boolean;
  onCreate: (name: string, slug: string) => void;
}) {
  const [name, setName] = useState("My Organization");
  const slug = useMemo(
    () =>
      name
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    [name],
  );
  return (
    <>
      <PageHead
        eyebrow="MULTI-TENANT CONTROL"
        title="租户控制台"
        action={
          <div className="inline-form">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              className="primary"
              disabled={loading || slug.length < 2}
              onClick={() => onCreate(name, slug)}
            >
              ＋ 创建组织
            </button>
          </div>
        }
      />
      <div className="card-grid">
        {items.map((item) => (
          <article className="org-card" key={item.id}>
            <div className="org-monogram">
              {item.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h3>{item.name}</h3>
              <code>{item.slug}</code>
            </div>
            <div className="org-stats">
              <span>
                <small>组织余额</small>
                {money(item.wallet?.balance)}
              </span>
              <span>
                <small>成员</small>
                {item._count.members}
              </span>
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <Empty>创建组织后即可使用组织余额、月度额度与成员管理。</Empty>
      )}
    </>
  );
}

function Exports({
  items,
  loading,
  onCreate,
}: {
  items: ExportTask[];
  loading: boolean;
  onCreate: (type: string, format: string) => void;
}) {
  const [type, setType] = useState("USAGE");
  const [format, setFormat] = useState("CSV");
  return (
    <>
      <PageHead
        eyebrow="DATA PORTABILITY"
        title="导出中心"
        action={
          <div className="inline-form">
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option>USAGE</option>
              <option>TRANSACTIONS</option>
              <option>ORDERS</option>
            </select>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value)}
            >
              <option>CSV</option>
              <option>JSON</option>
            </select>
            <button
              className="primary"
              disabled={loading}
              onClick={() => onCreate(type, format)}
            >
              创建导出
            </button>
          </div>
        }
      />
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>格式</th>
              <th>状态</th>
              <th>进度</th>
              <th>创建时间</th>
              <th>文件</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.type}</strong>
                </td>
                <td>{item.format}</td>
                <td>
                  <span
                    className={`pill ${item.status === "COMPLETED" ? "good" : ""}`}
                  >
                    {item.status}
                  </span>
                </td>
                <td>
                  <div className="progress">
                    <i style={{ width: `${item.progress}%` }} />
                  </div>
                </td>
                <td>{date(item.createdAt)}</td>
                <td>{item.fileUrl ? <span>已生成</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty>暂无导出任务。</Empty>}
      </div>
    </>
  );
}
