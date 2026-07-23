"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

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
  inputCost?: string;
  outputCost?: string;
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
  userId?: string;
  slug: string;
  name: string;
  description?: string;
  modelSlug: string;
  pricePerRun: string;
  visibility?: string;
  status?: string;
};
type Workflow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  description?: string;
  definition?: { nodes?: Array<Record<string, unknown>> };
  version?: number;
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

const sectionRoutes: Record<string, string> = {
  overview: "/console",
  keys: "/console/api-keys",
  recharge: "/console/recharge",
  models: "/models",
  pricing: "/pricing",
  playground: "/playground",
  knowledge: "/console/knowledge",
  agents: "/apps",
  workflows: "/workflows",
  tenant: "/tenant",
  exports: "/exports",
};

function sectionFromPath(pathname: string) {
  if (pathname.startsWith("/console/api-keys")) return "keys";
  if (pathname.startsWith("/console/recharge")) return "recharge";
  if (pathname.startsWith("/console/knowledge")) return "knowledge";
  if (pathname.startsWith("/console/organizations")) return "tenant";
  if (pathname.startsWith("/tenant")) return "tenant";
  if (pathname.startsWith("/playground")) return "playground";
  if (pathname.startsWith("/pricing")) return "pricing";
  if (pathname.startsWith("/models")) return "models";
  if (pathname.startsWith("/apps")) return "agents";
  if (pathname.startsWith("/templates") || pathname.startsWith("/workflows")) return "workflows";
  if (pathname.startsWith("/exports")) return "exports";
  return "overview";
}

