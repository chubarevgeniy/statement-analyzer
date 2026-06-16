import { useState } from 'react';
import type { Account, Category, Mapping, StatementMeta } from '../types';
import { deleteCategory, deleteMapping, putCategory, resetCategoriesDb } from '../db/categoriesDb';
import { resetTransactionsDb } from '../db/transactionsDb';
import { bankLabel, ownerLabel } from '../ui/format';

export function SettingsPanel({
  categories,
  mappings,
  accounts,
  statements,
  onChange,
}: {
  categories: Category[];
  mappings: Mapping[];
  accounts: Account[];
  statements: StatementMeta[];
  onChange: () => Promise<void>;
}) {
  const [newName, setNewName] = useState('');

  async function addCategory() {
    const name = newName.trim();
    if (!name) return;
    await putCategory({
      id: crypto.randomUUID(),
      name,
      kind: 'expense',
      excludedByDefault: false,
      color: '#1976d2',
    });
    setNewName('');
    await onChange();
  }

  async function confirmReset(which: 'tx' | 'cat') {
    const msg =
      which === 'tx'
        ? 'Удалить ВСЕ транзакции, счета и метаданные? Это необратимо.'
        : 'Сбросить категории и маппинги к значениям по умолчанию? Это необратимо.';
    if (!window.confirm(msg)) return;
    if (which === 'tx') await resetTransactionsDb();
    else await resetCategoriesDb();
    await onChange();
  }

  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="panel">
      <h2>Настройки</h2>

      <section>
        <h3>Категории</h3>
        <ul className="settings-list">
          {categories.map((c) => (
            <li key={c.id}>
              <span style={{ color: c.color }}>●</span> {c.name}{' '}
              <span className="muted small">({c.kind})</span>
              {c.builtin ? (
                <span className="muted small"> · встроенная</span>
              ) : (
                <button
                  className="link"
                  onClick={async () => {
                    await deleteCategory(c.id);
                    await onChange();
                  }}
                >
                  удалить
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="inline-add">
          <input
            placeholder="Новая категория"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCategory()}
          />
          <button onClick={addCategory}>Добавить</button>
        </div>
      </section>

      <section>
        <h3>Маппинги операций → категории ({mappings.length})</h3>
        <ul className="settings-list">
          {mappings.map((m) => (
            <li key={m.key}>
              <code>{m.key}</code> → {catName(m.categoryId)}
              <button
                className="link"
                onClick={async () => {
                  await deleteMapping(m.key);
                  await onChange();
                }}
              >
                удалить
              </button>
            </li>
          ))}
          {mappings.length === 0 && <li className="muted">Пока нет сохранённых маппингов.</li>}
        </ul>
      </section>

      <section>
        <h3>Распознанные счета</h3>
        <ul className="settings-list">
          {accounts.map((a) => (
            <li key={a.iban}>
              {bankLabel(a.bank)} · {ownerLabel(a.owner)} · <code>{a.iban}</code>
            </li>
          ))}
          {accounts.length === 0 && <li className="muted">Нет счетов.</li>}
        </ul>
      </section>

      <section>
        <h3>Импортированные выписки</h3>
        <ul className="settings-list">
          {statements.map((s) => (
            <li key={s.id}>
              {bankLabel(s.bank)} · {s.fileName} · {s.txnCount} операций
            </li>
          ))}
          {statements.length === 0 && <li className="muted">Нет импортов.</li>}
        </ul>
      </section>

      <section className="danger">
        <h3>Сброс баз данных</h3>
        <p className="muted small">Каждая база сбрасывается отдельно.</p>
        <button className="btn-danger" onClick={() => confirmReset('tx')}>
          Сбросить БД транзакций
        </button>
        <button className="btn-danger" onClick={() => confirmReset('cat')}>
          Сбросить БД категорий
        </button>
      </section>
    </div>
  );
}
