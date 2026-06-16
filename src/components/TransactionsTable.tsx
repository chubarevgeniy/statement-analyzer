import { useMemo, useState } from 'react';
import type { Account, Category, StoredTxn } from '../types';
import { updateTxnCategory } from '../db/transactionsDb';
import { putMapping } from '../db/categoriesDb';
import { resolveCounterpartyOwners } from '../services/internalTransfers';
import { categoryKey } from '../services/categoryKey';
import { bankLabel, formatDate, formatEur, ownerLabel } from '../ui/format';

export function TransactionsTable({
  txns,
  accounts,
  categories,
  onChange,
}: {
  txns: StoredTxn[];
  accounts: Account[];
  categories: Category[];
  onChange: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');

  const cpOwner = useMemo(() => resolveCounterpartyOwners(txns, accounts), [txns, accounts]);
  const owners = useMemo(() => Array.from(new Set(accounts.map((a) => a.owner))), [accounts]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txns
      .filter((t) => {
        if (ownerFilter && t.accountOwner !== ownerFilter) return false;
        if (catFilter === '__none__' && t.categoryId != null) return false;
        if (catFilter && catFilter !== '__none__' && t.categoryId !== catFilter) return false;
        if (q) {
          const hay = `${t.rawDescription} ${t.counterpartyName ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : -1));
  }, [txns, query, ownerFilter, catFilter]);

  async function changeCategory(t: StoredTxn, categoryId: string) {
    await updateTxnCategory(t.id, categoryId || null);
    // Запоминаем маппинг, чтобы будущие такие операции категоризировались сами.
    if (categoryId && !t.isTransfer) {
      const key = categoryKey(t);
      if (key) await putMapping({ key, categoryId });
    }
    await onChange();
  }

  return (
    <div className="panel">
      <h2>Транзакции ({rows.length})</h2>
      <div className="filters">
        <input placeholder="Поиск…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {owners.length > 1 && (
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
            <option value="">Все профили</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {ownerLabel(o)}
              </option>
            ))}
          </select>
        )}
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">Все категории</option>
          <option value="__none__">— без категории —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Банк</th>
              <th>Операция</th>
              <th className="num">Сумма (EUR)</th>
              <th>Категория</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 1000).map((t) => {
              const internal = cpOwner.get(t.id) != null && t.isTransfer;
              return (
                <tr key={t.id}>
                  <td>{formatDate(t.bookingDate)}</td>
                  <td>{bankLabel(t.bank)}</td>
                  <td>
                    {t.counterpartyName ?? t.rawDescription}
                    {t.currency !== 'EUR' && (
                      <span className="muted small">
                        {' '}
                        ({t.amount.toFixed(2)} {t.currency})
                      </span>
                    )}
                    {internal && <span className="badge">внутр.</span>}
                  </td>
                  <td className={`num ${t.eurAmount < 0 ? 'neg' : 'pos'}`}>
                    {formatEur(t.eurAmount)}
                  </td>
                  <td>
                    <select
                      value={t.categoryId ?? ''}
                      onChange={(e) => changeCategory(t, e.target.value)}
                    >
                      <option value="">
                        {internal ? 'Внутренний перевод' : '— без категории —'}
                      </option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 1000 && <p className="muted">Показаны первые 1000 операций.</p>}
      </div>
    </div>
  );
}
