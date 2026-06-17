import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import type { Category, Mapping, Settings } from '../types';

// Вторая БД: категории, маппинги ключей в категории, настройки.
// Сбрасывается отдельной кнопкой, независимо от БД транзакций.

const DB_NAME = 'statement-analyzer-categories';
const DB_VERSION = 1;

// Встроенные категории. Имена — не личные данные.
export const BUILTIN_CATEGORIES: Category[] = [
  { id: 'internal', name: 'Внутренний перевод', kind: 'transfer', excludedByDefault: true, color: '#888888', builtin: true },
  { id: 'savings', name: 'Накопления / Инвестиции', kind: 'savings', excludedByDefault: true, color: '#4caf50', builtin: true },
  { id: 'salary', name: 'Зарплата', kind: 'income', excludedByDefault: false, color: '#2e7d32', builtin: true },
  { id: 'dividend', name: 'Дивиденды', kind: 'income', excludedByDefault: false, color: '#66bb6a', builtin: true },
  { id: 'interest', name: 'Проценты', kind: 'income', excludedByDefault: false, color: '#81c784', builtin: true },
  { id: 'cash', name: 'Наличные', kind: 'expense', excludedByDefault: false, color: '#ef6c00', builtin: true },
  { id: 'fee', name: 'Комиссии', kind: 'expense', excludedByDefault: false, color: '#c62828', builtin: true },
];

export const DEFAULT_CHART_SETTINGS = {
  showIncome: true,
  showExpense: true,
  showNet: false,
  showCumulative: true,
} as const;

const DEFAULT_SETTINGS: Settings = {
  key: 'app',
  excludedCategoryIds: ['internal', 'savings'],
  selectedOwners: [],
  chart: { ...DEFAULT_CHART_SETTINGS },
};

let dbPromise: Promise<IDBPDatabase<unknown>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('mappings')) {
          db.createObjectStore('mappings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

/** Гарантирует наличие встроенных категорий и настроек. */
export async function ensureSeeded(): Promise<void> {
  const db = await getDB();
  const existing = (await db.getAll('categories')) as Category[];
  const existingIds = new Set(existing.map((c) => c.id));
  const tx = db.transaction('categories', 'readwrite');
  for (const c of BUILTIN_CATEGORIES) {
    if (!existingIds.has(c.id)) await tx.store.put(c);
  }
  await tx.done;
  const settings = await db.get('settings', 'app');
  if (!settings) await db.put('settings', DEFAULT_SETTINGS);
}

export async function getCategories(): Promise<Category[]> {
  return (await getDB()).getAll('categories') as Promise<Category[]>;
}

export async function putCategory(cat: Category): Promise<void> {
  await (await getDB()).put('categories', cat);
}

export async function deleteCategory(id: string): Promise<void> {
  await (await getDB()).delete('categories', id);
}

export async function getMappings(): Promise<Mapping[]> {
  return (await getDB()).getAll('mappings') as Promise<Mapping[]>;
}

export async function getMapping(key: string): Promise<Mapping | undefined> {
  return (await getDB()).get('mappings', key) as Promise<Mapping | undefined>;
}

export async function putMapping(mapping: Mapping): Promise<void> {
  await (await getDB()).put('mappings', mapping);
}

export async function deleteMapping(key: string): Promise<void> {
  await (await getDB()).delete('mappings', key);
}

export async function getSettings(): Promise<Settings> {
  const s = (await (await getDB()).get('settings', 'app')) as Settings | undefined;
  return s ?? DEFAULT_SETTINGS;
}

export async function putSettings(settings: Settings): Promise<void> {
  await (await getDB()).put('settings', { ...settings, key: 'app' });
}

/** Полный сброс БД категорий/маппингов (затем пересев встроенных). */
export async function resetCategoriesDb(): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
  await deleteDB(DB_NAME);
  await ensureSeeded();
}

/** Снимок всех данных БД категорий — для резервной копии. */
export interface CategoriesDump {
  categories: Category[];
  mappings: Mapping[];
  settings: Settings;
}

export async function dumpCategoriesDb(): Promise<CategoriesDump> {
  const [categories, mappings, settings] = await Promise.all([
    getCategories(),
    getMappings(),
    getSettings(),
  ]);
  return { categories, mappings, settings };
}

/**
 * Полностью заменяет содержимое БД категорий данными из резервной копии,
 * после чего гарантирует наличие встроенных категорий/настроек.
 */
export async function restoreCategoriesDb(dump: CategoriesDump): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['categories', 'mappings', 'settings'], 'readwrite');
  await Promise.all([
    tx.objectStore('categories').clear(),
    tx.objectStore('mappings').clear(),
    tx.objectStore('settings').clear(),
  ]);
  for (const c of dump.categories ?? []) void tx.objectStore('categories').put(c);
  for (const m of dump.mappings ?? []) void tx.objectStore('mappings').put(m);
  if (dump.settings) void tx.objectStore('settings').put({ ...dump.settings, key: 'app' });
  await tx.done;
  await ensureSeeded();
}
