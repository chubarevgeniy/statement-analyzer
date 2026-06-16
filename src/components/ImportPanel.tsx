import { useMemo, useState } from 'react';
import { extractText } from '../parsers';
import { commitImport, prepareImport, type ImportPrep, type UnknownKey } from '../services/import';
import { lookupRate } from '../services/fx';
import { putCategory } from '../db/categoriesDb';
import type { Category, CategoryKind } from '../types';
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
}

export function ImportPanel({
  categories,
  onImported,
}: {
  categories: Category[];
  onImported: () => Promise<void>;
}) {
  const [staged, setStaged] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<FileReport[]>([]);
  const [pending, setPending] = useState<PendingResolution | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  // Категории, созданные прямо во время разбора — доступны сразу для следующих операций.
  const [extraCategories, setExtraCategories] = useState<Category[]>([]);

  // Объединяем сохранённые и только что созданные, убирая дубли по id.
  const allCategories = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    for (const c of extraCategories) m.set(c.id, c);
    return Array.from(m.values());
  }, [categories, extraCategories]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    setStaged((prev) => {
      const byKey = new Map(prev.map((f) => [`${f.name}:${f.size}`, f]));
      for (const f of Array.from(files)) byKey.set(`${f.name}:${f.size}`, f);
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
        const buf = await file.arrayBuffer();
        const text = await extractText(buf);
        const prep = await prepareImport(text, file.name);
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

    setReports(doneReports);
    setChoices({});
    setPending({ preps, unknownKeys, fxNeeds });
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
      if (id) categoryByKey.set(u.key, id);
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
    <div className="panel">
      <h2>Импорт выписок</h2>
      <p className="muted">
        Поддерживаются PDF Deutsche Bank, Trade Republic и Revolut. Данные обрабатываются только в
        вашем браузере и никуда не отправляются.
      </p>

      <label className={`dropzone ${busy ? 'busy' : ''}`}>
        <input
          type="file"
          accept="application/pdf"
          multiple
          disabled={busy}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <span className="dropzone-icon">📄</span>
        <span className="dropzone-text">
          {staged.length > 0 ? 'Добавить ещё файлы' : 'Выберите PDF-выписки'}
        </span>
        <span className="muted small">
          Загрузите выписки всех счетов сразу — так внутренние переводы определятся автоматически.
        </span>
      </label>

      {staged.length > 0 && (
        <>
          <ul className="staged-list">
            {staged.map((f, i) => (
              <li key={`${f.name}:${f.size}`} className="staged-item">
                <span className="staged-name">📎 {f.name}</span>
                <button
                  type="button"
                  className="staged-remove"
                  onClick={() => removeStaged(i)}
                  disabled={busy}
                  aria-label="Убрать файл"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-primary block" onClick={handleProcess} disabled={busy}>
            {busy ? 'Обработка…' : `Разобрать ${staged.length} файл(ов)`}
          </button>
        </>
      )}

      {reports.length > 0 && (
        <ul className="reports">
          {reports.map((r, i) => (
            <li key={i} className={`report ${r.status}`}>
              <strong>{r.fileName}</strong>:{' '}
              {r.status === 'ok' && `добавлено ${r.added}, пропущено дублей ${r.duplicates}`}
              {r.status === 'duplicate' && r.message}
              {r.status === 'error' && `ошибка — ${r.message}`}
            </li>
          ))}
        </ul>
      )}

      {reports.some((r) => r.status === 'ok') && (
        <p className="muted small">
          Готово. Откройте «Дашборд» или «Транзакции», чтобы посмотреть результат.
        </p>
      )}
    </div>
  );
}
