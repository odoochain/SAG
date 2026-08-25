---
name: sag-hainan-law-ingest
description: 226篇海南地方法规批量导入SAG的完整流程、问题排查与最终结果
metadata:
  type: project
---

# 海南地方法规批量导入 SAG 总结

## 概况

| 项目 | 数值 |
|---|---|
| 数据源 | `G:\1-lawiaorg\lawrefbook.github.io\content\docs\DLC\海南地方法规\地方性法规\海南` |
| 文件格式 | Markdown (.md)，lawrefbook 导出格式 |
| 文件数量 | 226 篇 |
| 总大小 | ~3.5 MB |
| SAG Source ID | `20000000-0000-0000-0000-000000000001` |
| 最终入库文档数 | 223 条（226 个文件中有 3 组同名不同年份法规，各保留最新版，223 个唯一标题全部入库） |
| 总耗时 | 约 4 小时（含排障和多轮重试） |

## 导入管道

```
.md 文件 → batch-ingest-laws.ts → SAG /ingest API
    → Markdown 分块(heading_strict)
    → 本地 Embedding (bge-m3 via localhost:11435)
    → LLM 事件/实体抽取 (硅基流动 Qwen3-8B)
    → pgvector 存储 (PostgreSQL 5433)
```

## 工具

- **批量导入脚本**: `D:\dev\lawgraph\SAG\scripts\batch-ingest-laws.ts`
  - 用法: `npx tsx scripts/batch-ingest-laws.ts <dir> [--source-id <uuid>] [--concurrency <n>] [--dry-run]`
  - 从首个 `# heading` 提取标题，从文件名 `(YYYY-MM-DD)` 提取日期
  - 自动去除 `<!-- INFO END -->` 标记
  - 并发控制（默认 2）

- **重试脚本**: `D:\dev\lawgraph\SAG\scripts\retry-failed-ingest.ts`
  - 硬编码失败标题列表，按标题匹配文件后重新导入

- **独立 Embedding 服务**: `D:\dev\lawgraph\embedding-server\server.ts`
  - 端口 11435，OpenAI 兼容 API
  - 本地 ONNX 推理: bge-m3 (embedding) + bge-reranker-base (rerank)

## 分轮次导入记录

### 第一轮：全量 226 篇

| 配置 | 值 |
|---|---|
| Embedding | 硅基流动 bge-m3（远程） → 后改为本地 localhost:11435 |
| LLM | 硅基流动 Qwen/Qwen3-8B |
| LLM_TIMEOUT_MS | 60000 (60s) |
| 并发 | 2 |

**结果**: 201 成功，25 失败（全部为 HTTP 500 `This operation was aborted` — LLM 事件抽取超时）

### 第二轮：重试 25 篇（提高超时）

| 变更 | 值 |
|---|---|
| LLM_TIMEOUT_MS | 60000 → **180000** (3 分钟) |
| Embedding | 切换为 **本地 localhost:11435** |

**结果**: 22 成功，4 失败
- 2 篇 `fetch failed`（PG 重启导致 SAG 连接池断开）
- 1 篇 `Unterminated string in JSON`（LLM 输出截断）
- 1 篇重复标题匹配

### 第三轮：单独重试最后 3 篇

- `海南省无规定动物疫病区管理条例(2024-07-31)` → 成功 (Qwen3-8B)
- `海口市城市供水排水节约用水管理条例(2018-12-10)` → 成功 (Qwen3-8B)
- `海南省无规定动物疫病区管理条例(2021-09-30)` → 失败 (Qwen3-8B JSON 截断)

### 第四轮：换大模型

- `海南省无规定动物疫病区管理条例(2021-09-30)` → **Qwen/Qwen2.5-32B-Instruct** → 成功

### 去重清理

多轮重试导致部分文档重复入库。用 SQL 按 `title` 分组，保留每组 `created_at` 最新的一条，删除其余：

```sql
-- 找到重复记录（每个 title 保留最新一条）
CREATE TEMP TABLE dup_docs AS
SELECT id FROM (
  SELECT id, title, ROW_NUMBER() OVER (PARTITION BY title ORDER BY created_at DESC) as rn
  FROM documents WHERE source_id = '20000000-0000-0000-0000-000000000001'
) t WHERE rn > 1;

-- 按依赖顺序删除
DELETE FROM event_entities WHERE event_id IN (SELECT id FROM events WHERE document_id IN (SELECT id FROM dup_docs));
DELETE FROM events WHERE document_id IN (SELECT id FROM dup_docs);
DELETE FROM source_chunks WHERE document_id IN (SELECT id FROM dup_docs);
DELETE FROM document_sections WHERE document_id IN (SELECT id FROM dup_docs);
DELETE FROM documents WHERE id IN (SELECT id FROM dup_docs);
```

