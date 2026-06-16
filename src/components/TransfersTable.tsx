import { useMemo, useState } from 'react';
import type { Account, StoredTxn } from '../types';
import { allOwners, resolveCounterpartyOwners } from '../services/internalTransfers';
import { updateTxnManualTransferOwner } from '../db/transactionsDb';
import { bankLabel, formatDate, formatEur, ownerLabel } from '../ui/format';

const AUTO = '__auto__';
const EXTERNAL = '__external__';

export function TransfersTable({
  txns,
  accounts,
  onChange,
}: {
  txns: StoredTxn[];
  accounts: Account[];
  onChange: () => Promise<void>;
}) {
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);

  const transfers = useMemo(() => txns.filter((t) => t.isTransfer), [txns]);
  const cpOwner = useMemo(() => resolveCounterpartyOwners(txns, accounts), [txns, accounts]);
  const owners = useMemo(() => allOwners(accounts), [accounts]);

  const rows = useMemo(
    () =>
      transfers
        .filter((t) => !onlyUnresolved || cpOwner.get(t.id) == null)
        .sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : -1)),
    [transfers, onlyUnresolved, cpOwner],
  );

  const unresolvedCount = useMemo(
    () => transfers.filter((t) => cpOwner.get(t.id) == null).length,
    [transfers, cpOwner],
  );

  async function setManualOwner(t: StoredTxn, value: string) {
    if (value === AUTO) await updateTxnManualTransferOwner(t.id, undefined);
    else if (value === EXTERNAL) await updateTxnManualTransferOwner(t.id, null);
    else await updateTxnManualTransferOwner(t.id, value);
    await onChange();
  }

  return (
    <div className="panel">
      <h2>Переводы ({transfers.length})</h2>
      <p className="muted small">
        Все операции, распознанные как переводы. Внутренние (между вашими профилями) определяются
        автоматически по IBAN, имени или парному переводу — здесь можно проверить и поправить
        вручную те, что не распознались.
      </p>

      <div className="filters">
        <label className="check-row">
          <input
            type="checkbox"
            checked={onlyUnresolved}
            onChange={(e) => setOnlyUnresolved(e.target.checked)}
          />
          Только нераспознанные{unresolvedCount > 0 ? ` (${unresolvedCount})` : ''}
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Счёт</th>
              <th>Контрагент</th>
              <th className="num">Сумма (EUR)</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const owner = cpOwner.get(t.id) ?? null;
              const isManual = t.manualTransferOwner !== undefined;
              const selectValue = isManual ? t.manualTransferOwner ?? EXTERNAL : AUTO;
              return (
                <tr key={t.id}>
                  <td>{formatDate(t.bookingDate)}</td>
                  <td>
                    {bankLabel(t.bank)} <span className="muted small">· {ownerLabel(t.accountOwner)}</span>
                  </td>
                  <td>
                    {t.counterpartyName ?? t.rawDescription}
                    {t.currency !== 'EUR' && (
                      <span className="muted small">
                        {' '}
                        ({t.amount.toFixed(2)} {t.currency})
                      </span>
                    )}
                  </td>
                  <td className={`num ${t.eurAmount < 0 ? 'neg' : 'pos'}`}>{formatEur(t.eurAmount)}</td>
                  <td>
                    <div className="transfer-status">
                      {owner != null ? (
                        <span className="badge badge-internal">внутр. → {ownerLabel(owner)}</span>
                      ) : (
                        <span className="badge badge-external">внешний / неизвестно</span>
                      )}
                      {isManual && <span className="muted small">(вручную)</span>}
                      <select value={selectValue} onChange={(e) => setManualOwner(t, e.target.value)}>
                        <option value={AUTO}>Авто</option>
                        {owners.map((o) => (
                          <option key={o} value={o}>
                            Внутр. → {ownerLabel(o)}
                          </option>
                        ))}
                        <option value={EXTERNAL}>Внешний (не внутр.)</option>
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Нет переводов{onlyUnresolved ? ', все распознаны.' : '.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
