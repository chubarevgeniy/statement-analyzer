import { useEffect, useMemo, useState } from 'react';
import type { Account, Category, CategoryKind, Settings, StoredTxn } from '../types';
import { assignCategory, assignCategoryBulk, applyChoicesToTxns } from '../services/categorize';
import { categoryKey } from '../services/categoryKey';
import { resolveCounterpartyOwners, allOwners } from '../services/internalTransfers';
import { suggestCategoriesLlm, type LlmItem } from '../services/llm';
import { updateTxnManualTransferOwner } from '../db/transactionsDb';
import { putCategory } from '../db/categoriesDb';
import { bankLabel, formatDate, formatEur, ownerLabel } from '../ui/format';
import { ImportReview } from './ImportReview';
import type { UnknownKey } from '../services/import';

const AUTO = '__auto__';
const EXTERNAL = '__external__';

export function TransactionsTable({
  txns,
  accounts,
  categories,
  settings,
  onChange,
  presetCategoryId,
}: {
  txns: StoredTxn[];
  accounts: Account[];
  categories: Category[];
  settings: Settings;
  onChange: () => Promise<void>;
  /** Извне заданный фильтр по категории (например, переход «посмотреть» с дашборда). */
  presetCategoryId?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [bankFilter, setBankFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [extraCategories, setExtraCategories] = useState<Category[]>([]);
  // Предложение применить ручную правку к остальным однотипным операциям.
  const [similar, setSimilar] = useState<{ ids: string[]; categoryId: string; name: string } | null>(
    null,
  );

  useEffect(() => {
    if (presetCategoryId !== undefined) setCatFilter(presetCategoryId ?? '__none__');
  }, [presetCategoryId]);

  const llmConfig = settings.llm?.enabled ? settings.llm : null;
  const cpOwner = useMemo(() => resolveCounterpartyOwners(txns, accounts), [txns, accounts]);
  const owners = useMemo(() => allOwners(accounts), [accounts]);
  const banks = useMemo(() => Array.from(new Set(txns.map((t) => t.bank))), [txns]);

  const allCategories = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    for (const c of extraCategories) m.set(c.id, c);
    return Array.from(m.values());
  }, [categories, extraCategories]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txns
      .filter((t) => {
        if (ownerFilter && t.accountOwner !== ownerFilter) return false;
        if (bankFilter && t.bank !== bankFilter) return false;
        if (catFilter === '__none__' && t.categoryId != null) return false;
        if (catFilter && catFilter !== '__none__' && t.categoryId !== catFilter) return false;
        if (dateFrom && t.bookingDate < dateFrom) return false;
        if (dateTo && t.bookingDate > dateTo) return false;
        if (q) {
          const hay = `${t.rawDescription} ${t.counterpartyName ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : -1));
  }, [txns, query, ownerFilter, catFilter, bankFilter, dateFrom, dateTo]);

  const shown = rows.slice(0, 1000);
  const selectedTxns = useMemo(() => txns.filter((t) => selected.has(t.id)), [txns, selected]);
  const allShownSelected = shown.length > 0 && shown.every((t) => selected.has(t.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (shown.every((t) => prev.has(t.id))) {
        const next = new Set(prev);
        for (const t of shown) next.delete(t.id);
        return next;
      }
      const next = new Set(prev);
      for (const t of shown) next.add(t.id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function changeCategory(t: StoredTxn, categoryId: string) {
    const id = categoryId || null;
    await assignCategory(t, id);
    // Если есть другие однотипные операции с иной категорией — предложим обновить их.
    if (id && !t.isTransfer) {
      const key = categoryKey(t);
      const others = txns.filter(
        (x) => x.id !== t.id && !x.isTransfer && x.categoryId !== id && categoryKey(x) === key,
      );
      if (others.length > 0) {
        const name = allCategories.find((c) => c.id === id)?.name ?? '';
        setSimilar({ ids: others.map((x) => x.id), categoryId: id, name });
      }
    }
    await onChange();
  }

  async function applySimilar() {
    if (!similar) return;
    setBusy(true);
    const targets = txns.filter((t) => similar.ids.includes(t.id));
    await assignCategoryBulk(targets, similar.categoryId);
    setSimilar(null);
    await onChange();
    setBusy(false);
  }

  async function setManualOwner(t: StoredTxn, value: string) {
    if (value === AUTO) await updateTxnManualTransferOwner(t.id, undefined);
    else if (value === EXTERNAL) await updateTxnManualTransferOwner(t.id, null);
    else await updateTxnManualTransferOwner(t.id, value);
    await onChange();
  }

  // ── Групповые действия ──
  async function bulkAssign() {
    if (!bulkCat || selectedTxns.length === 0) return;
    setBusy(true);
    setMsg(null);
    await assignCategoryBulk(selectedTxns, bulkCat || null);
    clearSelection();
    await onChange();
    setBusy(false);
  }

  async function bulkAi() {
    if (!llmConfig || selectedTxns.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      // Группируем по ключу, чтобы не гонять дубли через модель.
      const byKey = new Map<string, StoredTxn>();
      for (const t of selectedTxns) {
        if (t.isTransfer) continue;
        const key = categoryKey(t);
        if (key && !byKey.has(key)) byKey.set(key, t);
      }
      const items: LlmItem[] = Array.from(byKey.entries()).map(([key, t]) => ({
        key,
        description: t.counterpartyName ?? t.rawDescription,
        amount: t.eurAmount,
        currency: t.currency,
      }));
      const suggestions = await suggestCategoriesLlm(items, allCategories, llmConfig);
      await applyChoicesToTxns(selectedTxns, suggestions);
      setMsg(`ИИ распознал ${suggestions.size} из ${items.length} групп`);
      clearSelection();
      await onChange();
    } catch (e) {
      setMsg('Ошибка ИИ: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  // Неизвестные ключи выбранных операций — для мастера «разобрать по очереди».
  const wizardKeys = useMemo<UnknownKey[]>(() => {
    const m = new Map<string, UnknownKey>();
    for (const t of selectedTxns) {
      if (t.isTransfer) continue;
      const key = categoryKey(t);
      if (!key) continue;
      const ex = m.get(key);
      if (ex) ex.count++;
      else
        m.set(key, {
          key,
          sampleDescription: t.counterpartyName ?? t.rawDescription,
          suggestedKind: t.eurAmount >= 0 ? 'income' : 'expense',
          count: 1,
          sampleDate: t.bookingDate,
          sampleAmount: t.eurAmount,
          sampleCurrency: t.currency,
          sampleBank: t.bank,
          sampleAccountIban: t.accountIban,
        });
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [selectedTxns]);

  async function createCategory(data: { name: string; kind: CategoryKind; color: string }) {
    const cat: Category = {
      id: crypto.randomUUID(),
      name: data.name,
      kind: data.kind,
      excludedByDefault: false,
      color: data.color,
    };
    await putCategory(cat);
    setExtraCategories((prev) => [...prev, cat]);
    return cat;
  }

  async function confirmWizard() {
    setBusy(true);
    const categoryByKey = new Map<string, string>();
    for (const u of wizardKeys) {
      const id = choices[u.key];
      if (id) categoryByKey.set(u.key, id);
    }
    await applyChoicesToTxns(selectedTxns, categoryByKey);
    setWizard(false);
    setChoices({});
    setExtraCategories([]);
    clearSelection();
    await onChange();
    setBusy(false);
  }

  if (wizard) {
    return (
      <ImportReview
        categories={allCategories}
        unknownKeys={wizardKeys}
        fxNeeds={[]}
        choices={choices}
        busy={busy}
        llmConfig={llmConfig}
        onSetRate={() => {}}
        onSetCategory={(key, categoryId) => setChoices((prev) => ({ ...prev, [key]: categoryId }))}
        onSetChoices={(next) => setChoices((prev) => ({ ...prev, ...next }))}
        onCreateCategory={createCategory}
        onCancel={() => {
          setWizard(false);
          setChoices({});
          setExtraCategories([]);
        }}
        onConfirm={confirmWizard}
      />
    );
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
        {banks.length > 1 && (
          <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}>
            <option value="">Все банки</option>
            {banks.map((b) => (
              <option key={b} value={b}>
                {bankLabel(b)}
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
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="Дата с"
          title="Дата с"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="Дата по"
          title="Дата по"
        />
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">Выбрано: {selected.size}</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} disabled={busy}>
            <option value="">— в категорию —</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={bulkAssign} disabled={busy || !bulkCat}>
            Применить ко всем
          </button>
          <button type="button" onClick={() => setWizard(true)} disabled={busy}>
            Разобрать по очереди
          </button>
          {llmConfig && (
            <button type="button" onClick={bulkAi} disabled={busy}>
              🤖 ИИ
            </button>
          )}
          <button type="button" className="link" onClick={clearSelection} disabled={busy}>
            Снять выбор
          </button>
        </div>
      )}

      {msg && <p className="muted small">{msg}</p>}

      {similar && (
        <div className="similar-bar">
          <span>
            Применить «{similar.name}» к ещё {similar.ids.length} однотипным операциям?
          </span>
          <button type="button" onClick={applySimilar} disabled={busy}>
            Да, применить
          </button>
          <button type="button" className="link" onClick={() => setSimilar(null)} disabled={busy}>
            Нет
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="check-col">
                <input
                  type="checkbox"
                  checked={allShownSelected}
                  onChange={toggleSelectAll}
                  aria-label="Выбрать все"
                />
              </th>
              <th>Дата</th>
              <th>Банк</th>
              <th>Операция</th>
              <th className="num">Сумма (EUR)</th>
              <th>Категория</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const internal = cpOwner.get(t.id) != null && t.isTransfer;
              return (
                <tr key={t.id} className={selected.has(t.id) ? 'row-selected' : ''}>
                  <td className="check-col">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      aria-label="Выбрать операцию"
                    />
                  </td>
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
                    {t.isTransfer && (
                      <select
                        className="transfer-mini"
                        value={
                          t.manualTransferOwner !== undefined
                            ? t.manualTransferOwner ?? EXTERNAL
                            : AUTO
                        }
                        onChange={(e) => setManualOwner(t, e.target.value)}
                        title="Внутренний/внешний перевод"
                      >
                        <option value={AUTO}>Перевод: авто</option>
                        {owners.map((o) => (
                          <option key={o} value={o}>
                            Внутр. → {ownerLabel(o)}
                          </option>
                        ))}
                        <option value={EXTERNAL}>Внешний</option>
                      </select>
                    )}
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
