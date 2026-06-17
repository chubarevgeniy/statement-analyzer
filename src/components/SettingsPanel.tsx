import { useState } from 'react';
import type { Account, Category, LlmConfig, Mapping, Settings, StatementMeta } from '../types';
import {
  deleteCategory,
  deleteMapping,
  putCategory,
  putSettings,
  resetCategoriesDb,
} from '../db/categoriesDb';
import { resetTransactionsDb } from '../db/transactionsDb';
import { pingLlm } from '../services/llm';
import { bankLabel, ownerLabel } from '../ui/format';
import type { ThemeMode } from '../ui/theme';
import { IconAuto, IconDownload, IconMoon, IconPlus, IconSun, IconTrash, IconUpload } from '../ui/icons';
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
  settings,
  onChange,
  themeMode,
  onThemeModeChange,
}: {
  categories: Category[];
  mappings: Mapping[];
  accounts: Account[];
  statements: StatementMeta[];
  settings: Settings;
  onChange: () => Promise<void>;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
}) {
  const [newName, setNewName] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);

  const [llm, setLlm] = useState<LlmConfig>(
    settings.llm ?? { baseUrl: 'http://localhost:11434/v1', model: '', enabled: false },
  );
  const [llmMsg, setLlmMsg] = useState<string | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);

  async function saveLlm(next: LlmConfig) {
    setLlm(next);
    await putSettings({ ...settings, llm: next });
    await onChange();
  }

  async function testLlm() {
    setLlmBusy(true);
    setLlmMsg(null);
    const res = await pingLlm(llm);
    setLlmMsg((res.ok ? '✓ ' : '✗ ') + res.message);
    setLlmBusy(false);
  }

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
    <div className="screen">
      <h2 className="section-title">Оформление</h2>
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
              <Icon /> {o.label}
            </button>
          );
        })}
      </div>

      <h2 className="section-title">Локальный ИИ</h2>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>
          Адрес OpenAI-совместимой модели (напр. через Ollama). ИИ сопоставляет операции с
          категориями при импорте и в групповых действиях. Запросы идут только на указанный адрес.
        </p>
        <div className="field">
          <span className="field-label">Адрес API (base URL)</span>
          <input
            placeholder="http://localhost:11434/v1"
            value={llm.baseUrl}
            onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })}
            onBlur={() => void saveLlm(llm)}
          />
        </div>
        <div className="field">
          <span className="field-label">Модель</span>
          <input
            placeholder="llama3.1"
            value={llm.model}
            onChange={(e) => setLlm({ ...llm, model: e.target.value })}
            onBlur={() => void saveLlm(llm)}
          />
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={llm.enabled}
            onChange={(e) => void saveLlm({ ...llm, enabled: e.target.checked })}
          />
          Включить ИИ-категоризацию
        </label>
        <button type="button" className="btn" onClick={testLlm} disabled={llmBusy}>
          {llmBusy ? 'Проверка…' : 'Проверить соединение'}
        </button>
        {llmMsg && <p className="muted small" style={{ margin: 0 }}>{llmMsg}</p>}
      </div>

      <h2 className="section-title">Категории</h2>
      <div className="settings-group">
        {categories.map((c) => (
          <div key={c.id} className="settings-row">
            <span className="dot" style={{ background: c.color }} />
            <span className="grow">
              {c.name} <span className="muted small">· {c.kind}</span>
            </span>
            {c.builtin ? (
              <span className="muted small">встроенная</span>
            ) : (
              <button
                className="icon-btn"
                aria-label="Удалить категорию"
                onClick={async () => {
                  await deleteCategory(c.id);
                  await onChange();
                }}
              >
                <IconTrash />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="inline-add">
        <input
          placeholder="Новая категория"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCategory()}
        />
        <button className="btn btn-primary" onClick={addCategory}>
          <IconPlus /> Добавить
        </button>
      </div>

      <h2 className="section-title">Маппинги операций → категории ({mappings.length})</h2>
      <div className="settings-group">
        {mappings.map((m) => (
          <div key={m.key} className="settings-row">
            <span className="mapping-key grow">{m.key}</span>
            <span className="muted small">{catName(m.categoryId)}</span>
            <button
              className="icon-btn"
              aria-label="Удалить маппинг"
              onClick={async () => {
                await deleteMapping(m.key);
                await onChange();
              }}
            >
              <IconTrash />
            </button>
          </div>
        ))}
        {mappings.length === 0 && <div className="settings-row muted">Пока нет сохранённых маппингов.</div>}
      </div>

      <h2 className="section-title">Распознанные счета</h2>
      <div className="settings-group">
        {accounts.map((a) => (
          <div key={a.iban} className="settings-row column">
            <span className="grow">
              {bankLabel(a.bank)} · {ownerLabel(a.owner)}
            </span>
            <code>{a.iban}</code>
          </div>
        ))}
        {accounts.length === 0 && <div className="settings-row muted">Нет счетов.</div>}
      </div>

      <h2 className="section-title">Импортированные выписки</h2>
      <div className="settings-group">
        {statements.map((s) => (
          <div key={s.id} className="settings-row">
            <span className="grow">
              {bankLabel(s.bank)} · {s.fileName}
            </span>
            <span className="muted small">{s.txnCount} оп.</span>
          </div>
        ))}
        {statements.length === 0 && <div className="settings-row muted">Нет импортов.</div>}
      </div>

      <h2 className="section-title">Резервная копия данных</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Полная копия (JSON) сохраняет все данные и может быть импортирована обратно — импорт
        полностью заменит текущие данные. CSV удобен для Excel, но не для обратного импорта.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" className="btn btn-block" onClick={handleExport} disabled={backupBusy}>
          <IconDownload /> Экспорт (JSON)
        </button>
        <label className="btn btn-block">
          <IconUpload /> Импорт (JSON)
          <input
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            disabled={backupBusy}
            style={{ display: 'none' }}
          />
        </label>
        <button type="button" className="btn btn-block" onClick={handleExportCsv} disabled={backupBusy}>
          <IconDownload /> Транзакции в CSV
        </button>
      </div>

      <h2 className="section-title">Сброс баз данных</h2>
      <p className="muted small" style={{ margin: 0 }}>Каждая база сбрасывается отдельно.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn btn-danger btn-block" onClick={() => confirmReset('tx')}>
          Сбросить БД транзакций
        </button>
        <button className="btn btn-danger btn-block" onClick={() => confirmReset('cat')}>
          Сбросить БД категорий
        </button>
      </div>

      <p className="muted small" style={{ textAlign: 'center', marginTop: 8 }}>
        Все данные хранятся локально в браузере (IndexedDB). Ничего не отправляется на сервер.
      </p>
    </div>
  );
}
