export type ActivityMode =
  | "explorer"
  | "search"
  | "data"
  | "experiments"
  | "version"
  | "knowledge"
  | "account"
  | "settings";

export type ActivityPanelInfo = {
  id: ActivityMode;
  label: string;
  title: string;
  description: string;
  group: "primary" | "secondary";
};

export const activityPanels: ActivityPanelInfo[] = [
  {
    id: "explorer",
    label: "工作区",
    title: "工作区",
    description: "管理项目、会话和文件。",
    group: "primary",
  },
  {
    id: "search",
    label: "搜索",
    title: "项目搜索",
    description: "按文件名或内容检索当前项目。",
    group: "primary",
  },
  {
    id: "data",
    label: "数据源",
    title: "数据源",
    description: "查看项目中的数据文件和当前活跃数据集。",
    group: "primary",
  },
  {
    id: "experiments",
    label: "实验",
    title: "实验",
    description: "查看训练实验、模型指标和 GPU 状态。",
    group: "primary",
  },
  {
    id: "version",
    label: "版本",
    title: "版本与审计",
    description: "查看项目位置、会话和近期运行痕迹。",
    group: "primary",
  },
  {
    id: "knowledge",
    label: "知识库",
    title: "知识库",
    description: "查看自进化经验、协议和知识图谱入口。",
    group: "primary",
  },
  {
    id: "account",
    label: "账户",
    title: "账户",
    description: "查看当前开发用户和会话连接状态。",
    group: "secondary",
  },
  {
    id: "settings",
    label: "设置",
    title: "设置",
    description: "查看本地服务、运行时和 QA 快捷入口。",
    group: "secondary",
  },
];

export function getActivityPanelInfo(id: ActivityMode): ActivityPanelInfo {
  return activityPanels.find((panel) => panel.id === id) ?? activityPanels[0];
}
