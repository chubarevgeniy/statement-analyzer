// Типы, общие для всех парсеров выписок.
// ВАЖНО: здесь нет никаких личных данных — только структуры.

export type Bank = 'deutsche_bank' | 'trade_republic' | 'revolut';

/** Тип операции в нормализованном виде. */
export type TxnType =
  | 'transfer' // перевод (входящий/исходящий)
  | 'card' // покупка по карте / у мерчанта
  | 'salary' // зарплата
  | 'interest' // проценты
  | 'dividend' // дивиденды
  | 'trade' // биржевая операция (покупка/продажа ценных бумаг)
  | 'fee' // комиссия
  | 'cash' // наличные (внос/снятие)
  | 'other';

/** Одна распарсенная транзакция (ещё без id, eurAmount, категории). */
export interface ParsedTxn {
  /** Дата проводки в формате YYYY-MM-DD. */
  bookingDate: string;
  /** Дата валютирования YYYY-MM-DD (если есть, иначе = bookingDate). */
  valueDate: string;
  /** Знаковая сумма в исходной валюте: + поступление, − списание. */
  amount: number;
  /** Код валюты ISO, напр. EUR / USD / CHF. */
  currency: string;
  /** Исходное описание операции (как в выписке). */
  rawDescription: string;
  /** Имя контрагента, если удалось извлечь. */
  counterpartyName: string | null;
  /** IBAN контрагента, если удалось извлечь. */
  counterpartyIban: string | null;
  /** Нормализованный тип операции. */
  type: TxnType;
  /** Является ли операция переводом (для детекции внутренних). */
  isTransfer: boolean;
  /** Баланс счёта после операции (для дедупликации и проверки). */
  balanceAfter: number | null;
  /**
   * Готовый EUR-эквивалент суммы, если банк его сам печатает (Revolut).
   * Если задан — конвертация по курсу не требуется.
   */
  eurAmountHint?: number | null;
}

/** Информация о счёте-источнике выписки. */
export interface ParsedAccount {
  bank: Bank;
  /** Все IBAN этого счёта (Revolut может иметь DE+LT). */
  ibans: string[];
  /** Имя владельца счёта, как в выписке. */
  holderName: string | null;
}

/** Результат парсинга одного PDF. */
export interface ParseResult {
  account: ParsedAccount;
  transactions: ParsedTxn[];
  /** Период выписки, если определён (для информации). */
  periodStart?: string;
  periodEnd?: string;
  /** Начальный/конечный баланс по заголовку выписки (для самопроверки). */
  openingBalance?: number;
  closingBalance?: number;
}
