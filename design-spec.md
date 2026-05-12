# MLAgent 平台设计规格说明

> 面向专业数据科学家的 AI IDE 风格智能体 Web 平台
> 基于 LLM 对话交互，进行数据分析与机器学习模型搭建

## 项目概述

MLAgent 是一个企业内网 Web 平台，核心理念是基于 LLM 大模型以对话聊天形式进行数据分析和挖掘，支持数据文件读写编辑，并构建训练机器学习模型。

平台内置**自进化 Agent 系统**，能从每次分析/训练任务中提炼经验，沉淀为可复用的知识资产，越用越精准。

### 目标用户

企业内部数据科学家和 ML 工程师

### 两大核心功能

1. **数据分析** — 上传本地数据，与数据分析智能体对话，进行探索、清洗、可视化，产出分析报告和数据文件
2. **机器学习模型搭建** — 依赖数据分析结果，选择/构建/训练/评估机器学习模型，支持 GPU 按需调度

---

## 技术选型

| 层面 | 技术 | 说明 |
|------|------|------|
| 前端 | React + TypeScript | SPA，AI IDE 风格布局 |
| 后端 | FastAPI (Python) | API 网关 + WebSocket |
| 代码执行 | Docker + Jupyter Kernel | 每用户独立 Kernel 容器 |
| 数据库 | PostgreSQL | 用户、会话、操作记录 |
| 缓存 | Redis | 会话状态、任务队列 |
| 文件存储 | 服务端工作目录 | 每用户独立项目空间 |
| LLM | 多模型可切换 | OpenAI / Claude / DeepSeek / 自托管 |
| 图表 | Plotly.js + Matplotlib | 交互探索 + 静态导出 |

---

## 页面布局

### 整体结构：三区 + 状态栏

```
┌──────────────────────────────────────────────────┐
│  [标签栏] sales_analysis │ eda.py │ data_preview  │
├──────────┬────────────────────────┬──────────────┤
│          │                        │              │
│  文件树   │      💬 对话区          │  结果面板     │
│          │                        │  📊 图表     │
│ 📁 data  │  用户与 Agent 聊天交互   │  </> 代码    │
│ 📁 results│                        │  📋 数据     │
│ 📁 models│  内嵌快捷操作 badge      │  📝 日志     │
│          │                        │              │
│ 📊 Agent │                        │  (可折叠)    │
│ 🧠 ML    │                        │              │
├──────────┴────────────────────────┴──────────────┤
│ 🐍 Python 3.11 │ 📦 sklearn │ 🖥️ CPU · MEM │ ⏱ 12min │
└──────────────────────────────────────────────────┘
```

### 设计系统：Dark Precision

- **色彩**：Catppuccin 暗色调 — Base #0a0a0f / Surface #11111b / Accent 蓝 #89b4fa / ML紫 #cba6f7
- **字体**：Inter（UI）+ JetBrains Mono（代码）
- **风格**：暗色 IDE + 微玻璃质感，圆角 6-8px
- **右面板**：默认折叠，Agent 产出图表/代码时自动展开

---

## 系统架构

### 四层架构

```
┌─────────────────────────────────────┐
│  前端层 (React SPA)                  │
│  文件管理 │ 对话面板 │ 结果面板 │ ML  │
└──────────────┬──────────────────────┘
               │ WebSocket + REST
┌──────────────▼──────────────────────┐
│  API 网关 (FastAPI)                  │
│  认证 │ WebSocket │ 文件 │ 会话管理  │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  Agent 编排引擎 (核心)               │
│  ┌──────────────────────────────┐   │
│  │ Agent 调度器 (ReAct 循环)     │   │
│  │ 意图识别 → 路由 → Tool Call  │   │
│  ├──────────────────────────────┤   │
│  │ 工具注册中心                  │   │
│  │ 20+ 预置数据分析/ML 工具      │   │
│  ├──────────────────────────────┤   │
│  │ LLM Router                   │   │
│  │ 多模型调度 & 流式输出         │   │
│  ├──────────────────────────────┤   │
│  │ 自进化引擎                    │   │
│  │ 经验提取 → 规则升华 → 注入    │   │
│  └──────────────────────────────┘   │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  执行层                              │
│  Jupyter Kernel Pool │ GPU 节点调度  │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  数据层                              │
│  PostgreSQL │ 用户工作目录 │ Redis    │
└─────────────────────────────────────┘
```

---

## Agent 体系设计

### 双 Agent + 可扩展 Skill 架构

#### 数据分析 Agent
- 10 个默认工具：load_data, describe, detect_missing, detect_outliers, correlation_matrix, fill_missing, plot_distribution, plot_heatmap, feature_engineer, code_execute
- 系统提示词：资深数据分析师角色

#### ML 训练 Agent
- 10 个默认工具：auto_ml, train_model, tune_hyperparams, cross_validate, compare_models, feature_importance, export_model, predict, request_gpu, code_execute
- 系统提示词：ML 工程师角色

#### Agent 协作
数据分析完成后，一键传递清洗后的数据路径 + 分析上下文 + 列描述给 ML Agent

### Harness Schema 驱动（融合 llm_wiki 设计模式）

每个 Agent 由四文件配置驱动：

```
agent_schema/
├── purpose.md      # Agent 目的、核心问题、分析范围
├── schema.md       # 工作流规则、输出格式、工具使用协议
├── tools.yaml      # 工具注册表、参数 Schema、调用策略
└── evolution.md    # 进化历史：改动、原因、效果
```

### 两步思维链流程

