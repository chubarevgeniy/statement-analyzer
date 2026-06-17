import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Account, Category, Settings, StoredTxn } from '../types';
import {
  analyze,
  compare,
  dateRange,
  monthPeriod,
  monthsList,
  ownersList,
  prevMonth,
  yearPeriod,
  type CategoryDelta,
} from '../services/analytics';
import { putSettings } from '../db/categoriesDb';
import { formatEur, ownerLabel } from '../ui/format';
import { IconArrowDownRight, IconArrowUpRight, IconEye } from '../ui/icons';
import type { ResolvedTheme } from '../ui/theme';
import type { TxnView } from './TransactionsTable';

const CHART_THEME = {
  light: {
    grid: '#e6e9ef',
    text: '#6b7486',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e2e6ef',
    tooltipShadow: '0 12px 28px -14px rgba(30, 35, 60, 0.25)',
    cursor: 'rgba(106, 100, 240, 0.08)',
    panelStroke: '#ffffff',
  },
  dark: {
    grid: '#262a36',
    text: '#8b93a7',
    tooltipBg: '#1c1f29',
    tooltipBorder: '#262a36',
    tooltipShadow: '0 12px 32px -12px rgba(0, 0, 0, 0.6)',
    cursor: 'rgba(124, 108, 255, 0.14)',
    panelStroke: '#15171f',
  },
};

const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const monthShortFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long' });

