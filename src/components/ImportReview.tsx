import { useMemo, useState } from 'react';
import type { Category, CategoryKind } from '../types';
import type { UnknownKey } from '../services/import';
import { bankLabel, formatDate, formatEur } from '../ui/format';

const KIND_LABELS: Record<CategoryKind, string> = {
  income: 'Доход',
  expense: 'Расход',
  transfer: 'Перевод',
  savings: 'Накопления',
};

const PALETTE = ['#1976d2', '#e53935', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#6d4c41', '#c2185b'];

export interface FxNeedRow {
  currency: string;
  date: string;
  rate: number | '';
}

/**
 * Пошаговый разбор импорта: по одной операции на экран крупно.
 * Сначала курсы валют, затем выбор категорий «таблетками».
 */
export function ImportReview({
  categories,
  unknownKeys,
  fxNeeds,
  choices,
  busy,
  onSetRate,
  onSetCategory,
  onCreateCategory,
  onCancel,
  onConfirm,
}: {
  categories: Category[];
  unknownKeys: UnknownKey[];
  fxNeeds: FxNeedRow[];
  /** key операции → id выбранной категории. */
  choices: Record<string, string>;
  busy: boolean;
  onSetRate: (index: number, rate: number | '') => void;
  onSetCategory: (key: string, categoryId: string) => void;
  /** Создаёт и сразу сохраняет категорию, возвращает её. */
  onCreateCategory: (data: { name: string; kind: CategoryKind; color: string }) => Promise<Category>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Шаги: сначала курсы, затем категории, последний шаг — подтверждение.
  const totalSteps = fxNeeds.length + unknownKeys.length;
  const [step, setStep] = useState(0);

  const resolvedCount =
    fxNeeds.filter((f) => f.rate !== '').length +
    unknownKeys.filter((u) => choices[u.key]).length;

  const next = () => setStep((s) => Math.min(s + 1, totalSteps));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const isFxStep = step < fxNeeds.length;
  const isConfirmStep = step >= totalSteps;

  return (
    <div className="review">
      <div className="review-top">
        <button type="button" className="review-close" onClick={onCancel} disabled={busy}>
          ✕
        </button>
        <div className="review-progress">
          <div className="review-progress-bar">
            <div
              className="review-progress-fill"
              style={{ width: `${totalSteps ? (resolvedCount / totalSteps) * 100 : 100}%` }}
            />
          </div>
          <span className="muted small">
            {isConfirmStep ? 'Готово' : `${step + 1} из ${totalSteps}`} · отмечено {resolvedCount}/
            {totalSteps}
          </span>
        </div>
      </div>

      <div className="review-body">
        {isConfirmStep ? (
          <ConfirmStep
            unknownKeys={unknownKeys}
            fxNeeds={fxNeeds}
            choices={choices}
            categories={categories}
            onJump={setStep}
          />
        ) : isFxStep ? (
          <FxStep
            need={fxNeeds[step]}
            onSetRate={(r) => onSetRate(step, r)}
          />
        ) : (
          <CategoryStep
            item={unknownKeys[step - fxNeeds.length]}
            categories={categories}
            selectedId={choices[unknownKeys[step - fxNeeds.length].key] ?? null}
            onPick={(id) => {
              onSetCategory(unknownKeys[step - fxNeeds.length].key, id);
              next();
            }}
            onCreateCategory={onCreateCategory}
          />
        )}
      </div>

      <div className="review-nav">
        <button type="button" onClick={prev} disabled={busy || step === 0}>
          ← Назад
        </button>
        {isConfirmStep ? (
          <button type="button" className="primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Импорт…' : 'Импортировать'}
          </button>
        ) : (
          <button type="button" className="primary" onClick={next} disabled={busy}>
            {isFxStep || !choices[unknownKeys[step - fxNeeds.length]?.key]
              ? 'Пропустить →'
              : 'Далее →'}
          </button>
        )}
      </div>
    </div>
  );
}

function FxStep({ need, onSetRate }: { need: FxNeedRow; onSetRate: (r: number | '') => void }) {
  return (
    <div className="review-card">
      <span className="review-kicker">Курс валюты</span>
      <div className="review-amount">1 {need.currency}</div>
      <div className="review-sub muted">на {formatDate(need.date)}</div>
      <p className="muted">
        Курс к EUR не нашёлся автоматически. Введите его вручную, чтобы пересчитать суммы.
      </p>
      <div className="fx-input-row">
        <input
          type="number"
          inputMode="decimal"
          step="0.0001"
          autoFocus
          placeholder="0.0000"
          value={need.rate}
          onChange={(e) => onSetRate(e.target.value === '' ? '' : Number(e.target.value))}
        />
        <span className="muted">EUR за 1 {need.currency}</span>
      </div>
    </div>
  );
}

function CategoryStep({
  item,
  categories,
  selectedId,
  onPick,
  onCreateCategory,
}: {
  item: UnknownKey;
  categories: Category[];
  selectedId: string | null;
  onPick: (id: string) => void;
  onCreateCategory: (data: { name: string; kind: CategoryKind; color: string }) => Promise<Category>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>(item.suggestedKind);
  const [saving, setSaving] = useState(false);

  // Категории-подсказки (совпадающие по виду) — вперёд.
  const sorted = useMemo(() => {
    return [...categories].sort((a, b) => {
      const am = a.kind === item.suggestedKind ? 0 : 1;
      const bm = b.kind === item.suggestedKind ? 0 : 1;
      if (am !== bm) return am - bm;
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [categories, item.suggestedKind]);

  const sign = item.sampleAmount < 0 ? 'neg' : 'pos';

  async function commitNew() {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      const created = await onCreateCategory({ name: trimmed, kind, color });
      setName('');
      setCreating(false);
      onPick(created.id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="review-card">
      <span className="review-kicker">{formatDate(item.sampleDate)}</span>
      <div className="review-merchant">{item.sampleDescription}</div>
      <div className={`review-amount ${sign}`}>
        {item.sampleCurrency === 'EUR'
          ? formatEur(item.sampleAmount)
          : `${item.sampleAmount.toFixed(2)} ${item.sampleCurrency}`}
      </div>
      <div className="review-meta">
        <span className="review-tag">{bankLabel(item.sampleBank)}</span>
        {item.count > 1 && <span className="review-tag">встречается {item.count}×</span>}
      </div>

      <div className="review-pick-label muted">Выберите категорию:</div>
      <div className="pill-grid">
        {sorted.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`pill ${selectedId === c.id ? 'selected' : ''}`}
            onClick={() => onPick(c.id)}
          >
            <span className="pill-dot" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
        {!creating && (
          <button type="button" className="pill pill-new" onClick={() => setCreating(true)}>
            ＋ Новая
          </button>
        )}
      </div>

      {creating && (
        <div className="cat-create-box">
          <input
            autoFocus
            placeholder="Название категории"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commitNew()}
          />
          <div className="kind-pills">
            {(Object.keys(KIND_LABELS) as CategoryKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`pill ${kind === k ? 'selected' : ''}`}
                onClick={() => setKind(k)}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <div className="cat-create-actions">
            <button type="button" onClick={() => setCreating(false)} disabled={saving}>
              Отмена
            </button>
            <button type="button" className="primary" onClick={commitNew} disabled={saving || !name.trim()}>
              {saving ? 'Сохранение…' : 'Создать и выбрать'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmStep({
  unknownKeys,
  fxNeeds,
  choices,
  categories,
  onJump,
}: {
  unknownKeys: UnknownKey[];
  fxNeeds: FxNeedRow[];
  choices: Record<string, string>;
  categories: Category[];
  onJump: (step: number) => void;
}) {
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const unresolved = unknownKeys.filter((u) => !choices[u.key]).length;

  return (
    <div className="review-card review-summary">
      <span className="review-kicker">Проверьте перед импортом</span>
      <div className="review-amount">Всё готово</div>
      {unresolved > 0 && (
        <p className="warn">
          {unresolved} операц. без категории — они импортируются «без категории», их можно
          разобрать позже на вкладке «Транзакции».
        </p>
      )}
      <ul className="summary-list">
        {fxNeeds.map((f, i) => (
          <li key={`fx-${i}`} onClick={() => onJump(i)}>
            <span>
              {f.currency} → EUR на {formatDate(f.date)}
            </span>
            <span className={f.rate === '' ? 'muted' : ''}>
              {f.rate === '' ? 'не задан' : f.rate}
            </span>
          </li>
        ))}
        {unknownKeys.map((u, i) => {
          const cat = choices[u.key] ? catById.get(choices[u.key]) : undefined;
          return (
            <li key={u.key} onClick={() => onJump(fxNeeds.length + i)}>
              <span className="summary-name">{u.sampleDescription}</span>
              <span className={cat ? '' : 'muted'}>
                {cat ? (
                  <>
                    <span className="pill-dot" style={{ background: cat.color }} /> {cat.name}
                  </>
                ) : (
                  'без категории'
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
