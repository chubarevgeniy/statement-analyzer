import { describe, it, expect } from 'vitest';
import { parse as parseDB, detect as detectDB } from '../deutscheBank';
import { parse as parseTR, detect as detectTR } from '../tradeRepublic';
import { parse as parseRev, detect as detectRev } from '../revolut';

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
