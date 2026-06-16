import type { ParseResult, ParsedTxn, TxnType } from './types';
import {
  fromCents,
  isoDate,
  monthFromAbbrev,
  normalizeIban,
  parseUsAmount,
  toCents,
} from './util';

// Revolut выпускает два разных PDF-формата выписок:
// 1. "Custom Statement" — консолидированная выписка с секциями по валютам/счетам
//    ("Personal Account (EUR)\nTransaction statement"); суммы со знаком, для не-EUR
//    Revolut сам печатает EUR-эквивалент рядом с исходной суммой.
// 2. "Account statement" — обычная выписка по одному счёту/валюте ("EUR Statement",
//    "Account transactions from ... to ...", таблица "Date Description Money out
//    Money in Balance"). Суммы без знака — направление определяем по разнице балансов.

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
  if (/Account transactions from/i.test(text) && /Balance summary/i.test(text)) {
    return parseAccountStatement(text);
  }
  return parseCustomStatement(text);
}

function parseCustomStatement(text: string): ParseResult {
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

// Маркер начала строки операции в "Account statement": "Jan 4, 2026 Gepha €12.93 €785.69".
// Якорим к началу строки — иначе встроенная дата в "Generated on the Jun 16, 2026"
// (повторяется в колонтитуле каждой страницы) даёт ложные срабатывания.
const ACCOUNT_DATE_LINE = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s+(\d{4})\s+(.*)$/;

interface AccountTxnBlock {
  date: string;
  /** Остаток первой строки после даты: описание + сумма + баланс. */
  rest: string;
  /** Последующие строки до следующей операции (To/From/Card/Fee/Reference и т.п.). */
  extra: string[];
}

function parseAccountStatement(text: string): ParseResult {
  const ibans = Array.from(
    new Set(
      (text.match(/\b([A-Z]{2}\d{2}[0-9A-Z]{10,30})\b/g) ?? []).map((s) => normalizeIban(s)),
    ),
  );

  const currencyMatch = text.match(/\b([A-Z]{3})\s+Statement\b/);
  const currency = currencyMatch ? currencyMatch[1] : 'EUR';

  // Имя владельца: строка прописными буквами прямо перед сводкой баланса.
  const holderMatch = text.match(/\n([A-ZÄÖÜ][A-ZÄÖÜ' -]+[A-ZÄÖÜ])\n\s*Balance summary/);
  const holderName = holderMatch ? holderMatch[1].trim() : null;

  const periodMatch = text.match(
    /Account transactions from\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+to\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/,
  );
  let periodStart: string | undefined;
  let periodEnd: string | undefined;
  if (periodMatch) {
    const m1 = monthFromAbbrev(periodMatch[1].slice(0, 3));
    const m2 = monthFromAbbrev(periodMatch[4].slice(0, 3));
    if (m1 != null) periodStart = isoDate(+periodMatch[3], m1, +periodMatch[2]);
    if (m2 != null) periodEnd = isoDate(+periodMatch[6], m2, +periodMatch[5]);
  }

  // Сводная строка "Total €863.35 €7,562.11 €6,753.00 €54.24" — открытие/закрытие баланса.
  const summaryMatch = text.match(
    /Total\s+€?([\d,]+\.\d{2})\s+€?([\d,]+\.\d{2})\s+€?([\d,]+\.\d{2})\s+€?([\d,]+\.\d{2})/,
  );
  const opening = summaryMatch ? parseUsAmount(summaryMatch[1]) : null;
  const closing = summaryMatch ? parseUsAmount(summaryMatch[4]) : undefined;

  // Берём только основную таблицу операций: от заголовка до секции "Reverted"
  // (отменённые операции не меняют баланс и печатаются без колонки Balance).
  const startIdx = text.search(/Account transactions from/i);
  const revertedIdx = text.search(/\bReverted from\b/i);
  const region = text.slice(
    startIdx >= 0 ? startIdx : 0,
    revertedIdx >= 0 ? revertedIdx : text.length,
  );

  // Группируем строки по операциям: новая операция начинается строкой с датой
  // в начале (якорь ^), всё до следующей даты — её детали (To/From/Card/Fee/...).
  const lines = region.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const blocks: AccountTxnBlock[] = [];
  for (const line of lines) {
    const m = line.match(ACCOUNT_DATE_LINE);
    const month = m ? monthFromAbbrev(m[1].slice(0, 3)) : null;
    if (m && month != null) {
      blocks.push({ date: isoDate(+m[3], month, +m[2]), rest: m[4], extra: [] });
      continue;
    }
    if (blocks.length) blocks[blocks.length - 1].extra.push(line);
  }

  const txns: ParsedTxn[] = [];
  let prevCents = opening != null ? toCents(opening) : null;

  for (const b of blocks) {
    // На строке операции всегда ровно два денежных токена: сумма и баланс после неё.
    // Дополнительные суммы (Fee:, Revolut Rate) находятся на отдельных строках extra
    // и сюда не попадают.
    const tokens: number[] = [];
    let am: RegExpExecArray | null;
    MONEY.lastIndex = 0;
    while ((am = MONEY.exec(b.rest))) tokens.push(parseUsAmount(am[0]));
    if (tokens.length < 2) continue; // не строка операции (например, обрывок шапки)

    const rawAmount = tokens[0];
    const balance = tokens[1];
    const balCents = toCents(balance);
    // Знак суммы по этому формату не печатается явно (отдельные колонки Money out/in),
    // поэтому определяем его по изменению баланса — это надёжно работает и для
    // возвратов (refund), которые приходят на тех же строках, что и покупки по карте.
    const amount = prevCents != null ? fromCents(balCents - prevCents) : -rawAmount;
    prevCents = balCents;

    const firstMoneyIdx = b.rest.search(MONEY);
    const desc = (firstMoneyIdx === -1 ? b.rest : b.rest.slice(0, firstMoneyIdx)).trim();

    let counterpartyName: string | null = null;
    for (const ex of b.extra) {
      const cm = ex.match(/^(?:To|From):\s*(.+)$/i);
      if (cm) {
        counterpartyName = cm[1].trim();
        break;
      }
    }

    const hasCard = b.extra.some((l) => /^Card:/i.test(l));
    const hasReference = b.extra.some((l) => /^Reference:/i.test(l));

    let type: TxnType;
    let isTransfer: boolean;
    if (hasReference) {
      // Перевод другому пользователю Revolut: описание — общее юрлицо банка,
      // реального получателя/отправителя видно только по строке Reference/To/From.
      type = 'transfer';
      isTransfer = true;
    } else if (hasCard) {
      // Признак Card: однозначно указывает на покупку/возврат по карте — это надёжнее,
      // чем угадывать по описанию (например, "Too Good To Go" содержит слово "to").
      type = 'card';
      isTransfer = false;
    } else {
      const base = classify(desc);
      type = base.type;
      isTransfer = base.isTransfer;
    }
    if (!counterpartyName && !isTransfer) counterpartyName = desc || null;

    txns.push({
      bookingDate: b.date,
      valueDate: b.date,
      amount,
      currency,
      rawDescription: desc.slice(0, 200),
      counterpartyName,
      counterpartyIban: null,
      type,
      isTransfer,
      balanceAfter: balance,
    });
  }

  return {
    account: { bank: 'revolut', ibans, holderName },
    transactions: txns,
    periodStart,
    periodEnd,
    openingBalance: opening ?? undefined,
    closingBalance: closing,
  };
}
