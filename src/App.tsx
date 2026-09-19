import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  Customer,
  Slot,
  VisitNode,
  addDays,
  completeNode,
  computeMetrics,
  formatDate,
  nodeStatus,
  todayISO,
  visitDate,
} from "./domain";
import { loadCustomers, resetCustomers, saveCustomers } from "./store";
import { BookingDialog } from "./BookingDialog";

type FilterKey = "all" | "unscheduled" | "scheduled" | "completed" | "overdue";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部节点" },
  { key: "unscheduled", label: "待预约" },
  { key: "scheduled", label: "已预约" },
  { key: "completed", label: "已完成" },
  { key: "overdue", label: "已逾时" },
];

function isOverdue(node: VisitNode, today: string): boolean {
  if (node.completed) return false;
  const due = node.slot ? visitDate(node) : node.nodeDate;
  return due < today;
}

function StatusBadge({ node, today }: { node: VisitNode; today: string }) {
  if (node.completed) return <span className="badge badge-done">已完成</span>;
  if (isOverdue(node, today)) return <span className="badge badge-overdue">已逾时</span>;
  if (node.slot) return <span className="badge badge-scheduled">已预约</span>;
  return <span className="badge badge-todo">待预约</span>;
}

function App() {
  const [customers, setCustomers] = useState<Customer[]>(() => loadCustomers());
  const [filter, setFilter] = useState<FilterKey>("all");
  const [dialog, setDialog] = useState<{ customer: Customer; node: VisitNode } | null>(
    null,
  );
  const [newName, setNewName] = useState("");
  const [newDevice, setNewDevice] = useState("");
  const [newDate, setNewDate] = useState(todayISO());
  const [formError, setFormError] = useState("");
  const [flash, setFlash] = useState("");

  const today = todayISO();

  // 预约与完成记录持久化，刷新后保持不变
  useEffect(() => {
    saveCustomers(customers);
  }, [customers]);

  const metrics = useMemo(() => computeMetrics(customers, today), [customers, today]);

  const visibleCustomers = useMemo(() => {
    if (filter === "all") return customers;
    return customers
      .map((c) => ({
        ...c,
        nodes: c.nodes.filter((n) => {
          if (filter === "overdue") return isOverdue(n, today);
          return nodeStatus(n) === filter;
        }),
      }))
      .filter((c) => c.nodes.length > 0);
  }, [customers, filter, today]);

  function openDialog(customer: Customer, node: VisitNode) {
    if (node.completed) return; // 已完成节点不得覆盖
    setDialog({ customer, node });
  }

  function handleComplete(customer: Customer, node: VisitNode) {
    if (!node.slot || node.completed) return;
    setCustomers((prev) => completeNode(prev, node.id));
    setFlash(`${customer.name}「${node.label}」已标记完成，记录已锁定。`);
  }

  function handleAddCustomer() {
    const name = newName.trim();
    const device = newDevice.trim() || "未填写型号";
    if (!name) {
      setFormError("请填写客户姓名。");
      return;
    }
    if (!newDate) {
      setFormError("请选择初配日。");
      return;
    }
    const id = name.slice(0, 1).toUpperCase() + "-" + String(Date.now()).slice(-4);
    const customer: Customer = {
      id,
      name,
      phone: "—",
      device,
      fittingDate: newDate,
      // 初配日起第 1、7、30 天节点
      nodes: (() => {
        const defs = [
          { day: 1, label: "第1天 · 初戴适应" },
          { day: 7, label: "第7天 · 一周复调" },
          { day: 30, label: "第30天 · 月度评估" },
        ];
        return defs.map((d, i) => ({
          id: `${id}-n${i + 1}`,
          customerId: id,
          milestoneDay: d.day,
          label: d.label,
          nodeDate: addDays(newDate, d.day - 1),
          slot: null as Slot | null,
          scheduledDate: null,
          completed: false,
          completedAt: null,
        }));
      })(),
    };
    setCustomers((prev) => [...prev, customer]);
    setNewName("");
    setNewDevice("");
    setFormError("");
    setFlash(`已建档：${customer.name}，三个回访节点已按初配日生成。`);
  }

  function handleReset() {
    if (window.confirm("将清空当前预约与完成记录并恢复示例数据，确定继续？")) {
      setCustomers(resetCustomers());
      setFlash("已恢复示例数据。");
    }
  }

  const metricCards = [
    { label: "回访节点总数", value: metrics.totalNodes },
    { label: "已完成（锁定）", value: metrics.completed },
    { label: "未来7天接待", value: metrics.weekVisits },
    { label: "待预约 / 逾时", value: `${metrics.unscheduled} / ${metrics.overdue}` },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-01 · 助听器试戴回访调度台</p>
          <h1>回访调度台</h1>
          <p className="subtitle">
            每名客户按初配日自动生成第 1、7、30 天回访节点。临时改期不得跨过后续节点，
            已完成记录不可覆盖；门店同一时段仅接待一人，改期即释放原时段。
          </p>
        </div>
        <div className="stack-card">
          <span>今日</span>
          <strong>{formatDate(today)}</strong>
          <button onClick={handleReset}>恢复示例数据</button>
        </div>
      </section>

      <section className="metrics-grid">
        {metricCards.map((m, i) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={["status-ok", "status-watch", "status-danger", "status-watch"][i]} />
          </article>
        ))}
      </section>

      {flash && (
        <div className="flash" onClick={() => setFlash("")}>
          {flash}（点击关闭）
        </div>
      )}

      <section className="workspace">
        <aside className="panel narrow">
          <h2>节点筛选</h2>
          <div className="chips muted filter-chips">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={filter === f.key ? "chip-active" : ""}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <h2>新建客户档案</h2>
          <div className="add-form">
            <label>
              <span>姓名</span>
              <input
                value={newName}
                placeholder="客户姓名"
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label>
              <span>助听器型号</span>
              <input
                value={newDevice}
                placeholder="如 RIC · 双耳"
                onChange={(e) => setNewDevice(e.target.value)}
              />
            </label>
            <label>
              <span>初配日</span>
              <input
                type="date"
                value={newDate}
                max={today}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </label>
            {formError && <p className="form-error">{formError}</p>}
            <button className="primary-action" onClick={handleAddCustomer}>
              建档并生成节点
            </button>
          </div>
        </aside>

        <section className="panel schedule-panel">
          <div className="section-heading">
            <div>
              <p>调度规则</p>
              <h2>客户回访节点（{visibleCustomers.length} 位客户）</h2>
            </div>
          </div>

          <div className="rules">
            <span>① 节点日固定 = 初配日 + 第1/7/30天</span>
            <span>② 改期只能提前或顺延，不得跨过下一节点日</span>
            <span>③ 同一日期+时段全门店唯一</span>
            <span>④ 改期成功立即释放原时段</span>
            <span>⑤ 已完成节点锁定，不可覆盖</span>
          </div>

          <div className="customer-list">
            {visibleCustomers.map((c) => (
              <article className="customer-card" key={c.id}>
                <header className="customer-head">
                  <div>
                    <h3>{c.name}</h3>
                    <p>
                      {c.id} · {c.device} · 初配 {formatDate(c.fittingDate)}
                    </p>
                  </div>
                </header>
                <div className="node-list">
                  {c.nodes.map((n) => {
                    const rescheduled = n.slot && n.scheduledDate !== null;
                    return (
                      <div
                        key={n.id}
                        className={
                          "node-row" +
                          (n.completed ? " is-completed" : "") +
                          (isOverdue(n, today) ? " is-overdue" : "")
                        }
                      >
                        <div className="node-main">
                          <div className="node-label">
                            <strong>{n.label}</strong>
                            <StatusBadge node={n} today={today} />
                          </div>
                          <div className="node-detail">
                            <span>节点日：{formatDate(n.nodeDate)}</span>
                            {n.slot ? (
                              <span>
                                接待：<em>{formatDate(visitDate(n))} {n.slot}</em>
                                {rescheduled && <i className="tag-move">已改期</i>}
                              </span>
                            ) : (
                              <span className="muted-text">尚未预约时段</span>
                            )}
                          </div>
                        </div>
                        <div className="node-actions">
                          <button
                            disabled={n.completed}
                            onClick={() => {
                              const fresh = customers.find((x) => x.id === c.id)!;
                              const freshNode = fresh.nodes.find((x) => x.id === n.id)!;
                              openDialog(fresh, freshNode);
                            }}
                          >
                            {n.slot ? "改期" : "预约"}
                          </button>
                          <button
                            className="complete-btn"
                            disabled={!n.slot || n.completed}
                            onClick={() => {
                              const fresh = customers.find((x) => x.id === c.id)!;
                              const freshNode = fresh.nodes.find((x) => x.id === n.id)!;
                              handleComplete(fresh, freshNode);
                            }}
                          >
                            {n.completed ? "已完成" : "完成"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
            {visibleCustomers.length === 0 && (
              <p className="empty">当前筛选下没有节点。</p>
            )}
          </div>
        </section>
      </section>

      {dialog && (
        <BookingDialog
          customers={customers}
          customer={dialog.customer}
          node={dialog.node}
          onClose={() => setDialog(null)}
          onConfirm={(next) => {
            setCustomers(next);
            setDialog(null);
            setFlash("预约已保存，原占用时段（如有）已释放。");
          }}
        />
      )}
    </main>
  );
}

export default App;
