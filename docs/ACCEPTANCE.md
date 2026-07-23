# SZRouter 验收清单

生成时间：2026-07-23

## 本机已实测

- [x] `npm run typecheck`
- [x] Gateway 单元测试：4/4 通过
- [x] Gateway、Worker、Database TypeScript 生产构建
- [x] Web Next.js 生产构建：25 个路由生成成功
- [x] Admin Next.js 生产构建：21 个路由生成成功
- [x] Web 清单中的全部页面返回 HTTP 200
- [x] Admin 清单中的全部页面返回 HTTP 200
- [x] Web 首页可访问且品牌为 SZRouter
- [x] Admin 后台可访问，桌面端无横向溢出，导航正文 14px、页面标题 35px
- [x] Prisma schema 校验通过，共 46 个模型
- [x] baseline migration 包含 pgvector、DocumentChunk、HNSW 和 BackgroundJob
- [x] 三份 Compose YAML 语法解析通过，开发 Compose 包含 postgres、redis、gateway、worker、web、admin
- [x] 打包脚本不会误删 `web/app/exports` 页面
- [x] Git diff 空白错误检查通过
- [x] 仓库未包含 `.env`、密码、`node_modules`、`.next`、`dist`、日志、上传和导出运行数据

## 功能代码验收

- [x] 用户注册、密码登录、退出与 HttpOnly 会话 Cookie
- [x] API Key 创建、仅显示一次、列表、禁用、启用和吊销
- [x] 模型广场、价格、参考成本与毛利说明
- [x] 流式 Playground 与 Token 用量显示
- [x] 充值订单、卡密与钱包流水
- [x] 知识库创建、四类文档上传、列表、删除、重建索引、切片、问答、引用、高亮和原文下载
- [x] Agent 应用创建、发布、列表、详情路由和在线体验
- [x] Workflow 创建、节点 JSON 编辑、条件分支、保存、发布、调试、分享链接和嵌入代码
- [x] 租户成员、组织 API Key、应用、Workflow、账单与 30 天调用大盘
- [x] Admin 登录、仪表盘、平台、用户、模型、渠道、订单、卡密、日志、审核、代理、提现、财务、账单 PDF、告警、任务和审计
- [x] OpenAI-compatible、Agent、Knowledge、Workflow 与内部检索 API
- [x] Bearer Key 哈希鉴权、用户/组织状态、额度、余额、限流、渠道熔断、输入/输出审核
- [x] 10 类 Worker 任务、数据库 BackgroundJob 消费、自动评估、Webhook 重试和定时任务

## 需要在安装 Docker 的主机执行

当前验收电脑没有安装 `docker` 命令，因此以下运行时步骤无法在本机伪造为已通过。代码构建和配置解析已通过，部署主机需执行：

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
curl http://localhost:8000/health
```

预期 Health：

```json
{"status":"ok","service":"szrouter-gateway"}
```

随后在真实 PostgreSQL/pgvector/Redis 环境依次验收：注册、创建 API Key、Playground、知识库上传与 Worker 状态。完整命令见根目录 `README.md` 和 `DEPLOY.md`。
