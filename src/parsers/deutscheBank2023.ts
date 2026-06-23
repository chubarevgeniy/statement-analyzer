import type { ParseResult, ParsedTxn, TxnType } from './types';
import { isoDate, normalizeIban, parseUsAmount, toCents, fromCents } from './util';

// Парсер для выписок Deutsche Bank 2022-2023 с повреждённой кодировкой шрифта.
// pdf.js извлекает символы со сдвигом +29: реальный код = извлечённый − 29.
// Диапазоны: H-Z (72–90) → +(43)–=(61), a-w (97–119) → D(68)–Z(90).
// Числа и пунктуация (кроме знаков и точки) передаются корректно.
// "Account statement from" присутствует в чистом виде; IBAN начинается с "ab" (= DE).

function dec(s: string): string {
  return s.replace(/[H-Za-w]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 29));
}

export function detect(text: string): boolean {
  // "Account statement from" в чистом тексте + IBAN закодирован ("ab" = "DE")
  return /Account statement from/i.test(text) && /\bab[MNOPQRSTUV]{2}\b/.test(text);
}

// Сумма: знак ([HJ] или ASCII +/-), тело из закодированных цифр + десятичная (K = ASCII .)
const AMOUNT_G = /([HJ+\-])\s?([MNOPQRSTUVI0-9]*[K.][MNOPQRSTUV0-9]{1,2})/g;

function classify(desc: string): { type: TxnType; isTransfer: boolean } {
  const d = desc.toLowerCase();
  if (/lohn|gehalt|salary|\bsala\b/.test(d)) return { type: 'salary', isTransfer: false };
  if (/überweisung|ueberweisung|transfer|sepa|lastschrift/.test(d)) return { type: 'transfer', isTransfer: true };
  if (/karte|card|kartenzahlung/.test(d)) return { type: 'card', isTransfer: false };
  if (/bargeld|cash|einzahlung|auszahlung/.test(d)) return { type: 'cash', isTransfer: false };
  if (/entgelt|gebühr|fee/.test(d)) return { type: 'fee', isTransfer: false };
  return { type: 'other', isTransfer: false };
}

export function parse(text: string): ParseResult {
  // Владелец: "Account holderW <name>" — W = закодированный ":"
  const holderMatch = text.match(/Account holder[W:]\s*(.+)/i);
  const holderName = holderMatch ? dec(holderMatch[1]).trim() : null;

  // Свой IBAN начинается с "ab" (= DE) и содержит закодированные цифры
  const ibanMatch = text.match(/\bab[MNOPQRSTUV]{2}(?:\s[A-Z\d]{4}){4}\s[A-Z\d]{2}\b/);
  const iban = ibanMatch ? normalizeIban(dec(ibanMatch[0])) : '';

  // Период из чистого заголовка "Account statement from DD.MM.YYYY to DD.MM.YYYY"
  const periodMatch = text.match(/Account statement from\s+(\S+)\s+to\s+(\S+)/i);
  let periodStart: string | undefined;
  let periodEnd: string | undefined;
  if (periodMatch) {
    const parseDate = (raw: string) => {
      const d = dec(raw).match(/(\d{2})\.(\d{2})\.(\d{4})/);
      return d ? isoDate(+d[3], +d[2], +d[1]) : undefined;
    };
    periodStart = parseDate(periodMatch[1]);
    periodEnd = parseDate(periodMatch[2]);
  }

  // Начальный баланс: "bro" (= EUR) + знак + сумма
  const openingMatch = text.match(/bro\s+([H+])\s?([MNOPQRSTUVI0-9]*[K.][MNOPQRSTUV0-9]{1,2})/);
  const opening: number | null = openingMatch
    ? parseUsAmount(dec(openingMatch[1]) + dec(openingMatch[2]))
    : null;

  // Конечный баланс: "kew/New balance ... bro + сумма"
  const closingMatch = text.match(
    /(?:kew|New)\s+balance[\s\S]{0,150}?bro\s+([H+])\s?([MNOPQRSTUVI0-9]*[K.][MNOPQRSTUV0-9]{1,2})/i,
  );
  const closing: number | undefined = closingMatch
    ? parseUsAmount(dec(closingMatch[1]) + dec(closingMatch[2]))
    : undefined;

  // Все денежные якоря
  const anchors: { start: number; end: number; amount: number; isBalance: boolean }[] = [];
  let m: RegExpExecArray | null;
  AMOUNT_G.lastIndex = 0;
  while ((m = AMOUNT_G.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 10), m.index);
    // "bro" (= EUR) перед суммой → балансовая строка
    const isBalance = /bro\s*$/.test(before);
    anchors.push({
      start: m.index,
      end: m.index + m[0].length,
      amount: parseUsAmount(dec(m[1]) + dec(m[2])),
      isBalance,
    });
  }

  const txns: ParsedTxn[] = [];
  let runningCents = opening != null ? toCents(opening) : null;

  // Закодированная дата: DD J MM J YYYY (J = "-", M-V = "0"-"9")
  const DATE_RE = /([MNOPQRSTUV]{2})J([MNOPQRSTUV]{2})J\s*([MNOPQRSTUV]{4})/g;

  for (let a = 0; a < anchors.length; a++) {
    if (anchors[a].isBalance) continue;
    const segEnd = a + 1 < anchors.length ? anchors[a + 1].start : text.length;
    const segment = text.slice(anchors[a].end, segEnd);

    DATE_RE.lastIndex = 0;
    const dates: string[] = [];
    let dm: RegExpExecArray | null;
    while ((dm = DATE_RE.exec(segment)) && dates.length < 2) {
      dates.push(isoDate(+dec(dm[3]), +dec(dm[2]), +dec(dm[1])));
    }
    if (dates.length === 0) continue;

    const valueDate = dates[0];
    const bookingDate = dates[1] ?? dates[0];
    const amount = anchors[a].amount;

    // Описание: последняя строка перед якорем суммы
    const beforeSlice = text.slice(Math.max(0, anchors[a].start - 150), anchors[a].start);
    const lastNl = beforeSlice.lastIndexOf('\n');
    const descLine = beforeSlice.slice(lastNl + 1).trim();
    const { type, isTransfer } = classify(descLine);

    // IBAN контрагента: закодированный (fBAk = IBAN) или ASCII
    const cpIbanMatch = segment.match(/(?:fBAk|IBAN)\s+([a-zA-Z]{2}[H-Za-w\d\s]+)/i);
    const counterpartyIban = cpIbanMatch
      ? normalizeIban(dec(cpIbanMatch[1].replace(/\s+/g, '')))
      : null;

    if (runningCents != null) runningCents += toCents(amount);
    const balanceAfter = runningCents != null ? fromCents(runningCents) : null;

    txns.push({
      bookingDate,
      valueDate,
      amount,
      currency: 'EUR',
      rawDescription: descLine,
      counterpartyName: null,
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
