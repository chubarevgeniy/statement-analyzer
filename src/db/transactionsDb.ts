import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import type { StoredTxn, Account, StatementMeta, FxRate } from '../types';

// Первая БД: транзакции, счета, метаданные файлов, кэш курсов.
// Сбрасывается целиком отдельной кнопкой.

const DB_NAME = 'statement-analyzer-transactions';
const DB_VERSION = 1;

interface TxDBSchema {
  transactions: StoredTxn;
  accounts: Account;
  statements: StatementMeta;
  fxRates: FxRate;
}

let dbPromise: Promise<IDBPDatabase<unknown>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('transactions')) {
          const tx = db.createObjectStore('transactions', { keyPath: 'id' });
          tx.createIndex('bookingDate', 'bookingDate');
          tx.createIndex('accountOwner', 'accountOwner');
        }
        if (!db.objectStoreNames.contains('accounts')) {
          db.createObjectStore('accounts', { keyPath: 'iban' });
        }
        if (!db.objectStoreNames.contains('statements')) {
          db.createObjectStore('statements', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('fxRates')) {
          db.createObjectStore('fxRates', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllTxns(): Promise<StoredTxn[]> {
  return (await getDB()).getAll('transactions') as Promise<StoredTxn[]>;
}

export async function getTxn(id: string): Promise<StoredTxn | undefined> {
  return (await getDB()).get('transactions', id) as Promise<StoredTxn | undefined>;
}

export async function putTxns(txns: StoredTxn[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('transactions', 'readwrite');
  await Promise.all(txns.map((t) => tx.store.put(t)));
  await tx.done;
}

export async function updateTxnCategory(id: string, categoryId: string | null): Promise<void> {
  const db = await getDB();
  const t = (await db.get('transactions', id)) as StoredTxn | undefined;
  if (t) {
    t.categoryId = categoryId;
    await db.put('transactions', t);
  }
}

/**
 * Ручная привязка перевода к владельцу-контрагенту (или `null` — подтверждённо внешний).
 * `undefined` сбрасывает ручную привязку — определение вернётся к автоматическому.
 */
export async function updateTxnManualTransferOwner(
  id: string,
  owner: string | null | undefined,
): Promise<void> {
  const db = await getDB();
  const t = (await db.get('transactions', id)) as StoredTxn | undefined;
  if (t) {
    if (owner === undefined) delete t.manualTransferOwner;
    else t.manualTransferOwner = owner;
    await db.put('transactions', t);
  }
}

export async function getAllAccounts(): Promise<Account[]> {
  return (await getDB()).getAll('accounts') as Promise<Account[]>;
}

export async function putAccounts(accounts: Account[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('accounts', 'readwrite');
  await Promise.all(accounts.map((a) => tx.store.put(a)));
  await tx.done;
}

export async function getAllStatements(): Promise<StatementMeta[]> {
  return (await getDB()).getAll('statements') as Promise<StatementMeta[]>;
}

export async function getStatement(id: string): Promise<StatementMeta | undefined> {
  return (await getDB()).get('statements', id) as Promise<StatementMeta | undefined>;
}

export async function putStatement(meta: StatementMeta): Promise<void> {
  await (await getDB()).put('statements', meta);
}

export async function getFxRate(key: string): Promise<FxRate | undefined> {
  return (await getDB()).get('fxRates', key) as Promise<FxRate | undefined>;
}

export async function putFxRate(rate: FxRate): Promise<void> {
  await (await getDB()).put('fxRates', rate);
}

/** Полный сброс БД транзакций. */
export async function resetTransactionsDb(): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
  await deleteDB(DB_NAME);
}

export type { TxDBSchema };
