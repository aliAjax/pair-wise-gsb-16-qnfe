import { useMemo, useState } from "react";
import {
  BookingConflict,
  Customer,
  SLOTS,
  VisitNode,
  applyBooking,
  evaluateBooking,
  formatDate,
  rescheduleMaxDate,
  rescheduleMinDate,
  visitDate,
} from "./domain";

interface BookingDialogProps {
  customers: Customer[];
  customer: Customer;
  node: VisitNode;
  onClose: () => void;
  onConfirm: (next: Customer[]) => void;
}

export function BookingDialog({
  customers,
  customer,
  node,
  onClose,
  onConfirm,
}: BookingDialogProps) {
  const isReschedule = node.slot !== null;
  const minDate = rescheduleMinDate(customer);
  const maxDate = rescheduleMaxDate(customer, node);
  const [date, setDate] = useState<string>(visitDate(node));
  const [slot, setSlot] = useState<(typeof SLOTS)[number] | "">(
    node.slot ?? "",
  );
  const [conflicts, setConflicts] = useState<BookingConflict[]>([]);
  const [error, setError] = useState<string>("");

  const title = isReschedule ? "临时改期" : "预约回访";

  const validation = useMemo(
    () =>
      slot
        ? evaluateBooking(customers, { customer, node, date, slot })
        : null,
    [customers, customer, node, date, slot],
  );

  const canSubmit = validation?.ok === true;

  function handleSubmit() {
    if (!slot) {
      setError("请选择接待时段。");
      setConflicts([]);
      return;
    }
    const result = evaluateBooking(customers, { customer, node, date, slot });
    if (!result.ok) {
      setError(result.message);
      setConflicts(result.reason === "conflict" ? result.conflicts : []);
      return;
    }
    // 改期成功：新时段写入后，原时段自动释放
    onConfirm(applyBooking(customers, { customer, node, date, slot }));
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">{customer.name} · {customer.id}</p>
            <h3>{title} · {node.label}</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-meta">
          <div>
            <span>初配日</span>
            <strong>{formatDate(customer.fittingDate)}</strong>
          </div>
          <div>
            <span>节点日（固定）</span>
            <strong>{formatDate(node.nodeDate)}</strong>
          </div>
          <div>
            <span>改期范围</span>
            <strong>
              {formatDate(minDate)} ～ {maxDate ? formatDate(maxDate) : "节点之后不限"}
            </strong>
          </div>
        </div>

        <label className="field-block">
          <span>接待日期</span>
          <input
            type="date"
            value={date}
            min={minDate}
            max={maxDate ?? undefined}
            onChange={(e) => {
              setDate(e.target.value);
              setError("");
              setConflicts([]);
            }}
          />
        </label>

        <div className="field-block">
          <span>接待时段（每时段门店仅接待一人）</span>
          <div className="slot-grid">
            {SLOTS.map((s) => {
              const selected = slot === s;
              const sameSlotCheck =
                date &&
                evaluateBooking(customers, { customer, node, date, slot: s });
              const blocked =
                sameSlotCheck && !sameSlotCheck.ok && sameSlotCheck.reason === "conflict";
              return (
                <button
                  key={s}
                  type="button"
                  className={
                    "slot-option" +
                    (selected ? " selected" : "") +
                    (blocked ? " blocked" : "")
                  }
                  onClick={() => {
                    setSlot(s);
                    setError("");
                    setConflicts([]);
                  }}
                >
                  {s}
                  {blocked && <i>已占用</i>}
                </button>
              );
            })}
          </div>
        </div>

        {isReschedule && node.slot && (
          <p className="hint">
            原时段 {formatDate(visitDate(node))} {node.slot} 将在改期成功后立即释放。
          </p>
        )}

        {error && (
          <div className="alert">
            <strong>{validation && !validation.ok ? "无法保存" : "提示"}</strong>
            <p>{error}</p>
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="conflict-box">
            <p className="conflict-title">时段冲突明细：</p>
            <table>
              <thead>
                <tr>
                  <th>客户</th>
                  <th>回访节点</th>
                  <th>节点日</th>
                  <th>占用日期</th>
                  <th>原时段</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => (
                  <tr key={c.customerId + c.slot}>
                    <td>
                      {c.customerName}
                      {c.completed && <em className="tag-done">已完成</em>}
                    </td>
                    <td>{c.nodeLabel}</td>
                    <td>{formatDate(c.nodeDate)}</td>
                    <td>{formatDate(c.date)}</td>
                    <td>{c.slot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary-action" disabled={!canSubmit} onClick={handleSubmit}>
            {isReschedule ? "确认改期" : "确认预约"}
          </button>
        </div>
      </div>
    </div>
  );
}
