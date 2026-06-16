import type { ParseResult, ParsedTxn, TxnType } from './types';
import { normalizeIban, parseCsv } from './util';

// Парсер CSV-экспорта транзакций Trade Republic ("Transaction export").
// Колонки (с заголовком): datetime, date, account_type, category, type, asset_class,
// name, symbol, shares, price, amount, fee, tax, currency, original_amount,
// original_currency, fx_rate, description, transaction_id, counterparty_name,
// counterparty_iban, payment_reference, mcc_code.
//
// Особенности формата:
// - amount уже со знаком (+ поступление, − списание) и в валюте счёта (обычно EUR);
//   комиссия (fee) и налог (tax) идут отдельными колонками со своим знаком,
//   поэтому фактическое движение по счёту = amount + fee + tax.
// - У каждой операции есть уникальный transaction_id — используем его для дедупликации.
// - Баланс после операции в экспорте не печатается.

// Заголовок файла однозначно опознаёт формат.
const HEADER_COLS = ['datetime', 'date', 'account_type', 'category', 'type', 'amount'];

export function detect(text: string): boolean {
  const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
  const lower = firstLine.toLowerCase();
  return HEADER_COLS.every((c) => lower.includes(c)) && lower.includes('transaction_id');
}

function num(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : 0;
}

function classify(type: string): { type: TxnType; isTransfer: boolean } {
  switch (type) {
    case 'BUY':
    case 'SELL':
    case 'IPO_SUBSCRIPTION':
      return { type: 'trade', isTransfer: false };
    case 'DIVIDEND':
      return { type: 'dividend', isTransfer: false };
    case 'INTEREST_PAYMENT':
      return { type: 'interest', isTransfer: false };
    case 'CARD_TRANSACTION':
      return { type: 'card', isTransfer: false };
    case 'TRANSFER_INBOUND':
    case 'TRANSFER_OUTBOUND':
    case 'TRANSFER_INSTANT_INBOUND':
    case 'TRANSFER_INSTANT_OUTBOUND':
      return { type: 'transfer', isTransfer: true };
    default:
      // STOCKPERK, GIFT и прочее — отдельным типом не выделяем.
      return { type: 'other', isTransfer: false };
  }
}

export function parse(text: string): ParseResult {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim().length > 0));
  if (rows.length === 0) {
    return { account: { bank: 'trade_republic', ibans: [], holderName: null }, transactions: [] };
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const col = {
    date: idx('date'),
    type: idx('type'),
    name: idx('name'),
    amount: idx('amount'),
    fee: idx('fee'),
    tax: idx('tax'),
    currency: idx('currency'),
    description: idx('description'),
    transactionId: idx('transaction_id'),
    counterpartyName: idx('counterparty_name'),
    counterpartyIban: idx('counterparty_iban'),
  };

  const txns: ParsedTxn[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '');

    const date = get(col.date);
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue; // не строка операции
    const rawType = get(col.type);

    // Фактическое движение по счёту = сумма ± комиссия ± налог.
    const amount = num(get(col.amount)) + num(get(col.fee)) + num(get(col.tax));
    const currency = get(col.currency) || 'EUR';
    const { type, isTransfer } = classify(rawType);

    const cpName = get(col.counterpartyName) || null;
    const cpIban = get(col.counterpartyIban);
    const description = get(col.description) || get(col.name) || rawType;

    txns.push({
      bookingDate: date.slice(0, 10),
      valueDate: date.slice(0, 10),
      amount,
      currency,
      rawDescription: (get(col.name) ? `${get(col.name)} — ${description}` : description).slice(0, 200),
      counterpartyName: cpName,
      counterpartyIban: cpIban ? normalizeIban(cpIban) : null,
      type,
      isTransfer,
      balanceAfter: null,
      externalId: get(col.transactionId) || null,
    });
  }

  return {
    account: { bank: 'trade_republic', ibans: [], holderName: null },
    transactions: txns,
  };
}
