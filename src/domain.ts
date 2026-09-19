// 助听器试戴回访调度：领域规则
// 每名客户按初配日起第 1、7、30 天生成回访节点

export interface MilestoneDef {
  day: number; // 距初配日的天数（初配当天为第 1 天，day 为 0 偏移）
  label: string;
}

// 第 1、7、30 天 → 相对初配日偏移 0、6、29
export const MILESTONES: MilestoneDef[] = [
  { day: 1, label: "第1天 · 初戴适应" },
  { day: 7, label: "第7天 · 一周复调" },
  { day: 30, label: "第30天 · 月度评估" },
];

// 门店每日可接待时段：同一时段只能接待一人
export const SLOTS = ["09:00-10:00", "10:30-11:30", "14:00-15:00", "15:30-16:30"] as const;
export type Slot = (typeof SLOTS)[number];

export type NodeStatus = "completed" | "scheduled" | "unscheduled";

export interface VisitNode {
  id: string; // customerId + 节点序号
  customerId: string;
  milestoneDay: number; // 1 | 7 | 30
  label: string;
  nodeDate: string; // 节点日（YYYY-MM-DD），由初配日固定推导，不可改
  slot: Slot | null; // 预约时段；null 表示尚未预约
  scheduledDate: string | null; // 实际接待日期（改期只动这里），null 表示按节点日
  completed: boolean;
  completedAt: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  device: string; // 助听器型号
  fittingDate: string; // 初配日 YYYY-MM-DD
  nodes: VisitNode[];
}

