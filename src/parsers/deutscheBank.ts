import type { ParseResult, ParsedTxn, TxnType } from './types';
import { isoDate, normalizeIban, parseUsAmount, toCents, fromCents } from './util';

// Парсер выписок Deutsche Bank (формат "Account statement ...").
// Суммы в US-формате со знаком: "+ 26,416.84" / "- 2,400.00".
// В извлечённом pdf.js тексте сумма склеена с описанием ("- 150.00SEPA ... an"),
// а балансовые суммы — со словом "EUR" ("+ 383.51EUR..."). Поэтому парсим
// якорями по регулярке, а не по строкам.

export function detect(text: string): boolean {
  return /Deutsche Bank AG/i.test(text) && /Account statement from/i.test(text);
}

// Сумма со знаком: захватываем знак и число.
const AMOUNT_G = /([+-])\s?(\d[\d,]*\.\d{2})/g;

function classify(desc: string): { type: TxnType; isTransfer: boolean } {
  const d = desc.toLowerCase();
  if (/lohn\/gehalt|gehalt|salary|\bsala\b/.test(d)) return { type: 'salary', isTransfer: false };
  if (/überweisung|ueberweisung|transfer|sepa/.test(d)) return { type: 'transfer', isTransfer: true };
  if (/bargeld|cash|einzahlung|auszahlung/.test(d)) return { type: 'cash', isTransfer: false };
  if (/entgelt|gebühr|fee/.test(d)) return { type: 'fee', isTransfer: false };
  return { type: 'other', isTransfer: false };
}

export function parse(text: string): ParseResult {
  const holderMatch = text.match(/Account holder:\s*(.+)/);
  const holderName = holderMatch ? holderMatch[1].trim() : null;

  // Свой IBAN печатается с пробелами-группами ("DE83 8207 0024 0101 1287 00"),
  // тогда как IBAN контрагентов — слитно. Это однозначно выделяет счёт.
  const ibanMatch = text.match(/DE\d{2}(?:\s\d{4}){4}\s\d{2}/);
  const iban = ibanMatch ? normalizeIban(ibanMatch[0]) : '';

  const periodMatch = text.match(/from\s+(\d{2})\.(\d{2})\.(\d{4})\s+to\s+(\d{2})\.(\d{2})\.(\d{4})/);
  const periodStart = periodMatch ? isoDate(+periodMatch[3], +periodMatch[2], +periodMatch[1]) : undefined;
  const periodEnd = periodMatch ? isoDate(+periodMatch[6], +periodMatch[5], +periodMatch[4]) : undefined;

  const openingMatch = text.match(/Previous balance[\s\S]*?([+-])\s?(\d[\d,]*\.\d{2})\s*EUR/);
  const opening = openingMatch ? parseUsAmount(openingMatch[1] + openingMatch[2]) : null;
  const closingMatch = text.match(/New balance[\s\S]*?([+-])\s?(\d[\d,]*\.\d{2})\s*EUR/);
  const closing = closingMatch ? parseUsAmount(closingMatch[1] + closingMatch[2]) : undefined;

  // Собираем все денежные якоря.
  const anchors: { start: number; end: number; amount: number; isBalance: boolean }[] = [];
  let m: RegExpExecArray | null;
  AMOUNT_G.lastIndex = 0;
  while ((m = AMOUNT_G.exec(text))) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 4);
    anchors.push({
      start: m.index,
      end: m.index + m[0].length,
      amount: parseUsAmount(m[1] + m[2]),
      isBalance: /^\s*EUR/.test(after),
    });
  }

  const txns: ParsedTxn[] = [];
  let runningCents = opening != null ? toCents(opening) : null;

  for (let a = 0; a < anchors.length; a++) {
    if (anchors[a].isBalance) continue;
    const segEnd = a + 1 < anchors.length ? anchors[a + 1].start : text.length;
    const segment = text.slice(anchors[a].end, segEnd);

    const dateRe = /(\d{2})-(\d{2})-\s*(\d{4})/g;
    const dates: string[] = [];
    let dm: RegExpExecArray | null;
    while ((dm = dateRe.exec(segment)) && dates.length < 2) {
      dates.push(isoDate(+dm[3], +dm[2], +dm[1]));
    }
    if (dates.length === 0) continue; // не транзакция

    const valueDate = dates[0];
    const bookingDate = dates[1] ?? dates[0];
    const amount = anchors[a].amount;

    const firstDateIdx = segment.search(/\d{2}-\d{2}-/);
    const beforeDate = segment.slice(0, firstDateIdx).replace(/\s+/g, ' ').trim();
    const { type, isTransfer } = classify(segment);
    const nameMatch = beforeDate.match(/\b(?:an|von|to|from)\s+(.+)$/i);
    const counterpartyName = nameMatch ? nameMatch[1].trim() : null;
    const cpIbanMatch = segment.match(/IBAN\s+([A-Z]{2}[0-9A-Z]+)/);
    const counterpartyIban = cpIbanMatch ? normalizeIban(cpIbanMatch[1]) : null;

    if (runningCents != null) runningCents += toCents(amount);
    const balanceAfter = runningCents != null ? fromCents(runningCents) : null;

    txns.push({
      bookingDate,
      valueDate,
      amount,
      currency: 'EUR',
      rawDescription: beforeDate || segment.slice(0, 80),
      counterpartyName,
      counterpartyIban,
      type,
      isTransfer,
      balanceAfter,
    });
  }

  return {
    account: { bank: 'deutsche_bank', ibans: iban ? [iban] : [], holderName },
    transactions: txns,
    periodStart,
    periodEnd,
    openingBalance: opening ?? undefined,
    closingBalance: closing,
  };
}
