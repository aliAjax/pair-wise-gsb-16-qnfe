import {
  Customer,
  VisitNode,
  addDays,
  buildNodes,
  todayISO,
} from "./domain";

const STORAGE_KEY = "hxwl-followup-desk-v1";

/**
 * 示例数据：围绕“今天”构造，覆盖
 * - 已预约 / 未预约 / 已完成
 * - 已改期（未跨过后续节点）
 * - 同一时段临近冲突场景，便于演示冲突提示
 */
export function seedCustomers(): Customer[] {
  const today = todayISO();

  const raw: Array<{
    id: string;
    name: string;
    phone: string;
    device: string;
    fittingOffset: number; // 初配日相对今天的偏移
    bookings?: Array<{
      nodeIndex: number; // 0 | 1 | 2
      dateOffset?: number; // 接待日相对今天的偏移；不填=节点日
      slot: VisitNode["slot"];
      completed?: boolean;
    }>;
  }> = [
    {
      id: "Liu-024",
      name: "刘建国",
      phone: "138-0024",
      device: "RIC · 双耳",
      fittingOffset: -3,
      bookings: [
        { nodeIndex: 0, slot: "09:00-10:00", completed: true },
        { nodeIndex: 1, slot: "10:30-11:30" },
      ],
    },
    {
      id: "Chen-118",
      name: "陈雪梅",
      phone: "139-1180",
      device: "BTE · 右耳",
      fittingOffset: 0,
      bookings: [{ nodeIndex: 0, slot: "14:00-15:00" }],
    },
    {
      id: "Zhao-077",
      name: "赵淑芬",
      phone: "137-0775",
      device: "RIC · 左耳",
      fittingOffset: -6,
      bookings: [
        { nodeIndex: 0, slot: "15:30-16:30", completed: true },
        // 一周节点改期到 +3（仍在第 30 天节点之前）
        { nodeIndex: 1, dateOffset: 3, slot: "09:00-10:00" },
      ],
    },
    {
      id: "Sun-205",
      name: "孙浩然",
      phone: "136-2051",
      device: "受话器内置 · 双耳",
      fittingOffset: -29,
      bookings: [
        { nodeIndex: 0, slot: "10:30-11:30", completed: true },
        { nodeIndex: 1, slot: "09:00-10:00", completed: true },
        { nodeIndex: 2, slot: "14:00-15:00" },
      ],
    },
    {
      id: "Zhou-031",
      name: "周晓彤",
      phone: "135-0318",
      device: "迷你耳背机",
      fittingOffset: 2,
      bookings: [],
    },
  ];

  return raw.map((r) => {
    const fittingDate = addDays(today, r.fittingOffset);
    const nodes = buildNodes(r.id, fittingDate);
    for (const b of r.bookings ?? []) {
      const node = nodes[b.nodeIndex];
      const date =
        b.dateOffset !== undefined ? addDays(today, b.dateOffset) : node.nodeDate;
      node.slot = b.slot;
      node.scheduledDate = date === node.nodeDate ? null : date;
      if (b.completed) {
        node.completed = true;
        node.completedAt = new Date(
          date + "T" + (b.slot ?? "09:00").slice(0, 5) + ":00",
        ).toISOString();
      }
    }
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      device: r.device,
      fittingDate,
      nodes,
    };
  });
}

export function loadCustomers(): Customer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Customer[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // 存储损坏时回落到示例数据
  }
  const seeded = seedCustomers();
  saveCustomers(seeded);
  return seeded;
}

export function saveCustomers(customers: Customer[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customers));
  } catch {
    // 隐私模式等场景下降级为纯内存运行
  }
}

export function resetCustomers(): Customer[] {
  const seeded = seedCustomers();
  saveCustomers(seeded);
  return seeded;
}
