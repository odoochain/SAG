# SAG v1 与 v2 对比

## 总结

v2 不是 v1 的小版本升级，而是一次完整重写后的产品化版本：

- **v1**：专注 SAG 检索算法的 TypeScript 工作台。
- **v2**：面向本地知识库用户的完整产品，功能范围更广，但系统复杂度也明显增加。

两个版本没有共同 Git 历史，不能直接通过 `merge` 或 `cherry-pick` 复用代码。

## 基本信息

| 项目 | v1 | v2 |
|---|---|---|
| 代码形态 | 单体 TypeScript 工作区 | 多应用 monorepo |
| 后端 | Fastify + TypeScript | FastAPI + Python |
| 前端 | React + Vite + Tailwind | Next.js Web + Electron Desktop |
| 检索引擎 | 本地 TypeScript 实现 | `zleap-sag` Python 引擎 |
| 默认关系存储 | PostgreSQL | SQLite |
| 默认向量存储 | pgvector | LanceDB |
| 文档定位 | Markdown/TXT 检索工作台 | 完整知识库产品 |
| 分支关系 | 本地 `v1` 分支 | `v2` 跟踪 `Zleap-AI/main` |

## v2 的主要改进

### 1. 部署门槛更低

v1 默认需要 PostgreSQL 和 pgvector；v2 默认使用 SQLite + LanceDB，可以不依赖外部数据库启动，更适合个人用户、桌面端和快速试用。

v2 同时保留 PostgreSQL/pgvector 等生产配置路径，并提供完整 Docker Compose 部署和桌面应用发行能力。

### 2. 文档处理能力更广

v1 主要面向 Markdown/TXT 文档。v2 增加了：

- PDF
- DOCX
- PPTX
- XLS/XLSX
- 网页来源
- MinerU
- MarkItDown
- 解析缓存和 fallback

因此 v2 更适合处理法律法规的 PDF、扫描件和 Office 原始资料。

### 3. 后台任务更完善

v1 的导入流程主要由一次性服务调用完成，虽然提供进度事件，但任务管理相对简单。

v2 增加了：

- 后台任务队列
- 暂停和恢复
- 自动或手动重试
- 删除和重新处理
- 检查点
- 任务状态跟踪
- 失败恢复
- 长任务进度管理

这对批量导入大量法规文件是明显改进。

### 4. API 更规范

v1 的 Fastify 路由主要集中在 `src/api/server.ts`，使用若干 `/api/*` 和未版本化端点。

v2 使用 FastAPI 和 `/api/v1/*` 版本化路由，并增加：

- OpenAPI 文档
- Pydantic 请求模型
- 认证
- 结构化错误响应
- 请求 ID
- OpenAI 兼容接口
- Dify 接口
- MCP
- Agent API

### 5. 检索生命周期更可靠

v1 已经实现向量召回、实体召回、事件扩展、多跳查询和重排。v2 在此基础上增加：

- 中文词语切分和词法分析
- 多种搜索策略
- vector fallback
- global/source-scoped 搜索
- 正在删除或重新处理的文档不参与检索
- 更严格的来源隔离

特别是文档删除和重新处理期间避免旧数据继续进入检索结果，提升了数据一致性和可靠性。

### 6. 测试和发布能力更强

v1 主要使用 Vitest，测试规模较小。v2 增加了：

- Python 后端测试
- Web 单元测试
- PostgreSQL/pgvector E2E 测试
- 存储迁移测试
- OCTX 测试
- 任务生命周期测试
- 桌面端测试
- CI 中的 lint、类型检查、构建和发布检查

### 7. 数据迁移能力更强

v2 增加 OCTX 导入导出和向量复用能力，可用于：

- 知识库备份
- 跨实例迁移
- 保留已有向量
- 数据完整性校验
- 冲突处理
- 失败恢复

## v2 的退步和代价

### 1. 技术栈复杂度明显增加

v1 的主要技术栈是：

```text
TypeScript + Fastify + React + PostgreSQL
```

v2 变为：

```text
Python FastAPI
Python zleap-sag engine
Next.js Web
Electron Desktop
SQLite/LanceDB/PostgreSQL
```

开发和维护需要同时处理 Python、Node、Next.js、Electron 以及多个存储后端。

### 2. v1 API 不兼容

