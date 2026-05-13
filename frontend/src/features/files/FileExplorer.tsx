const demoItems = [
  "data/customer_churn.csv",
  "notebooks/eda.py",
  "results/profile.json",
  "models/",
  "agent_schema/",
  "evolution/",
];

export function FileExplorer() {
  return (
    <div>
      <div className="panel-title">项目文件</div>
      <ul className="file-list">
        {demoItems.map((item) => (
          <li key={item} className={item.includes("customer_churn") ? "selected" : ""}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