function monthLabel(ym: string, withYear = false): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const s = (withYear ? monthFmt : monthShortFmt).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function Dashboard({
  txns,
  accounts,
  categories,
  settings,
  onSettingsChange,
  onViewCategory,
  theme,
}: {
  txns: StoredTxn[];
  accounts: Account[];
  categories: Category[];
  settings: Settings;
  onSettingsChange: () => Promise<void>;
  onViewCategory: (view: Omit<TxnView, 'nonce'>) => void;
  theme: ResolvedTheme;
}) {
  const owners = ownersList(accounts);
  const fullRange = useMemo(() => dateRange(txns), [txns]);
  const [view, setView] = useState<'overview' | 'compare'>('overview');

  const selectedOwners = settings.selectedOwners.length ? settings.selectedOwners : owners;
  const selectedSet = new Set(selectedOwners);

  async function persist(next: Settings) {
    await putSettings(next);
    await onSettingsChange();
  }

  function toggleOwner(owner: string) {
    const current = settings.selectedOwners.length ? settings.selectedOwners : owners;
    const next = current.includes(owner)
      ? current.filter((o) => o !== owner)
      : [...current, owner];
    void persist({ ...settings, selectedOwners: next });
  }

  if (txns.length === 0) {
    return (
      <div className="screen">
        <div className="card">
          <p className="empty">Нет данных. Загрузите выписки на вкладке «Импорт».</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      {owners.length > 1 && (
        <div className="chip-row">
          {owners.map((o) => (
            <button
              key={o}
              className={`chip ${selectedSet.has(o) ? 'active' : ''}`}
              onClick={() => toggleOwner(o)}
            >
              {ownerLabel(o)}
            </button>
          ))}
        </div>
      )}

      <div className="segmented accent">
        <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>
          Обзор
        </button>
        <button className={view === 'compare' ? 'active' : ''} onClick={() => setView('compare')}>
          Сравнение
        </button>
      </div>

      {view === 'overview' ? (
        <OverviewView
          txns={txns}
          accounts={accounts}
          categories={categories}
          settings={settings}
          fullRange={fullRange}
          theme={theme}
          onPersist={persist}
          onViewCategory={onViewCategory}
        />
      ) : (
        <CompareView
          txns={txns}
          accounts={accounts}
          categories={categories}
          settings={settings}
          fullRange={fullRange}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Обзор (бывший дашборд)
// ──────────────────────────────────────────────────────────────

type PeriodMode = 'all' | 'year' | 'month' | 'custom';

function OverviewView({
  txns,
  accounts,
  categories,
  settings,
  fullRange,
  theme,
  onPersist,
  onViewCategory,
}: {
  txns: StoredTxn[];
  accounts: Account[];
  categories: Category[];
  settings: Settings;
  fullRange: { start: string; end: string };
  theme: ResolvedTheme;
  onPersist: (next: Settings) => Promise<void>;
  onViewCategory: (view: Omit<TxnView, 'nonce'>) => void;
}) {
  const ct = CHART_THEME[theme];
  const tooltipStyle = {
    background: ct.tooltipBg,
    border: `1px solid ${ct.tooltipBorder}`,
    borderRadius: 12,
    boxShadow: ct.tooltipShadow,
    padding: '8px 12px',
  };

  const [mode, setMode] = useState<PeriodMode>('all');
  const years = useMemo(() => {
    const a = Number(fullRange.start.slice(0, 4));
    const b = Number(fullRange.end.slice(0, 4));
    const arr: number[] = [];
    for (let y = b; y >= a; y--) arr.push(y);
    return arr.length ? arr : [new Date().getFullYear()];
  }, [fullRange]);
  const [year, setYear] = useState<number>(years[0]);
  const [month, setMonth] = useState<string>(fullRange.end.slice(0, 7));
  const [customStart, setCustomStart] = useState(fullRange.start);
  const [customEnd, setCustomEnd] = useState(fullRange.end);

  const period = useMemo(() => {
    if (mode === 'year') return yearPeriod(year);
    if (mode === 'month') return monthPeriod(month);
    if (mode === 'custom') return { start: customStart, end: customEnd };
    return fullRange;
  }, [mode, year, month, customStart, customEnd, fullRange]);

  const result = useMemo(
    () =>
      analyze(txns, accounts, categories, {
        period,
        selectedOwners: settings.selectedOwners,
        excludedCategoryIds: settings.excludedCategoryIds,
      }),
    [txns, accounts, categories, period, settings],
  );

  function toggleCategory(catId: string) {
    const ex = settings.excludedCategoryIds;
    const next = ex.includes(catId) ? ex.filter((c) => c !== catId) : [...ex, catId];
    void onPersist({ ...settings, excludedCategoryIds: next });
  }

  const cashRemaining = result.net - result.savingsContributions;

  return (
    <>
      <div className="segmented">
        {(
          [
            ['all', 'Весь'],
            ['year', 'Год'],
            ['month', 'Месяц'],
            ['custom', 'Период'],
          ] as [PeriodMode, string][]
        ).map(([m, label]) => (
          <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'year' && (
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Год">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}
      {mode === 'month' && (
        <input
          type="month"
          value={month}
          min={fullRange.start.slice(0, 7)}
          max={fullRange.end.slice(0, 7)}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Месяц"
        />
      )}
      {mode === 'custom' && (
        <div className="toolbar">
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} aria-label="С" />
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} aria-label="по" />
        </div>
      )}

      <div className="stat-grid">
        <Stat label="Доходы" value={result.income} accent="green" />
        <Stat label="Расходы" value={result.expense} accent="red" />
        <Stat label="Сальдо" value={result.net} accent={result.net >= 0 ? 'green' : 'red'} />
        <Stat label="В инвестиции" value={result.savingsContributions} accent="blue" />
        <Stat label="Изменение кэша" value={cashRemaining} span2 />
      </div>

      {cashRemaining < 0 && (
        <p className="warn">
          Отрицательное изменение кэша означает, что в инвестиции переведено больше, чем составило
          сальдо за период (разница покрыта из прошлых накоплений).
        </p>
      )}
      <p className="muted small">
        Внутренних переводов исключено на {formatEur(result.internalVolume)} · операций учтено:{' '}
        {result.txCount}
      </p>

      <div className="chart-card">
        <h3 className="card-heading">Расходы по категориям</h3>
        {result.expenseByCategory.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={result.expenseByCategory}
                dataKey="amount"
                nameKey="name"
                innerRadius={58}
                outerRadius={96}
                paddingAngle={2}
              >
                {result.expenseByCategory.map((c, i) => (
                  <Cell key={i} fill={c.color} stroke={ct.panelStroke} strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number) => formatEur(v)}
                contentStyle={tooltipStyle}
                labelStyle={{ color: ct.text }}
                itemStyle={{ color: ct.text }}
              />
              <Legend wrapperStyle={{ color: ct.text, fontSize: 12 }} iconType="circle" />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p className="empty">Нет расходов в периоде.</p>
        )}
      </div>

      <div className="chart-card">
        <h3 className="card-heading">Доходы и расходы по месяцам</h3>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={result.monthly} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ct.grid} />
            <XAxis dataKey="month" tick={{ fill: ct.text, fontSize: 11 }} tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tick={{ fill: ct.text, fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
            <Tooltip
              formatter={(v: number) => formatEur(v)}
              contentStyle={tooltipStyle}
              labelStyle={{ color: ct.text }}
              itemStyle={{ color: ct.text }}
              cursor={{ fill: ct.cursor }}
            />
            <Legend wrapperStyle={{ color: ct.text, fontSize: 11, paddingTop: 8 }} iconType="circle" />
            <Bar dataKey="income" name="Доход" fill="var(--green)" radius={[6, 6, 0, 0]} maxBarSize={26} />
            <Bar dataKey="expense" name="Расход" fill="var(--red)" radius={[6, 6, 0, 0]} maxBarSize={26} />
            <Line
              dataKey="cumulativeNet"
              name="Накоплено"
              stroke="var(--accent)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3 className="card-heading">Доход по категориям</h3>
        {result.incomeByCategory.length ? (
          <ResponsiveContainer width="100%" height={Math.max(140, result.incomeByCategory.length * 38)}>
            <BarChart data={result.incomeByCategory} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={ct.grid} />
              <XAxis type="number" tick={{ fill: ct.text, fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fill: ct.text, fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v: number) => formatEur(v)}
                contentStyle={tooltipStyle}
                labelStyle={{ color: ct.text }}
                itemStyle={{ color: ct.text }}
                cursor={{ fill: ct.cursor }}
              />
              <Bar dataKey="amount" name="Доход" radius={[0, 6, 6, 0]} maxBarSize={24}>
                {result.incomeByCategory.map((c, i) => (
                  <Cell key={i} fill={c.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="empty">Нет доходов в периоде.</p>
        )}
      </div>

      <h2 className="section-title">Категории</h2>
      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>
          Снимите галочку, чтобы исключить категорию из подсчётов. Иконкой глаза можно открыть
          операции категории.
        </p>
        {result.allCategoryTotals.map((c) => {
          const id = c.categoryId ?? '__none__';
          const excluded = settings.excludedCategoryIds.includes(id);
          return (
            <div key={id} className="cat-row">
              <label className="check-wrap">
                <input
                  type="checkbox"
                  checked={!excluded}
                  onChange={() => toggleCategory(id)}
                  disabled={id === '__none__'}
                />
                <span className="dot" style={{ background: c.color }} />
                <span className="cat-name">{c.name}</span>
              </label>
              <span className={`cat-amount ${c.amount < 0 ? 'neg' : c.amount > 0 ? 'pos' : ''}`}>{formatEur(c.amount)}</span>
              <button
                type="button"
                className="icon-btn"
                title="Посмотреть операции"
                onClick={() =>
                  onViewCategory({
                    // «Внутренний перевод» — это не категория конкретных операций, а
                    // динамический признак, поэтому открываем его особым фильтром.
                    categoryId: c.categoryId === 'internal' ? undefined : c.categoryId,
                    internal: c.categoryId === 'internal',
                    owners: settings.selectedOwners,
                    period,
                  })
                }
              >
                <IconEye />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// Сравнение (предопределённые дашборды)
// ──────────────────────────────────────────────────────────────

function CompareView({
  txns,
  accounts,
  categories,
  settings,
  fullRange,
}: {
  txns: StoredTxn[];
  accounts: Account[];
  categories: Category[];
  settings: Settings;
  fullRange: { start: string; end: string };
}) {
  const [mode, setMode] = useState<'month' | 'year'>('month');

  const months = useMemo(() => monthsList(fullRange), [fullRange]);
  const years = useMemo(() => {
    const a = Number(fullRange.start.slice(0, 4));
    const b = Number(fullRange.end.slice(0, 4));
    const arr: number[] = [];
    for (let y = b; y >= a; y--) arr.push(y);
    return arr.length ? arr : [new Date().getFullYear()];
  }, [fullRange]);

  const [month, setMonth] = useState<string>(months[0]);
  const [year, setYear] = useState<number>(years[0]);

  const cmp = useMemo(() => {
    const common = {
      selectedOwners: settings.selectedOwners,
      excludedCategoryIds: settings.excludedCategoryIds,
    };
    if (mode === 'month') {
      const prev = prevMonth(month);
      return compare(txns, accounts, categories, {
        current: monthPeriod(month),
        previous: monthPeriod(prev),
        currentLabel: monthLabel(month, true),
        previousLabel: monthLabel(prev, true),
        ...common,
      });
    }
    return compare(txns, accounts, categories, {
      current: yearPeriod(year),
      previous: yearPeriod(year - 1),
      currentLabel: String(year),
      previousLabel: String(year - 1),
      ...common,
    });
  }, [mode, month, year, txns, accounts, categories, settings]);

  return (
    <>
      <div className="segmented">
        <button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>
          Месяц к месяцу
        </button>
        <button className={mode === 'year' ? 'active' : ''} onClick={() => setMode('year')}>
          Год к году
        </button>
      </div>

      {mode === 'month' ? (
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Месяц">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, true)}
            </option>
          ))}
        </select>
      ) : (
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Год">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      )}

      <p className="muted small" style={{ margin: 0 }}>
        <strong style={{ color: 'var(--text)' }}>{cmp.currentLabel}</strong> в сравнении с{' '}
        {cmp.previousLabel}
      </p>

      <div className="stat-grid">
        <CompareStat label="Доходы" current={cmp.current.income} delta={cmp.incomeDelta} goodWhenUp />
        <CompareStat label="Расходы" current={cmp.current.expense} delta={cmp.expenseDelta} goodWhenUp={false} />
        <CompareStat label="Сальдо" current={cmp.current.net} delta={cmp.netDelta} goodWhenUp />
        <CompareStat
          label="В инвестиции"
          current={cmp.current.savingsContributions}
          delta={cmp.savingsDelta}
          goodWhenUp
        />
      </div>

      <MoversCard
        title="Расходы: что изменилось"
        deltas={cmp.expenseDeltas}
        currentLabel={cmp.currentLabel}
        previousLabel={cmp.previousLabel}
        increaseIsBad
      />
      <MoversCard
        title="Доходы: что изменилось"
        deltas={cmp.incomeDeltas}
        currentLabel={cmp.currentLabel}
        previousLabel={cmp.previousLabel}
        increaseIsBad={false}
      />
    </>
  );
}

function MoversCard({
  title,
  deltas,
  currentLabel,
  previousLabel,
  increaseIsBad,
}: {
  title: string;
  deltas: CategoryDelta[];
  currentLabel: string;
  previousLabel: string;
  increaseIsBad: boolean;
}) {
  const shown = deltas.filter((d) => Math.abs(d.delta) >= 0.005).slice(0, 8);
  const max = Math.max(1, ...shown.map((d) => Math.max(d.current, d.previous)));

  return (
    <>
      <h2 className="section-title">{title}</h2>
      <div className="card">
        {shown.length === 0 ? (
          <p className="empty">Изменений нет.</p>
        ) : (
          shown.map((d) => {
            const up = d.delta > 0;
            const good = increaseIsBad ? !up : up;
            return (
              <div key={d.categoryId ?? '__none__'} className="mover-row">
                <div className="mover-top">
                  <span className="dot" style={{ background: d.color }} />
                  <span className="mover-name">{d.name}</span>
                  <span className={`delta ${good ? 'up' : 'down'}`}>
                    {up ? <IconArrowUpRight /> : <IconArrowDownRight />}
                    {d.pct == null ? formatEur(Math.abs(d.delta)) : `${Math.abs(Math.round(d.pct * 100))}%`}
                  </span>
                </div>
                <div className="mover-bars">
                  <div className="mover-bar-track">
                    <span className="label">{previousLabel.length > 7 ? 'было' : previousLabel}</span>
                    <span className="mover-bar">
                      <span style={{ width: `${(d.previous / max) * 100}%`, background: 'var(--surface-3)', outline: '1px solid var(--border)' }} />
                    </span>
                    <span className="amount">{formatEur(d.previous)}</span>
                  </div>
                  <div className="mover-bar-track">
                    <span className="label">{currentLabel.length > 7 ? 'стало' : currentLabel}</span>
                    <span className="mover-bar">
                      <span style={{ width: `${(d.current / max) * 100}%`, background: d.color }} />
                    </span>
                    <span className="amount">{formatEur(d.current)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

// ── Маленькие компоненты ──

function Stat({
  label,
  value,
  accent,
  span2,
}: {
  label: string;
  value: number;
  accent?: 'green' | 'red' | 'blue';
  span2?: boolean;
}) {
  return (
    <div className={`stat-card ${accent ? `accent-${accent}` : ''} ${span2 ? 'span-2' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{formatEur(value)}</span>
    </div>
  );
}

function CompareStat({
  label,
  current,
  delta,
  goodWhenUp,
}: {
  label: string;
  current: number;
  delta: number;
  goodWhenUp: boolean;
}) {
  const up = delta > 0;
  const flat = Math.abs(delta) < 0.005;
  const good = up ? goodWhenUp : !goodWhenUp;
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{formatEur(current)}</span>
      <span className={`delta ${flat ? 'flat' : good ? 'up' : 'down'}`} style={{ alignSelf: 'flex-start' }}>
        {!flat && (up ? <IconArrowUpRight /> : <IconArrowDownRight />)}
        {flat ? 'без изменений' : `${up ? '+' : '−'}${formatEur(Math.abs(delta))}`}
      </span>
    </div>
  );
}
