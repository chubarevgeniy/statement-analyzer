import { useState } from 'react';
import type { Category, CategoryKind } from '../types';

const KIND_LABELS: Record<CategoryKind, string> = {
  income: 'Доход',
  expense: 'Расход',
  transfer: 'Перевод',
  savings: 'Накопления',
};

const PALETTE = ['#1976d2', '#e53935', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#6d4c41', '#c2185b'];

export interface CategoryChoice {
  /** id существующей категории, либо null если создаётся новая. */
  categoryId: string | null;
  /** Данные новой категории, если создаётся. */
  newCategory?: { id: string; name: string; kind: CategoryKind; color: string };
}

/** Выбор существующей категории или создание новой. */
export function CategoryPicker({
  categories,
  value,
  suggestedKind,
  onChange,
}: {
  categories: Category[];
  value: CategoryChoice | null;
  suggestedKind: 'income' | 'expense';
  onChange: (choice: CategoryChoice) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>(suggestedKind);

  if (creating) {
    const commit = () => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      onChange({
        categoryId: null,
        newCategory: { id: crypto.randomUUID(), name: trimmed, kind, color },
      });
    };
    return (
      <div className="cat-create">
        <input
          autoFocus
          placeholder="Название категории"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
          {(Object.keys(KIND_LABELS) as CategoryKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setCreating(false)}>
          ✕
        </button>
      </div>
    );
  }

  const selected = value?.newCategory
    ? `новая: ${value.newCategory.name}`
    : value?.categoryId ?? '';

  return (
    <select
      value={value?.newCategory ? '__new_selected__' : selected}
      onChange={(e) => {
        if (e.target.value === '__new__') setCreating(true);
        else onChange({ categoryId: e.target.value });
      }}
    >
      <option value="" disabled>
        — выберите категорию —
      </option>
      {value?.newCategory && (
        <option value="__new_selected__">➕ {value.newCategory.name} (новая)</option>
      )}
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value="__new__">➕ Создать новую…</option>
    </select>
  );
}
