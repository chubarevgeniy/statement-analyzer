import type { Account, StoredTxn } from '../types';
import { normalizeName } from '../parsers/util';

// Резолвинг владельца контрагента и определение внутренних переводов.
// Внутренность вычисляется ДИНАМИЧЕСКИ от выбранных профилей (см. analytics).

const DAY = 86_400_000;
const PAIR_WINDOW_DAYS = 5;

export function ownerByIban(accounts: Account[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of accounts) m.set(a.iban, a.owner);
  return m;
}

export function allOwners(accounts: Account[]): string[] {
  return Array.from(new Set(accounts.map((a) => a.owner)));
}

/**
 * Для каждой транзакции определяет владельца контрагента (профиль) или null.
 * Шаги: по IBAN → по имени == владельцу → по парному переводу в другом счёте.
 */
export function resolveCounterpartyOwners(
  txns: StoredTxn[],
  accounts: Account[],
): Map<string, string | null> {
  const ibanOwner = ownerByIban(accounts);
  const ownerNames = new Set(allOwners(accounts)); // owner уже нормализован
  const result = new Map<string, string | null>();

  // Индекс переводов по модулю суммы (в центах) для парного сопоставления.
  const byAmount = new Map<number, StoredTxn[]>();
  for (const t of txns) {
    if (!t.isTransfer) continue;
    const cents = Math.round(Math.abs(t.eurAmount) * 100);
    (byAmount.get(cents) ?? byAmount.set(cents, []).get(cents)!).push(t);
  }

  for (const t of txns) {
    let owner: string | null = null;

    if (t.counterpartyIban && ibanOwner.has(t.counterpartyIban)) {
      owner = ibanOwner.get(t.counterpartyIban)!;
    } else if (t.counterpartyName) {
      const norm = normalizeName(t.counterpartyName);
      if (ownerNames.has(norm)) owner = norm;
    }

    // Парное сопоставление: ищем встречный перевод в другом счёте.
    if (owner == null && t.isTransfer) {
      const cents = Math.round(Math.abs(t.eurAmount) * 100);
      const candidates = byAmount.get(cents) ?? [];
      const tTime = new Date(t.bookingDate).getTime();
      for (const c of candidates) {
        if (c.id === t.id) continue;
        if (c.accountIban === t.accountIban) continue;
        if (Math.sign(c.eurAmount) === Math.sign(t.eurAmount)) continue; // нужны противоположные
        const dt = Math.abs(new Date(c.bookingDate).getTime() - tTime);
        if (dt <= PAIR_WINDOW_DAYS * DAY) {
          owner = c.accountOwner;
          break;
        }
      }
    }

    result.set(t.id, owner);
  }

  return result;
}

/**
 * Внутренняя ли операция при выбранном множестве профилей.
 * Внутренняя = перевод, у которого владелец контрагента входит в выбранные профили
 * (деньги остались внутри выбранного набора людей).
 */
export function isInternal(
  txn: StoredTxn,
  counterpartyOwner: string | null,
  selectedOwners: Set<string>,
): boolean {
  if (!txn.isTransfer) return false;
  if (counterpartyOwner == null) return false;
  return selectedOwners.has(counterpartyOwner);
}