```
第一步（分析）：LLM 分析数据特征 → 结构化分析计划
  - 数据特征识别（列类型、分布、异常）
  - 与历史经验的关联匹配
  - 推荐操作序列 + 风险评估
  → 展示计划给用户确认

第二步（执行）：用户确认后批量执行
  - 工具调用优先（毫秒级）
  - 代码在 Kernel 中执行
  - 并行执行无依赖操作
  - 实时流式进度反馈
  → 结果组装 + 来源标注 + 回写经验
```

---

## 自进化系统（核心差异化）

### 三层闭环

```
Layer 1: 任务结束 → 自动经验提取
  extract_lessons() — 成功经验、失败教训、发现模式

Layer 2: 跨任务聚合 → 经验升华为规则
  consolidate_lessons() — 按领域/操作聚类 → 冲突检测 → 置信度评估

Layer 3: 永久沉淀 → 提升未来效率
  高置信规则注入 Schema → 新增默认工具 → 优化提示词 → 团队共享
```

### 经验数据结构

```yaml
---
type: lesson
id: 2026-05-12-missing-value-median
domain: [数据清洗, 缺失值处理]
quality: success
confidence: 3
trigger_condition: "数值列 | 缺失率 < 10% | 分布偏度 > 1.5"
action: "优先使用中位数填充，而非均值"
rationale: "右偏分布下中位数比均值更鲁棒"
times_validated: 5
times_contradicted: 0
linked_lessons: [outlier-iqr-method, robust-scaling]
---
```

### 进化知识目录

```
evolution/
├── lessons/                    # 每条经验一个 .md 文件
├── rules/
│   ├── high-confidence/        # ≥3 次验证，自动应用
│   ├── medium-confidence/      # 1-2 次验证，建议参考
│   └── conflicts/              # 待人工裁定
├── patterns/                   # 数据模式库
├── consolidation-log.md        # 聚合操作记录
└── evolution.md                # 进化历程总览
```

---

## 数据/模型关联图谱

### 数据关联图谱
- 节点：数据列、特征、数据集
- 边：相关系数、衍生关系、共享来源
- 检测：共线性警告、衍生特征链、数据泄漏路径、孤立特征

### 模型关联图谱
- 节点：模型实例、参数配置、评估指标
- 边：继承关系、相似配置、性能对比
- 检测：最优模型路径、过拟合迹象、模型家族聚类

### 图谱洞察引擎
- 惊奇连接：意外高相关特征对、跨任务可迁移特征
- 知识空白：未探索的特征组合、未尝试的模型架构

---

## 项目管理

### 项目制 + 临时会话
- 默认项目制：文件持久化，可随时回访继续
- 支持快速临时会话，临时会话可升级为项目
- 每个用户有个人使用记录和历史

### 项目目录结构

```
workspaces/{user_id}/{project_name}/
├── data/              # 上传的原始数据
├── results/           # 分析产出（图表、报告、清洗后数据）
├── notebooks/         # 生成的 Python 脚本
├── models/            # 训练好的模型文件
├── agent_schema/      # Agent 配置（purpose/schema/tools/evolution）
├── index.md           # 项目内容索引
└── log.md             # 操作时序记录
```

---

## ML 模型搭建

### 四个入口
1. **自动 ML** — Agent 自动选择模型、调参、评估对比（推荐入口）
2. **自定义流程** — 用户指定模型类型、参数范围、验证策略
3. **实验对比** — 并行训练多模型，对比指标、导出最佳
4. **部署导出** — 导出 ONNX/PMML/pkl，生成预测脚本

### GPU 调度
- GPU 按需申请，Agent 询问用户是否使用
- GPU 节点队列调度，训练完成后释放
- 支持训练进度实时可视化

---

## 增量缓存 & 持久化队列

### 增量计算缓存
- 数据文件 SHA256 哈希 → 跳过未变更重分析
- 中间结果缓存（describe、corr、特征重要性）
- 代码块哈希 → 相同代码+相同数据 = 重用结果
- 数据变更自动清除关联缓存

### 持久化任务队列
- ML 训练任务异步入队
- 支持取消、重试（最多3次）、优先级
- 崩溃恢复：队列持久化到磁盘
- 前端实时进度可视化

---

## 后续实施阶段

### Phase 1: 核心骨架（后端基础）
- FastAPI 项目结构搭建
- 用户认证（JWT）
- PostgreSQL 数据模型（用户、项目、会话）
- 基础文件管理 API

### Phase 2: 执行环境
- Docker + Jupyter Kernel 集成
- Kernel Pool 管理
- 工作目录隔离

### Phase 3: Agent 引擎
- Agent 调度器（ReAct 循环）
- 工具注册中心
- LLM Router（多模型调度）
- WebSocket 流式通信

### Phase 4: 前端界面
- React 项目搭建
- IDE 三栏布局
- 对话面板（Markdown 渲染、图表内嵌）
- 文件树 & 结果面板

### Phase 5: 数据分析 Agent
- 10 个默认工具实现
- 两步思维链分析
- Harness Schema 配置
- 图表渲染（Plotly + Matplotlib）

### Phase 6: ML Agent
- 10 个默认工具实现
- GPU 调度
- 训练任务队列
- 模型对比可视化

### Phase 7: 自进化系统
- 经验提取引擎
- 跨任务聚合
- 规则注入机制
- 置信度管理

### Phase 8: 高级特性
- 数据/模型关联图谱
- 图谱洞察引擎
- 团队共享知识库
- 深度研究和审核系统

---

*设计日期：2026-05-12*
*参考：Karpathy LLM Wiki 方法论、nashsu/llm_wiki Harness 设计模式*
