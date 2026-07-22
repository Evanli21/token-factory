# Architecture

```text
Browser ── web:3000 ─┐
                     ├── nginx ── gateway:8000 ── PostgreSQL + pgvector
Operator ─ admin:3001┘                    │
                                         ├── Redis (rate/circuit/BullMQ)
OpenAI SDK ───────────── /v1/* ───────────┤
                                         └── provider channels
                                              OpenAI compatible / Mock

worker ── BullMQ ── documents / exports / webhooks / invoices / evals / cleanup
```

## 请求生命周期

1. Gateway 对原始 API Key 加 pepper 后做 SHA-256 查询，验证状态、到期时间和租户。
2. Redis 原子计数执行每分钟限流；按用户或组织检查月度额度。
3. 内容审核规则按优先级执行；命中 `BLOCK` 时记录并终止。
4. 根据提示 Token、最大输出和模型价格冻结余额，创建有 TTL 的 `Reservation`。
5. 选择优先级最低、权重更高且熔断器未打开的 ChannelModel。失败累计达到阈值后暂时熔断。
6. 普通响应或 SSE 完成后，以实际 Token 和工具调用结算；失败则释放预扣。
7. 写入 UsageLog、组织月度聚合和资金流水。过期预扣由 Worker 对账释放。

## RAG 数据流

上传文档后，Gateway 创建 `Document` 并投递 BullMQ。Worker 解析 PDF/DOCX/TXT/MD，按知识库配置切片，生成 1536 维向量并写入原生 `DocumentChunk` 表。问答时执行 HNSW cosine 搜索与 `tsvector` 全文检索，再进行词项覆盖 Rerank，将 Top-K 片段、编号和文档名送入模型，最终返回结构化引用。

## 数据与隔离

用户钱包和组织钱包独立。API Key 可绑定组织；请求权限、余额、限流、月度额度、用量聚合与账单都跟随 Key 的租户上下文。知识库、Agent 和 Workflow 同时保存 owner 与可选 organizationId。

## 扩展点

- Channel provider adapter：在 `gateway/src/services/provider.ts` 增加非 OpenAI 协议转换器。
- Workflow executor：为 `definition.nodes[].type` 增加 HTTP、condition、tool 和 parallel 执行器。
- KMS：替换 `channelSecret()`，对 `apiKeyEncrypted` 做信封加密。
- Object storage：Gateway 上传层与 Worker 文档读取层可替换为 S3 SDK。
- Payments：在订单模型上接入支付会话与签名 Webhook，到账事务中原子增加 Wallet。
