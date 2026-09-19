import {
  Customer,
  Slot,
  SLOTS,
  addDays,
  applyBooking,
  buildNodes,
  completeNode,
  evaluateBooking,
  rescheduleMaxDate,
  visitDate,
} from "../src/domain";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error("FAIL:", msg);
  }
}

function makeCustomer(id: string, fitting: string): Customer {
  return {
    id,
    name: id,
    phone: "",
    device: "",
    fittingDate: fitting,
    nodes: buildNodes(id, fitting),
  };
}

// 1. 节点生成：第 1/7/30 天
const a = makeCustomer("A", "2026-09-19");
assert(a.nodes[0].nodeDate === "2026-09-19", "第1天节点日=初配日");
assert(a.nodes[1].nodeDate === "2026-09-25", "第7天节点日");
assert(a.nodes[2].nodeDate === "2026-10-18", "第30天节点日");
assert(rescheduleMaxDate(a, a.nodes[0]) === "2026-09-24", "第1天改期最晚9/24（不能跨过第7天节点日9/25）");
assert(rescheduleMaxDate(a, a.nodes[1]) === "2026-10-17", "第7天改期最晚10/17");
assert(rescheduleMaxDate(a, a.nodes[2]) === null, "第30天之后无节点，不限");

// 2. 正常预约第1天
let r = evaluateBooking([a], { customer: a, node: a.nodes[0], date: a.nodes[0].nodeDate, slot: "09:00-10:00" });
assert(r.ok, "节点日当天预约应成功");

// 3. 改期跨过后续节点 → 拒绝
r = evaluateBooking([a], { customer: a, node: a.nodes[0], date: "2026-09-25", slot: "09:00-10:00" });
assert(!r.ok && r.reason === "cross-node", "改到下一节点日当天即视为跨过，拒绝");
r = evaluateBooking([a], { customer: a, node: a.nodes[0], date: "2026-09-24", slot: "09:00-10:00" });
assert(r.ok, "改到下一节点日前一天允许");

// 4. 早于初配日 → 拒绝
r = evaluateBooking([a], { customer: a, node: a.nodes[0], date: "2026-09-18", slot: "09:00-10:00" });
assert(!r.ok && r.reason === "before-fitting", "不能早于初配日");

// 5. 时段冲突 + 冲突明细
const b = makeCustomer("B", "2026-09-10");
let customers = [a, b];
// A 占用 9/24 09:00
const reqA = { customer: a, node: a.nodes[0], date: "2026-09-24", slot: "09:00-10:00" as Slot };
customers = applyBooking(customers, reqA);
const aAfter = customers[0];
// B 想约同一天同一时段
const r2 = evaluateBooking(customers, { customer: b, node: b.nodes[1], date: "2026-09-24", slot: "09:00-10:00" });
assert(!r2.ok && r2.reason === "conflict", "同时段冲突应拒绝");
if (!r2.ok && r2.reason === "conflict") {
  assert(r2.conflicts[0].customerId === "A", "冲突方为客户A");
  assert(r2.conflicts[0].nodeDate === aAfter.nodes[0].nodeDate, "冲突明细含节点日");
  assert(r2.conflicts[0].slot === "09:00-10:00", "冲突明细含原时段");
}
// B 约其他时段可以
const r3 = evaluateBooking(customers, { customer: b, node: b.nodes[1], date: "2026-09-24", slot: "10:30-11:30" });
assert(r3.ok, "同时段以外可预约");

// 6. 改期释放原时段
customers = applyBooking(customers, { customer: aAfter, node: aAfter.nodes[0], date: "2026-09-23", slot: "14:00-15:00" });
const aMoved = customers[0];
assert(aMoved.nodes[0].slot === "14:00-15:00", "新时段已写入");
assert(visitDate(aMoved.nodes[0]) === "2026-09-23", "改期日已写入");
const r4 = evaluateBooking(customers, { customer: b, node: b.nodes[1], date: "2026-09-24", slot: "09:00-10:00" });
assert(r4.ok, "原时段9/24 09:00已释放，可被他人预约");

// 7. 完成节点锁定，且已完成记录仍占位
customers = completeNode(customers, aMoved.nodes[0].id);
const aDone = customers[0].nodes[0];
assert(aDone.completed && aDone.completedAt !== null, "完成时间已记录");
const r5 = evaluateBooking(customers, {
  customer: customers[0],
  node: aDone,
  date: "2026-09-22",
  slot: "15:30-16:30",
});
assert(!r5.ok && r5.reason === "completed", "已完成节点不得改期/覆盖");
// 已完成的 9/23 14:00 仍占位（用 B 的第30天节点，避开 B 自身节点边界）
const r6 = evaluateBooking(customers, { customer: b, node: b.nodes[2], date: "2026-09-23", slot: "14:00-15:00" });
assert(!r6.ok && r6.reason === "conflict", "已完成记录同样占位");
if (!r6.ok && r6.reason === "conflict") {
  assert(r6.conflicts[0].completed === true, "冲突明细标记已完成");
}

// 8. 节点完成后它不再阻塞后续节点的跨节点判断（后续节点已完成时）
const c = makeCustomer("C", "2026-09-19");
let cc = [c];
cc = applyBooking(cc, { customer: c, node: c.nodes[0], date: c.nodes[0].nodeDate, slot: SLOTS[0] });
cc = completeNode(cc, cc[0].nodes[0].id);
// 第7天节点若已完成，第30天不受其限制由数据驱动；这里验证已完成第1天后，第7天改期边界仍为第30天
const cNode1 = cc[0].nodes[1];
assert(rescheduleMaxDate(cc[0], cNode1) === "2026-10-17", "第7天节点边界不受第1天完成影响");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
