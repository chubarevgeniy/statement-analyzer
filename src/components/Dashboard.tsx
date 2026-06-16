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

export function Dashboard({
  txns,
  accounts,
  categories,
  settings,
  onSettingsChange,
}: {
  txns: StoredTxn[];
  accounts: Account[];
  categories: Category[];
  settings: Settings;
  onSettingsChange: () => Promise<void>;
}) {
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

      <div className="period">
        <label>
          С <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          по <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
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
        <Card title="Заработано" value={result.income} accent="green" />
        <Card title="Потрачено" value={result.expense} accent="red" />
        <Card title="Накоплено" value={result.net} accent={result.net >= 0 ? 'green' : 'red'} />
        <Card title="В инвестиции" value={result.savingsContributions} accent="blue" />
        <Card title="Осталось кэшем" value={cashRemaining} accent="neutral" />
      </div>
      <p className="muted small">
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
                  outerRadius={100}
                  label={(e) => e.name}
                >
                  {result.expenseByCategory.map((c, i) => (
                    <Cell key={i} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatEur(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted">Нет расходов в периоде.</p>
          )}
        </div>

        <div className="chart-box">
          <h4>По месяцам</h4>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={result.monthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v: number) => formatEur(v)} />
              <Legend />
              <Bar dataKey="income" name="Доход" fill="#43a047" />
              <Bar dataKey="expense" name="Расход" fill="#e53935" />
              <Line dataKey="cumulativeNet" name="Накоплено (нарастающим)" stroke="#1976d2" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-box">
        <h4>Доход по категориям</h4>
        {result.incomeByCategory.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={result.incomeByCategory} layout="vertical">
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={140} />
              <Tooltip formatter={(v: number) => formatEur(v)} />
              <Bar dataKey="amount" name="Доход">
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
        <h4>Исключить категории из подсчётов</h4>
        <p className="muted small">
          По умолчанию исключены внутренние переводы и накопления/инвестиции. Можно исключить и
          другие (например, внос наличных).
        </p>
        <div className="exclusion-grid">
          {result.allCategoryTotals.map((c) => {
            const id = c.categoryId ?? '__none__';
            const excluded = settings.excludedCategoryIds.includes(id);
            return (
              <label key={id} className="exclusion-item">
                <input
                  type="checkbox"
                  checked={!excluded}
                  onChange={() => toggleCategory(id)}
                  disabled={id === '__none__'}
                />
                <span style={{ color: c.color }}>●</span> {c.name}
                <span className="muted small"> {formatEur(c.amount)}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Card({ title, value, accent }: { title: string; value: number; accent: string }) {
  return (
    <div className={`card ${accent}`}>
      <div className="card-title">{title}</div>
      <div className="card-value">{formatEur(value)}</div>
    </div>
  );
}
