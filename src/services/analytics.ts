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
  /**
   * Чистый вклад в накопления/инвестиции (категории вида savings):
   * оттоки (покупки/пополнения) минус возвраты (продажи/выводы).
   * Может быть отрицательным, если из инвестиций выведено больше, чем вложено.
   */
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

// ── Готовые периоды для сравнений ──

export function monthPeriod(ym: string): Period {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` };
}

export function yearPeriod(y: number): Period {
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1); // m-1 текущий (0-based) → m-2 предыдущий
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Список месяцев (YYYY-MM) от самого свежего к старому, покрывающих данные. */
export function monthsList(range: Period): string[] {
  const out: string[] = [];
  let [y, m] = range.end.slice(0, 7).split('-').map(Number);
  const [sy, sm] = range.start.slice(0, 7).split('-').map(Number);
  while (y > sy || (y === sy && m >= sm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return out.length ? out : [range.end.slice(0, 7)];
}

export interface CategoryDelta {
  categoryId: string | null;
  name: string;
  color: string;
  current: number;
  previous: number;
  delta: number;
  /** Относительное изменение (доля), null если в прошлом периоде было 0. */
  pct: number | null;
}

export interface ComparisonResult {
  current: AnalyticsResult;
  previous: AnalyticsResult;
  /** Метки периодов для подписи. */
  currentLabel: string;
  previousLabel: string;
  incomeDelta: number;
  expenseDelta: number;
  netDelta: number;
  savingsDelta: number;
  /** Категории расходов, отсортированные по модулю изменения (крупнейшие движения вперёд). */
  expenseDeltas: CategoryDelta[];
  incomeDeltas: CategoryDelta[];
}

function joinDeltas(current: CategoryTotal[], previous: CategoryTotal[]): CategoryDelta[] {
  const prevById = new Map(previous.map((c) => [c.categoryId ?? UNCATEGORIZED, c]));
  const curById = new Map(current.map((c) => [c.categoryId ?? UNCATEGORIZED, c]));
  const keys = new Set([...prevById.keys(), ...curById.keys()]);
  const out: CategoryDelta[] = [];
  for (const key of keys) {
    const c = curById.get(key);
    const p = prevById.get(key);
    const meta = c ?? p!;
    const cur = c?.amount ?? 0;
    const prev = p?.amount ?? 0;
    out.push({
      categoryId: meta.categoryId,
      name: meta.name,
      color: meta.color,
      current: cur,
      previous: prev,
      delta: cur - prev,
      pct: prev === 0 ? null : (cur - prev) / prev,
    });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/**
 * Сравнивает два периода (например, текущий месяц с предыдущим или год к году).
 * Возвращает агрегаты обоих периодов и разбивку изменений по категориям.
 */
export function compare(
  txns: StoredTxn[],
  accounts: Account[],
  categories: Category[],
  opts: {
    current: Period;
    previous: Period;
    currentLabel: string;
    previousLabel: string;
    selectedOwners: string[];
    excludedCategoryIds: string[];
  },
): ComparisonResult {
  const common = {
    selectedOwners: opts.selectedOwners,
    excludedCategoryIds: opts.excludedCategoryIds,
  };
  const current = analyze(txns, accounts, categories, { period: opts.current, ...common });
  const previous = analyze(txns, accounts, categories, { period: opts.previous, ...common });
  return {
    current,
    previous,
    currentLabel: opts.currentLabel,
    previousLabel: opts.previousLabel,
    incomeDelta: current.income - previous.income,
    expenseDelta: current.expense - previous.expense,
    netDelta: current.net - previous.net,
    savingsDelta: current.savingsContributions - previous.savingsContributions,
    expenseDeltas: joinDeltas(current.expenseByCategory, previous.expenseByCategory),
    incomeDeltas: joinDeltas(current.incomeByCategory, previous.incomeByCategory),
  };
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

  let netInternal = 0;
  const monthlyInternal = new Map<string, number>();

  for (const t of ofOwners) {
    if (!inPeriod(t.bookingDate, opts.period)) continue;
    const internal = isInternal(t, cpOwner.get(t.id) ?? null, selectedSet);

    let catId = t.categoryId ?? UNCATEGORIZED;
    if (internal) {
      internalVolume += t.eurAmount > 0 ? t.eurAmount : 0;
      if (catId === UNCATEGORIZED) {
        catId = 'internal';
      }

      allCat.set(catId, (allCat.get(catId) ?? 0) + t.eurAmount);
      if (!excluded.has(catId)) {
        netInternal += t.eurAmount;
        const month = t.bookingDate.slice(0, 7);
        monthlyInternal.set(month, (monthlyInternal.get(month) ?? 0) + t.eurAmount);
      }
      continue;
    }

    const cat = catId !== UNCATEGORIZED ? catById.get(catId) : undefined;

    if (cat?.kind === 'savings') {
      savingsContributions += -t.eurAmount;
    }

    allCat.set(catId, (allCat.get(catId) ?? 0) + t.eurAmount);

    if (excluded.has(catId)) continue;

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

  if (netInternal > 0) {
    income += netInternal;
    incomeCat.set('internal', (incomeCat.get('internal') ?? 0) + netInternal);
  } else if (netInternal < 0) {
    expense += -netInternal;
    expenseCat.set('internal', (expenseCat.get('internal') ?? 0) + -netInternal);
  }

  for (const [month, net] of monthlyInternal.entries()) {
    const mp = monthlyMap.get(month) ?? { income: 0, expense: 0 };
    if (net > 0) {
      mp.income += net;
    } else if (net < 0) {
      mp.expense += -net;
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
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

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
    allCategoryTotals: toTotals(allCat, false),
    monthly,
    txCount,
  };
}
