import type { ParseResult, ParsedTxn, TxnType } from './types';
import { isoDate, monthFromAbbrev, normalizeIban, parseUsAmount } from './util';

// Парсер консолидированной выписки Revolut (Custom Statement).
// Несколько секций по валютам/счетам; для не-EUR Revolut сам печатает EUR-эквивалент
// рядом с исходной суммой — мы его и используем (конвертация курсами не нужна).

export function detect(text: string): boolean {
  return /Revolut Bank UAB/i.test(text) || /Custom Statement/i.test(text);
}

// Денежный токен: "-$48.32", "-€41.23", "$0.00", "0.87 CHF".
const MONEY = /-?(?:[€$]\s?[\d,]+\.\d{2}|[\d,]+\.\d{2}\s?(?:CHF|GBP|PLN|USD|EUR))/g;
// Маркер даты "Jan 4, 2026".
const DATE = /([A-Z][a-z]{2,3})\s+(\d{1,2}),\s+(\d{4})/g;

const CATEGORY_WORDS = new Set([
  'Merchant', 'Others', 'Transfer', 'Transfers', 'Cashback', 'Services', 'General',
  'Income', 'Investments', 'Restaurants', 'Groceries', 'Shopping', 'Transport',
  'Utilities', 'Entertainment', 'Health', 'Travel', 'Fees', 'Bills', 'Cash',
]);

function tokenCurrency(tok: string): string {
  if (tok.includes('€')) return 'EUR';
  if (tok.includes('$')) return 'USD';
  const m = tok.match(/(CHF|GBP|PLN|USD|EUR)/);
  return m ? m[1] : 'EUR';
}

function classify(desc: string): { type: TxnType; isTransfer: boolean; selfMove: boolean } {
  const d = desc.toLowerCase();
  if (/exchang/.test(d)) return { type: 'transfer', isTransfer: true, selfMove: true };
  if (/to savings|from savings|to pocket|from pocket/.test(d))
    return { type: 'transfer', isTransfer: true, selfMove: true };
  if (/transfer|top.?up|payment from|sent|received|\bto \b|\bfrom \b/.test(d))
    return { type: 'transfer', isTransfer: true, selfMove: false };
  if (/interest/.test(d)) return { type: 'interest', isTransfer: false, selfMove: false };
  if (/fee\b/.test(d)) return { type: 'fee', isTransfer: false, selfMove: false };
  return { type: 'card', isTransfer: false, selfMove: false };
}

function stripCategory(desc: string): { clean: string; category: string | null } {
  const words = desc.trim().split(/\s+/);
  const last = words[words.length - 1];
  if (last && CATEGORY_WORDS.has(last)) {
    return { clean: words.slice(0, -1).join(' '), category: last };
  }
  return { clean: desc.trim(), category: null };
}

export function parse(text: string): ParseResult {
  // IBAN(ы) и владелец из шапки.
  const ibans = Array.from(
    new Set(
      (text.match(/\b([A-Z]{2}\d{2}[0-9A-Z]{10,30})\b/g) ?? []).map((s) => normalizeIban(s)),
    ),
  );
  // Имя владельца: строка верхним регистром в начале документа.
  const holderMatch = text.match(/Generated on[^\n]*\n([A-ZÄÖÜ][A-ZÄÖÜ ]+[A-ZÄÖÜ])\s*\n/);
  const holderName = holderMatch ? holderMatch[1].trim() : null;

  // Регион с таблицами операций.
  const tsIdx = text.search(/Transaction Statements/i);
  const region = tsIdx >= 0 ? text.slice(tsIdx) : text;

  // Заголовки секций со счётом и валютой.
  const headerRe = /([^\n]*?)\(([A-Z]{3})\)\s*\n\s*Transaction statement/g;
  const sections: { currency: string; start: number; end: number }[] = [];
  let hm: RegExpExecArray | null;
  const headers: { currency: string; index: number }[] = [];
  while ((hm = headerRe.exec(region))) {
    headers.push({ currency: hm[2], index: hm.index });
  }
  for (let i = 0; i < headers.length; i++) {
    sections.push({
      currency: headers[i].currency,
      start: headers[i].index,
      end: i + 1 < headers.length ? headers[i + 1].index : region.length,
    });
  }

  const txns: ParsedTxn[] = [];

  for (const sec of sections) {
    const body = region.slice(sec.start, sec.end);
    const joined = body.replace(/\s+/g, ' ');

    // Позиции дат.
    const marks: { index: number; date: string }[] = [];
    let dm: RegExpExecArray | null;
    DATE.lastIndex = 0;
    while ((dm = DATE.exec(joined))) {
      const month = monthFromAbbrev(dm[1]);
      if (month == null) continue;
      marks.push({ index: dm.index, date: isoDate(+dm[3], month, +dm[2]) });
    }

    for (let k = 0; k < marks.length; k++) {
      const chunk = joined.slice(
        marks[k].index,
        k + 1 < marks.length ? marks[k + 1].index : joined.length,
      );
      const afterDate = chunk.replace(DATE, '').trim();

      // Денежные токены с валютой.
      const tokens: { value: number; cur: string }[] = [];
      let am: RegExpExecArray | null;
      MONEY.lastIndex = 0;
      while ((am = MONEY.exec(chunk))) tokens.push({ value: parseUsAmount(am[0]), cur: tokenCurrency(am[0]) });
      if (tokens.length === 0) continue; // строка-шапка страницы и т.п.

      const origCur = sec.currency;
      const origList = tokens.filter((t) => t.cur === origCur).map((t) => t.value);
      const eurList = tokens.filter((t) => t.cur === 'EUR').map((t) => t.value);
      if (origList.length < 2) continue; // нет суммы+баланса — не операция

      const amount = origList[0];
      const balanceAfter = origList[1];
      const eurAmount = origCur === 'EUR' ? amount : eurList[0] ?? null;

      // Описание: текст до первой суммы, без хвостовой Revolut-категории.
      const firstMoney = afterDate.search(MONEY);
      const descPart = (firstMoney === -1 ? afterDate : afterDate.slice(0, firstMoney)).trim();
      const { clean } = stripCategory(descPart);
      const { type, isTransfer, selfMove } = classify(clean);

      let counterpartyName: string | null = null;
      const cpMatch = clean.match(/(?:from|to)\s+(.+)$/i);
      if (isTransfer && cpMatch) counterpartyName = cpMatch[1].trim();
      else if (!isTransfer) counterpartyName = clean || null;
      // Внутренние перемещения Revolut (обмен валют, переводы в копилки) — это сам владелец.
      if (selfMove && holderName) counterpartyName = holderName;

      txns.push({
        bookingDate: marks[k].date,
        valueDate: marks[k].date,
        amount,
        currency: origCur,
        rawDescription: clean.slice(0, 200),
        counterpartyName,
        counterpartyIban: null,
        type,
        isTransfer,
        balanceAfter,
        eurAmountHint: eurAmount,
      });
    }
  }

  return {
    account: { bank: 'revolut', ibans, holderName },
    transactions: txns,
  };
}
