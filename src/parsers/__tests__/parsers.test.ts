import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parse as parseDB, detect as detectDB } from '../deutscheBank';
import { parse as parseTR, detect as detectTR } from '../tradeRepublic';
import { parse as parseTRCsv, detect as detectTRCsv } from '../tradeRepublicCsv';
import { parse as parseRev, detect as detectRev } from '../revolut';
import { parse as parseRevXlsx, detect as detectRevXlsx } from '../revolutXlsx';
import { readXlsx } from '../xlsx';

// Все фикстуры — синтетические (выдуманные имена/IBAN), имитируют формат
// извлечения текста pdf.js (склейка токенов).

const DB_TEXT = [
  'Deutsche Bank AG',
  'Account holder: Test Person',
  'Account statement from 01.01.2026 to 31.01.2026',
  'Previous balance as at 31.12.2025IBANofPageStatement',
  '+ 100.00EURDE00 1111 2222 3333 4444 55211',
  'CreditDebitItemValueBooking',
  'date',
  '- 50.00SEPA Überweisung an',
  'Jane Doe',
  '05-01-',
  '2026',
  '05-01-',
  '2026',
  'IBAN DE99888877776666555544',
  'BIC TESTDEFFXXX',
  '+ 200.00SEPA Überweisung von',
  'Some Employer',
  '15-01-',
  '2026',
  '14-01-',
  '2026',
  'Payment Reference/E2E-Ref.',
  'Lohn/Gehalt 123/202601',
  'SALA Lohn/Gehalt',
  'New balance+ 250.00EUR',
].join('\n');

const TR_TEXT = [
  'TRADE REPUBLIC BANK GMBH',
  'IBAN',
  'DE11220033004400550066',
  'BIC',
  'TRBKDEBBXXX',
  'TEST PERSON',
  'Some Street 1',
  '12345 Berlin',
  'KONTOÜBERSICHT',
  'PRODUKT ANFANGSSALDO ZAHLUNGSEINGANG ZAHLUNGSAUSGANG ENDSALDO',
  'Cashkonto 10,00 € 100,00 € 60,00 € 20,00 €',
  'UMSATZÜBERSICHT',
  'DATUM TYP BESCHREIBUNG ZAHLUNGSEINGANG ZAHLUNGSAUSGANG SALDO',
  '01 Jan.',
  '2026 ',
  'Zinsen Interest payment 5,00 € 15,00 €',
  '03 Jan.',
  '2026 ',
  'Überweisung Incoming transfer from Test Person (DE00111122223333444455)',
  '40,00 € 55,00 €',
  '10 Jan.',
  '2026 ',
  'Handel',
  'Buy trade XX ETF, quantity: 1',
  '35,00 € 20,00 €',
].join('\n');

const REV_TEXT = [
  'Custom Statement',
  'Revolut Bank UAB',
  'Generated on the Jun 15, 2026',
  'TEST PERSON',
  '',
  'Account Number (IBAN)',
  'DE22334455667788990011',
  'Current Accounts Transaction Statements',
  'Personal Account (EUR)',
  'Transaction statement',
  'Date Description Category Money in /out Balance Tax withheld Other taxes Fees',
  'Jan 1, 2026',
  'Bolt',
  'Merchant -€2.00 €98.00 €0.00 €0.00 €0.00',
  'Jan 2, 2026',
  'Transfer from John Smith Others €10.00 €108.00 €0.00 €0.00 €0.00',
  'Personal Account (USD)',
  'Transaction statement',
  'Date Description Category Money in /out Balance Tax withheld Other taxes Fees',
  'Jan 4, 2026',
  'Carrefour',
  'Merchant -$48.32 -€41.23 $9,033.55 €7,707.15 $0.00 €0.00 $0.00 €0.00 $0.48 €0.41',
].join('\n');

describe('Deutsche Bank parser', () => {
  it('детектирует формат', () => {
    expect(detectDB(DB_TEXT)).toBe(true);
    expect(detectTR(DB_TEXT)).toBe(false);
  });

  it('парсит счёт и транзакции', () => {
    const r = parseDB(DB_TEXT);
    expect(r.account.bank).toBe('deutsche_bank');
    expect(r.account.holderName).toBe('Test Person');
    expect(r.account.ibans).toEqual(['DE00111122223333444455']);
    expect(r.openingBalance).toBe(100);
    expect(r.closingBalance).toBe(250);
    expect(r.transactions).toHaveLength(2);

    const [t1, t2] = r.transactions;
    expect(t1.amount).toBe(-50);
    expect(t1.type).toBe('transfer');
    expect(t1.counterpartyName).toBe('Jane Doe');
    expect(t1.counterpartyIban).toBe('DE99888877776666555544');
    expect(t1.valueDate).toBe('2026-01-05');
    expect(t1.balanceAfter).toBe(50);

    expect(t2.amount).toBe(200);
    expect(t2.type).toBe('salary');
    expect(t2.counterpartyName).toBe('Some Employer');
    expect(t2.valueDate).toBe('2026-01-15');
    expect(t2.bookingDate).toBe('2026-01-14');
    expect(t2.balanceAfter).toBe(250);
  });
});

