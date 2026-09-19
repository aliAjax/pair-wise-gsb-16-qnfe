import { useEffect, useMemo, useState } from "react";
import "./styles.css";

/* ---------------- 领域常量与工具 ---------------- */

const STORAGE_KEY = "hxwl-followup-dispatch-v1";

const STAGES = [
  { offset: 1, label: "第1天", short: "D1" },
  { offset: 7, label: "第7天", short: "D7" },
  { offset: 30, label: "第30天", short: "D30" },
];

// 门店同一时段只接待一人：每天固定六个时段
const SLOTS = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toISO(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(iso: string, days: number) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

function fmtCN(iso: string) {
  const d = parseISO(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`;
}

function todayISO() {
  return toISO(new Date());
}

function nodeId(customerId: string, stageIndex: number) {
  return `${customerId}#${stageIndex}`;
}

function splitSlot(slot: string) {
  const [date, time] = slot.split(" ");
  return { date, time };
}

/* ---------------- 类型 ---------------- */

interface Customer {
  id: string;
  code: string;
  name: string;
  model: string;
  fittingDate: string; // 初配日
}

interface FollowupNode {
  id: string;
  customerId: string;
  stageIndex: number;
  slot: string; // "YYYY-MM-DD HH:mm"，当前预约时段
  status: "scheduled" | "completed";
  completedAt?: string;
}

interface Database {
  customers: Customer[];
  nodes: FollowupNode[];
}

interface ConflictItem {
  customer: string;
  nodeDate: string; // 冲突方的节点日（初配 + 1/7/30）
  originalSlot: string; // 冲突方已占用的原时段
}

type Feedback =
  | { kind: "ok"; message: string }
  | { kind: "rule"; message: string }
  | {
      kind: "conflict";
      request: { customer: string; nodeDate: string; targetSlot: string };
      items: ConflictItem[];
    }
  | null;

/* ---------------- 示例数据 ---------------- */

function seedDatabase(): Database {
  const t = todayISO();
  const customers: Customer[] = [
    { id: "wx024", code: "WX-024", name: "王秀兰", model: "RIC 双耳 · 高频增益", fittingDate: addDays(t, -3) },
    { id: "cj118", code: "CJ-118", name: "陈建国", model: "BTE 单耳 · 传导性补偿", fittingDate: addDays(t, -1) },
    { id: "zx077", code: "ZX-077", name: "赵晓梅", model: "RIC 双耳 · 言语程序", fittingDate: addDays(t, -8) },
    { id: "lz052", code: "LZ-052", name: "林志远", model: "ITE 双耳 · 降噪程序", fittingDate: t },
    { id: "sl089", code: "SL-089", name: "孙丽华", model: "RIC 双耳 · 老人语频", fittingDate: addDays(t, -6) },
  ];

  // 默认排班：同一时段保证不撞单，部分第1/7天节点已完成
  const plan: Array<[string, number, string, string, FollowupNode["status"]?]> = [
    ["wx024", 0, addDays(t, -2), "10:00", "completed"],
    ["wx024", 1, addDays(t, 4), "10:00"],
    ["wx024", 2, addDays(t, 27), "10:00"],

    ["cj118", 0, t, "14:00"],
    ["cj118", 1, addDays(t, 6), "14:00"],
    ["cj118", 2, addDays(t, 29), "15:00"],

    ["zx077", 0, addDays(t, -7), "09:00", "completed"],
    ["zx077", 1, addDays(t, -1), "11:00", "completed"],
    ["zx077", 2, addDays(t, 22), "09:00"],

    ["lz052", 0, addDays(t, 1), "16:00"],
    ["lz052", 1, addDays(t, 7), "16:00"],
    ["lz052", 2, addDays(t, 30), "16:00"],

    ["sl089", 0, addDays(t, -5), "15:00", "completed"],
    ["sl089", 1, addDays(t, 1), "09:00"],
    ["sl089", 2, addDays(t, 24), "11:00"],
  ];

  const nodes: FollowupNode[] = plan.map(([customerId, stageIndex, date, time, status]) => ({
    id: nodeId(customerId, stageIndex),
    customerId,
    stageIndex,
    slot: `${date} ${time}`,
    status: status ?? "scheduled",
    completedAt: status === "completed" ? `${date} ${time}` : undefined,
  }));

  return { customers, nodes };
}

function loadDatabase(): Database {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Database;
      if (parsed.customers?.length && parsed.nodes?.length) return parsed;
    }
  } catch {
    // 存储不可用时退回到内存数据
  }
  return seedDatabase();
}