async function request<T>(
  path: string,
  token: string,
  init: RequestInit = {},
  apiKey?: string,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
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
  const pathname = usePathname();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(true);
  const [active, setActive] = useState(() => sectionFromPath(pathname));
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
  const [transactions, setTransactions] = useState<Array<{ id: string; type: string; amount: string; balance: string; description?: string; createdAt: string }>>([]);
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
        transactionData,
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
        request<{ data: typeof transactions }>("/api/transactions", session),
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
      setTransactions(transactionData.data);
    } catch {
      localStorage.removeItem("szrouter_token");
      localStorage.removeItem("tf_token");
      setToken("");
      setMe(null);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem("szrouter_token") || localStorage.getItem("tf_token") || "";
    setToken(saved);
    if (saved) void load(saved);
    else setChecking(false);
  }, []);

  useEffect(() => {
    setActive(sectionFromPath(pathname));
  }, [pathname]);

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

  function navigate(section: string) {
    setActive(section);
    setMobileNav(false);
    router.push(sectionRoutes[section] || "/console");
  }

  function logout() {
    void fetch(`${API}/api/auth/logout`, { method: "POST", credentials: "include" });
    localStorage.removeItem("szrouter_token");
    localStorage.removeItem("tf_token");
    setToken("");
    setMe(null);
    router.push("/login");
  }

  if (pathname === "/") return <Landing />;

  if (checking)
    return (
      <div className="splash">
        <div className="brand-mark">SZ</div>
        <span>Loading your workspace…</span>
      </div>
    );
  if (!token || !me) {
    if (["/models", "/pricing", "/apps", "/templates"].includes(pathname) || pathname.startsWith("/apps/"))
      return <PublicCatalog pathname={pathname} />;
    if (pathname.startsWith("/workflows/")) return <PublicWorkflow id={pathname.split("/").filter(Boolean)[1] || ""} />;
    return (
      <Auth
        initialRegister={pathname === "/register"}
        onModeChange={(register) => router.push(register ? "/register" : "/login")}
        onAuthenticated={(session) => {
          localStorage.setItem("szrouter_token", session);
          setToken(session);
          setChecking(true);
          router.push("/console");
          void load(session);
        }}
      />
    );
  }

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
                navigate(id);
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
              onNavigate={navigate}
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
              onStatus={(id, status) =>
                act(async () => {
                  await request(`/api/api-keys/${id}`, token, { method: "PATCH", body: JSON.stringify({ status }) });
                  await load(token);
                })
              }
            />
          )}
          {active === "recharge" && (
            <Recharge
              balance={me.wallet.balance}
              orders={orders}
              transactions={transactions}
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
              token={token}
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
          {active === "agents" && <Agents items={agents} token={token} apiKey={latestKey} loading={loading} onRefresh={() => void load(token)} />}
          {active === "workflows" && (
            <Workflows
              items={workflows}
              templates={templates}
              token={token}
              apiKey={latestKey}
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
                            id: "quality-gate",
                            type: "condition",
                            condition: "{{previous.length}} > 100",
                            onTrue: "polish",
                            onFalse: "finish",
                          },
                          {
                            id: "polish",
                            type: "llm",
                            prompt: "Polish this response: {{previous}}",
                          },
                          { id: "finish", type: "output" },
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
              token={token}
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
              token={token}
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

function Landing() {
  const capabilities = [
    ["◇", "模型广场", "统一查看可用模型、上下文窗口和实时价格。", "/models"],
    ["＄", "价格中心", "透明展示输入、输出与向量价格。", "/pricing"],
    ["▷", "Playground", "使用自己的 API Key 调试流式对话。", "/playground"],
    ["✦", "Agent 市场", "创建、发布并在线体验智能应用。", "/apps"],
    ["⌘", "Workflow", "编排节点、条件分支并发布工作流。", "/workflows"],
    ["▤", "知识库", "上传文档、生成向量并返回可核验引用。", "/console/knowledge"],
  ];
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-logo" href="/">
          <span className="brand-mark">SZ</span>
          <strong>SZRouter</strong>
        </a>
        <nav>
          <a href="/models">模型</a>
          <a href="/pricing">价格</a>
          <a href="/apps">应用</a>
          <a href="/templates">模板</a>
        </nav>
        <div>
          <a className="landing-link" href="/login">登录</a>
          <a className="primary landing-cta" href="/register">免费开始</a>
        </div>
      </header>
      <main className="landing-main">
        <section className="landing-hero">
          <div>
            <span className="eyebrow">AI INFRASTRUCTURE FOR BUILDERS</span>
            <h1>一个入口，连接你的全部 AI 能力。</h1>
            <p>SZRouter 将模型路由、知识库、Agent、Workflow、计费与多租户管理组合成可直接上线的 AI 平台。</p>
            <div className="button-row">
              <a className="primary" href="/register">创建开发者账户</a>
              <a className="secondary" href="/models">浏览模型广场</a>
            </div>
          </div>
          <div className="landing-terminal">
            <small>POST /v1/chat/completions</small>
            <pre>{`curl https://api.szrouter.shop/v1/chat/completions \\
  -H "Authorization: Bearer sz_••••" \\
  -d '{"model":"gpt-4o-mini","stream":true}'`}</pre>
            <span>● Gateway online</span>
          </div>
        </section>
        <section className="landing-grid">
          {capabilities.map(([icon, title, copy, href]) => (
            <a href={href} key={title}>
              <span>{icon}</span>
              <h2>{title}</h2>
              <p>{copy}</p>
              <strong>打开 →</strong>
            </a>
          ))}
        </section>
      </main>
      <footer className="landing-footer">© {new Date().getFullYear()} SZRouter · OpenAI-compatible · Tenant-aware · Observable</footer>
    </div>
  );
}

function PublicCatalog({ pathname }: { pathname: string }) {
  const [data, setData] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const endpoint = pathname.startsWith("/apps/") ? `/api/public/agent-apps/${encodeURIComponent(pathname.split("/").filter(Boolean)[1] || "")}` : pathname === "/apps" ? "/api/public/agent-apps" : pathname === "/templates" ? "/api/public/workflow-templates" : "/api/public/models";
  useEffect(() => {
    setLoading(true);
    fetch(`${API}${endpoint}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message || "加载失败");
        setData(body.data || []);
        setError("");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [endpoint]);
  return (
    <div className="public-page">
      <header className="landing-nav">
        <a className="landing-logo" href="/"><span className="brand-mark">SZ</span><strong>SZRouter</strong></a>
        <nav><a href="/models">模型</a><a href="/pricing">价格</a><a href="/apps">应用</a><a href="/templates">模板</a></nav>
        <div><a className="landing-link" href="/login">登录</a><a className="primary landing-cta" href="/register">免费开始</a></div>
      </header>
      <div className="public-content">
        {loading && <div className="splash"><span>正在加载…</span></div>}
        {error && <div className="error">{error}</div>}
        {!loading && !error && pathname === "/models" && <Models models={data as unknown as Model[]} />}
        {!loading && !error && pathname === "/pricing" && <Pricing models={data as unknown as Model[]} />}
        {!loading && !error && pathname.startsWith("/apps") && <Agents items={data as unknown as Agent[]} />}
        {!loading && !error && pathname === "/templates" && (
          <>
            <PageHead eyebrow="Workflow Library" title="模板市场" />
            <div className="card-grid">
              {data.map((item) => <article className="model-card" key={String(item.id)}><div className="model-icon">⌘</div><div><code>{String(item.category || "GENERAL")}</code><h3>{String(item.name)}</h3><p>{String(item.description || "可复用的 SZRouter Workflow 模板")}</p><span className="pill good">{item.featured ? "FEATURED" : "READY"}</span></div></article>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PublicWorkflow({ id }: { id: string }) {
  const [workflow, setWorkflow] = useState<{ id: string; name: string; description?: string; version: number } | null>(null);
  const [key, setKey] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  useEffect(() => { fetch(`${API}/api/public/workflows/${encodeURIComponent(id)}`).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body?.error?.message || "加载失败"); setWorkflow(body); }).catch((error) => setOutput(error instanceof Error ? error.message : "加载失败")); }, [id]);
  async function run() {
    if (!workflow) return;
    try { const result = await request<{ output: string }>(`/v1/workflows/${workflow.id}/run`, "", { method: "POST", body: JSON.stringify({ input }) }, key); setOutput(result.output); }
    catch (error) { setOutput(error instanceof Error ? error.message : "运行失败"); }
  }
  return <div className="public-page"><header className="landing-nav"><a className="landing-logo" href="/"><span className="brand-mark">SZ</span><strong>SZRouter</strong></a><div><a className="landing-link" href="/login">登录控制台</a></div></header><main className="public-content">{workflow && <div className="panel"><PageHead eyebrow={`PUBLISHED WORKFLOW · V${workflow.version}`} title={workflow.name}/><p>{workflow.description || "通过分享链接运行 SZRouter Workflow。"}</p><label>API Key<input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="sz_..."/></label><label>输入<textarea rows={6} value={input} onChange={(event) => setInput(event.target.value)}/></label><button className="primary" disabled={!key || !input} onClick={() => void run()}>运行</button>{output && <pre className="rag-answer">{output}</pre>}</div>}{!workflow && !output && <div className="splash">正在加载 Workflow…</div>}{!workflow && output && <div className="error">{output}</div>}</main></div>;
}

function Auth({
  onAuthenticated,
  initialRegister = false,
  onModeChange,
}: {
  onAuthenticated: (token: string) => void;
  initialRegister?: boolean;
  onModeChange?: (register: boolean) => void;
}) {
  const [register, setRegister] = useState(initialRegister);
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
          credentials: "include",
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
            <button type="button" onClick={() => {
              setRegister(!register);
              onModeChange?.(!register);
            }}>
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
              <b>&quot;Authorization: Bearer sz_...&quot;</b> \\{"\n"} -H
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
  onStatus,
}: {
  keys: ApiKey[];
  latestKey: string;
  loading: boolean;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  onStatus: (id: string, status: "ACTIVE" | "DISABLED") => void;
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
                    className="link-button"
                    onClick={() => onStatus(key.id, key.status === "ACTIVE" ? "DISABLED" : "ACTIVE")}
                  >
                    {key.status === "ACTIVE" ? "禁用" : "启用"}
                  </button>
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
  transactions,
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
  transactions: Array<{ id: string; type: string; amount: string; balance: string; description?: string; createdAt: string }>;
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
              placeholder="SZ-XXXXXXXXXXXXXXXXXXXX"
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
      <div className="panel table-wrap">
        <PageHead eyebrow="WALLET LEDGER" title="账单流水" />
        <table><thead><tr><th>类型</th><th>金额</th><th>变动后余额</th><th>说明</th><th>时间</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><strong>{item.type}</strong></td><td>{money(item.amount)}</td><td>{money(item.balance)}</td><td>{item.description || "—"}</td><td>{date(item.createdAt)}</td></tr>)}</tbody></table>
        {!transactions.length && <Empty>暂无账单流水。</Empty>}
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
      {!models.length && <Empty>暂无已启用模型，请在 Admin 中配置模型与渠道。</Empty>}
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
              <th>参考成本 / 毛利</th>
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
                <td>{money(Number(model.inputCost || 0) + Number(model.outputCost || 0))} / {Number(model.inputPrice) + Number(model.outputPrice) > 0 ? `${(((Number(model.inputPrice) + Number(model.outputPrice) - Number(model.inputCost || 0) - Number(model.outputCost || 0)) / (Number(model.inputPrice) + Number(model.outputPrice))) * 100).toFixed(1)}%` : "—"}</td>
                <td>{model.contextWindow.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!models.length && <Empty>暂无价格数据。</Empty>}
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
  const [usage, setUsage] = useState<{ prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }>({});
  useEffect(() => {
    if (apiKey) setKey(apiKey);
  }, [apiKey]);
  async function run() {
    setBusy(true);
    setOutput("");
    setUsage({});
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
          if (data.usage) setUsage(data.usage);
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
            <span>{usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)) ? `${usage.prompt_tokens || 0} IN · ${usage.completion_tokens || 0} OUT` : "TOKEN USAGE"}</span>
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
  token,
  loading,
  onCreate,
  onUpload,
}: {
  items: Knowledge[];
  apiKey: string;
  token: string;
  loading: boolean;
  onCreate: (name: string, description: string) => void;
  onUpload: (id: string, file: File) => void;
}) {
  const [name, setName] = useState("产品文档");
  const [description, setDescription] = useState("面向客户的产品资料");
  const [selected, setSelected] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Array<{ document_name: string; document_id: string; chunk_id: string; score: number; excerpt: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; name: string; status: string; chunkCount: number; size: number; errorMessage?: string; updatedAt: string }>>([]);
  const [chunks, setChunks] = useState<Array<{ id: string; content: string; tokens?: number }>>([]);
  const [documentError, setDocumentError] = useState("");
  const [asking, setAsking] = useState(false);
  const kbId = selected || items[0]?.id || "";
  async function loadDocuments() {
    if (!kbId) return setDocuments([]);
    try {
      const result = await request<{ data: typeof documents }>(`/api/knowledge-bases/${kbId}/documents`, token);
      setDocuments(result.data);
      setDocumentError("");
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : "文档加载失败");
    }
  }
  useEffect(() => {
    void loadDocuments();
  }, [kbId, token]);

  async function removeDocument(documentId: string) {
    await request(`/api/knowledge-bases/${kbId}/documents/${documentId}`, token, { method: "DELETE" });
    setChunks([]);
    await loadDocuments();
  }

  async function reindexDocument(documentId: string) {
    await request(`/api/knowledge-bases/${kbId}/documents/${documentId}/reindex`, token, { method: "POST" });
    await loadDocuments();
  }

  async function viewChunks(documentId: string) {
    const result = await request<{ data: typeof chunks }>(`/api/knowledge-bases/${kbId}/documents/${documentId}/chunks`, token);
    setChunks(result.data);
  }
  async function downloadDocument(documentId: string, name: string) {
    const response = await fetch(`${API}/api/knowledge-bases/${kbId}/documents/${documentId}/download`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
  }
  async function ask() {
    setAsking(true);
    setAnswer("");
    try {
      const data = await request<{
        answer: string;
        citations: Array<{ document_name: string; document_id: string; chunk_id: string; score: number; excerpt: string }>;
      }>(
        `/v1/knowledge/${kbId}/ask`,
        "",
        { method: "POST", body: JSON.stringify({ question }) },
        apiKey,
      );
      setCitations(data.citations);
      setAnswer(
        `${data.answer}\n\n${data.citations.map((item, index) => `[${index + 1}] ${item.document_name} · ${(item.score * 100).toFixed(0)}%`).join("\n")}`,
      );
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : "问答失败");
      setCitations([]);
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
        <div className="panel table-wrap document-panel">
          <PageHead eyebrow="DOCUMENT PIPELINE" title="文档与切片" action={<button className="secondary" onClick={() => void loadDocuments()}>↻ 刷新</button>} />
          {documentError && <div className="error">{documentError}</div>}
          <table>
            <thead><tr><th>文档</th><th>状态</th><th>切片</th><th>大小</th><th>操作</th></tr></thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td><strong>{document.name}</strong>{document.errorMessage && <><br/><small className="danger-link">{document.errorMessage}</small></>}</td>
                  <td><span className={`pill ${document.status === "READY" ? "good" : ""}`}>{document.status}</span></td>
                  <td>{document.chunkCount}</td><td>{Math.ceil(document.size / 1024)} KB</td>
                  <td><button className="link-button" onClick={() => void viewChunks(document.id)}>查看切片</button><button className="link-button" onClick={() => void downloadDocument(document.id, document.name)}>查看原文</button><button className="link-button" onClick={() => void reindexDocument(document.id)}>重建索引</button><button className="danger-link" onClick={() => void removeDocument(document.id)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!documents.length && <Empty>请选择知识库并上传 PDF、DOCX、TXT 或 MD 文档。</Empty>}
          {chunks.length > 0 && <div className="chunk-list">{chunks.map((chunk, index) => <article key={chunk.id}><span>CHUNK {index + 1} · {chunk.tokens || 0} TOKENS</span><p>{chunk.content}</p></article>)}</div>}
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
          {citations.length > 0 && <div className="citation-grid">{citations.map((citation, index) => <article key={citation.chunk_id}><strong>[{index + 1}] {citation.document_name}</strong><span>{(citation.score * 100).toFixed(0)}% match</span><p><mark>{citation.excerpt}</mark></p><button className="link-button" onClick={() => void viewChunks(citation.document_id)}>查看原文切片</button></article>)}</div>}
          {!apiKey && <p className="muted">请先创建 API Key，再进行问答。</p>}
        </div>
      )}
    </>
  );
}

function Agents({ items, token, apiKey = "", loading = false, onRefresh }: { items: Agent[]; token?: string; apiKey?: string; loading?: boolean; onRefresh?: () => void }) {
  const [name, setName] = useState("智能客服");
  const [modelSlug, setModelSlug] = useState("gpt-4o-mini");
  const [systemPrompt, setSystemPrompt] = useState("你是专业、准确的 SZRouter 智能客服。");
  const [selected, setSelected] = useState("");
  const [key, setKey] = useState(apiKey);
  const [message, setMessage] = useState("介绍一下你的能力");
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (apiKey) setKey(apiKey); }, [apiKey]);
  async function createAgent() {
    if (!token) return;
    setBusy(true);
    try {
      await request("/api/agent-apps", token, { method: "POST", body: JSON.stringify({ name, slug: `${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-") || "agent"}-${Date.now().toString().slice(-6)}`, systemPrompt, modelSlug, description: "Created in SZRouter Console" }) });
      onRefresh?.();
    } finally { setBusy(false); }
  }
  async function publishAgent(id: string) {
    if (!token) return;
    await request(`/api/agent-apps/${id}/publish`, token, { method: "POST" });
    onRefresh?.();
  }
  async function chat() {
    if (!selected || !key) return;
    setBusy(true); setResponse("");
    try {
      const data = await request<{ choices?: Array<{ message?: { content?: string } }> }>(`/v1/agent/apps/${selected}/chat`, "", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: message }] }) }, key);
      setResponse(data.choices?.[0]?.message?.content || "Agent 未返回文本内容");
    } catch (error) { setResponse(error instanceof Error ? error.message : "体验失败"); }
    finally { setBusy(false); }
  }
  return (
    <>
      <PageHead eyebrow="AGENT APPLICATIONS" title="Agent 应用市场" action={token ? <button className="primary" disabled={loading || busy} onClick={() => void createAgent()}>＋ 创建应用</button> : undefined} />
      {token && <div className="panel agent-builder"><label>应用名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>模型<input value={modelSlug} onChange={(event) => setModelSlug(event.target.value)} /></label><label>系统提示词<textarea rows={3} value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} /></label></div>}
      <div className="card-grid">
        {items.map((item, index) => (
          <article className={`agent-card ${selected === item.id ? "selected-card" : ""}`} key={item.id} onClick={() => setSelected(item.id)}>
            <div className={`agent-art art-${index % 3}`}>
              <span>✦</span>
            </div>
            <div>
              <span className="pill">{item.visibility || "PUBLIC"}</span>
              <h3>{item.name}</h3>
              <p>{item.description || "Composable agent application."}</p>
              <div className="agent-foot">
                <code>{item.modelSlug}</code>
                <strong>{money(item.pricePerRun)} / run</strong>
              </div>
              {token && item.visibility !== "PUBLIC" && <button className="secondary wide" onClick={(event) => { event.stopPropagation(); void publishAgent(item.id); }}>发布应用</button>}
            </div>
          </article>
        ))}
      </div>
      {!items.length && <Empty>暂无公开 Agent 应用。</Empty>}
      {items.length > 0 && token && <div className="panel agent-play"><PageHead eyebrow="ONLINE EXPERIENCE" title="在线体验" /><div className="inline-form"><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="sz_ API Key"/><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="输入消息"/><button className="primary" disabled={!selected || !key || busy} onClick={() => void chat()}>{busy ? "运行中…" : "发送"}</button></div>{response && <pre className="rag-answer">{response}</pre>}</div>}
    </>
  );
}