describe('Trade Republic parser', () => {
  it('детектирует формат', () => {
    expect(detectTR(TR_TEXT)).toBe(true);
  });

  it('парсит транзакции и определяет знак по балансу', () => {
    const r = parseTR(TR_TEXT);
    expect(r.account.bank).toBe('trade_republic');
    expect(r.account.holderName).toBe('TEST PERSON');
    expect(r.account.ibans).toEqual(['DE11220033004400550066']);
    expect(r.transactions).toHaveLength(3);

    const [zins, trans, handel] = r.transactions;
    expect(zins.type).toBe('interest');
    expect(zins.amount).toBeCloseTo(5);
    expect(zins.balanceAfter).toBeCloseTo(15);

    expect(trans.type).toBe('transfer');
    expect(trans.amount).toBeCloseTo(40);
    expect(trans.counterpartyName).toBe('Test Person');
    expect(trans.counterpartyIban).toBe('DE00111122223333444455');

    expect(handel.type).toBe('trade');
    expect(handel.amount).toBeCloseTo(-35);
    expect(handel.balanceAfter).toBeCloseTo(20);
  });
});

describe('Revolut parser', () => {
  it('детектирует формат', () => {
    expect(detectRev(REV_TEXT)).toBe(true);
  });

  it('парсит EUR и USD (с EUR-эквивалентом)', () => {
    const r = parseRev(REV_TEXT);
    expect(r.account.bank).toBe('revolut');
    expect(r.account.holderName).toBe('TEST PERSON');
    expect(r.account.ibans).toContain('DE22334455667788990011');
    expect(r.transactions).toHaveLength(3);

    const bolt = r.transactions[0];
    expect(bolt.currency).toBe('EUR');
    expect(bolt.amount).toBeCloseTo(-2);
    expect(bolt.counterpartyName).toBe('Bolt');
    expect(bolt.isTransfer).toBe(false);

    const transfer = r.transactions[1];
    expect(transfer.isTransfer).toBe(true);
    expect(transfer.counterpartyName).toBe('John Smith');
    expect(transfer.amount).toBeCloseTo(10);

    const usd = r.transactions[2];
    expect(usd.currency).toBe('USD');
    expect(usd.amount).toBeCloseTo(-48.32);
    expect(usd.eurAmountHint).toBeCloseTo(-41.23);
    expect(usd.balanceAfter).toBeCloseTo(9033.55);
  });
});

// "Account statement" — другой формат экспорта Revolut (одна валюта, без знака у суммы,
// колонки Money out/Money in/Balance). Колонтитул с датой генерации повторяется на
// каждой странице и должен игнорироваться при поиске операций.
const REV_ACCOUNT_TEXT = [
  'EUR Statement',
  'Generated on the Jun 16, 2026',
  'Revolut Bank UAB',
  'Page of1 2',
  'TEST PERSON',
  'Balance summary',
  'Product Opening balance Money out Money in Closing balance',
  'Account (Current Account) €100.00 €60.00 €60.00 €100.00',
  'Total €100.00 €60.00 €60.00 €100.00',
  'Account transactions from January 1, 2026 to January 31, 2026',
  'Date Description Money out Money in Balance',
  'Jan 2, 2026 Glovo €20.00 €80.00',
  'Revolut Rate €1.00 = 3.12 GEL (ECB rate* €1.00 = 3.16 GEL) 46.58 GEL',
  'To: Glovoapp, Tbilisi, TB',
  'Card: 535456******0582',
  'Jan 5, 2026 Apple Pay top-up by *4412 €50.00 €130.00',
  'From: *4412',
  'Jan 10, 2026 Revolut Bank UAB Zweigniederlassung Deutschland €40.00 €90.00',
  'Reference: To Jane D',
  'To: JANE DOE',
  'Jan 12, 2026 Too Good To Go €10.00 €100.00',
  'To: Toogoodtogo, Berlin',
  'Card: 535456******0582',
  'EUR Statement',
  'Generated on the Jun 16, 2026',
  'Page of2 2',
  'Reverted from January 1, 2026 to January 31, 2026',
  'Start date Description Money out Money in',
  'Jan 7, 2026 Some Cancelled Top-up €5.00',
].join('\n');

