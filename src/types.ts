import type { Bank, TxnType } from './parsers/types';

export type { Bank, TxnType } from './parsers/types';

/** Транзакция в хранилище. Все денежные значения — числа в EUR/исходной валюте. */
export interface StoredTxn {
  /** Детерминированный id для дедупликации. */
  id: string;
  bank: Bank;
  accountIban: string;
  /** Владелец счёта (нормализованное имя) — основа «профилей». */
  accountOwner: string;
  currency: string;
  bookingDate: string; // YYYY-MM-DD
  valueDate: string;
  /** Знаковая сумма в исходной валюте. */
  amount: number;
  /** Сумма в EUR (для не-EUR — через курс/эквивалент из выписки). */
  eurAmount: number;
  /** Применённый курс к EUR (для не-EUR), иначе 1. */
  fxRate: number;
  rawDescription: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  type: TxnType;
  isTransfer: boolean;
  balanceAfter: number | null;
  /** Назначенная пользователем/авто категория (id) или null. */
  categoryId: string | null;
  /** Файл-источник. */
  statementId: string;
  /**
   * Ручная привязка перевода к владельцу-контрагенту: переопределяет автоопределение
   * (по IBAN/имени/парному переводу). `null` — подтверждено, что перевод внешний.
   * `undefined`/отсутствует — определять автоматически.
   */
  manualTransferOwner?: string | null;
}

/** Известный (выученный из выписок) счёт. */
export interface Account {
  iban: string;
  holderName: string | null;
  owner: string; // нормализованное имя владельца = профиль
  bank: Bank;
}

/** Метаданные импортированного файла (для дедупликации файлов). */
export interface StatementMeta {
  id: string; // отпечаток содержимого
  bank: Bank;
  fileName: string;
  importedAt: number;
  txnCount: number;
  periodStart?: string;
  periodEnd?: string;
}

/** Кэш курса валюты к EUR на дату. */
export interface FxRate {
  key: string; // `${currency}:${date}`
  currency: string;
  date: string;
  rate: number; // 1 единица валюты = rate EUR
  source: 'api' | 'manual';
}

export type CategoryKind = 'income' | 'expense' | 'transfer' | 'savings';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  /** Исключать ли из подсчётов дохода/расхода по умолчанию. */
  excludedByDefault: boolean;
  color: string;
  /** Встроенная категория (нельзя удалить). */
  builtin?: boolean;
}

/** Маппинг ключа операции (контрагент/мерчант) в категорию. */
export interface Mapping {
  key: string;
  categoryId: string;
}

/** Настройки приложения (вторая БД). */
export interface Settings {
  key: 'app';
  /** id категорий, исключённых из подсчётов (переопределяет excludedByDefault). */
  excludedCategoryIds: string[];
  /** Список профилей (владельцев), выбранных в дашборде. Пусто = все. */
  selectedOwners: string[];
}