function Workflows({
  items,
  templates,
  token,
  apiKey,
  loading,
  onCreate,
}: {
  items: Workflow[];
  templates: Array<{ id: string; name: string; description?: string }>;
  token: string;
  apiKey: string;
  loading: boolean;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("内容加工流水线");
  const [selectedId, setSelectedId] = useState("");
  const selected = items.find((item) => item.id === selectedId) || items[0];
  const [definition, setDefinition] = useState("");
  const [runInput, setRunInput] = useState("为 SZRouter 写一段发布文案");
  const [runOutput, setRunOutput] = useState("");
  const [share, setShare] = useState("");
  useEffect(() => {
    setDefinition(JSON.stringify(selected?.definition || { nodes: [] }, null, 2));
    if (selected) setSelectedId(selected.id);
  }, [selected?.id]);
  async function saveWorkflow() {
    if (!selected) return;
    await request(`/api/workflows/${selected.id}`, token, { method: "PATCH", body: JSON.stringify({ definition: JSON.parse(definition) }) });
    setRunOutput("Workflow 已保存");
  }
  async function publishWorkflow() {
    if (!selected) return;
    const result = await request<{ shareUrl: string; embedCode: string }>(`/api/workflows/${selected.id}/publish`, token, { method: "POST" });
    setShare(`${result.shareUrl}\n${result.embedCode}`);
  }
  async function runWorkflow() {
    if (!selected || !apiKey) return;
    try {
      const result = await request<{ output: string; trace: unknown[] }>(`/v1/workflows/${selected.id}/run`, "", { method: "POST", body: JSON.stringify({ input: runInput }) }, apiKey);
      setRunOutput(`${result.output}\n\nTRACE\n${JSON.stringify(result.trace, null, 2)}`);
    } catch (error) { setRunOutput(error instanceof Error ? error.message : "运行失败"); }
  }
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
          <small>CONDITION</small>
          <strong>质量分支</strong>
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
            <button className={`list-row workflow-select ${selected?.id === item.id ? "selected-row" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}>
              <div>
                <strong>{item.name}</strong>
                <code>{item.slug}</code>
              </div>
              <span className="pill">{item.status}</span>
            </button>
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
      {selected && <div className="two-column workflow-editor"><article className="panel"><PageHead eyebrow={`VERSION ${selected.version || 1}`} title="节点配置"/><textarea rows={16} value={definition} onChange={(event) => setDefinition(event.target.value)} /><div className="button-row"><button className="primary" onClick={() => void saveWorkflow()}>保存</button><button className="secondary" onClick={() => void publishWorkflow()}>发布 / 分享</button></div>{share && <pre className="rag-answer">{share}</pre>}</article><article className="panel"><PageHead eyebrow="DEBUG RUN" title="调试运行"/><label>输入<textarea rows={6} value={runInput} onChange={(event) => setRunInput(event.target.value)} /></label><button className="primary wide" disabled={!apiKey} onClick={() => void runWorkflow()}>运行 Workflow</button>{!apiKey && <p className="muted">请先创建 API Key。</p>}{runOutput && <pre className="rag-answer">{runOutput}</pre>}</article></div>}
    </>
  );
}

function Tenant({
  items,
  token,
  loading,
  onCreate,
}: {
  items: Organization[];
  token: string;
  loading: boolean;
  onCreate: (name: string, slug: string) => void;
}) {
  const [name, setName] = useState("My Organization");
  const [selectedId, setSelectedId] = useState("");
  const [members, setMembers] = useState<Array<{ id: string; role: string; status: string; user: { email: string; name?: string } }>>([]);
  const [billing, setBilling] = useState<{ wallet?: { balance: string; frozen: string }; transactions?: Array<Record<string, unknown>>; invoices?: Array<Record<string, unknown>> }>({});
  const [analytics, setAnalytics] = useState<Record<string, unknown>>({});
  const [resources, setResources] = useState<{ apiKeys: Array<Record<string, unknown>>; apps: Array<Record<string, unknown>>; workflows: Array<Record<string, unknown>> }>({ apiKeys: [], apps: [], workflows: [] });
  const [inviteEmail, setInviteEmail] = useState("");
  const [orgKey, setOrgKey] = useState("");
  const organizationId = selectedId || items[0]?.id || "";
  const slug = useMemo(
    () =>
      name
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    [name],
  );
  async function loadTenant() {
    if (!organizationId) return;
    const [memberData, billingData, analyticsData, resourceData] = await Promise.all([
      request<{ data: typeof members }>(`/api/organizations/${organizationId}/members`, token),
      request<typeof billing>(`/api/organizations/${organizationId}/billing`, token),
      request<Record<string, unknown>>(`/api/organizations/${organizationId}/analytics`, token),
      request<typeof resources>(`/api/organizations/${organizationId}/resources`, token),
    ]);
    setMembers(memberData.data); setBilling(billingData); setAnalytics(analyticsData); setResources(resourceData);
  }
  useEffect(() => { void loadTenant(); }, [organizationId, token]);
  async function invite() {
    await request(`/api/organizations/${organizationId}/members`, token, { method: "POST", body: JSON.stringify({ email: inviteEmail, role: "MEMBER" }) });
    setInviteEmail(""); await loadTenant();
  }
  async function createOrganizationKey() {
    const result = await request<{ key: string }>("/api/api-keys", token, { method: "POST", body: JSON.stringify({ name: "Organization Key", organizationId }) });
    setOrgKey(result.key);
  }
  async function createOrganizationApp() {
    await request("/api/agent-apps", token, { method: "POST", body: JSON.stringify({ name: "Tenant Assistant", slug: `tenant-assistant-${Date.now().toString().slice(-6)}`, systemPrompt: "You are a helpful tenant assistant.", modelSlug: "gpt-4o-mini", organizationId }) });
    await loadTenant();
  }
  async function createOrganizationWorkflow() {
    await request("/api/workflows", token, { method: "POST", body: JSON.stringify({ name: "Tenant Workflow", slug: `tenant-workflow-${Date.now().toString().slice(-6)}`, organizationId, definition: { nodes: [{ id: "generate", type: "llm", prompt: "Process: {{input}}" }] } }) });
    await loadTenant();
  }
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
          <article className={`org-card ${organizationId === item.id ? "selected-card" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}>
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
      {organizationId && <><nav className="tenant-tabs"><a href="/tenant/members">成员</a><a href="/tenant/api-keys">API Key</a><a href="/tenant/apps">应用</a><a href="/tenant/workflows">Workflow</a><a href="/tenant/billing">账单</a><a href="/tenant/analytics">调用大盘</a></nav><div className="two-column tenant-detail"><article className="panel"><PageHead eyebrow="MEMBERS & ACCESS" title="成员管理" action={<div className="inline-form"><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@example.com"/><button className="primary" disabled={!inviteEmail} onClick={() => void invite()}>添加成员</button></div>}/>{members.map((member) => <div className="list-row" key={member.id}><div><strong>{member.user.name || member.user.email}</strong><p>{member.user.email}</p></div><span className="pill">{member.role} · {member.status}</span></div>)}</article><article className="panel"><PageHead eyebrow="TENANT CREDENTIALS" title="租户 API Key"/><button className="primary" onClick={() => void createOrganizationKey()}>创建租户 Key</button>{orgKey && <div className="secret-reveal"><div><strong>仅显示一次</strong><code>{orgKey}</code></div><button onClick={() => navigator.clipboard.writeText(orgKey)}>复制</button></div>}<p className="muted">已创建 {resources.apiKeys.length} 个组织 Key。调用费用从组织钱包结算，并受组织额度限制。</p></article></div><div className="two-column tenant-detail"><article className="panel"><PageHead eyebrow="TENANT RESOURCES" title="应用与 Workflow"/><div className="button-row"><button className="primary" onClick={() => void createOrganizationApp()}>创建租户应用</button><button className="secondary" onClick={() => void createOrganizationWorkflow()}>创建租户 Workflow</button></div><p className="muted">应用：{resources.apps.length} · Workflow：{resources.workflows.length}</p>{[...resources.apps, ...resources.workflows].map((item) => <div className="list-row" key={String(item.id)}><strong>{String(item.name)}</strong><span className="pill">{String(item.status)}</span></div>)}</article><article className="panel"><PageHead eyebrow="BILLING" title="租户账单"/><div className="metric-grid compact"><div className="metric lime"><small>余额</small><strong>{money(billing.wallet?.balance)}</strong></div><div className="metric violet"><small>冻结</small><strong>{money(billing.wallet?.frozen)}</strong></div></div><p className="muted">月结账单：{billing.invoices?.length || 0} · 流水：{billing.transactions?.length || 0}</p></article></div><article className="panel"><PageHead eyebrow="30 DAY ANALYTICS" title="调用大盘"/><pre className="rag-answer">{JSON.stringify(analytics, null, 2)}</pre><p className="muted">租户应用与 Workflow 使用同一组织身份、钱包和用量统计。</p></article></>}
    </>
  );
}

function Exports({
  items,
  token,
  loading,
  onCreate,
}: {
  items: ExportTask[];
  token: string;
  loading: boolean;
  onCreate: (type: string, format: string) => void;
}) {
  const [type, setType] = useState("USAGE");
  const [format, setFormat] = useState("CSV");
  async function download(item: ExportTask) {
    const response = await fetch(`${API}/api/exports/${item.id}/download`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `szrouter-${item.type.toLocaleLowerCase()}.${item.format.toLocaleLowerCase()}`; anchor.click();
    URL.revokeObjectURL(url);
  }
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
                <td>{item.fileUrl ? <button className="link-button" onClick={() => void download(item)}>下载</button> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty>暂无导出任务。</Empty>}
      </div>
    </>
  );
}
