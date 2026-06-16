import type { ParseResult, ParsedTxn, TxnType } from './types';
import { isoDate, monthFromAbbrev, normalizeIban, parseEuAmount, toCents, fromCents } from './util';

// Парсер выписок Trade Republic.
// Немецкий формат сумм: "2.034,95 €". Даты "01 Jan. 2026" (в тексте могут быть разорваны).
// Колонки: DATUM, TYP, BESCHREIBUNG, ZAHLUNGSEINGANG, ZAHLUNGSAUSGANG, SALDO.
// Знак суммы определяем по разнице с предыдущим SALDO (надёжнее позиции колонки).

export function detect(text: string): boolean {
  return /TRADE REPUBLIC BANK/i.test(text);
}

// Маркер даты внутри склеенного текста: "01 Jan. 2026", "01 März 2026", "1 Mai 2026".
// Месяц захватываем как слово и проверяем через monthFromAbbrev (отсекает ложные срабатывания).
const DATE_MARKER = /(\d{1,2})\s+([A-Za-zäöüÄÖÜ]{3,5})\.?\s+(\d{4})/g;
const EURO_AMOUNT = /([\d.]+,\d{2})\s*€/g;

function classify(typ: string, desc: string): { type: TxnType; isTransfer: boolean } {
  const t = (typ + ' ' + desc).toLowerCase();
  if (/zinsen|interest/.test(t)) return { type: 'interest', isTransfer: false };
  if (/handel|trade|buy|sell|kauf|verkauf/.test(t)) return { type: 'trade', isTransfer: false };
  if (/ertrag|dividend/.test(t)) return { type: 'dividend', isTransfer: false };
  if (/überweisung|ueberweisung|transfer/.test(t)) return { type: 'transfer', isTransfer: true };
  if (/karte|card|kartenzahlung/.test(t)) return { type: 'card', isTransfer: false };
  if (/gebühr|fee|entgelt/.test(t)) return { type: 'fee', isTransfer: false };
  return { type: 'other', isTransfer: false };
}

export function parse(text: string): ParseResult {
  const ibanMatch = text.match(/IBAN\s+(DE[0-9A-Z]+)/);
  const iban = ibanMatch ? normalizeIban(ibanMatch[1]) : '';
  // Имя владельца: строка после адреса банка, в верхнем регистре.
  // Имя владельца: строка только из заглавных букв, за которой идёт адрес и индекс.
  const holderMatch = text.match(/\n([A-ZÄÖÜ][A-ZÄÖÜ ]+[A-ZÄÖÜ])\n[^\n]*\n\d{5}\b/);
  const holderName = holderMatch ? holderMatch[1].trim() : null;

  // Начальный баланс (ANFANGSSALDO) из сводки.
  const anfangMatch = text.match(/ANFANGSSALDO[\s\S]*?([\d.]+,\d{2})\s*€/);
  const opening = anfangMatch ? parseEuAmount(anfangMatch[1]) : null;

  // Берём текст после заголовка таблицы операций (UMSATZÜBERSICHT).
  const umsatzIdx = text.search(/UMSATZÜBERSICHT|UMSATZUBERSICHT/i);
  const body = umsatzIdx >= 0 ? text.slice(umsatzIdx) : text;
  const joined = body.replace(/\s+/g, ' ');

  // Находим позиции всех маркеров дат.
  const markers: { index: number; date: string }[] = [];
  let dm: RegExpExecArray | null;
  DATE_MARKER.lastIndex = 0;
  while ((dm = DATE_MARKER.exec(joined))) {
    const month = monthFromAbbrev(dm[2]);
    if (month == null) continue;
    markers.push({ index: dm.index, date: isoDate(+dm[3], month, +dm[1]) });
  }

  const txns: ParsedTxn[] = [];
  let prevCents = opening != null ? toCents(opening) : null;

  for (let k = 0; k < markers.length; k++) {
    const start = markers[k].index;
    const end = k + 1 < markers.length ? markers[k + 1].index : joined.length;
    const chunk = joined.slice(start, end);
    // Текст после самой даты.
    const afterDate = chunk.replace(DATE_MARKER, '').trim();

    // Все денежные суммы в чанке: последняя = SALDO, остальные — суммы операции.
    const amounts: number[] = [];
    let am: RegExpExecArray | null;
    EURO_AMOUNT.lastIndex = 0;
    while ((am = EURO_AMOUNT.exec(chunk))) amounts.push(parseEuAmount(am[1]));
    if (amounts.length === 0) continue; // не строка операции

    const saldo = amounts[amounts.length - 1];
    const saldoCents = toCents(saldo);
    // Знаковая сумма операции = изменение баланса.
    const amount = prevCents != null ? fromCents(saldoCents - prevCents) : 0;
    prevCents = saldoCents;

    // TYP — первое слово; описание — до первой суммы.
    const descPart = afterDate.replace(EURO_AMOUNT, '').trim();
    const typMatch = descPart.match(/^(\S+)/);
    const typ = typMatch ? typMatch[1] : '';
    const { type, isTransfer } = classify(typ, descPart);

    // Контрагент и IBAN из "from/to NAME (IBAN)".
    const cpMatch = descPart.match(/(?:from|to|von|an)\s+(.+?)\s*\(([A-Z]{2}[0-9A-Z]+)\)/i);
    const counterpartyName = cpMatch ? cpMatch[1].trim() : null;
    const counterpartyIban = cpMatch ? normalizeIban(cpMatch[2]) : null;

    txns.push({
      bookingDate: markers[k].date,
      valueDate: markers[k].date,
      amount,
      currency: 'EUR',
      rawDescription: descPart.slice(0, 200),
      counterpartyName,
      counterpartyIban,
      type,
      isTransfer,
      balanceAfter: saldo,
    });
  }

  return {
    account: { bank: 'trade_republic', ibans: iban ? [iban] : [], holderName },
    transactions: txns,
    closingBalance: txns.length ? (txns[txns.length - 1].balanceAfter ?? undefined) : undefined,
    openingBalance: opening ?? undefined,
  };
}
