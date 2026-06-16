import type { ParsedTxn, TxnType } from '../parsers/types';

// Ключ категоризации: по нему ищется маппинг «операция → категория».
// Используем имя контрагента/мерчанта, иначе начало описания.

export function categoryKey(t: { counterpartyName: string | null; rawDescription: string }): string {
  const base = t.counterpartyName ?? t.rawDescription;
  return base
    .replace(/\([^)]*\)/g, '') // убрать (IBAN) и пр.
    .replace(/\d{4,}/g, '') // убрать длинные номера/референсы
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Авто-категория по типу операции (встроенные id), либо null если требуется выбор. */
export function autoCategoryId(type: TxnType): string | null {
  switch (type) {
    case 'salary':
      return 'salary';
    case 'interest':
      return 'interest';
    case 'dividend':
      return 'dividend';
    case 'trade':
      return 'savings';
    case 'cash':
      return 'cash';
    case 'fee':
      return 'fee';
    default:
      return null;
  }
}

/** Предполагаемый вид новой категории по типу операции (для подсказки в UI). */
export function suggestedKind(t: ParsedTxn): 'income' | 'expense' {
  return t.amount >= 0 ? 'income' : 'expense';
}
