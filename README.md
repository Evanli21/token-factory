# Token Factory

Token Factory 是一个可自托管的多租户 AI Token 平台：前台、运营后台、OpenAI Compatible API Gateway、异步 Worker、PostgreSQL/pgvector、Redis/BullMQ 与 Nginx/Let's Encrypt 都包含在同一个 TypeScript monorepo 中。

## 能力概览

- Web 前台：注册登录、API Key、充值订单/卡密、模型广场、价格中心、流式 Playground、知识库与引用问答、Agent 市场、Workflow、组织租户、数据导出。
- Admin 后台：管理员登录、用户/模型/渠道/订单/卡密管理、调用日志、内容审核、代理与提现、组织财务、月结/PDF 账单、告警、后台任务、审计日志与平台总览。
- Gateway：API Key 鉴权、用户/组织余额预扣和结算、Token/工具/Agent 计费、Redis 限流、月度额度、加权渠道选择、熔断与失败回退、SSE、内容审核。
- RAG：PDF/DOCX/TXT/MD 解析、1536 维 Embedding、pgvector HNSW、向量+全文混合检索、本地 Rerank 和来源引用。
- Worker：邮件、Webhook 重试、导出、文档解析与 Embedding、知识库/Agent 评估、月报/PDF 账单、对账、告警与日志清理。

## 目录

```text
token-factory/
├── web/                 Next.js 用户前台（3000）
├── admin/               Next.js 管理后台（3001）
├── gateway/             Express API Gateway（8000）
├── worker/              BullMQ Worker / Scheduler
├── packages/database/   Prisma Client、Schema、pgvector SQL
├── nginx/               三域名反向代理与 TLS 配置
├── docs/                API、架构和部署文档
├── docker-compose.yml
└── docker-compose.prod.yml
```

## 一键本地启动

前置条件：Docker 24+ 与 Docker Compose v2。

```bash
cp .env.example .env
# 至少修改 ADMIN_PASSWORD、JWT_SECRET、API_KEY_PEPPER 和数据库密码
docker compose up -d --build
```

服务地址：

- Web：[http://localhost:3000](http://localhost:3000)
- Admin：[http://localhost:3001](http://localhost:3001)
- Gateway：[http://localhost:8000](http://localhost:8000)
- Health：[http://localhost:8000/health](http://localhost:8000/health)

首次启动会自动创建数据库表、pgvector 索引与演示数据。演示用户为 `demo@token-factory.local` / `demo123456`。未配置 `OPENAI_API_KEY` 时使用内置 Mock 渠道，便于完整验证登录、API Key、余额计费和 SSE；配置真实 Key 后执行 `docker compose restart gateway worker` 并重新运行 `docker compose exec gateway npm run db:seed`。

查看状态与日志：

```bash
docker compose ps
docker compose logs -f gateway worker
curl http://localhost:8000/health
```

停止服务（保留数据）：

```bash
docker compose down
```

## 非 Docker 开发

本机需要 Node.js 20+、PostgreSQL 16 + pgvector、Redis 7。

```bash
cp .env.example .env
# 把 DATABASE_URL / REDIS_URL 的主机名改为 localhost
npm install
npm run prisma:generate
npm run db:push
npm run db:seed
npm run dev
```

质量检查：

```bash
npm test
npm run typecheck
npm run build
```

## OpenAI Compatible API

创建 API Key 后：

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer tf_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gpt-4o-mini",
    "stream":true,
    "messages":[{"role":"user","content":"Hello Token Factory"}]
  }'
```

接口：

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `POST /v1/agent/chat`
- `POST /v1/knowledge/:id/ask`
- `POST /v1/workflows/:id/run`

请求鉴权支持 `Authorization: Bearer tf_...` 或 `X-API-Key`。更多示例见 [docs/API.md](docs/API.md)。

## 生产部署与域名

1. 将代码放到安装了 Docker 的 Linux 服务器，确保 80/443 端口开放。
2. 复制并填写生产配置：

```bash
cp .env.example .env.production
```

必须替换所有 `change-*` 值，并设置：

```dotenv
DOMAIN=yourdomain.com
LETSENCRYPT_EMAIL=admin@yourdomain.com
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
ADMIN_BASE_URL=https://admin.yourdomain.com
GATEWAY_PUBLIC_URL=https://api.yourdomain.com
CORS_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com
```

DNS 需要配置三个 A/AAAA 记录指向服务器：`yourdomain.com`、`admin.yourdomain.com`、`api.yourdomain.com`。

首次签发证书并启动：

```bash
set -a; source .env.production; set +a
bash scripts/init-letsencrypt.sh
docker compose -f docker-compose.prod.yml ps
```

后续部署：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

续签证书（可放入 cron）：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm certbot renew
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -s reload
```

详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 打包

在项目根目录运行：

```bash
npm run pack
```

压缩包会生成在项目上一级目录：`token-factory.zip`。脚本排除 `.git`、`node_modules`、`.next`、`dist`、`.env*`（保留 `.env.example`）、日志、上传和导出目录。

## 上线前安全清单

- 替换数据库、Redis、管理员、JWT、内部 API 和 API Key pepper 的所有默认密钥。
- 禁用演示用户，配置真实支付 Webhook 后再开放充值；当前订单接口不会伪造支付成功。
- 上游渠道密钥当前保存于数据库字段。正式环境建议接入 KMS/Vault，并在渠道创建接口前置企业 SSO。
- 将 Admin 域名放在 VPN、Cloudflare Access 或其他 Zero Trust 身份层之后。
- 配置对象存储、备份、集中日志与告警接收人；验证恢复流程。
- 按地区法规补齐隐私政策、退款规则、内容政策和数据保留策略。

## License

Proprietary. Add your organization license before public distribution.
