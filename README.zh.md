<div align="center">
  <img src="frontend/public/favicon.svg" alt="CrossedArts 徽标" height="96" />
</div>

# CrossedArts - Learning Operating System

[![Deploy to GitHub Pages](https://github.com/marodriguezd/CrossedArts/actions/workflows/deploy.yml/badge.svg)](https://github.com/marodriguezd/CrossedArts/actions/workflows/deploy.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

**在线应用：**[https://marodriguezd.github.io/CrossedArts/](https://marodriguezd.github.io/CrossedArts/)

[English](README.md) · [Español](README.es.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Italiano](README.it.md) · 中文

---

## 是什么

CrossedArts 是一个个人的、**本地优先的可视化学习与知识平台**，完全在浏览器中运行。它将课程、书籍、导入文档、笔记、概念与你产出的作品汇于一个环境——全部存于本地 SQLite 数据库，无需后端服务器。

一切按学习者真实的学习方式组织：展示在学内容的 **Dashboard** 画廊、呈现它们关联的**知识图谱**、学习上下文的**山峰**进度视图，以及记录你产出的**实践作品**。它刻意**领域中立**：数学、音乐、编程或艺术都同样适用。

本应用面向想要完全拥有学习数据、不依赖云服务或订阅的学习者。

## 功能

- **Dashboard 画廊：**精心策划的学习可视入口——课程、书籍、导入文档与实践作品，按用途分组（继续学习、导入资源、实践作品）
- **今天 / 专注：**对“我现在该做什么？”的唯一确定性回答——下一课、到期复习、待定实践、未达目标与最近学习的资源，每项都附列出理由
- **课程与课时：**层级课程结构，含模块、课时与可编辑 Markdown 内容
- **书籍与资源：**图书馆目录，含阅读进度、导入文档（PDF、EPUB、TXT、MD）与资源整理
- **学习会话：**统一抽认卡复习（SM-2）、练习题与混合模式，本地进度跟踪
- **实践作品：**你产出的练习、项目、文章、绘画或代码，链接到其展示的资源、课时或概念——适用于任何学科。每项打开一个**实践工作区**，含 Markdown 内容、持久化清单、自评与所属上下文
- **学习目标：**用户自定义的显式目标（课程、书籍、实践、习惯）与目标日期；目标进度仅由实测进度推导，绝不虚构
- **分析：**每日学习序列、正确率、按资源活跃度、区间对比（7/30/90 天/全部）与连击——均由真实学习会话与复习计算
- **知识图谱：**课程、书籍、模块、课时、笔记、概念、实践作品及其关系的交互式 2D 可视化，外加**结构分析**（度、连通分量、弱连接与最近触达节点），描述拓扑而绝不对重要性排序
- **山峰进度：**旅程指示器，全局或限定于某课程，使用真实实测进度与真实课程模块作里程碑
- **课程包：**将资源的*教学材料*（大纲与建议作业，绝不含你的进度或笔记）导出为便携 JSON 包，可分享、可增量导入
- **本地媒体：**经 File System Access API 播放本地文件夹的视频与音频
- **本地搜索：**确定性 SQL 全内容搜索，外加全局命令面板（Ctrl+K）
- **文档摄入：**在浏览器内解析 PDF、EPUB、TXT 与 MD 文件，SHA-256 去重
- **AI 提供方：**本地设备端推理（WebLLM/WebGPU）、启发式演示模式、Ollama 或 OpenAI API。回答携带**来源引用**，回指其依据的确切资源、课时或笔记，并注明生成它的提供方与模型
- **备份与导出：**二进制 SQLite 导出/导入与 JSON 备份（含 schema 校验）
- **PWA：**离线可用的 app shell，service worker 缓存

## 本地优先模型

CrossedArts 采用双存储架构：

- **SQLite WASM**（`sql.js`）：在浏览器中运行的规范关系数据库。存储全部学习数据——课程、课时、笔记、抽认卡、概念、会话与资源。
- **IndexedDB**：浏览器重启后仍存续的持久层。每次变更都将 SQLite 数据库序列化到 IndexedDB。

**无需后端即可工作：**
- 全部学习活动（课程、课时、笔记、抽认卡、学习会话）
- 本地媒体播放
- 文档摄入与搜索
- 知识图谱可视化
- 备份与恢复

**需要网络访问：**
- 本地 AI 模型的首次下载（WebLLM 权重、embedding 模型）
- OpenAI API 调用（opt-in）
- Ollama 连接（opt-in，本地服务器）

## AI 与搜索

CrossedArts 支持四种 AI 提供方模式：

| 模式 | 说明 | 需要网络 |
|------|-------------|---------------|
| **本地（WebLLM）** | 经 WebGPU 的设备端推理。模型：Qwen3 1.7B（默认）、Llama 3.2 1B、SmolLM2 1.7B、Qwen3 0.6B | 仅首次下载 |
| **演示** | 基于本地内容的启发式回答。不加载 AI 模型 | 否 |
| **Ollama** | 连接 `http://localhost:11434` 的本地 Ollama 服务器 | 局域网 |
| **OpenAI** | 使用 OpenAI API，密钥仅存内存 | 是 |

**Embedding 与 RAG：**
- 经 Transformers.js 的本地 embedding，使用 `onnx-community/embeddinggemma-300m-ONNX`（768 原生维度，经 Matryoshka Representation Learning 存为 256 维）
- 词法搜索与语义 embedding 相结合的混合检索
- 向量缓存于 IndexedDB，SHA-256 内容哈希与 pipeline 版本化（`v2.0-embeddinggemma-mrl256-sha256`）
- 全部 embedding 计算在设备上完成；浏览器集成使用验证过的 ONNX EmbeddingGemma 300M 导出，目前为正确性优先使用 WASM

## 进度语义

CrossedArts 跟踪多个都叫“进度”的不同东西，绝不悄悄混用：实测进度（完成的课时、读过的页数）显示为百分比；粗粒度状态（`not started` / `in progress` / `completed`）显示为状态，绝不显示为虚构百分比。实践完成度、概念掌握与学习活跃度是各自独立的概念。

完整规则——包括哪种产物参与画廊、图谱、山峰与课程包——见 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

## 限制

- **不是完整 LMS：**CrossedArts 没有班级、注册、评分、教师账号或远程课堂。课程包是便携*教学材料*，不是管理系统。
- **浏览器支持：**本地媒体功能需要 Chrome、Edge 或 Brave（File System Access API）。其他浏览器可使用全部非媒体功能。
- **本地 AI 硬件：**本地 LLM 推理建议 WebGPU 显卡。CPU 回退可用但较慢。
- **首次下载：**首次使用本地 AI 需下载模型权重；embedding 模型按需获取并由浏览器缓存。
- **媒体备份：**本地媒体文件不含于 SQLite 备份。仅备份数据库；恢复后需重新链接媒体。
- **无自动同步：**未内置多设备同步。导出/导入是手动迁移机制。
- **单用户：**无多用户支持或鉴权。

## 快速开始

### 前置要求

- Node.js v22 或更高（测试套件使用 `--experimental-strip-types`）
- Chrome、Edge 或 Brave 浏览器

### 安装与开发

```bash
git clone https://github.com/marodriguezd/CrossedArts.git
cd CrossedArts/frontend
npm install
npm run dev
```

在浏览器打开 `http://localhost:5173`。

### 测试

```bash
cd frontend
npm test
```

测试套件含 63 个文件 715 个测试，覆盖 SQLite 初始化、SM-2 算法、学习会话、知识图谱（含结构分析）、RAG 与引用溯源、文档摄入、AI 提供方、学习产物投影、山峰定界、课程包冲突、学习目标、分析、专注规划、实践工作区、WCAG 主题对比度与禁用态可读性。

#### 可视与响应式 QA（部署强制，本地可选）

渲染层用 Playwright 针对生产构建程序化验证——三个视口（桌面 1280×800、平板 834×1112、手机 390×844），检查横向溢出、控制台错误、各视图预期标题、命令面板、主题切换与实践工作区：

```bash
cd frontend
npx playwright install chromium   # 一次即可
npm run build
npm run preview:qa &             # 在 127.0.0.1:4173 提供构建
QA_URL=http://127.0.0.1:4173 npm run qa:visual
```

截图写入 `/tmp/crossedarts-qa`（从不提交）。客观检查失败时 runner 非零退出。

在自己机器上跑该套件可选——`npm test` 已覆盖功能行为。**通过它不是可选的**：它针对即将发布的确切生产构建运行，且 `Deploy to Pages` 任务声明 `needs: [build-frontend, validate-backend]`，因此 Visual QA 失败会阻止部署到 GitHub Pages。它还在每个针对 `main` 的 PR 与 `workflow_dispatch` 手动运行。

> [!WARNING]
> 请用 `npm run preview:qa` 而非 `npm run preview -- --port …`：npm 不会把尾随参数转发给 Vite，端口与 `--strictPort` 标志会被静默丢弃。

### 构建

```bash
cd frontend
npm run build
```

生产产物生成于 `frontend/dist/`。

## 架构

CrossedArts 是 monorepo，含两个独立组件：

- **`frontend/`**：React 19 + TypeScript + Vite 单页应用。部署到 GitHub Pages。
- **`backend/`**：可选的 Python FastAPI 服务器，用于批量摄入与高级分析。

前端无需后端即可完全工作。后端为重处理工作流提供附加服务。

## 后端伴侣

可选的 Python 后端提供：

- 批量文档摄入（PDF、EPUB）
- 元数据提取与缩略图生成
- Sentence Transformers embedding
- LangChain LLM 工作流

配置：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
PYTHONPATH=. alembic -c backend/alembic.ini upgrade head
python -m backend.app.main
```

API 服务器运行于 `http://127.0.0.1:8080`，交互文档位于 `/docs`。

### 网络暴露是 opt-in

> [!CAUTION]
> API **无鉴权**，仅供本地使用。默认绑定 `127.0.0.1`，在非 loopback 接口启动（如
> `HOST=0.0.0.0`）会被**拒绝**，除非显式设置 `ALLOW_NETWORK_ACCESS=true`。启用该标志会把
> 可写的未鉴权 API 暴露到你的网络；若启用，请用防火墙或反向代理限制端口。使用 Ollama 时，
> 将 `OLLAMA_ORIGINS` 设为你的确切 origin（如 `http://localhost:5173`）而非 `"*"`。

## 数据备份

在设置视图内：

- **导出 SQLite：**下载标准的 `.sqlite` 数据库文件
- **导入 SQLite：**从之前的 `.sqlite` 备份恢复
- **导出 JSON：**生成全部表的结构化转储
- **导入 JSON：**从 JSON 备份恢复（变更前先校验）

## 第三方声明

第三方依赖保留各自许可：
- `onnx-community/embeddinggemma-300m-ONNX`：Gemma 使用条款
- `Xenova/multilingual-e5-small`：MIT
- WebLLM（`@mlc-ai/web-llm`）：Apache-2.0
- Transformers.js（`@huggingface/transformers`）：Apache-2.0
- SQLite WASM（`sql.js`）：MIT