describe('Revolut parser (Account statement)', () => {
  it('детектирует формат', () => {
    expect(detectRev(REV_ACCOUNT_TEXT)).toBe(true);
  });

  it('парсит операции, игнорируя колонтитул и секцию Reverted', () => {
    const r = parseRev(REV_ACCOUNT_TEXT);
    expect(r.account.bank).toBe('revolut');
    expect(r.account.holderName).toBe('TEST PERSON');
    expect(r.periodStart).toBe('2026-01-01');
    expect(r.periodEnd).toBe('2026-01-31');
    expect(r.openingBalance).toBeCloseTo(100);
    expect(r.closingBalance).toBeCloseTo(100);
    expect(r.transactions).toHaveLength(4);

    const [purchase, topup, transfer, refund] = r.transactions;

    expect(purchase.amount).toBeCloseTo(-20);
    expect(purchase.balanceAfter).toBeCloseTo(80);
    expect(purchase.type).toBe('card');
    expect(purchase.counterpartyName).toBe('Glovoapp, Tbilisi, TB');

    expect(topup.amount).toBeCloseTo(50);
    expect(topup.type).toBe('transfer');
    expect(topup.isTransfer).toBe(true);
    expect(topup.counterpartyName).toBe('*4412');

    expect(transfer.amount).toBeCloseTo(-40);
    expect(transfer.type).toBe('transfer');
    expect(transfer.counterpartyName).toBe('JANE DOE');

    // Описание содержит "to" как отдельное слово — наличие Card: должно
    // переопределять эвристику по ключевым словам и не считать это переводом.
    expect(refund.amount).toBeCloseTo(10);
    expect(refund.balanceAfter).toBeCloseTo(100);
    expect(refund.type).toBe('card');
    expect(refund.isTransfer).toBe(false);
  });
});

// CSV-экспорт Trade Republic: amount уже со знаком, fee/tax — отдельные колонки,
// фактическое движение по счёту = amount + fee + tax. У каждой строки есть transaction_id.
const TR_CSV = [
  '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"',
  '"2024-10-11T12:22:19Z","2024-10-11","DEFAULT","CASH","TRANSFER_INBOUND","","","","","","110.000000","","","EUR","","","","Incoming transfer from Test Person","id-1","","","",""',
  '"2024-10-16T09:15:04Z","2024-10-16","DEFAULT","TRADING","BUY","FUND","S&P 500","IE00B3WJKG14","3.0","30.10","-90.30","-1.00","","EUR","","","","Buy trade IE00B3WJKG14, quantity: 3","id-2","","","",""',
  '"2024-11-14T00:00:00Z","2024-11-14","DEFAULT","CASH","DIVIDEND","STOCK","Verizon","US92343V1044","64.75","","38.33","","-5.75","EUR","43.87","USD","0.873668","Cash Dividend for ISIN US92343V1044","id-3","","","",""',
  '"2024-10-28T00:00:00Z","2024-10-28","DEFAULT","CASH","CARD_TRANSACTION","","Ullrich Berlin-Zoo","","","","-18.070000","","","EUR","","","","TR Card Transaction","id-4","","","","5411"',
  '"2025-01-17T00:00:00Z","2025-01-17","DEFAULT","CASH","TRANSFER_OUTBOUND","","","","","","-19.000000","","","EUR","","","","Outgoing transfer for Jane Doe","id-5","Jane Doe","DE99888877776666555544","",""',
].join('\n');

describe('Trade Republic CSV parser', () => {
  it('детектирует формат и не путает с другими', () => {
    expect(detectTRCsv(TR_CSV)).toBe(true);
    expect(detectTRCsv(TR_TEXT)).toBe(false);
    expect(detectTR(TR_CSV)).toBe(false);
  });

  it('парсит суммы (с комиссией/налогом), типы и контрагента', () => {
    const r = parseTRCsv(TR_CSV);
    expect(r.account.bank).toBe('trade_republic');
    expect(r.transactions).toHaveLength(5);

    const [transfer, buy, dividend, card, out] = r.transactions;

    expect(transfer.type).toBe('transfer');
    expect(transfer.isTransfer).toBe(true);
    expect(transfer.amount).toBeCloseTo(110);
    expect(transfer.externalId).toBe('id-1');

    // amount + fee = -90.30 + (-1.00).
    expect(buy.type).toBe('trade');
    expect(buy.amount).toBeCloseTo(-91.3);

    // amount + tax = 38.33 + (-5.75) — чистый дивиденд после удержания налога.
    expect(dividend.type).toBe('dividend');
    expect(dividend.amount).toBeCloseTo(32.58);
    expect(dividend.currency).toBe('EUR');

    expect(card.type).toBe('card');
    expect(card.amount).toBeCloseTo(-18.07);

    expect(out.type).toBe('transfer');
    expect(out.amount).toBeCloseTo(-19);
    expect(out.counterpartyName).toBe('Jane Doe');
    expect(out.counterpartyIban).toBe('DE99888877776666555544');
  });
});

