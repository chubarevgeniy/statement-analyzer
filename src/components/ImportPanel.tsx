import { useState } from 'react';
import { extractText } from '../parsers';
import { commitImport, prepareImport, type ImportPrep, type UnknownKey } from '../services/import';
import { lookupRate } from '../services/fx';
import { putCategory } from '../db/categoriesDb';
import type { Category } from '../types';
import { CategoryPicker, type CategoryChoice } from './CategoryPicker';
import { bankLabel } from '../ui/format';

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
  fxNeeds: { currency: string; date: string; rate: number | '' }[];
}

export function ImportPanel({
  categories,
  onImported,
}: {
  categories: Category[];
  onImported: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<FileReport[]>([]);
  const [pending, setPending] = useState<PendingResolution | null>(null);
  const [choices, setChoices] = useState<Record<string, CategoryChoice>>({});

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setReports([]);
    const preps: ImportPrep[] = [];
    const doneReports: FileReport[] = [];

    for (const file of Array.from(files)) {
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

    // Агрегируем неизвестные ключи и потребности в курсах.
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
      // Сразу коммитим.
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

  async function confirmResolution() {
    if (!pending) return;
    setBusy(true);

    // Создаём новые категории и строим map ключ→categoryId.
    const categoryByKey = new Map<string, string>();
    for (const u of pending.unknownKeys) {
      const choice = choices[u.key];
      if (!choice) continue;
      if (choice.newCategory) {
        await putCategory({
          id: choice.newCategory.id,
          name: choice.newCategory.name,
          kind: choice.newCategory.kind,
          excludedByDefault: false,
          color: choice.newCategory.color,
        });
        categoryByKey.set(u.key, choice.newCategory.id);
      } else if (choice.categoryId) {
        categoryByKey.set(u.key, choice.categoryId);
      }
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
    await onImported();
    setBusy(false);
  }

  const allResolved =
    pending != null &&
    pending.unknownKeys.every((u) => {
      const c = choices[u.key];
      return c && (c.categoryId || c.newCategory);
    });

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
          onChange={(e) => handleFiles(e.target.files)}
        />
        {busy ? 'Обработка…' : 'Выберите PDF-файлы выписок (можно несколько)'}
      </label>

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

      {pending && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Требуется уточнение</h3>

            {pending.fxNeeds.length > 0 && (
              <section>
                <h4>Курсы валют к EUR</h4>
                <p className="muted">Курс не найден автоматически — введите вручную.</p>
                {pending.fxNeeds.map((f, i) => (
                  <div key={i} className="resolve-row">
                    <span>
                      {f.currency} на {f.date}
                    </span>
                    <input
                      type="number"
                      step="0.0001"
                      value={f.rate}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPending((prev) =>
                          prev
                            ? {
                                ...prev,
                                fxNeeds: prev.fxNeeds.map((x, j) =>
                                  j === i ? { ...x, rate: v === '' ? '' : Number(v) } : x,
                                ),
                              }
                            : prev,
                        );
                      }}
                    />
                    <span className="muted">EUR за 1 {f.currency}</span>
                  </div>
                ))}
              </section>
            )}

            {pending.unknownKeys.length > 0 && (
              <section>
                <h4>Новые операции — выберите категории</h4>
                {pending.unknownKeys.map((u) => (
                  <div key={u.key} className="resolve-row">
                    <span className="resolve-desc" title={u.sampleDescription}>
                      {u.sampleDescription} <span className="muted">×{u.count}</span>
                    </span>
                    <CategoryPicker
                      categories={categories}
                      value={choices[u.key] ?? null}
                      suggestedKind={u.suggestedKind}
                      onChange={(choice) => setChoices((prev) => ({ ...prev, [u.key]: choice }))}
                    />
                  </div>
                ))}
              </section>
            )}

            <div className="modal-actions">
              <button type="button" onClick={() => setPending(null)} disabled={busy}>
                Отмена
              </button>
              <button type="button" onClick={confirmResolution} disabled={busy || !allResolved}>
                Импортировать ({pending.preps.reduce((s, p) => s + p.newCount, 0)} операций из{' '}
                {pending.preps.map((p) => bankLabel(p.bank)).join(', ')})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