清理结果: 260 条 → 223 条（删除 37 条重复）

### 3 组同名不同年份法规（源文件即重复标题）

| 标题 | 文件 1 | 文件 2 | 保留 |
|---|---|---|---|
| 海南省城市市政设施管理条例 | (1997-10-25).md | (2024-03-20).md | 最新入库版 |
| 海南省实施《海域使用管理法》办法 | (2015-01-01).md | (2025-04-29).md | 最新入库版 |
| 海南省无规定动物疫病区管理条例 | (2021-09-30).md | (2024-07-31).md | 最新入库版 |

226 个文件 → 223 个唯一标题，去重保留最新版后恰好 223 条文档。

## 遇到的问题与解决

### 1. LLM 事件抽取超时 (P0)

**现象**: HTTP 500 `This operation was aborted`，占首轮失败的 100%
**原因**: 默认 `LLM_TIMEOUT_MS=60000`，部分长法规（10+ chunks）的事件抽取超过 60s
**解决**: 提高到 `180000` (3 分钟)
**建议**: 对法律法规等长文档，`LLM_TIMEOUT_MS` 建议设为 180000-300000

### 2. LLM JSON 输出截断

**现象**: `Unterminated string in JSON at position 7056`
**原因**: Qwen3-8B 在处理特定文档时生成的 JSON 超出 max_tokens 限制，输出被截断
**解决**: 换用 Qwen2.5-32B-Instruct（max_tokens 更大或输出更紧凑）
**注意**: Qwen3-30B-A3B 在硅基流动返回 403 `Model disabled`，不可用

### 3. PostgreSQL 重启导致 SAG 崩溃

**现象**: SAG 进程 `Unhandled 'error' event` 退出，后续请求全部 `fetch failed`
**原因**: PG 重启后，SAG 的连接池中的连接全部断开，触发未捕获的 error 事件
**解决**: 重启 SAG 即可。SAG 上游应改进连接池的 error 事件处理（加 `.on('error', ...)`)

### 4. SAG AI Settings 存在数据库中

**现象**: 修改 `.env` 后重启 SAG，embedding/LLM 配置没变
**原因**: SAG 的 AI 设置优先从 `ai_provider_settings` 表读取，`.env` 只作 fallback
**解决**: 通过 `PUT /api/settings/ai` 更新数据库中的设置，需传完整对象

### 5. Embedding 服务从远程切到本地

**过程**:
1. 先在 SAG 内实现了 `LocalEmbeddingClient` + `LocalRerankClient`（进程内 ONNX 推理）
2. 后改为独立微服务 `embedding-server`（端口 11435），SAG 通过 HTTP 调用
3. 清理了 SAG 内的 `@huggingface/transformers` 依赖和 local client 代码
4. SAG 只需设置 `EMBEDDING_BASE_URL=http://localhost:11435/v1`

## 当前 SAG AI 配置

| 项 | 值 |
|---|---|
| Embedding | 本地 `http://localhost:11435/v1` (bge-m3, ONNX) |
| Rerank | 硅基流动 `BAAI/bge-reranker-v2-m3`（SAG 的 rerank 复用 llmBaseUrl，无法单独指向本地） |
| LLM | 硅基流动 `Qwen/Qwen3-8B` |
| LLM_TIMEOUT_MS | 180000 |

## 后续建议

1. **Rerank 独立配置**: SAG 当前 rerank 复用 `llmBaseUrl`，建议上游增加独立的 `RERANK_BASE_URL` 配置，以便将 rerank 指向本地 embedding-server (`:11435/v1/rerank`)
2. **连接池容错**: SAG 的 PG 连接池应添加 `pool.on('error', ...)` 处理，避免数据库临时重启导致进程崩溃
3. **幂等导入**: 批量导入脚本应在导入前检查是否已存在同标题文档，避免重复入库
4. **LLM 降级**: 对 JSON 截断错误，可实现自动降级到更大模型重试的机制
