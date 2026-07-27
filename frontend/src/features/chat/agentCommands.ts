export type AgentCommandMode = "analysis" | "machine-learning";

export type AgentCommandId =
  | "profile"
  | "clean"
  | "transform"
  | "train"
  | "gpu"
  | "evaluate"
  | "diagnose"
  | "iterate"
  | "export"
  | "learn"
  | "continue";

export type AgentCommandContext = {
  mode: AgentCommandMode;
  activeFile?: string;
  focusedExperimentId?: string | null;
  preprocessingPlanPath?: string | null;
  targetColumn?: string;
  trainingDatasetPath?: string;
};

export type AgentCommandDefinition = {
  id: AgentCommandId;
  slash: `/${string}`;
  label: string;
  description: string;
  category: "数据" | "机器学习" | "交付" | "恢复";
  keywords: string[];
  buildPrompt: (context: AgentCommandContext) => string;
};

function activeDataset(context: AgentCommandContext) {
  return context.trainingDatasetPath || context.activeFile || "当前数据集";
}

function selectedRun(context: AgentCommandContext, fallback: string) {
  return context.focusedExperimentId ? `experiment ${context.focusedExperimentId}` : fallback;
}

export const AGENT_COMMANDS: readonly AgentCommandDefinition[] = [
  {
    id: "profile",
    slash: "/profile",
    label: "数据画像",
    description: "检查缺失值、分布、唯一值和目标列候选",
    category: "数据",
    keywords: ["分析", "质量", "缺失值", "分布", "profile"],
    buildPrompt: (context) => `分析 ${activeDataset(context)} 的数据质量、缺失值和分布`,
  },
  {
    id: "clean",
    slash: "/clean",
    label: "清洗方案",
    description: "基于真实画像生成安全的数据清洗建议",
    category: "数据",
    keywords: ["清理", "缺失值", "特征", "clean"],
    buildPrompt: (context) => `为 ${activeDataset(context)} 生成安全的清洗方案和特征工程建议`,
  },
  {
    id: "transform",
    slash: "/transform",
    label: "预处理计划",
    description: "生成可审批、可执行的预处理计划",
    category: "数据",
    keywords: ["变换", "编码", "标准化", "预处理", "transform"],
    buildPrompt: (context) => `为 ${activeDataset(context)} 生成可执行的预处理计划，等待我审批后再执行`,
  },
  {
    id: "train",
    slash: "/train",
    label: "训练计划",
    description: "基于当前数据集配置 sklearn 训练",
    category: "机器学习",
    keywords: ["建模", "模型", "sklearn", "训练", "train"],
    buildPrompt: (context) =>
      `基于 ${activeDataset(context)} 制定 sklearn 训练计划${
        context.targetColumn ? `，目标列 ${context.targetColumn}` : ""
      }${context.preprocessingPlanPath ? `，使用预处理计划 ${context.preprocessingPlanPath}` : ""}`,
  },
  {
    id: "gpu",
    slash: "/gpu",
    label: "GPU 评估",
    description: "判断当前训练是否需要 GPU 资源",
    category: "机器学习",
    keywords: ["显卡", "资源", "队列", "gpu"],
    buildPrompt: (context) => `评估 ${activeDataset(context)} 是否需要 GPU 训练，并说明原因`,
  },
  {
    id: "evaluate",
    slash: "/evaluate",
    label: "评估与报告",
    description: "比较模型指标并生成评估报告",
    category: "机器学习",
    keywords: ["模型对比", "指标", "报告", "evaluate"],
    buildPrompt: (context) => `评估 ${selectedRun(context, "最新完成的实验")} 并生成模型对比报告`,
  },
  {
    id: "diagnose",
    slash: "/diagnose",
    label: "错误诊断",
    description: "检查混淆矩阵、错误切片和预测样本",
    category: "机器学习",
    keywords: ["错误样本", "召回率", "混淆矩阵", "诊断", "diagnose"],
    buildPrompt: (context) => `诊断 ${selectedRun(context, "最新完成的实验")} 的错误样本和类别质量`,
  },
  {
    id: "iterate",
    slash: "/iterate",
    label: "迭代建议",
    description: "从当前诊断提出下一轮实验方案",
    category: "机器学习",
    keywords: ["改进", "重训", "实验", "iterate"],
    buildPrompt: (context) => `根据 ${selectedRun(context, "最新完成的实验")} 的诊断提出下一轮迭代方案`,
  },
  {
    id: "export",
    slash: "/export",
    label: "导出交付包",
    description: "收集模型、指标、报告和可复现元数据",
    category: "交付",
    keywords: ["打包", "下载", "交付", "export"],
    buildPrompt: (context) => `导出 ${selectedRun(context, "最新完成的实验")} 的可复现交付包`,
  },
  {
    id: "learn",
    slash: "/learn",
    label: "提取经验",
    description: "从当前会话提出需要人工审核的规则",
    category: "交付",
    keywords: ["沉淀", "知识", "规则", "lesson", "learn"],
    buildPrompt: () => "从当前会话提取可复用经验，并等待我审核后再采用",
  },
  {
    id: "continue",
    slash: "/continue",
    label: "继续失败步骤",
    description: "读取持久化任务状态并恢复最安全的下一步",
    category: "恢复",
    keywords: ["重试", "恢复", "失败", "retry", "continue"],
    buildPrompt: () => "继续上次失败的步骤，并先说明将要恢复的阶段",
  },
] as const;

const QUICK_COMMAND_IDS: Record<AgentCommandMode, AgentCommandId[]> = {
  analysis: ["profile", "clean", "train"],
  "machine-learning": ["train", "gpu", "evaluate"],
};

function commandById(id: AgentCommandId) {
  return AGENT_COMMANDS.find((command) => command.id === id)!;
}

export function quickAgentCommands(mode: AgentCommandMode) {
  return QUICK_COMMAND_IDS[mode].map(commandById);
}

export function availableAgentCommands(mode: AgentCommandMode) {
  const quickIds = new Set(QUICK_COMMAND_IDS[mode]);
  return [...quickAgentCommands(mode), ...AGENT_COMMANDS.filter((command) => !quickIds.has(command.id))];
}

export function filterAgentCommands(commands: readonly AgentCommandDefinition[], query: string) {
  const normalized = query.trim().replace(/^\//, "").toLocaleLowerCase();
  if (!normalized) return [...commands];
  return commands.filter((command) =>
    [command.slash.slice(1), command.label, command.description, command.category, ...command.keywords]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalized),
  );
}

export function resolveSlashCommand(value: string, context: AgentCommandContext) {
  const match = value.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const [, commandName, argumentText = ""] = match;
  const command = AGENT_COMMANDS.find((candidate) => candidate.slash.slice(1) === commandName.toLocaleLowerCase());
  if (!command) return null;
  const prompt = command.buildPrompt(context);
  const supplement = argumentText.trim();
  return {
    command,
    prompt: supplement ? `${prompt}。用户补充：${supplement}` : prompt,
  };
}
