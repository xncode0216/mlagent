import sys
import os
import json
import urllib.request
from pathlib import Path

# Add backend to python path to import app modules
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.append(str(BACKEND_DIR))

# Import settings and services from mlagent backend
os.environ["MLAGENT_WORKSPACE_ROOT"] = str(BACKEND_DIR / "workspaces")
from app.core.config import get_settings
from app.schemas.project import ProjectRead
from app.services.project_registry_service import ProjectRegistryService
from app.services.workspace_service import WorkspaceService
from app.services.experiment_service import ExperimentService
from app.services.evolution_service import EvolutionService

def main():
    print("=== 开始构建 IBM 电信客户流失预测 GitHub 实战项目 ===")

    settings = get_settings()
    project_id = "githubchurnproj000000000000001"
    project_name = "IBM 电信客户流失预测实战 (GitHub)"

    # 1. 建立项目的工作目录
    workspace_service = WorkspaceService(settings.workspace_root)
    project_root = workspace_service.ensure_project_root(settings.dev_user_id, project_id)
    print(f"项目物理工作目录创建成功: {project_root}")

    # 创建所有必须的子文件夹
    for sub in ["data", "results", "notebooks", "models", "logs", "agent_schema"]:
        (project_root / sub).mkdir(parents=True, exist_ok=True)

    # 2. 从 GitHub 下载 IBM Telco Customer Churn 数据集
    csv_url = "https://raw.githubusercontent.com/treselle-systems/customer_churn_analysis/master/WA_Fn-UseC_-Telco-Customer-Churn.csv"
    csv_path = project_root / "data" / "telecom_customer_churn.csv"

    print(f"正在从 GitHub 官方源下载电信客户流失数据集...\nURL: {csv_url}")
    try:
        urllib.request.urlretrieve(csv_url, csv_path)
        print(f"数据集成功保存至: {csv_path} (文件大小: {csv_path.stat().st_size / 1024:.2f} KB)")
    except Exception as e:
        print(f"下载数据集失败: {e}")
        print("尝试写入一个本地模拟电信流失数据集以确保演示可用...")
        csv_path.write_text(
            "customerID,gender,SeniorCitizen,Partner,Dependents,tenure,PhoneService,MultipleLines,InternetService,OnlineSecurity,OnlineBackup,DeviceProtection,TechSupport,StreamingTV,StreamingMovies,Contract,PaperlessBilling,PaymentMethod,MonthlyCharges,TotalCharges,Churn\n"
            "7590-VHVEG,Female,0,Yes,No,1,No,No phone service,DSL,No,Yes,No,No,No,No,Month-to-month,Yes,Electronic check,29.85,29.85,No\n"
            "5575-GNVDE,Male,0,No,No,34,Yes,No,DSL,Yes,No,Yes,No,No,No,One year,No,Mailed check,56.95,1889.5,No\n"
            "3668-QPYBK,Male,0,No,No,2,Yes,No,DSL,Yes,Yes,No,No,No,No,Month-to-month,Yes,Mailed check,53.85,108.15,Yes\n"
            "7795-CFOCW,Male,0,No,No,45,No,No phone service,DSL,Yes,No,Yes,Yes,No,No,One year,No,Bank transfer,42.3,1840.75,No\n",
            encoding="utf-8"
        )
        print("本地模拟数据集已就绪。")

    # 3. 模拟并导入一次高准确率的机器学习历史训练实验 runs
    print("正在为该实战项目模拟并写入 ML 模型历史运行实验...")
    exp_service = ExperimentService(project_root)
    exp_service.record_run(
        project_id=project_id,
        experiment_id="exp_telecom_gb_001",
        engine="sklearn",
        dataset_path="data/telecom_customer_churn.csv",
        target_column="Churn",
        use_gpu=False,
        metrics={"accuracy": 0.842},
        model={
            "algorithm": "gradient_boosting",
            "feature_columns": ["tenure", "MonthlyCharges", "TotalCharges"]
        },
        candidate_runs=[],
        model_artifact={"type": "model", "name": "gb_churn_model.pkl", "path": "models/gb_churn_model.pkl"},
        metrics_artifact={"id": "metrics_gb", "type": "training", "name": "metrics.json", "path": "results/metrics.json"}
    )
    print("模型实验 runs 注入完毕。")

    # 4. 模拟自进化规则的沉淀
    print("正在为该项目生成自进化知识...")
    evo_service = EvolutionService(project_root)

    # 规则 1：已采纳规则 (会连接到 MonthlyCharges, tenure 和 Churn)
    rule_adopted = evo_service.create_lesson(
        source_type="session",
        source_id="session_churn_999",
        domain=["MonthlyCharges", "tenure"],
        observation="MonthlyCharges 与 tenure 的交互项对于客户流失（Churn）具有最强相关度，月度话费高且在网时间短的用户流失概率高达 78.4%。",
        recommendation="数据清洗后，强烈推荐衍生一个新特征：MonthlyCharges_per_tenure = MonthlyCharges / (tenure + 1)。在 ML 建模时该特征将大幅提升 XGBoost/GBDT 预测准确度。",
        confidence=0.92,
        title="月度消费与在网时长交互分析法"
    )
    # 将其设为已采纳 (high_confidence)
    evo_service.adopt_lesson(rule_adopted.id)
    print(f"已注入已采纳规则: {rule_adopted.title} (ID: {rule_adopted.id})")

    # 规则 2：待审核规则 (可以在自进化页手动点击采纳)
    rule_pending = evo_service.create_lesson(
        source_type="session",
        source_id="session_churn_999",
        domain=["TotalCharges"],
        observation="TotalCharges 字段包含少量缺失值（主要是由于新用户入网 tenure 为 0 导致），直接删除该行或填充 0 会扭曲梯度树的分裂结果率。",
        recommendation="在电信客户流失预测中，如果遇到 TotalCharges 存在极少缺失，优先采用中位数（Median）进行稳健填充，并配合 RobustScaler 抑制由于合约期极值拉扯造成的偏度偏差。",
        confidence=0.87,
        title="电信总消费额 Robust 填充法"
    )
    print(f"已注入待审核规则: {rule_pending.title} (ID: {rule_pending.id})")

    # 5. 在项目注册表 projects.json 中注册该项目
    print("正在向 MLAgent 平台注册该实战项目...")
    now_iso = "2026-05-21T18:45:00+08:00"
    project_item = ProjectRead(
        id=project_id,
        owner_id=settings.dev_user_id,
        name=project_name,
        workspace_path=str(project_root),
        created_at=now_iso,
        updated_at=now_iso
    )

    # 使用后端的 ProjectRegistryService 保存项目到 projects.json 中
    registry = ProjectRegistryService(settings.workspace_root, settings.dev_user_id)
    registry.save_project(project_item)
    print(f"项目注册完毕！项目ID 为: {project_id}")

    print("\n=======================================================")
    print("=== IBM 电信客户流失预测实战项目 (GitHub) 创建并注入成功 ===")
    print("=======================================================")
    print("您可以通过以下步骤在 MLAgent 前端中体验完整的实战测试：")
    print("1. 刷新您的 MLAgent 前端 Web 页面。")
    print("2. 在顶部导航栏的“项目选择”下拉菜单中，选择：")
    print(f"   * '{project_name}'")
    print("3. 数据分析测试：在左侧文件树中，右键点击 `data/telecom_customer_churn.csv`，")
    print("   可随时选择‘传给 ML Agent’或输入自然语言令 Agent 分析数据和缺失值。")
    print("4. 自进化知识与图谱测试：直接切换到“自进化知识”主页，您将看到：")
    print("   - 待审核列表包含待采纳的《电信总消费额 Robust 填充法》。")
    print("   - 右侧瞬间渲染出美轮美奂的‘三层垂直拓扑自进化图谱’！连接线带粒子流动动画！")
    print("   - 点击‘采纳’新规则，观察其如何飞入拓扑网络并立刻优化‘高级洞察’！")
    print("=======================================================\n")

if __name__ == "__main__":
    main()
