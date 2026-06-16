import type { ParsedTxn } from '../parsers/types';
import type { Bank } from '../types';
import { toCents } from '../parsers/util';

/** Нормализует строку описания для ключа дедупликации. */
function normDesc(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
}

/**
 * Детерминированный id транзакции. Включает баланс после операции, что делает
 * уникальными даже одинаковые повторяющиеся платежи в один день.
 */
export function computeTxnId(bank: Bank, accountIban: string, t: ParsedTxn): string {
  // Если у выписки есть собственный стабильный id операции (CSV Trade Republic) —
  // используем его: это надёжнее, чем эвристика по сумме/балансу/описанию.
  if (t.externalId) return [bank, accountIban, 'id', t.externalId].join('|');
  const bal = t.balanceAfter != null ? toCents(t.balanceAfter) : 'NA';
  return [
    bank,
    accountIban,
    t.currency,
    t.bookingDate,
    toCents(t.amount),
    bal,
    normDesc(t.rawDescription),
  ].join('|');
}

/** Простой стабильный строковый хеш (FNV-1a, hex). */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Отпечаток файла-выписки: хеш отсортированных id транзакций. */
export function computeStatementId(bank: Bank, txnIds: string[]): string {
  return bank + '-' + hashString([...txnIds].sort().join('\n'));
}