// XLSX-выписка Revolut: секции по счетам/валютам, даты — серийные числа Excel,
// в не-EUR суммах рядом с исходной печатается EUR-эквивалент "$X (€Y)".
const REV_XLSX_ROWS: string[][] = [
  ['Current Accounts Summaries'],
  ['Personal Account (EUR)'],
  ['Account Number (DE IBAN)', 'DE00111122223333444455'],
  ['Financial institution name', 'Revolut Bank UAB, Zweigniederlassung Deutschland'],
  ['---------'],
  ['Current Accounts Transaction Statements'],
  ['Personal Account (EUR)'],
  ['Transaction statement'],
  ['Date', 'Description', 'Category', 'Money in/out', 'Balance', 'Tax withheld', 'Other taxes', 'Fees'],
  ['44775', 'Payment from John Doe', 'Top up', '10.0', '10.0', '0.0', '0.0', '0.0'],
  ['44776', "McDonald's", 'Merchant', '-9.59', '0.41', '0.0', '0.0', '0.0'],
  ['44777', 'Exchanged to USD', 'Exchange', '-5.0', '-4.59', '0.0', '0.0', '0.0'],
  ['Total', '-4.59', '0.0', '0.0', '0.0'],
  ['---------'],
  ['Personal Account (USD)'],
  ['Transaction statement'],
  ['Date', 'Description', 'Category', 'Money in/out', 'Balance', 'Tax withheld', 'Other taxes', 'Fees'],
  ['44778', 'Carrefour', 'Merchant', '-$48.32 (-€41.23)', '$9,033.55 (€7,707.15)', '$0.00 (€0.00)', '$0.00 (€0.00)', '$0.48 (€0.41)'],
  ['Total', '$9,033.55 (€7,707.15)', '$0.00 (€0.00)', '$0.00 (€0.00)', '$0.48 (€0.41)'],
  ['---------'],
  ['Savings Accounts Transaction Statements'],
];

describe('Revolut XLSX parser', () => {
  it('детектирует формат', () => {
    expect(detectRevXlsx(REV_XLSX_ROWS)).toBe(true);
  });

  it('парсит секции по валютам, EUR-эквивалент и внутренний обмен', () => {
    const r = parseRevXlsx(REV_XLSX_ROWS);
    expect(r.account.bank).toBe('revolut');
    expect(r.account.ibans).toContain('DE00111122223333444455');
    expect(r.transactions).toHaveLength(4);

    const [topup, merchant, exchange, usd] = r.transactions;

    expect(topup.currency).toBe('EUR');
    expect(topup.amount).toBeCloseTo(10);
    expect(topup.isTransfer).toBe(true);
    expect(topup.counterpartyName).toBe('John Doe');

    expect(merchant.type).toBe('card');
    expect(merchant.amount).toBeCloseTo(-9.59);
    expect(merchant.counterpartyName).toBe("McDonald's");

    // Обмен валют — внутренний перевод на собственный счёт (по IBAN).
    expect(exchange.isTransfer).toBe(true);
    expect(exchange.counterpartyIban).toBe('DE00111122223333444455');

    // Не-EUR: исходная сумма + готовый EUR-эквивалент из выписки.
    expect(usd.currency).toBe('USD');
    expect(usd.amount).toBeCloseTo(-48.32);
    expect(usd.eurAmountHint).toBeCloseTo(-41.23);
    expect(usd.balanceAfter).toBeCloseTo(9033.55);
    expect(usd.type).toBe('card');
  });
});

describe('readXlsx', () => {
  it('читает ячейки: shared strings, числа, inline strings, XML-сущности', () => {
    const sharedStrings =
      '<?xml version="1.0"?><sst><si><t>Hello</t></si><si><t>World &amp; Co</t></si></sst>';
    const sheet =
      '<?xml version="1.0"?><worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>44775</v></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Inline</t></is></c></row>' +
      '</sheetData></worksheet>';
    const zip = zipSync({
      'xl/sharedStrings.xml': strToU8(sharedStrings),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    });
    const ab = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
    const rows = readXlsx(ab as ArrayBuffer);
    expect(rows[0]).toEqual(['Hello', 'World & Co', '44775']);
    expect(rows[1]).toEqual(['Inline']);
  });
});
