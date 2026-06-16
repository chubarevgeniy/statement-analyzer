import type { ParseResult, ParsedTxn, TxnType } from './types';
import { excelSerialToIso, normalizeIban, parseUsAmount } from './util';

// Парсер XLSX-выписки Revolut ("consolidated statement"). Это табличный аналог
// PDF "Custom Statement": секции по счетам/валютам ("Personal Account (EUR/USD/...)")
// с колонками Date | Description | Category | Money in/out | Balance | Tax withheld |
// Other taxes | Fees.
//
// Особенности:
// - Даты хранятся серийными числами Excel.
// - В не-EUR секциях суммы печатаются в двух валютах: "$10.00 (€9.33)" — исходная и
//   уже посчитанный EUR-эквивалент (берём его как eurAmountHint, конвертация не нужна).
// - Money in/out уже учитывает комиссии (равен изменению баланса), поэтому колонку Fees
//   отдельно не прибавляем.
// - Обмен валют между своими счетами (категория Exchange) помечаем переводом на
//   собственный IBAN — так он распознаётся как внутренний и не искажает доход/расход.

const SECTION_START = 'Current Accounts Transaction Statements';
const SECTION_END = 'Savings Accounts Transaction Statements';

export function detect(rows: string[][]): boolean {
  let hasRevolut = false;
  let hasStatements = false;
  for (const r of rows) {
    for (const c of r) {
      if (c.includes('Revolut')) hasRevolut = true;
      if (/Transaction [Ss]tatement/.test(c)) hasStatements = true;
      if (hasRevolut && hasStatements) return true;
    }
  }
  return false;
}

/** Разбирает денежную ячейку: исходная сумма и EUR-эквивалент из скобок (если есть). */
function parseMoney(cell: string): { amount: number; eur: number } {
  const trimmed = (cell ?? '').trim();
  const par = trimmed.match(/\(([^)]*)\)/);
  if (par) {
    const orig = trimmed.slice(0, par.index).trim();
    return { amount: parseUsAmount(orig), eur: parseUsAmount(par[1]) };
  }
  const amount = parseUsAmount(trimmed);
  return { amount, eur: amount };
}

function classify(
  category: string,
  desc: string,
): { type: TxnType; isTransfer: boolean; selfMove: boolean } {
  const c = category.trim().toLowerCase();
  const d = desc.trim().toLowerCase();
  if (c === 'exchange' || /^exchanged to/.test(d))
    return { type: 'transfer', isTransfer: true, selfMove: true };
  if (c === 'atm' || /cash withdrawal/.test(d))
    return { type: 'cash', isTransfer: false, selfMove: false };
  if (c === 'merchant' || c === 'refund')
    return { type: 'card', isTransfer: false, selfMove: false };
  if (/interest/.test(d)) return { type: 'interest', isTransfer: false, selfMove: false };
  if (
    c === 'top up' ||
    c === 'others' ||
    /^payment from|top.?up|transfer|\bsent\b|\breceived\b|^to\s|^from\s/.test(d)
  )
    return { type: 'transfer', isTransfer: true, selfMove: false };
  return { type: 'card', isTransfer: false, selfMove: false };
}

function extractCounterparty(desc: string): string | null {
  const m = desc.match(/(?:from|to)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

const SERIAL = /^\d+(\.\d+)?$/;

export function parse(rows: string[][]): ParseResult {
  // IBAN(ы) счёта из шапки.
  const ibans = Array.from(
    new Set(
      rows
        .flat()
        .flatMap((c) => c.match(/\b[A-Z]{2}\d{2}[0-9A-Z]{10,30}\b/g) ?? [])
        .map((s) => normalizeIban(s)),
    ),
  );
  const primaryIban = ibans[0] ?? null;

  // Регион с таблицами операций по текущим счетам.
  const startIdx = rows.findIndex((r) => r.some((c) => c.trim() === SECTION_START));
  const endIdx = rows.findIndex((r) => r.some((c) => c.trim() === SECTION_END));
  const from = startIdx >= 0 ? startIdx + 1 : 0;
  const to = endIdx >= 0 ? endIdx : rows.length;

  const txns: ParsedTxn[] = [];
  let currency = 'EUR';
  let inTable = false;

  for (let i = from; i < to; i++) {
    const r = rows[i];
    const first = (r[0] ?? '').trim();

    const accHeader = first.match(/Account\s*\(([A-Z]{3})\)/);
    if (accHeader) {
      currency = accHeader[1];
      inTable = false;
      continue;
    }
    if (first === 'Date') {
      inTable = true;
      continue;
    }
    if (first === 'Total' || first.startsWith('---') || first === 'Transaction statement') {
      inTable = false;
      continue;
    }
    if (!inTable || !SERIAL.test(first)) continue;

    const date = excelSerialToIso(Number(first));
    const desc = (r[1] ?? '').trim();
    const category = (r[2] ?? '').trim();
    const money = parseMoney(r[3] ?? '');
    const balance = parseMoney(r[4] ?? '');
    if (money.amount === 0 && !desc) continue;

    const { type, isTransfer, selfMove } = classify(category, desc);

    let counterpartyName: string | null = null;
    let counterpartyIban: string | null = null;
    if (selfMove) {
      // Внутренний обмен валют — деньги остаются у владельца: привязываем к своему счёту.
      counterpartyIban = primaryIban;
    } else if (isTransfer) {
      counterpartyName = extractCounterparty(desc);
    } else if (type !== 'cash') {
      counterpartyName = desc || null;
    }

    txns.push({
      bookingDate: date,
      valueDate: date,
      amount: money.amount,
      currency,
      rawDescription: desc.slice(0, 200),
      counterpartyName,
      counterpartyIban,
      type,
      isTransfer,
      balanceAfter: balance.amount,
      eurAmountHint: money.eur,
    });
  }

  const dates = txns.map((t) => t.bookingDate).sort();

  return {
    account: { bank: 'revolut', ibans, holderName: null },
    transactions: txns,
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
  };
}
