import type { Account, Category, StoredTxn } from '../types';
import { allOwners, isInternal, resolveCounterpartyOwners } from './internalTransfers';

export interface Period {
  start: string; // YYYY-MM-DD включительно
  end: string; // YYYY-MM-DD включительно
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  color: string;
  amount: number; // абсолютная сумма (для разбивки расходов/доходов)
}

export interface MonthlyPoint {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  net: number;
  cumulativeNet: number;
}

export interface AnalyticsResult {
  income: number;
  expense: number;
  /** Накоплено = доход − расход (вложения в инвестиции считаются накоплением). */
  net: number;
  /** Сколько ушло в накопления/инвестиции (категории вида savings). */
  savingsContributions: number;
  /** Объём внутренних переводов (для информации, в подсчёт не входит). */
  internalVolume: number;
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
  /** Итоги по ВСЕМ категориям (вкл. исключённые) для UI-переключателей. */
  allCategoryTotals: CategoryTotal[];
  monthly: MonthlyPoint[];
  txCount: number;
}

const UNCATEGORIZED = '__none__';

function inPeriod(date: string, p: Period): boolean {
  return date >= p.start && date <= p.end;
}

export function dateRange(txns: StoredTxn[]): Period {
  if (txns.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return { start: today, end: today };
  }
  let min = txns[0].bookingDate;
  let max = txns[0].bookingDate;
  for (const t of txns) {
    if (t.bookingDate < min) min = t.bookingDate;
    if (t.bookingDate > max) max = t.bookingDate;
  }
  return { start: min, end: max };
}

export function ownersList(accounts: Account[]): string[] {
  return allOwners(accounts);
}

export function analyze(
  txns: StoredTxn[],
  accounts: Account[],
  categories: Category[],
  opts: { period: Period; selectedOwners: string[]; excludedCategoryIds: string[] },
): AnalyticsResult {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const excluded = new Set(opts.excludedCategoryIds);
  const owners = opts.selectedOwners.length ? opts.selectedOwners : allOwners(accounts);
  const selectedSet = new Set(owners);

  // Транзакции выбранных профилей (для резолва владельца и сумм).
  const ofOwners = txns.filter((t) => selectedSet.has(t.accountOwner));
  const cpOwner = resolveCounterpartyOwners(ofOwners, accounts);

  let income = 0;
  let expense = 0;
  let savingsContributions = 0;
  let internalVolume = 0;
  const expenseCat = new Map<string, number>();
  const incomeCat = new Map<string, number>();
  const allCat = new Map<string, number>();
  const monthlyMap = new Map<string, { income: number; expense: number }>();
  let txCount = 0;

  for (const t of ofOwners) {
    if (!inPeriod(t.bookingDate, opts.period)) continue;
    const internal = isInternal(t, cpOwner.get(t.id) ?? null, selectedSet);
    if (internal) {
      internalVolume += Math.abs(t.eurAmount);
      continue;
    }

    const catId = t.categoryId ?? UNCATEGORIZED;
    const cat = t.categoryId ? catById.get(t.categoryId) : undefined;

    // Накопительный вклад (инвестиции) — отдельной метрикой.
    if (cat?.kind === 'savings' && t.eurAmount < 0) {
      savingsContributions += Math.abs(t.eurAmount);
    }

    // Сумма по всем категориям (для переключателей), знаковая.
    allCat.set(catId, (allCat.get(catId) ?? 0) + t.eurAmount);

    if (excluded.has(catId)) continue; // исключено из дохода/расхода

    txCount++;
    const month = t.bookingDate.slice(0, 7);
    const mp = monthlyMap.get(month) ?? { income: 0, expense: 0 };
    if (t.eurAmount >= 0) {
      income += t.eurAmount;
      incomeCat.set(catId, (incomeCat.get(catId) ?? 0) + t.eurAmount);
      mp.income += t.eurAmount;
    } else {
      expense += -t.eurAmount;
      expenseCat.set(catId, (expenseCat.get(catId) ?? 0) + -t.eurAmount);
      mp.expense += -t.eurAmount;
    }
    monthlyMap.set(month, mp);
  }

  const toTotals = (m: Map<string, number>, abs = true): CategoryTotal[] =>
    Array.from(m.entries())
      .map(([id, amount]) => {
        const cat = id === UNCATEGORIZED ? undefined : catById.get(id);
        return {
          categoryId: id === UNCATEGORIZED ? null : id,
          name: cat?.name ?? 'Без категории',
          color: cat?.color ?? '#bbbbbb',
          amount: abs ? Math.abs(amount) : amount,
        };
      })
      .sort((a, b) => b.amount - a.amount);

  const months = Array.from(monthlyMap.keys()).sort();
  let cum = 0;
  const monthly: MonthlyPoint[] = months.map((month) => {
    const { income: i, expense: e } = monthlyMap.get(month)!;
    const net = i - e;
    cum += net;
    return { month, income: i, expense: e, net, cumulativeNet: cum };
  });

  return {
    income,
    expense,
    net: income - expense,
    savingsContributions,
    internalVolume,
    expenseByCategory: toTotals(expenseCat),
    incomeByCategory: toTotals(incomeCat),
    allCategoryTotals: toTotals(allCat),
    monthly,
    txCount,
  };
}
