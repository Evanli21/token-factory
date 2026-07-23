# SZRouter 完整性审计报告

审计日期：2026-07-23  
审计范围：Web、Admin、Gateway、Worker、Prisma、Docker、环境变量与文档。

## 结论

修复前 Web 与 Admin 的功能集中在单个 `page.tsx`，清单中的大多数 URL 会返回 404；Gateway 缺少指定 Agent 应用与内部知识检索接口；Prisma 缺少 `BackgroundJob`；Worker 使用旧任务别名且没有消费数据库任务表；根目录缺少 `DEPLOY.md` 和正式 Prisma baseline migration。

本次修复已为清单中的 URL 建立真实 App Router 页面，页面仍复用经过验证的 SZRouter 控制台组件，避免重复状态逻辑。Gateway、Worker、迁移、文档和部署配置已同步补齐。

## Web 页面

- [x] `/`
- [x] `/login`
- [x] `/register`
- [x] `/models`
- [x] `/pricing`
- [x] `/playground`
- [x] `/apps`
- [x] `/templates`
- [x] `/workflows`
- [x] `/exports`
- [x] `/console`
- [x] `/console/api-keys`
- [x] `/console/recharge`
- [x] `/console/knowledge`
- [x] `/console/organizations`
- [x] `/tenant`
- [x] `/tenant/members`
- [x] `/tenant/api-keys`
- [x] `/tenant/apps`
- [x] `/tenant/workflows`
- [x] `/tenant/billing`
- [x] `/tenant/analytics`

## Admin 页面

- [x] `/login`
- [x] `/dashboard`
- [x] `/platform`
- [x] `/users`
- [x] `/models`
- [x] `/channels`
- [x] `/orders`
- [x] `/cards`
- [x] `/logs`
- [x] `/moderation`
- [x] `/agents`
- [x] `/withdrawals`
- [x] `/invoices`
- [x] `/system/alerts`
- [x] `/system/jobs`
- [x] `/audit`

所有列表页包含数据表格、空状态、筛选表单和有效操作按钮；所有 Admin API 都经过管理员 JWT/Cookie 权限校验。

## Gateway API

- [x] `GET /health`
- [x] `GET /v1/models`
- [x] `POST /v1/chat/completions`
- [x] `POST /v1/embeddings`
- [x] `POST /v1/agent/chat`
- [x] `POST /v1/agent/apps/:id/chat`
- [x] `POST /v1/knowledge/:id/ask`
- [x] `POST /v1/workflows/:id/run`
- [x] `POST /internal/knowledge/search`

外部 V1 API 使用哈希 API Key、用户/组织状态、Redis 限流、余额预扣与结算、渠道熔断和输入/输出审核。内部检索使用 `X-Internal-Token`。

## Worker 任务

- [x] `send_email`
- [x] `webhook_retry`
- [x] `export_task`
- [x] `knowledge_parse`
- [x] `knowledge_eval`
- [x] `agent_eval`
- [x] `monthly_billing`
- [x] `reconciliation`
- [x] `alert_checks`
- [x] `log_cleanup`

旧任务名称保留为兼容别名。Worker 同时轮询 `BackgroundJob`，并记录 QUEUED、RUNNING、COMPLETED、FAILED、进度、结果和错误。

## 数据库

清单中的 45 个业务模型全部存在，并新增 `BackgroundJob`，共 46 个 Prisma 模型。`DocumentChunk` 通过 SQL migration 创建，包含 `vector(1536)`、HNSW 向量索引、文档索引与全文索引。baseline migration 位于：

`packages/database/prisma/migrations/20260723000000_szrouter_baseline/migration.sql`

## 基础设施与文档

- [x] 六个服务的 Dockerfile / Compose
- [x] PostgreSQL `pgvector/pgvector:pg16`
- [x] Redis / BullMQ
- [x] Nginx / HTTPS 模板
- [x] `.env.example`
- [x] `README.md`
- [x] `DEPLOY.md`
- [x] 排除密钥与构建产物的打包脚本

## 品牌约束

项目名称、页面标题、包作用域、Compose 项目名、队列名、Cookie 与新 API Key 前缀均使用 SZRouter。仓库目录与最终压缩包保留 `token-factory` 名称，仅用于兼容既定 GitHub 仓库和交付文件名。历史 `tf_` API Key 仍可使用，新 Key 使用 `sz_`。
