import "server-only";
import { randomUUID } from "crypto";
import { calculateCompletion, calculateDebt, listDaysToClose, shouldCreatePenalty } from "../lib/habitLogic";
import { getGoogleSheetsClient } from "../lib/googleSheetsClient";
import type { DailyEntry, DailySummary, Habit, MoneySummary, Payment, Penalty, Person, PersonSlug } from "../types/domain";

type SheetName = "people" | "habits" | "daily_entries" | "daily_closures" | "penalties" | "payments";

const PEOPLE: PersonSlug[] = ["partner", "me"];
const PENALTY_AMOUNT = 20000;

async function getRows(sheetName: SheetName): Promise<string[][]> {
  const { sheets, spreadsheetId } = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:Z`
  });
  return (response.data.values ?? []) as string[][];
}

async function appendRow(sheetName: SheetName, row: Array<string | number | boolean>): Promise<void> {
  const { sheets, spreadsheetId } = getGoogleSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: "RAW",
    requestBody: { values: [row] }
  });
}

async function updateRow(sheetName: SheetName, rowIndex: number, row: Array<string | number | boolean>): Promise<void> {
  const { sheets, spreadsheetId } = getGoogleSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${rowIndex + 2}:Z${rowIndex + 2}`,
    valueInputOption: "RAW",
    requestBody: { values: [row] }
  });
}

function nowIso() {
  return new Date().toISOString();
}

function mapHabit(row: string[]): Habit {
  return {
    id: row[0],
    personId: row[1] as PersonSlug,
    title: row[2],
    isActive: row[3] === "true" || row[3] === "TRUE",
    sortOrder: Number(row[4] ?? 0)
  };
}

function mapEntry(row: string[], habitTitle = ""): DailyEntry {
  return {
    id: row[0],
    personId: row[1] as PersonSlug,
    habitId: row[2],
    date: row[3],
    isDone: row[4] === "true" || row[4] === "TRUE",
    title: habitTitle,
    sortOrder: 0
  };
}

function mapPenalty(row: string[]): Penalty {
  return {
    id: row[0],
    personId: row[1] as PersonSlug,
    date: row[2],
    amount: Number(row[3] ?? 0),
    reason: "missed_day"
  };
}

function mapPayment(row: string[]): Payment {
  return {
    id: row[0],
    personId: row[1] as PersonSlug,
    amount: Number(row[2] ?? 0),
    note: row[3] ?? "",
    paidAt: row[4] ?? row[5] ?? ""
  };
}

export type SheetsRepository = {
  listPeople(): Promise<Person[]>;
  ensureTodayChecklist(date: string): Promise<DailyEntry[]>;
  toggleEntry(entryId: string, isDone: boolean): Promise<void>;
  listSevenDayHistory(today: string): Promise<DailySummary[]>;
  listMoneySummary(): Promise<MoneySummary[]>;
  recordPayment(personId: PersonSlug, amount: number, note: string): Promise<void>;
  closePastDays(today: string): Promise<void>;
  listHabits(personId: PersonSlug): Promise<Habit[]>;
  addHabit(personId: PersonSlug, title: string): Promise<Habit>;
  renameHabit(habitId: string, title: string): Promise<void>;
  deactivateHabit(habitId: string): Promise<void>;
  moveHabit(habitId: string, sortOrder: number): Promise<void>;
};

