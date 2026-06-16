import { describe, it, expect } from 'vitest';
import { analyze, dateRange } from '../analytics';
import { resolveCounterpartyOwners } from '../internalTransfers';
import { BUILTIN_CATEGORIES } from '../../db/categoriesDb';
import type { Account, StoredTxn } from '../../types';

const IBAN_DB = 'DE00111122223333444455';
const IBAN_TR = 'DE11220033004400550066';

const accounts: Account[] = [
  { iban: IBAN_DB, holderName: 'Test Person', owner: 'test person', bank: 'deutsche_bank' },
  { iban: IBAN_TR, holderName: 'Test Person', owner: 'test person', bank: 'trade_republic' },
];

function txn(p: Partial<StoredTxn> & { id: string; amount: number }): StoredTxn {
  return {
    bank: 'deutsche_bank',
    accountIban: IBAN_DB,
    accountOwner: 'test person',
    currency: 'EUR',
    bookingDate: '2026-01-15',
    valueDate: '2026-01-15',
    eurAmount: p.amount,
    fxRate: 1,
    rawDescription: '',
    counterpartyName: null,
    counterpartyIban: null,
    type: 'other',
    isTransfer: false,
    balanceAfter: null,
    categoryId: null,
    statementId: 's',
    ...p,
  };
}

const txns: StoredTxn[] = [
  // Внутренний перевод DB -> TR (по IBAN контрагента).
  txn({ id: 'a', amount: -100, isTransfer: true, type: 'transfer', counterpartyIban: IBAN_TR }),
  // Встречный внутренний перевод на стороне TR.
  txn({ id: 'b', amount: 100, isTransfer: true, type: 'transfer', counterpartyIban: IBAN_DB, accountIban: IBAN_TR, bank: 'trade_republic' }),
  // Зарплата.
  txn({ id: 'c', amount: 1000, type: 'salary', categoryId: 'salary' }),
  // Расход по карте (пользовательская категория, не исключена).
  txn({ id: 'd', amount: -200, type: 'card', categoryId: 'food' }),
  // Внешний перевод (контрагент не наш профиль) — реальный расход.
  txn({ id: 'e', amount: -300, isTransfer: true, type: 'transfer', counterpartyName: 'Sofia External' }),
];

describe('resolveCounterpartyOwners', () => {
  it('распознаёт владельца контрагента по IBAN', () => {
    const m = resolveCounterpartyOwners(txns, accounts);
    expect(m.get('a')).toBe('test person');
    expect(m.get('b')).toBe('test person');
    expect(m.get('e')).toBeNull();
  });
});

describe('analyze', () => {
  it('исключает внутренние переводы, считает доход/расход', () => {
    const r = analyze(txns, accounts, BUILTIN_CATEGORIES, {
      period: { start: '2026-01-01', end: '2026-01-31' },
      selectedOwners: ['test person'],
      excludedCategoryIds: ['internal', 'savings'],
    });
    expect(r.income).toBeCloseTo(1000);
    expect(r.expense).toBeCloseTo(500); // 200 карта + 300 внешний перевод
    expect(r.net).toBeCloseTo(500);
    expect(r.internalVolume).toBeCloseTo(200);
  });

  it('учитывает вклад в накопления отдельно (trade -> savings)', () => {
    const withTrade = [...txns, txn({ id: 'f', amount: -400, type: 'trade', categoryId: 'savings' })];
    const r = analyze(withTrade, accounts, BUILTIN_CATEGORIES, {
      period: { start: '2026-01-01', end: '2026-01-31' },
      selectedOwners: ['test person'],
      excludedCategoryIds: ['internal', 'savings'],
    });
    expect(r.savingsContributions).toBeCloseTo(400);
    // savings исключена из расхода -> expense не меняется.
    expect(r.expense).toBeCloseTo(500);
  });

  it('dateRange возвращает границы', () => {
    expect(dateRange(txns)).toEqual({ start: '2026-01-15', end: '2026-01-15' });
  });
});
