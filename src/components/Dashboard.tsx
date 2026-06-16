import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Account, Category, Settings, StoredTxn } from '../types';
import { analyze, dateRange, ownersList } from '../services/analytics';
import { putSettings } from '../db/categoriesDb';
import { formatEur, ownerLabel } from '../ui/format';
import { IconEye } from '../ui/icons';
import type { ResolvedTheme } from '../ui/theme';

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
    grid: '#2a3147',
    text: '#8e98ac',
    tooltipBg: '#1a2032',
    tooltipBorder: '#2a3147',
    tooltipShadow: '0 12px 32px -12px rgba(0, 0, 0, 0.6)',
    cursor: 'rgba(123, 118, 245, 0.14)',
    panelStroke: '#1a2032',
  },
};

const TOOLTIP_RADIUS = 12;

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
  onViewCategory: (categoryId: string | null) => void;
  theme: ResolvedTheme;
}) {
  const ct = CHART_THEME[theme];
  const tooltipStyle = {
    background: ct.tooltipBg,
    border: `1px solid ${ct.tooltipBorder}`,
    borderRadius: TOOLTIP_RADIUS,
    boxShadow: ct.tooltipShadow,
    padding: '8px 12px',
  };
  const owners = ownersList(accounts);
  const fullRange = useMemo(() => dateRange(txns), [txns]);
  const [start, setStart] = useState(fullRange.start);
  const [end, setEnd] = useState(fullRange.end);

  const selectedOwners = settings.selectedOwners.length ? settings.selectedOwners : owners;
  const selectedSet = new Set(selectedOwners);

  const result = useMemo(
    () =>
      analyze(txns, accounts, categories, {
        period: { start, end },
        selectedOwners: settings.selectedOwners,
        excludedCategoryIds: settings.excludedCategoryIds,
      }),
    [txns, accounts, categories, start, end, settings],
  );

  async function persist(next: Settings) {
    await putSettings(next);
    await onSettingsChange();
  }

  function toggleOwner(owner: string) {
    // Если выбраны все (пусто) — начинаем явный список.
    const current = settings.selectedOwners.length ? settings.selectedOwners : owners;
    const next = current.includes(owner)
      ? current.filter((o) => o !== owner)
      : [...current, owner];
    void persist({ ...settings, selectedOwners: next });
  }

  function toggleCategory(catId: string) {
    const ex = settings.excludedCategoryIds;
    const next = ex.includes(catId) ? ex.filter((c) => c !== catId) : [...ex, catId];
    void persist({ ...settings, excludedCategoryIds: next });
  }

  if (txns.length === 0) {
    return (
      <div className="panel">
        <h2>Дашборд</h2>
        <p className="muted">Нет данных. Загрузите выписки на вкладке «Импорт».</p>
      </div>
    );
  }

  const cashRemaining = result.net - result.savingsContributions;

  return (
    <div className="panel">
      <h2>Дашборд</h2>

      {owners.length > 1 && (
        <div className="chips">
          <span className="muted">Профили:</span>
          {owners.map((o) => (
            <button
              key={o}
              className={`chip ${selectedSet.has(o) ? 'active' : ''}`}
              onClick={() => toggleOwner(o)}
            >
              {ownerLabel(o)}
            </button>
          ))}
          {selectedOwners.length > 1 && <span className="muted">(домохозяйство)</span>}
        </div>
      )}

      <div className="period period-inputs">
        <div className="period-dates">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="С" />
          <span className="muted">–</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="по" />
        </div>
        <button
          onClick={() => {
            setStart(fullRange.start);
            setEnd(fullRange.end);
          }}
        >
          Весь период
        </button>
      </div>

      <div className="cards">
        <Card title="Доходы" value={result.income} accent="green" />
        <Card title="Расходы" value={result.expense} accent="red" />
        <Card title="Сальдо (разница)" value={result.net} accent={result.net >= 0 ? 'green' : 'red'} />
        <Card title="В инвестиции" value={result.savingsContributions} accent="blue" />
        <Card title="Изменение кэша" value={cashRemaining} accent="neutral" />
      </div>
      {cashRemaining < 0 && (
        <p className="warn small" style={{ marginTop: '12px', marginBottom: '8px' }}>
          Отрицательное изменение кэша означает, что в инвестиции переведено больше,
          чем составило сальдо за выбранный период (разница покрыта из прошлых накоплений).
        </p>
      )}
      <p className="muted small" style={{ marginTop: '8px' }}>
        Внутренних переводов исключено на {formatEur(result.internalVolume)} · операций учтено:{' '}
        {result.txCount}
      </p>

      <div className="charts">
        <div className="chart-box">
          <h4>Расходы по категориям</h4>
          {result.expenseByCategory.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={result.expenseByCategory}
                  dataKey="amount"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={100}
                  paddingAngle={2}
                  label={(p) => (
                    <text x={p.x} y={p.y} textAnchor={p.textAnchor} fill={ct.text} fontSize={12}>
                      {p.name}
                    </text>
                  )}
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
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted">Нет расходов в периоде.</p>
          )}
        </div>

        <div className="chart-box">
          <h4>По месяцам</h4>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={result.monthly} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ct.grid} />
              <XAxis
                dataKey="month"
                tick={{ fill: ct.text, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis tick={{ fill: ct.text, fontSize: 12 }} tickLine={false} axisLine={false} width={64} />
              <Tooltip
                formatter={(v: number) => formatEur(v)}
                contentStyle={tooltipStyle}
                labelStyle={{ color: ct.text }}
                itemStyle={{ color: ct.text }}
                cursor={{ fill: ct.cursor }}
              />
              <Legend wrapperStyle={{ color: ct.text, fontSize: 12, paddingTop: 8 }} iconType="circle" />
              <Bar dataKey="income" name="Доход" fill="#22c55e" radius={[6, 6, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expense" name="Расход" fill="#ef4444" radius={[6, 6, 0, 0]} maxBarSize={28} />
              <Line
                dataKey="cumulativeNet"
                name="Накоплено (нарастающим)"
                stroke="#818cf8"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-box">
        <h4>Доход по категориям</h4>
        {result.incomeByCategory.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={result.incomeByCategory} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={ct.grid} />
              <XAxis type="number" tick={{ fill: ct.text, fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fill: ct.text, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(v: number) => formatEur(v)}
                contentStyle={tooltipStyle}
                labelStyle={{ color: ct.text }}
                itemStyle={{ color: ct.text }}
                cursor={{ fill: ct.cursor }}
              />
              <Bar dataKey="amount" name="Доход" radius={[0, 6, 6, 0]} maxBarSize={26}>
                {result.incomeByCategory.map((c, i) => (
                  <Cell key={i} fill={c.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="muted">Нет доходов в периоде.</p>
        )}
      </div>

      <div className="exclusions">
        <h4>Категории</h4>
        <p className="muted small">
          Снимите галочку, чтобы исключить категорию из подсчётов (по умолчанию исключены
          внутренние переводы и накопления/инвестиции). Иконкой глаза можно открыть конкретные
          операции этой категории и при необходимости перенести их в другую.
        </p>
        <div className="exclusion-grid">
          {result.allCategoryTotals.map((c) => {
            const id = c.categoryId ?? '__none__';
            const excluded = settings.excludedCategoryIds.includes(id);
            return (
              <div key={id} className="exclusion-item">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={!excluded}
                    onChange={() => toggleCategory(id)}
                    disabled={id === '__none__'}
                  />
                  <span className="pill-dot" style={{ background: c.color }} />
                  <span className="exclusion-name">{c.name}</span>
                </label>
                <span className="muted small">{formatEur(c.amount)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  title="Посмотреть операции"
                  onClick={() => onViewCategory(c.categoryId)}
                >
                  <IconEye />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Card({ title, value, accent, fullWidth }: { title: string; value: number; accent: string; fullWidth?: boolean }) {
  return (
    <div className={`card ${accent} ${fullWidth ? 'full-width' : ''}`}>
      <div className="card-title">{title}</div>
      <div className="card-value">{formatEur(value)}</div>
    </div>
  );
}