/* ---------------- 组件 ---------------- */

function MetricCard({ label, value, hint, index }: { label: string; value: number; hint: string; index: number }) {
  const colors = ["status-ok", "status-watch", "status-danger", "status-ok"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
      <i className={colors[index % colors.length]} />
    </article>
  );
}

function App() {
  const [db, setDb] = useState<Database>(loadDatabase);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [drafts, setDrafts] = useState<Record<string, { date: string; time: string }>>({});

  // 刷新后预约与完成记录保持不变
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      // 忽略写入失败
    }
  }, [db]);

  const customersById = useMemo(() => {
    const map = new Map<string, Customer>();
    db.customers.forEach((c) => map.set(c.id, c));
    return map;
  }, [db.customers]);

  const nodesByCustomer = useMemo(() => {
    const map = new Map<string, FollowupNode[]>();
    db.customers.forEach((c) => map.set(c.id, []));
    db.nodes.forEach((n) => map.get(n.customerId)?.push(n));
    map.forEach((list) => list.sort((a, b) => a.stageIndex - b.stageIndex));
    return map;
  }, [db]);

  const metrics = useMemo(() => {
    const today = todayISO();
    const scheduled = db.nodes.filter((n) => n.status === "scheduled");
    return {
      customers: db.customers.length,
      scheduled: scheduled.length,
      completed: db.nodes.length - scheduled.length,
      today: db.nodes.filter((n) => n.status === "scheduled" && splitSlot(n.slot).date === today).length,
    };
  }, [db]);

  // 改期 / 完成的全部业务规则
  function reschedule(node: FollowupNode, rawDate: string, rawTime: string) {
    const customer = customersById.get(node.customerId)!;
    const dueDate = addDays(customer.fittingDate, STAGES[node.stageIndex].offset);

    if (node.status === "completed") {
      setFeedback({ kind: "rule", message: `「${customer.name} ${STAGES[node.stageIndex].label}回访」已完成，已完成节点不得覆盖。` });
      return;
    }
    if (!rawDate || !rawTime) {
      setFeedback({ kind: "rule", message: "请先选择新的回访日期与时段。" });
      return;
    }

    const targetSlot = `${rawDate} ${rawTime}`;
    if (targetSlot === node.slot) {
      setFeedback({ kind: "rule", message: "新时段与当前预约相同，无需改期。" });
      return;
    }

    // 边界：不能跨过前序 / 后续节点（按兄弟节点当前预约日期比较）
    const siblings = nodesByCustomer.get(node.customerId)!;
    const prev = siblings[node.stageIndex - 1];
    const next = siblings[node.stageIndex + 1];
    if (prev && rawDate <= splitSlot(prev.slot).date) {
      setFeedback({
        kind: "rule",
        message: `改期被拦截：不能早于前一节点（${STAGES[prev.stageIndex].label}，${fmtCN(
          splitSlot(prev.slot).date
        )}）。`,
      });
      return;
    }
    if (next && rawDate >= splitSlot(next.slot).date) {
      setFeedback({
        kind: "rule",
        message: `改期被拦截：临时改期不能跨过后续节点（${STAGES[next.stageIndex].label}，${fmtCN(
          splitSlot(next.slot).date
        )}）。`,
      });
      return;
    }

    // 门店同一时段只能接待一人：找出占用该时段的预约（完成记录属历史档案，不参与未来占档）
    const occupant = db.nodes.find(
      (other) => other.id !== node.id && other.status === "scheduled" && other.slot === targetSlot
    );
    if (occupant) {
      const occupantCustomer = customersById.get(occupant.customerId)!;
      const occupantDue = addDays(occupantCustomer.fittingDate, STAGES[occupant.stageIndex].offset);
      setFeedback({
        kind: "conflict",
        request: {
          customer: customer.name,
          nodeDate: `${STAGES[node.stageIndex].label}节点日 ${fmtCN(dueDate)}`,
          targetSlot: `${fmtCN(rawDate)} ${rawTime}`,
        },
        items: [
          {
            customer: `${occupantCustomer.name}（${occupantCustomer.code}）`,
            nodeDate: `${STAGES[occupant.stageIndex].label}节点日 ${fmtCN(occupantDue)}`,
            originalSlot: `${fmtCN(splitSlot(occupant.slot).date)} ${splitSlot(occupant.slot).time}`,
          },
        ],
      });
      return;
    }

    // 通过：原时段随改期自动释放，新时段落位
    const oldSlot = node.slot;
    setDb((prevDb) => ({
      ...prevDb,
      nodes: prevDb.nodes.map((n) => (n.id === node.id ? { ...n, slot: targetSlot } : n)),
    }));
    setFeedback({
      kind: "ok",
      message: `已改期：${customer.name} ${STAGES[node.stageIndex].label}回访，原时段 ${oldSlot} 已释放，现预约 ${targetSlot}。`,
    });
  }

  function complete(node: FollowupNode) {
    const customer = customersById.get(node.customerId)!;
    if (node.status === "completed") return;
    const now = new Date();
    const stamp = `${toISO(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setDb((prevDb) => ({
      ...prevDb,
      nodes: prevDb.nodes.map((n) =>
        n.id === node.id ? { ...n, status: "completed", completedAt: stamp } : n
      ),
    }));
    setFeedback({
      kind: "ok",
      message: `${customer.name} ${STAGES[node.stageIndex].label}回访已登记完成（${stamp}），该记录不可再覆盖或改期。`,
    });
  }

  // 时段占用看板：从今天起 35 天内，有预约的日期
  const occupancy = useMemo(() => {
    const today = todayISO();
    const days = Array.from({ length: 36 }, (_, i) => addDays(today, i));
    return days
      .map((date) => ({
        date,
        rows: SLOTS.map((time) => {
          const slot = `${date} ${time}`;
          const node = db.nodes.find((n) => n.slot === slot);
          return { time, node, customer: node ? customersById.get(node.customerId) : undefined };
        }),
      }))
      .filter((day) => day.rows.some((r) => r.node));
  }, [db.nodes, customersById]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">HXWL-FU-02 · 助听器试戴回访调度台</p>
          <h1>助听器试戴回访调度台</h1>
          <p className="subtitle">
            每名客户按初配日自动生成第 1、7、30 天回访节点；改期不得跨过后续节点、不得覆盖已完成记录，门店每时段仅接待一人。
          </p>
        </div>
        <div className="stack-card">
          <span>调度规则</span>
          <strong>1 / 7 / 30 天节点 · 单时段单人 · 改期释放原时段</strong>
          <span>预约与完成记录本地持久化，刷新后保持不变</span>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard index={0} label="在档试戴客户" value={metrics.customers} hint="按初配日生成三个回访节点" />
        <MetricCard index={1} label="待回访节点" value={metrics.scheduled} hint="含已改期未落完成的预约" />
        <MetricCard index={2} label="已完成节点" value={metrics.completed} hint="完成记录锁定，不可覆盖" />
        <MetricCard index={3} label="今日到店" value={metrics.today} hint="按当前预约时段统计" />
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>排程约束</h2>
          <ul className="rule-list">
            <li>节点日 = 初配日 + 第 1 / 7 / 30 天</li>
            <li>临时改期不能跨过后续节点，也不能早于前一节点</li>
            <li>已完成节点不得覆盖、不得再改期</li>
            <li>门店同一时段只能接待一人</li>
            <li>改期成功后原时段立即释放</li>
            <li>冲突时列出客户、节点日与原时段</li>
          </ul>
          <h2>门店时段</h2>
          <div className="chips">
            {SLOTS.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
          <p className="aside-note">数据保存在本机浏览器，刷新页面后预约与完成记录仍然保持。</p>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>客户回访排程</p>
              <h2>节点调度</h2>
            </div>
          </div>

          <div className="customer-list">
            {db.customers.map((customer) => {
              const nodes = nodesByCustomer.get(customer.id)!;
              return (
                <article key={customer.id} className="customer-card">
                  <header>
                    <div>
                      <h3>
                        {customer.name} <span className="code">{customer.code}</span>
                      </h3>
                      <p>
                        {customer.model} · 初配日 {fmtCN(customer.fittingDate)}
                      </p>
                    </div>
                  </header>

                  <div className="node-list">
                    {nodes.map((node) => {
                      const dueDate = addDays(customer.fittingDate, STAGES[node.stageIndex].offset);
                      const current = splitSlot(node.slot);
                      const draft = drafts[node.id] ?? { date: current.date, time: current.time };
                      const prev = nodes[node.stageIndex - 1];
                      const next = nodes[node.stageIndex + 1];
                      const minDate = prev
                        ? addDays(splitSlot(prev.slot).date, 1)
                        : dueDate;
                      const maxDate = next
                        ? addDays(splitSlot(next.slot).date, -1)
                        : addDays(customer.fittingDate, 60);
                      const moved = current.date !== dueDate;

                      return (
                        <div key={node.id} className={`node-row ${node.status}`}>
                          <div className="node-main">
                            <span className={`node-badge badge-${node.stageIndex}`}>
                              {STAGES[node.stageIndex].short}
                            </span>
                            <div>
                              <strong>{STAGES[node.stageIndex].label}回访</strong>
                              <p>
                                节点日 {fmtCN(dueDate)}
                                {moved && <em className="moved-tag">已改期</em>}
                              </p>
                            </div>
                          </div>

                          <div className="node-slot">
                            {node.status === "completed" ? (
                              <div className="completed-box">
                                <span className="status-tag done">已完成</span>
                                <p>完成时间 {node.completedAt}</p>
                              </div>
                            ) : (
                              <>
                                <div className="reschedule-controls">
                                  <input
                                    type="date"
                                    aria-label={`${customer.name} ${STAGES[node.stageIndex].label}新日期`}
                                    value={draft.date}
                                    min={minDate}
                                    max={maxDate}
                                    onChange={(e) =>
                                      setDrafts((d) => ({
                                        ...d,
                                        [node.id]: { ...draft, date: e.target.value },
                                      }))
                                    }
                                  />
                                  <select
                                    aria-label={`${customer.name} ${STAGES[node.stageIndex].label}新时段`}
                                    value={draft.time}
                                    onChange={(e) =>
                                      setDrafts((d) => ({
                                        ...d,
                                        [node.id]: { ...draft, time: e.target.value },
                                      }))
                                    }
                                  >
                                    {SLOTS.map((s) => (
                                      <option key={s} value={s}>
                                        {s}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="node-actions">
                                  <span className="current-slot">
                                    当前：{current.date} {current.time}
                                  </span>
                                  <button
                                    className="ghost-action"
                                    onClick={() => reschedule(node, draft.date, draft.time)}
                                  >
                                    改期
                                  </button>
                                  <button className="primary-action small" onClick={() => complete(node)}>
                                    登记完成
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>

      <section
        className={`panel feedback-panel ${feedback ? `feedback-${feedback.kind}` : ""}`}
        aria-live="polite"
      >
        <div className="section-heading">
          <div>
            <p>调度反馈</p>
            <h2>{feedback ? (feedback.kind === "conflict" ? "时段冲突" : feedback.kind === "ok" ? "操作成功" : "规则拦截") : "等待操作"}</h2>
          </div>
        </div>

        {!feedback && <p className="muted">在上方对任一待回访节点执行改期或登记完成，结果会显示在这里。</p>}

        {feedback?.kind === "ok" && <p className="ok-text">{feedback.message}</p>}
        {feedback?.kind === "rule" && <p className="rule-text">{feedback.message}</p>}

        {feedback?.kind === "conflict" && (
          <div className="conflict-box">
            <p className="rule-text">
              无法为「{feedback.request.customer} · {feedback.request.nodeDate}」改期到{" "}
              {feedback.request.targetSlot}，该时段已被占用：
            </p>
            <table className="conflict-table">
              <thead>
                <tr>
                  <th>客户</th>
                  <th>节点日</th>
                  <th>原时段</th>
                </tr>
              </thead>
              <tbody>
                {feedback.items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.customer}</td>
                    <td>{item.nodeDate}</td>
                    <td>{item.originalSlot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">原预约保留不动；请改选其他空闲时段后再提交。</p>
          </div>
        )}
      </section>

      <section className="panel occupancy-panel">
        <div className="section-heading">
          <div>
            <p>门店时段占用</p>
            <h2>近期排班看板</h2>
          </div>
        </div>
        <div className="occupancy-grid">
          {occupancy.map((day) => (
            <article key={day.date} className="occupancy-day">
              <h3>{fmtCN(day.date)}</h3>
              <ul>
                {day.rows.map((row) => (
                  <li key={row.time} className={row.node ? (row.node!.status === "completed" ? "occ done" : "occ") : "free"}>
                    <span className="occ-time">{row.time}</span>
                    {row.node && row.customer ? (
                      <span className="occ-who">
                        {row.customer.name} · {STAGES[row.node.stageIndex].short}
                        {row.node.status === "completed" ? " · 已完成" : ""}
                      </span>
                    ) : (
                      <span className="occ-who free-text">空闲</span>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
