import { useEffect, useMemo, useState } from 'react';
import type { Account, Category, CategoryKind, Mapping, Settings, StoredTxn } from '../types';
import { assignCategory, assignCategoryBulk, applyChoicesToTxns } from '../services/categorize';
import { categoryKey } from '../services/categoryKey';
import { resolveCounterpartyOwners, allOwners } from '../services/internalTransfers';
import { suggestCategoriesLlm, type LlmItem } from '../services/llm';
import { updateTxnManualTransferOwner } from '../db/transactionsDb';
import { putCategory } from '../db/categoriesDb';
import { bankLabel, formatDate, formatEur, ownerLabel } from '../ui/format';
import { IconClose, IconFilter, IconSearch, IconSparkles } from '../ui/icons';
import { ImportReview } from './ImportReview';
import type { UnknownKey } from '../services/import';

const AUTO = '__auto__';
const EXTERNAL = '__external__';

export function TransactionsTable({
  txns,
  accounts,
  categories,
  settings,
  mappings,
  onChange,
  presetCategoryId,
}: {
  txns: StoredTxn[];
  accounts: Account[];
  categories: Category[];
  settings: Settings;
  mappings: Mapping[];
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
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [bulkCat, setBulkCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [extraCategories, setExtraCategories] = useState<Category[]>([]);
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

  const activeFilters =
    (ownerFilter ? 1 : 0) + (bankFilter ? 1 : 0) + (catFilter ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllShown() {
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

  function exitSelectMode() {
    setSelectMode(false);
    clearSelection();
  }

  async function changeCategory(t: StoredTxn, categoryId: string) {
    const id = categoryId || null;
    await assignCategory(t, id);
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

  async function bulkAssign() {
    if (!bulkCat || selectedTxns.length === 0) return;
    setBusy(true);
    setMsg(null);
    await assignCategoryBulk(selectedTxns, bulkCat || null);
    exitSelectMode();
    await onChange();
    setBusy(false);
  }

  async function bulkAi() {
    if (!llmConfig || selectedTxns.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
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
      exitSelectMode();
      await onChange();
    } catch (e) {
      setMsg('Ошибка ИИ: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

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
    exitSelectMode();
    await onChange();
    setBusy(false);
  }

  function resetFilters() {
    setOwnerFilter('');
    setBankFilter('');
    setCatFilter('');
    setDateFrom('');
    setDateTo('');
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
        mappings={mappings}
        onSetRate={() => {}}
        onSetCategory={(key, categoryId) => setChoices((prev) => ({ ...prev, [key]: categoryId }))}
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
    <div className="screen">
      <div className="toolbar">
        <div className="searchbar">
          <IconSearch />
          <input placeholder="Поиск операций…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="icon-btn filter-btn" onClick={() => setFiltersOpen(true)} aria-label="Фильтры">
          <IconFilter />
          {activeFilters > 0 && <span className="filter-badge">{activeFilters}</span>}
        </button>
      </div>

      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <span className="muted small">Найдено: {rows.length}</span>
        {selectMode ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn-ghost" onClick={selectAllShown}>
              Все на экране
            </button>
            <button className="btn-ghost" onClick={exitSelectMode}>
              Готово
            </button>
          </div>
        ) : (
          <button className="btn-ghost" onClick={() => setSelectMode(true)}>
            Выбрать
          </button>
        )}
      </div>

      {msg && <p className="muted small">{msg}</p>}

      {similar && (
        <div className="similar-bar">
          <span style={{ flex: 1 }}>
            Применить «{similar.name}» к ещё {similar.ids.length} однотипным операциям?
          </span>
          <button className="btn btn-primary" onClick={applySimilar} disabled={busy}>
            Да
          </button>
          <button className="btn-ghost" onClick={() => setSimilar(null)} disabled={busy}>
            Нет
          </button>
        </div>
      )}

      <div className="card" style={{ padding: '4px 14px' }}>
        {shown.length === 0 ? (
          <p className="empty">Ничего не найдено.</p>
        ) : (
          <div className="txn-list">
            {shown.map((t) => {
              const internal = cpOwner.get(t.id) != null && t.isTransfer;
              const isSel = selected.has(t.id);
              return (
                <div key={t.id} className={`txn-row ${isSel ? 'selected' : ''}`}>
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSelect(t.id)}
                      aria-label="Выбрать операцию"
                    />
                  )}
                  <div className="txn-body">
                    <div className="txn-line">
                      <span className="txn-merchant">{t.counterpartyName ?? t.rawDescription}</span>
                      <span className={`txn-amount ${t.eurAmount < 0 ? 'neg' : 'pos'}`}>
                        {formatEur(t.eurAmount)}
                      </span>
                    </div>
                    <div className="txn-meta">
                      <span>{formatDate(t.bookingDate)}</span>
                      <span>·</span>
                      <span>{bankLabel(t.bank)}</span>
                      {t.currency !== 'EUR' && (
                        <span>
                          · {t.amount.toFixed(2)} {t.currency}
                        </span>
                      )}
                      {internal && <span className="tag internal">внутр.</span>}
                    </div>
                    <div className="txn-controls">
                      <select
                        value={t.categoryId ?? ''}
                        onChange={(e) => changeCategory(t, e.target.value)}
                        aria-label="Категория"
                      >
                        <option value="">{internal ? 'Внутренний перевод' : '— без категории —'}</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {t.isTransfer && (
                        <select
                          value={
                            t.manualTransferOwner !== undefined
                              ? t.manualTransferOwner ?? EXTERNAL
                              : AUTO
                          }
                          onChange={(e) => setManualOwner(t, e.target.value)}
                          aria-label="Статус перевода"
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
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {rows.length > 1000 && <p className="muted small">Показаны первые 1000 операций.</p>}

      {selectMode && selected.size > 0 && (
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
          <button className="btn btn-primary" onClick={bulkAssign} disabled={busy || !bulkCat}>
            Применить
          </button>
          <button className="btn" onClick={() => setWizard(true)} disabled={busy}>
            По очереди
          </button>
          {llmConfig && (
            <button className="btn" onClick={bulkAi} disabled={busy}>
              <IconSparkles /> ИИ
            </button>
          )}
        </div>
      )}

      {filtersOpen && (
        <FilterSheet
          owners={owners}
          banks={banks}
          categories={categories}
          ownerFilter={ownerFilter}
          bankFilter={bankFilter}
          catFilter={catFilter}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onOwner={setOwnerFilter}
          onBank={setBankFilter}
          onCat={setCatFilter}
          onDateFrom={setDateFrom}
          onDateTo={setDateTo}
          onReset={resetFilters}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  );
}

function FilterSheet({
  owners,
  banks,
  categories,
  ownerFilter,
  bankFilter,
  catFilter,
  dateFrom,
  dateTo,
  onOwner,
  onBank,
  onCat,
  onDateFrom,
  onDateTo,
  onReset,
  onClose,
}: {
  owners: string[];
  banks: string[];
  categories: Category[];
  ownerFilter: string;
  bankFilter: string;
  catFilter: string;
  dateFrom: string;
  dateTo: string;
  onOwner: (v: string) => void;
  onBank: (v: string) => void;
  onCat: (v: string) => void;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-header">
          <h3 className="sheet-title">Фильтры</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose />
          </button>
        </div>

        {owners.length > 1 && (
          <div className="field sheet-section">
            <span className="field-label">Профиль</span>
            <select value={ownerFilter} onChange={(e) => onOwner(e.target.value)}>
              <option value="">Все профили</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {ownerLabel(o)}
                </option>
              ))}
            </select>
          </div>
        )}

        {banks.length > 1 && (
          <div className="field sheet-section">
            <span className="field-label">Банк</span>
            <select value={bankFilter} onChange={(e) => onBank(e.target.value)}>
              <option value="">Все банки</option>
              {banks.map((b) => (
                <option key={b} value={b}>
                  {bankLabel(b)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field sheet-section">
          <span className="field-label">Категория</span>
          <select value={catFilter} onChange={(e) => onCat(e.target.value)}>
            <option value="">Все категории</option>
            <option value="__none__">— без категории —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="sheet-section">
          <span className="field-label">Период</span>
          <div className="toolbar">
            <input type="date" value={dateFrom} onChange={(e) => onDateFrom(e.target.value)} aria-label="Дата с" />
            <input type="date" value={dateTo} onChange={(e) => onDateTo(e.target.value)} aria-label="Дата по" />
          </div>
        </div>

        <div className="toolbar" style={{ gap: 10 }}>
          <button className="btn btn-block" onClick={onReset}>
            Сбросить
          </button>
          <button className="btn btn-primary btn-block" onClick={onClose}>
            Показать
          </button>
        </div>
      </div>
    </div>
  );
}
