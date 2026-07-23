# SZRouter 生产部署指南

本文以 `szrouter.shop` 为例，适用于 Ubuntu 22.04/24.04。Web 与 Admin 可以放在 Vercel，Gateway、Worker、PostgreSQL 和 Redis 放在 VPS；也可以全部使用 Docker 部署在 VPS。

## 1. 服务器要求

- 最低：2 vCPU、4 GB RAM、40 GB SSD、2 GB Swap。
- 推荐：4 vCPU、8 GB RAM。
- 安装 Docker Engine 24+、Docker Compose v2、Git。
- 对公网只开放 22、80、443；不要开放 PostgreSQL 5432 和 Redis 6379。

## 2. GoDaddy DNS

在 `szrouter.shop` 的 DNS 管理中配置：

| 类型 | Name | Value |
|---|---|---|
| A | `api` | VPS 公网 IPv4 |
| A | `@` | 全量 VPS 部署时填写 VPS IP；使用 Vercel 时填写 Vercel 提示值 |
| CNAME | `www` | Vercel 项目给出的 CNAME；全量 VPS 部署可填 `@` |
| CNAME | `admin` | Admin Vercel 项目给出的 CNAME；全量 VPS 部署可填 `@` |

删除与这些主机名冲突的旧 A/CNAME 记录。DNS 通常几分钟生效，最长可能需要 24–48 小时。

## 3. 获取代码并配置环境

```bash
git clone https://github.com/Evanli21/token-factory.git
cd token-factory
cp .env.example .env.production
chmod 600 .env.production
nano .env.production
```

至少修改 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`ADMIN_PASSWORD`、`INTERNAL_API_TOKEN`、`JWT_SECRET`、`API_KEY_PEPPER`、`OPENAI_API_KEY`，并设置：

```dotenv
DOMAIN=szrouter.shop
NEXT_PUBLIC_BASE_URL=https://www.szrouter.shop
NEXT_PUBLIC_API_BASE_URL=https://api.szrouter.shop
ADMIN_BASE_URL=https://admin.szrouter.shop
GATEWAY_PUBLIC_URL=https://api.szrouter.shop
INTERNAL_API_URL=http://gateway:8000
CORS_ORIGINS=https://szrouter.shop,https://www.szrouter.shop,https://admin.szrouter.shop
LETSENCRYPT_EMAIL=你的邮箱
```

不要把 `.env.production` 上传 GitHub。

## 4. Docker 生产启动

全量 VPS 部署：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl https://api.szrouter.shop/health
```

Vercel + VPS 混合部署后端：

```bash
docker compose --env-file .env.production -f docker-compose.backend.yml config
docker compose --env-file .env.production -f docker-compose.backend.yml up -d --build
```

## 5. Nginx 代理

仓库已包含可直接使用的模板：

- `szrouter.shop` / `www.szrouter.shop` → `web:3000`
- `admin.szrouter.shop` → `admin:3001`
- `api.szrouter.shop` → `gateway:8000`

上传、SSE 流式响应、真实 IP 与常用安全 Header 已在 `nginx/` 中配置。

## 6. HTTPS 证书

首次全量部署执行：

```bash
set -a
source .env.production
set +a
bash scripts/init-letsencrypt.sh
```

续签：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm certbot renew
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -s reload
```

后端混合部署使用 `Caddyfile.backend`，Caddy 会自动申请和续签 `api.szrouter.shop` 证书。

## 7. 数据库初始化与迁移

新数据库：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec gateway npm run db:migrate
docker compose --env-file .env.production -f docker-compose.prod.yml exec gateway npm run db:seed
```

旧版本数据库继续使用幂等升级：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec gateway npm run db:push
```

## 8. 查看状态与日志

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f gateway worker
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 postgres redis
```

健康检查必须返回 `{"status":"ok","service":"szrouter-gateway"}`。

## 9. 数据库备份

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "szrouter-$(date +%F-%H%M).dump"
```

同时备份 uploads/exports 卷，或配置带版本管理的 S3 兼容对象存储。务必定期测试恢复。

## 10. 更新部署

```bash
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

## 11. 回滚

部署前记录旧提交并备份数据库：

```bash
git rev-parse HEAD
git checkout <旧提交哈希>
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

只有确认新版本迁移与旧代码不兼容时才恢复数据库备份。恢复前先停止 Gateway 和 Worker，避免继续写入。