export function createSheetsRepository(): SheetsRepository {
  return {
    async listPeople() {
      const rows = await getRows("people");
      return rows.map((row) => ({
        id: row[0] as PersonSlug,
        slug: row[1] as PersonSlug,
        displayName: row[2],
        side: row[3] as "left" | "right",
        themeColor: row[4] as "lavender" | "rose",
        avatarUrl: row[5] || undefined
      }));
    },
    async listHabits(personId) {
      const rows = await getRows("habits");
      return rows
        .map(mapHabit)
        .filter((habit) => habit.personId === personId && habit.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    },
    async addHabit(personId, title) {
      const habits = (await getRows("habits")).map(mapHabit).filter((habit) => habit.personId === personId);
      const habit: Habit = {
        id: randomUUID(),
        personId,
        title,
        isActive: true,
        sortOrder: habits.length
      };
      const createdAt = nowIso();
      await appendRow("habits", [habit.id, habit.personId, habit.title, true, habit.sortOrder, createdAt, createdAt]);
      return habit;
    },
    async renameHabit(habitId, title) {
      const rows = await getRows("habits");
      const index = rows.findIndex((row) => row[0] === habitId);
      if (index >= 0) {
        const next = [...rows[index]];
        next[2] = title;
        next[6] = nowIso();
        await updateRow("habits", index, next);
      }
    },
    async deactivateHabit(habitId) {
      const rows = await getRows("habits");
      const index = rows.findIndex((row) => row[0] === habitId);
      if (index >= 0) {
        const next = [...rows[index]];
        next[3] = "false";
        next[6] = nowIso();
        await updateRow("habits", index, next);
      }
    },
    async moveHabit(habitId, sortOrder) {
      const rows = await getRows("habits");
      const index = rows.findIndex((row) => row[0] === habitId);
      if (index >= 0) {
        const next = [...rows[index]];
        next[4] = String(sortOrder);
        next[6] = nowIso();
        await updateRow("habits", index, next);
      }
    },
    async ensureTodayChecklist(date) {
      const habitRows = await getRows("habits");
      const habits = habitRows.map(mapHabit).filter((habit) => habit.isActive);
      const entryRows = await getRows("daily_entries");
      const existing = new Set(entryRows.map((row) => `${row[1]}:${row[2]}:${row[3]}`));
      const timestamp = nowIso();

      for (const habit of habits) {
        const key = `${habit.personId}:${habit.id}:${date}`;
        if (!existing.has(key)) {
          await appendRow("daily_entries", [randomUUID(), habit.personId, habit.id, date, false, timestamp, timestamp]);
        }
      }

      const refreshedRows = await getRows("daily_entries");
      const habitMap = new Map(habits.map((habit) => [habit.id, habit]));
      // Chỉ trả về entry của habit còn active — bỏ qua entry "mồ côi" (habit đã tắt/xoá)
      // để không hiện ra dòng "Thói quen" và không tính sai tiến độ.
      return refreshedRows
        .filter((row) => row[3] === date && habitMap.has(row[2]))
        .map((row) => {
          const habit = habitMap.get(row[2])!;
          return { ...mapEntry(row, habit.title), sortOrder: habit.sortOrder };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder);
    },
    async toggleEntry(entryId, isDone) {
      const rows = await getRows("daily_entries");
      const index = rows.findIndex((row) => row[0] === entryId);
      if (index >= 0) {
        const next = [...rows[index]];
        next[4] = String(isDone);
        next[6] = nowIso();
        await updateRow("daily_entries", index, next);
      }
    },
    async closePastDays(today) {
      const rows = await getRows("daily_entries");
      const closures = await getRows("daily_closures");
      const penalties = await getRows("penalties");
      const habitRows = await getRows("habits");
      const activeHabitIds = new Set(habitRows.map(mapHabit).filter((habit) => habit.isActive).map((habit) => habit.id));
      const closedKeys = new Set(closures.map((row) => `${row[1]}:${row[2]}`));
      const penaltyKeys = new Set(penalties.map((row) => `${row[1]}:${row[2]}`));
      const entriesByKey = new Map<string, DailyEntry[]>();
      let firstDate = today;

      for (const row of rows) {
        const entry = mapEntry(row);
        if (entry.date < firstDate) firstDate = entry.date;
        if (entry.date >= today) continue;
        // Bỏ qua entry mồ côi (habit đã tắt) để không tính/phạt sai.
        if (!activeHabitIds.has(entry.habitId)) continue;
        const key = `${entry.personId}:${entry.date}`;
        entriesByKey.set(key, [...(entriesByKey.get(key) ?? []), entry]);
      }

      // Duyệt theo lịch: ngày không mở app cũng phải bị chốt & phạt.
      const hasActiveHabit = new Map(
        PEOPLE.map((personId) => [
          personId,
          habitRows.map(mapHabit).some((habit) => habit.isActive && habit.personId === personId)
        ])
      );

      for (const date of listDaysToClose(firstDate, today)) {
        for (const personId of PEOPLE) {
          const key = `${personId}:${date}`;
          if (closedKeys.has(key)) continue;
          const entries = entriesByKey.get(key) ?? [];
          // Không có entry nhưng người đó có habit active => coi như miss cả ngày.
          const isMissedDay = entries.length === 0 ? hasActiveHabit.get(personId) === true : shouldCreatePenalty(entries);
          const isComplete = entries.length > 0 && calculateCompletion(entries).isComplete;
          await appendRow("daily_closures", [randomUUID(), personId, date, isComplete, nowIso()]);
          if (isMissedDay && !penaltyKeys.has(key)) {
            await appendRow("penalties", [randomUUID(), personId, date, PENALTY_AMOUNT, "missed_day", nowIso()]);
            penaltyKeys.add(key);
          }
        }
      }
    },
    async listSevenDayHistory(today) {
      const rows = await getRows("daily_entries");
      const penalties = new Set((await getRows("penalties")).map((row) => `${row[1]}:${row[2]}`));
      const activeHabits = (await getRows("habits")).map(mapHabit).filter((habit) => habit.isActive);
      const dates = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(`${today}T00:00:00+07:00`);
        date.setDate(date.getDate() - index);
        return date.toISOString().slice(0, 10);
      });

      return dates.flatMap((date) =>
        PEOPLE.map((personId): DailySummary => {
          const entries = rows.filter((row) => row[1] === personId && row[3] === date).map((row) => mapEntry(row));
          // Ngày không mở app: không có entry nhưng vẫn phải hiện 0/n, không phải 100%.
          const habitCount = activeHabits.filter((habit) => habit.personId === personId).length;
          const completion =
            entries.length === 0 && habitCount > 0
              ? { total: habitCount, done: 0, percent: 0, isComplete: false }
              : calculateCompletion(entries);
          return {
            date,
            personId,
            completion,
            hasPenalty: penalties.has(`${personId}:${date}`)
          };
        })
      );
    },
    async listMoneySummary() {
      const penalties = (await getRows("penalties")).map(mapPenalty);
      const payments = (await getRows("payments")).map(mapPayment);

      return PEOPLE.map((personId) => {
        const personPenalties = penalties.filter((penalty) => penalty.personId === personId);
        const personPayments = payments.filter((payment) => payment.personId === personId);
        return {
          personId,
          debt: calculateDebt(personPenalties, personPayments),
          penalties: personPenalties,
          payments: personPayments
        };
      });
    },
    async recordPayment(personId, amount, note) {
      const timestamp = nowIso();
      await appendRow("payments", [randomUUID(), personId, amount, note, timestamp, timestamp]);
    }
  };
}
