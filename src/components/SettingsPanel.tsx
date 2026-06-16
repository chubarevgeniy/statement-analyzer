import { useState } from 'react';
import type { Account, Category, Mapping, StatementMeta } from '../types';
import { deleteCategory, deleteMapping, putCategory, resetCategoriesDb } from '../db/categoriesDb';
import { resetTransactionsDb } from '../db/transactionsDb';
import { bankLabel, ownerLabel } from '../ui/format';
import type { ThemeMode } from '../ui/theme';
import { IconAuto, IconDownload, IconMoon, IconSun, IconUpload } from '../ui/icons';
import { exportBackup, exportTransactionsCsv, importBackup } from '../services/backup';

const THEME_OPTIONS: { id: ThemeMode; label: string; icon: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'light', label: 'Светлая', icon: IconSun },
  { id: 'dark', label: 'Тёмная', icon: IconMoon },
  { id: 'system', label: 'Системная', icon: IconAuto },
];

export function SettingsPanel({
  categories,
  mappings,
  accounts,
  statements,
  onChange,
  themeMode,
  onThemeModeChange,
}: {
  categories: Category[];
  mappings: Mapping[];
  accounts: Account[];
  statements: StatementMeta[];
  onChange: () => Promise<void>;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
}) {
  const [newName, setNewName] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);

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

  async function handleExport() {
    setBackupBusy(true);
    try {
      await exportBackup();
    } catch (e) {
      window.alert('Не удалось создать резервную копию: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleExportCsv() {
    setBackupBusy(true);
    try {
      await exportTransactionsCsv();
    } catch (e) {
      window.alert('Не удалось экспортировать CSV: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволяет выбрать тот же файл повторно
    if (!file) return;
    if (
      !window.confirm(
        'Импорт заменит ВСЕ текущие данные (транзакции, категории, настройки) данными из файла. Продолжить?',
      )
    )
      return;
    setBackupBusy(true);
    try {
      const res = await importBackup(file);
      await onChange();
      window.alert(`Восстановлено: ${res.txns} транзакций, ${res.categories} категорий.`);
    } catch (err) {
      window.alert('Не удалось импортировать: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Настройки</h2>

      <section>
        <h3>Оформление</h3>
        <p className="muted small">Тема</p>
        <div className="segmented">
          {THEME_OPTIONS.map((o) => {
            const Icon = o.icon;
            return (
              <button
                key={o.id}
                type="button"
                className={themeMode === o.id ? 'active' : ''}
                onClick={() => onThemeModeChange(o.id)}
              >
                <Icon className="nav-icon" /> {o.label}
              </button>
            );
          })}
        </div>
      </section>

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
        <ul className="settings-list mapping-list">
          {mappings.map((m) => (
            <li key={m.key} className="mapping-item">
              <span className="mapping-key">{m.key}</span>
              <span className="mapping-arrow">→</span>
              <span className="mapping-cat">{catName(m.categoryId)}</span>
              <button
                className="link mapping-delete"
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

      <section>
        <h3>Резервная копия данных</h3>
        <p className="muted small">
          Полная копия (JSON) сохраняет все транзакции, счета, выписки, категории, маппинги и
          настройки. Её можно импортировать обратно позже или перенести на другое устройство —
          импорт полностью заменит текущие данные.
        </p>
        <div className="backup-actions">
          <button type="button" onClick={handleExport} disabled={backupBusy}>
            <IconDownload className="nav-icon" /> Экспорт (JSON)
          </button>
          <label className="btn-file">
            <IconUpload className="nav-icon" /> Импорт (JSON)
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleImport}
              disabled={backupBusy}
            />
          </label>
          <button type="button" onClick={handleExportCsv} disabled={backupBusy}>
            <IconDownload className="nav-icon" /> Транзакции в CSV
          </button>
        </div>
        <p className="muted small" style={{ marginTop: '10px' }}>
          CSV удобен для просмотра в Excel или Google Таблицах, но не предназначен для обратного
          импорта — для переноса данных используйте JSON.
        </p>
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
