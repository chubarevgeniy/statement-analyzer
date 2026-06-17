import { useMemo, useState } from 'react';
import { parseFile } from '../parsers';
import { commitImport, prepareImport, type ImportPrep, type UnknownKey } from '../services/import';
import { lookupRate } from '../services/fx';
import { putCategory } from '../db/categoriesDb';
import { getAllTxns } from '../db/transactionsDb';
import { allOwners } from '../services/internalTransfers';
import type { ExampleTxn } from '../services/llm';
import type { Account, Category, CategoryKind, Settings } from '../types';
import { ownerLabel } from '../ui/format';
import { IconClose, IconImport } from '../ui/icons';
import { ImportReview, type FxNeedRow } from './ImportReview';

interface FileReport {
  fileName: string;
  status: 'ok' | 'duplicate' | 'error';
  added: number;
  duplicates: number;
  message?: string;
}

interface PendingResolution {
  preps: ImportPrep[];
  unknownKeys: UnknownKey[];
  fxNeeds: FxNeedRow[];
  examples: Record<string, ExampleTxn[]>;
}

const AUTO_OWNER = '__auto__';

export function ImportPanel({
  categories,
  accounts,
  settings,
  onImported,
}: {
  categories: Category[];
  accounts: Account[];
  settings: Settings;
  onImported: () => Promise<void>;
}) {
  const [staged, setStaged] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<FileReport[]>([]);
  const [pending, setPending] = useState<PendingResolution | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  // Принудительный владелец для загружаемых файлов ('__auto__' = из выписки).
  const [ownerChoice, setOwnerChoice] = useState<string>(AUTO_OWNER);
  // Категории, созданные прямо во время разбора — доступны сразу для следующих операций.
  const [extraCategories, setExtraCategories] = useState<Category[]>([]);

  const owners = useMemo(() => allOwners(accounts), [accounts]);
  const llmConfig = settings.llm?.enabled ? settings.llm : null;

  // Объединяем сохранённые и только что созданные, убирая дубли по id.
  const allCategories = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    for (const c of extraCategories) m.set(c.id, c);
    return Array.from(m.values());
  }, [categories, extraCategories]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const newFiles = Array.from(files);
    setStaged((prev) => {
      const byKey = new Map(prev.map((f) => [`${f.name}:${f.size}`, f]));
      for (const f of newFiles) byKey.set(`${f.name}:${f.size}`, f);
      return Array.from(byKey.values());
    });
  }

  function removeStaged(idx: number) {
    setStaged((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleProcess() {
    if (staged.length === 0) return;
    setBusy(true);
    setReports([]);
    const preps: ImportPrep[] = [];
    const doneReports: FileReport[] = [];

    for (const file of staged) {
      try {
        const res = await parseFile(file);
        const ownerOverride = ownerChoice === AUTO_OWNER ? undefined : ownerChoice;
        const prep = await prepareImport(res, file.name, ownerOverride);
        if (prep.alreadyImported && prep.newCount === 0) {
          doneReports.push({
            fileName: file.name,
            status: 'duplicate',
            added: 0,
            duplicates: prep.duplicateCount,
            message: 'Эти данные уже есть в базе',
          });
        } else {
          preps.push(prep);
        }
      } catch (e) {
        doneReports.push({
          fileName: file.name,
          status: 'error',
          added: 0,
          duplicates: 0,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    setStaged([]);

    // Агрегируем неизвестные ключи и потребности в курсах по всем файлам.
    const unknownMap = new Map<string, UnknownKey>();
    const fxMap = new Map<string, { currency: string; date: string }>();
    for (const p of preps) {
      for (const u of p.unknownKeys) {
        const ex = unknownMap.get(u.key);
        if (ex) ex.count += u.count;
        else unknownMap.set(u.key, { ...u });
      }
      for (const f of p.fxNeeds) fxMap.set(`${f.currency}:${f.date}`, f);
    }

    const unknownKeys = Array.from(unknownMap.values()).sort((a, b) => b.count - a.count);
    const fxNeedsRaw = Array.from(fxMap.values());

    if (unknownKeys.length === 0 && fxNeedsRaw.length === 0) {
      for (const p of preps) {
        const added = await commitImport(p);
        doneReports.push({ fileName: p.fileName, status: 'ok', added, duplicates: p.duplicateCount });
      }
      setReports(doneReports);
      await onImported();
      setBusy(false);
      return;
    }

    // Пытаемся заранее подтянуть курсы из API.
    const fxNeeds = await Promise.all(
      fxNeedsRaw.map(async (f) => {
        const fx = await lookupRate(f.currency, f.date);
        return { ...f, rate: (fx?.rate ?? '') as number | '' };
      }),
    );

    let examples: Record<string, ExampleTxn[]> = {};
    if (llmConfig && unknownKeys.length > 0) {
      const allTxns = await getAllTxns();
      for (const t of allTxns) {
        if (!t.categoryId) continue;
        if (!examples[t.categoryId]) examples[t.categoryId] = [];
        examples[t.categoryId].push({
          description: t.counterpartyName ?? t.rawDescription,
          amount: t.amount,
        });
      }
    }

    setReports(doneReports);
    setChoices({});
    setPending({ preps, unknownKeys, fxNeeds, examples });
    setBusy(false);
  }

  async function createCategory(data: { name: string; kind: CategoryKind; color: string }) {
    const cat: Category = {
      id: crypto.randomUUID(),
      name: data.name,
      kind: data.kind,
      excludedByDefault: false,
      color: data.color,
    };
    await putCategory(cat); // сохраняем сразу — доступна для следующих операций
    setExtraCategories((prev) => [...prev, cat]);
    return cat;
  }

  async function confirmResolution() {
    if (!pending) return;
    setBusy(true);

    const categoryByKey = new Map<string, string>();
    for (const u of pending.unknownKeys) {
      const id = choices[u.key];
      if (id && id !== '__none__') categoryByKey.set(u.key, id);
    }

    const fxRates = new Map<string, number>();
    for (const f of pending.fxNeeds) {
      if (f.rate !== '' && !Number.isNaN(Number(f.rate))) {
        fxRates.set(`${f.currency}:${f.date}`, Number(f.rate));
      }
    }

    const newReports: FileReport[] = [...reports];
    for (const p of pending.preps) {
      const added = await commitImport(p, { fxRates, categoryByKey });
      newReports.push({ fileName: p.fileName, status: 'ok', added, duplicates: p.duplicateCount });
    }

    setReports(newReports);
    setPending(null);
    setChoices({});
    setExtraCategories([]);
    await onImported();
    setBusy(false);
  }

  if (pending) {
    return (
      <ImportReview
        categories={allCategories}
        unknownKeys={pending.unknownKeys}
        fxNeeds={pending.fxNeeds}
        choices={choices}
        busy={busy}
        llmConfig={llmConfig}
        examples={pending.examples}
        onSetChoices={(next) => setChoices((prev) => ({ ...prev, ...next }))}
        onSetRate={(i, rate) =>
          setPending((prev) =>
            prev ? { ...prev, fxNeeds: prev.fxNeeds.map((x, j) => (j === i ? { ...x, rate } : x)) } : prev,
          )
        }
        onSetCategory={(key, categoryId) => setChoices((prev) => ({ ...prev, [key]: categoryId }))}
        onCreateCategory={createCategory}
        onCancel={() => {
          setPending(null);
          setChoices({});
          setExtraCategories([]);
        }}
        onConfirm={confirmResolution}
      />
    );
  }

  return (
    <div className="screen">
      <p className="muted small" style={{ margin: 0 }}>
        Поддерживаются PDF Deutsche Bank, Trade Republic и Revolut, а также CSV-экспорт Trade
        Republic и XLSX-выписка Revolut. Файлы обрабатываются только в браузере и никуда не
        отправляются.
      </p>

      {owners.length > 0 && (
        <div className="field">
          <span className="field-label">Владелец загружаемых счетов</span>
          <select value={ownerChoice} onChange={(e) => setOwnerChoice(e.target.value)} disabled={busy}>
            <option value={AUTO_OWNER}>Автоматически (из выписки)</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {ownerLabel(o)}
              </option>
            ))}
          </select>
          <span className="muted small">
            Полезно для CSV/XLSX без имени в шапке (напр. экспорт Trade Republic).
          </span>
        </div>
      )}

      <label className={`dropzone ${busy ? 'busy' : ''}`}>
        <input
          type="file"
          accept=".pdf,.csv,.xlsx,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          disabled={busy}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <span className="dropzone-badge">
          <IconImport />
        </span>
        <span className="dropzone-title">
          {staged.length > 0 ? 'Добавить ещё файлы' : 'Выберите выписки'}
        </span>
        <span className="muted small">
          PDF / CSV / XLSX. Загрузите все счета сразу — внутренние переводы определятся
          автоматически.
        </span>
      </label>

      {staged.length > 0 && (
        <>
          <ul className="staged-list">
            {staged.map((f, i) => (
              <li key={`${f.name}:${f.size}`} className="staged-item">
                <span className="staged-name">{f.name}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => removeStaged(i)}
                  disabled={busy}
                  aria-label="Убрать файл"
                >
                  <IconClose />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={handleProcess} disabled={busy}>
            {busy ? 'Обработка…' : `Разобрать ${staged.length} файл(ов)`}
          </button>
        </>
      )}

      {reports.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reports.map((r, i) => (
            <div key={i} className={`report ${r.status}`}>
              <strong>{r.fileName}</strong>:{' '}
              {r.status === 'ok' && `добавлено ${r.added}, пропущено дублей ${r.duplicates}`}
              {r.status === 'duplicate' && r.message}
              {r.status === 'error' && `ошибка — ${r.message}`}
            </div>
          ))}
        </div>
      )}

      {reports.some((r) => r.status === 'ok') && (
        <p className="muted small">Готово. Откройте «Дашборд» или «Операции», чтобы посмотреть результат.</p>
      )}
    </div>
  );
}
