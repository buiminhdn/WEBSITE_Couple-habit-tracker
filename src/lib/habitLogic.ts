import type { CompletionSummary, DailyEntry, Payment, Penalty } from "../types/domain";

export function calculateCompletion(entries: DailyEntry[]): CompletionSummary {
  const total = entries.length;
  const done = entries.filter((entry) => entry.isDone).length;

  if (total === 0) {
    return { total, done, percent: 100, isComplete: true };
  }

  return {
    total,
    done,
    percent: Math.round((done / total) * 100),
    isComplete: done === total
  };
}

export function shouldCreatePenalty(entries: DailyEntry[]): boolean {
  return entries.length > 0 && !calculateCompletion(entries).isComplete;
}

export function calculateDebt(penalties: Penalty[], payments: Payment[]): number {
  const penaltyTotal = penalties.reduce((sum, penalty) => sum + penalty.amount, 0);
  const paymentTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);

  return Math.max(0, penaltyTotal - paymentTotal);
}

// Ngày chưa mở app thì không có dòng nào trong daily_entries -> trước đây bị bỏ qua,
// nên nghỉ 2 tuần vẫn chỉ bị phạt 1-2 ngày. Liệt kê theo lịch thay vì theo entry đã có.
export function listDaysToClose(firstDate: string, today: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${firstDate}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  // ponytail: chặn 366 ngày cho mỗi lần chạy, đủ dùng; bỏ nếu cần lịch sử dài hơn.
  for (let i = 0; cursor < end && i < 366; i += 1) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
