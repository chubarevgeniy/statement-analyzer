// Резервное копирование и восстановление базы данных.
//
// Полная копия (JSON) надёжно сохраняет все хранилища обеих БД (транзакции,
// счета, выписки, курсы, категории, маппинги, настройки) и без потерь
// импортируется обратно — на этом же или другом устройстве.
//
// Дополнительно есть экспорт транзакций в CSV — для просмотра в Excel/таблицах
// (CSV не предназначен для обратного импорта: он не хранит категории/настройки).

import {
  dumpTransactionsDb,
  restoreTransactionsDb,
  type TransactionsDump,
} from '../db/transactionsDb';
import {
  dumpCategoriesDb,
  restoreCategoriesDb,
  type CategoriesDump,
} from '../db/categoriesDb';

const BACKUP_MAGIC = 'statement-analyzer-backup';
const BACKUP_VERSION = 1;

export interface Backup {
  magic: string;
  version: number;
  exportedAt: string;
  transactions: TransactionsDump;
  categories: CategoriesDump;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Освобождаем URL чуть позже, чтобы клик гарантированно обработался.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Полная резервная копия обеих БД в один JSON-файл. */
export async function exportBackup(): Promise<void> {
  const [transactions, categories] = await Promise.all([
    dumpTransactionsDb(),
    dumpCategoriesDb(),
  ]);
  const backup: Backup = {
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    transactions,
    categories,
  };
  downloadFile(
    `statement-analyzer-backup-${today()}.json`,
    JSON.stringify(backup, null, 2),
    'application/json;charset=utf-8',
  );
}

export interface ImportResult {
  txns: number;
  categories: number;
}

/** Восстанавливает обе БД из файла резервной копии (полностью заменяет данные). */
export async function importBackup(file: File): Promise<ImportResult> {
  const text = await file.text();
  let data: Backup;
  try {
    data = JSON.parse(text) as Backup;
  } catch {
    throw new Error('Файл не является корректным JSON.');
  }
  if (!data || data.magic !== BACKUP_MAGIC || !data.transactions || !data.categories) {
    throw new Error('Файл не похож на резервную копию анализатора выписок.');
  }
  // Сначала транзакции, затем категории (восстановление категорий пересевает встроенные).
  await restoreTransactionsDb(data.transactions);
  await restoreCategoriesDb(data.categories);
  return {
    txns: data.transactions.transactions?.length ?? 0,
    categories: data.categories.categories?.length ?? 0,
  };
}

// ── CSV транзакций (только экспорт) ──

const CSV_COLUMNS: { header: string; pick: (t: TransactionsDump['transactions'][number]) => unknown }[] = [
  { header: 'id', pick: (t) => t.id },
  { header: 'bank', pick: (t) => t.bank },
  { header: 'accountOwner', pick: (t) => t.accountOwner },
  { header: 'accountIban', pick: (t) => t.accountIban },
  { header: 'currency', pick: (t) => t.currency },
  { header: 'bookingDate', pick: (t) => t.bookingDate },
  { header: 'valueDate', pick: (t) => t.valueDate },
  { header: 'amount', pick: (t) => t.amount },
  { header: 'eurAmount', pick: (t) => t.eurAmount },
  { header: 'fxRate', pick: (t) => t.fxRate },
  { header: 'type', pick: (t) => t.type },
  { header: 'isTransfer', pick: (t) => t.isTransfer },
  { header: 'counterpartyName', pick: (t) => t.counterpartyName ?? '' },
  { header: 'counterpartyIban', pick: (t) => t.counterpartyIban ?? '' },
  { header: 'rawDescription', pick: (t) => t.rawDescription },
  { header: 'categoryId', pick: (t) => t.categoryId ?? '' },
  { header: 'statementId', pick: (t) => t.statementId },
];

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  // Экранируем по RFC 4180, если есть запятая, кавычка или перевод строки.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Экспорт всех транзакций в CSV (для просмотра, без обратного импорта). */
export async function exportTransactionsCsv(): Promise<void> {
  const { transactions } = await dumpTransactionsDb();
  const sorted = [...transactions].sort((a, b) =>
    a.bookingDate < b.bookingDate ? 1 : a.bookingDate > b.bookingDate ? -1 : 0,
  );
  const rows = [CSV_COLUMNS.map((c) => c.header).join(',')];
  for (const t of sorted) {
    rows.push(CSV_COLUMNS.map((c) => csvCell(c.pick(t))).join(','));
  }
  // BOM (﻿), чтобы Excel корректно распознал UTF-8 (кириллицу).
  downloadFile(
    `statement-analyzer-transactions-${today()}.csv`,
    '﻿' + rows.join('\r\n'),
    'text/csv;charset=utf-8',
  );
}
