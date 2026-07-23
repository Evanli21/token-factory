# API Reference

Base URL：`https://api.yourdomain.com`。所有 `/v1/*` 路由都要求 SZRouter API Key。

## Models

```http
GET /v1/models
Authorization: Bearer tf_...
```

## Chat Completions

请求/响应与 OpenAI Chat Completions 兼容；支持 `stream: true` 的 SSE、`tools`、`tool_choice`、`temperature`、`max_tokens` 和 `max_completion_tokens`。

```json
{
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "Explain pgvector." }],
  "stream": false
}
```

## Embeddings

`input` 支持字符串或最多 100 个字符串的数组。

```json
{
  "model": "text-embedding-3-small",
  "input": ["first document", "second document"]
}
```

## Agent chat

```json
{
  "agent_id": "research-assistant",
  "messages": [{ "role": "user", "content": "Give me a research plan." }]
}
```

Agent 应用费和实际返回的工具调用费会与模型 Token 费用合并结算，并分别写入 `UsageLog` 与 `AgentToolLog`。

## Knowledge ask

```http
POST /v1/knowledge/{knowledgeBaseId}/ask
```

```json
{
  "question": "What is the refund policy?",
  "top_k": 6,
  "model": "gpt-4o-mini"
}
```

响应中的 `citations` 含文档、切片、相关性分数和摘录。检索分数由向量相似度、PostgreSQL 全文检索与轻量 Rerank 合成。

## Workflow run

```json
{
  "input": "Draft source material",
  "model": "gpt-4o-mini"
}
```

`trace` 返回每个节点的输出和费用。当前内置执行器支持顺序 `llm` 节点；`definition` 是可扩展 JSON，可在 Worker/Gateway 中加入条件、HTTP、工具与并行节点执行器。

## Error format

```json
{
  "error": {
    "message": "Insufficient balance",
    "type": "invalid_request_error"
  }
}
```

每个响应都带 `X-Request-Id`，建议在客户端日志中保存它。限流响应为 HTTP 429，并带 `X-RateLimit-Limit` 和 `X-RateLimit-Remaining`。