v1 的 `/ingest`、`/search`、`/api/projects`、`/api/documents` 等接口不能直接用于 v2。v2 的 API 路径、认证方式和数据模型均有变化，现有脚本需要重新适配。

### 3. 检索实现不再完全透明

v1 的搜索核心主要位于：

```text
src/services/search-service.ts
src/db/repositories.ts
```

v2 将核心能力封装在 `zleap-sag` 包中。这样有利于复用和产品化，但调试或修改法律领域检索逻辑时，需要同时检查应用层和外部引擎包。

### 4. 默认定位偏向单用户本地应用

v2 明确采用 local-first、single-user 定位。多人共享、权限管理和长期服务化部署需要额外配置 PostgreSQL、认证以及资源管理。

v1 虽然也不是完整的 SaaS 系统，但 PostgreSQL、tenantId 和项目隔离模型更适合继续扩展为法律知识库服务。

### 5. 部署配置更复杂

v2 Web 前端通常在构建时注入 `NEXT_PUBLIC_API_BASE`。修改 API 地址可能需要重新构建 Web 镜像。相比之下，v1 的 Vite 开发代理和单一 Node 服务更简单。

## 对现有海南法规工作的影响

### 可以直接复用的内容

以下内容主要是领域经验或独立资料，不依赖 v1 的代码结构：

- 海南法规原始 Markdown 文件
- 文档标题提取和清理规则
- `heading_strict` 分块经验
- Ollama bge-m3 Embedding 配置经验
- SiliconFlow Qwen3-8B 抽取配置经验
- 法律领域的检索参数和质量观察
- 海南法规导入过程报告

### 需要改造后复用的内容

`batch-ingest-laws.ts` 和 `retry-failed-ingest.ts` 是针对 v1 `/ingest` API 编写的客户端脚本。迁移到 v2 时需要改造：

- v2 API 端点
- 认证方式
- 上传请求格式
- 异步任务创建和状态轮询
- 失败重试逻辑
- source/knowledge base 数据模型

### 不应直接迁移的内容

以下内容与 v1 的实现强绑定，不能直接复制到 v2：

- v1 PostgreSQL 表结构
- v1 `src/services/ingestion-service.ts`
- v1 `src/services/search-service.ts`
- v1 `src/db/repositories.ts`
- v1 HTTP API 路由
- v1 React WebUI 组件

## 数据迁移建议

v1 和 v2 的数据库 schema、事件表、实体表、向量表均不兼容。最稳妥的迁移方式不是复制 v1 数据库，而是重新导入原始文件：

```text
原始法规 Markdown 文件
    -> 适配 v2 的导入脚本
    -> v2 上传/创建文档任务 API
    -> v2 重新解析、抽取和向量化
```

这样会重新消耗模型调用和处理时间，但可以避免跨版本 schema 映射造成的数据一致性问题。

## 针对法律 RAG 的推荐路线

### 当前阶段继续使用 v1

v1 更适合作为当前法律检索实验和数据验证平台，因为：

- 已有 223 篇海南法规入库
- Ollama + SiliconFlow 管道已经跑通
- 可以直接修改实体、事件、关系和 SQL
- 检索核心透明，便于实验和排查
- 现有批量导入脚本可以继续运行

### 后续产品化评估 v2

v2 更适合作为后续产品化基础，因为：

- 支持 PDF、Office 和网页来源
- 具备后台任务、暂停、重试和恢复
- 提供 OpenAPI、Dify、OpenAI 兼容接口
- 支持桌面端和一键部署
- 支持知识库导入导出和向量迁移
- 测试与 CI 体系更完整

## 建议的并行策略

不要把 v1 直接合并到 v2。建议：

1. `v1` 继续作为法律 RAG 实验和数据验证分支。
2. `v2` 作为产品化分支独立演进。
3. 将 v1 中的法规导入规则、模型配置和评估经验重新移植到 v2。
4. 不直接移植 v1 的数据库 schema、TypeScript service、SQL repository 和 WebUI。
5. 在 v2 导入少量法规样本后，先对比分块、事件抽取、实体抽取和检索质量，再决定是否重新导入完整数据集。

## 最终结论

**v2 在产品能力、文档兼容性、任务管理、部署体验和测试体系上明显领先；v1 在结构简单、检索透明、法律 RAG 实验效率和现有数据连续性上更有优势。**

两者更适合并行使用，而不是直接合并。