/* ---------------- 日期工具 ---------------- */

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function parseISO(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${iso} ${WEEKDAYS[parseISO(iso).getDay()]}`;
}

/** 某节点的实际接待日期：改期后取改期日，否则为节点日本身 */
export function visitDate(node: VisitNode): string {
  return node.scheduledDate ?? node.nodeDate;
}

export function nodeStatus(node: VisitNode): NodeStatus {
  if (node.completed) return "completed";
  return node.slot ? "scheduled" : "unscheduled";
}

/* ---------------- 节点生成 ---------------- */

export function buildNodes(customerId: string, fittingDate: string): VisitNode[] {
  return MILESTONES.map((m, i) => ({
    id: `${customerId}-n${i + 1}`,
    customerId,
    milestoneDay: m.day,
    label: m.label,
    nodeDate: addDays(fittingDate, m.day - 1),
    slot: null,
    scheduledDate: null,
    completed: false,
    completedAt: null,
  }));
}

/* ---------------- 改期边界 ---------------- */

/** 返回该节点后面最近的未完成节点日；没有则为 null（第 30 天节点之后无限制） */
export function nextNodeDeadline(customer: Customer, node: VisitNode): string | null {
  const ordered = [...customer.nodes].sort((a, b) => a.milestoneDay - b.milestoneDay);
  const next = ordered.find(
    (n) => n.milestoneDay > node.milestoneDay && !n.completed,
  );
  return next ? next.nodeDate : null;
}

/** 改期允许的最晚日期：不得跨过后续节点日（须严格早于下一节点日） */
export function rescheduleMaxDate(customer: Customer, node: VisitNode): string | null {
  const deadline = nextNodeDeadline(customer, node);
  return deadline ? addDays(deadline, -1) : null;
}

/** 改期允许的最早日期：不早于初配日 */
export function rescheduleMinDate(customer: Customer): string {
  return customer.fittingDate;
}

/* ---------------- 预约 / 改期 / 完成校验 ---------------- */

export interface BookingRequest {
  customer: Customer;
  node: VisitNode;
  date: string; // 希望接待的日期
  slot: Slot;
}

export interface BookingConflict {
  customerId: string;
  customerName: string;
  nodeLabel: string;
  nodeDate: string; // 冲突方的节点日
  date: string; // 冲突方实际占用日期
  slot: Slot; // 被占用的原时段
  completed: boolean; // 是否为已完成记录（同样占位，不可覆盖）
}

export type BookingResult =
  | { ok: true }
  | { ok: false; reason: "completed" | "before-fitting" | "cross-node" | "invalid-date"; message: string }
  | { ok: false; reason: "conflict"; message: string; conflicts: BookingConflict[] };

/**
 * 校验一次预约/改期。
 * 规则：
 *  - 已完成节点不得覆盖
 *  - 改期不能早于初配日
 *  - 改期不能跨过后续节点日（必须 < 下一节点日）
 *  - 同一日期 + 时段全门店只能有一个预约（含已完成的记录，同样占位）
 */
export function evaluateBooking(
  customers: Customer[],
  req: BookingRequest,
): BookingResult {
  const { customer, node, date, slot } = req;

  if (node.completed) {
    return {
      ok: false,
      reason: "completed",
      message: `${node.label} 已完成，完成记录不得覆盖或改期。`,
    };
  }

  if (!date) {
    return { ok: false, reason: "invalid-date", message: "请选择接待日期。" };
  }

  if (parseISO(date).getTime() < parseISO(customer.fittingDate).getTime()) {
    return {
      ok: false,
      reason: "before-fitting",
      message: `接待日期不能早于初配日 ${formatDate(customer.fittingDate)}。`,
    };
  }

  const deadline = nextNodeDeadline(customer, node);
  if (deadline && parseISO(date).getTime() >= parseISO(deadline).getTime()) {
    return {
      ok: false,
      reason: "cross-node",
      message: `临时改期不能跨过后续节点：${node.label} 最晚只能改到 ${formatDate(
        addDays(deadline, -1),
      )}（下一节点日 ${formatDate(deadline)}）。`,
    };
  }

  // 时段冲突：同一日期同一时段只能接待一人
  const conflicts: BookingConflict[] = [];
  for (const c of customers) {
    for (const n of c.nodes) {
      if (n.id === node.id || !n.slot) continue;
      if (visitDate(n) === date && n.slot === slot) {
        conflicts.push({
          customerId: c.id,
          customerName: c.name,
          nodeLabel: n.label,
          nodeDate: n.nodeDate,
          date: visitDate(n),
          slot: n.slot,
          completed: n.completed,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      reason: "conflict",
      message: `该时段已被占用，请另选时间。`,
      conflicts,
    };
  }

  return { ok: true };
}

/** 应用预约/改期：写入新时段（旧时段随即释放，因为一个节点只保留一个时段） */
export function applyBooking(customers: Customer[], req: BookingRequest): Customer[] {
  return customers.map((c) => {
    if (c.id !== req.customer.id) return c;
    return {
      ...c,
      nodes: c.nodes.map((n) => {
        if (n.id !== req.node.id) return n;
        return {
          ...n,
          slot: req.slot,
          scheduledDate: req.date === n.nodeDate ? null : req.date,
        };
      }),
    };
  });
}

/** 完成回访：记录完成时间；完成后节点锁定 */
export function completeNode(customers: Customer[], nodeId: string): Customer[] {
  const stamp = new Date().toISOString();
  return customers.map((c) => ({
    ...c,
    nodes: c.nodes.map((n) =>
      n.id === nodeId && !n.completed && n.slot
        ? { ...n, completed: true, completedAt: stamp }
        : n,
    ),
  }));
}

/* ---------------- 指标 ---------------- */

export function dayDiff(a: string, b: string): number {
  return Math.round(
    (parseISO(a).getTime() - parseISO(b).getTime()) / 86_400_000,
  );
}

export interface Metrics {
  totalNodes: number;
  completed: number;
  scheduled: number;
  unscheduled: number;
  weekVisits: number; // 未来 7 天内（含今天）的接待数
  overdue: number; // 接待日已过但未完成
}

export function computeMetrics(customers: Customer[], today = todayISO()): Metrics {
  const m: Metrics = {
    totalNodes: 0,
    completed: 0,
    scheduled: 0,
    unscheduled: 0,
    weekVisits: 0,
    overdue: 0,
  };
  for (const c of customers) {
    for (const n of c.nodes) {
      m.totalNodes++;
      if (n.completed) {
        m.completed++;
        continue;
      }
      if (n.slot) {
        m.scheduled++;
        const diff = dayDiff(visitDate(n), today);
        if (diff >= 0 && diff <= 6) m.weekVisits++;
        if (diff < 0) m.overdue++;
      } else {
        m.unscheduled++;
        if (dayDiff(n.nodeDate, today) < 0) m.overdue++;
      }
    }
  }
  return m;
}
