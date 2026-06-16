import { parseStatement } from '../parsers';
import type { ParsedTxn } from '../parsers/types';
import { normalizeName } from '../parsers/util';
import type { Account, Bank, Mapping, StatementMeta, StoredTxn } from '../types';
import {
  getAllAccounts,
  getAllTxns,
  getStatement,
  putAccounts,
  putStatement,
  putTxns,
} from '../db/transactionsDb';
import { getMappings, putMapping } from '../db/categoriesDb';
import { computeStatementId, computeTxnId } from './dedup';
import { autoCategoryId, categoryKey, suggestedKind } from './categoryKey';

export interface UnknownKey {
  key: string;
  sampleDescription: string;
  suggestedKind: 'income' | 'expense';
  count: number;
  /** Поля одной из операций — для крупного отображения карточки в UI. */
  sampleDate: string;
  sampleAmount: number;
  sampleCurrency: string;
  sampleBank: Bank;
  sampleAccountIban: string;
}

export interface FxNeed {
  currency: string;
  date: string;
}

export interface ImportPrep {
  fileName: string;
  bank: Bank;
  accounts: Account[];
  statementId: string;
  /** Только новые (не дублирующиеся) черновики транзакций. */
  drafts: StoredTxn[];
  fxNeeds: FxNeed[];
  unknownKeys: UnknownKey[];
  newCount: number;
  duplicateCount: number;
  alreadyImported: boolean;
  periodStart?: string;
  periodEnd?: string;
}

/** Парсит текст выписки и готовит черновики транзакций к импорту. */
export async function prepareImport(text: string, fileName: string): Promise<ImportPrep> {
  const res = parseStatement(text);
  const bank = res.account.bank;
  const owner = res.account.holderName ? normalizeName(res.account.holderName) : 'неизвестно';
  const primaryIban = res.account.ibans[0] ?? `${bank}-unknown`;

  const accounts: Account[] = (res.account.ibans.length ? res.account.ibans : [primaryIban]).map(
    (iban) => ({ iban, holderName: res.account.holderName, owner, bank }),
  );

  const [existingTxns, mappings] = await Promise.all([getAllTxns(), getMappings()]);
  const existingIds = new Set(existingTxns.map((t) => t.id));
  const mapByKey = new Map<string, Mapping>(mappings.map((m) => [m.key, m]));

  const allIds: string[] = [];
  const drafts: StoredTxn[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  const fxNeedSet = new Map<string, FxNeed>();
  const unknownMap = new Map<string, UnknownKey>();

  for (const t of res.transactions) {
    const id = computeTxnId(bank, primaryIban, t);
    allIds.push(id);
    if (existingIds.has(id) || seen.has(id)) {
      duplicateCount++;
      continue;
    }
    seen.add(id);

    const { eurAmount, fxRate, needsFx } = resolveEur(t);
    if (needsFx) fxNeedSet.set(`${t.currency}:${t.bookingDate}`, { currency: t.currency, date: t.bookingDate });

    let categoryId = autoCategoryId(t.type);
    if (categoryId == null && !t.isTransfer) {
      const key = categoryKey(t);
      const mapped = mapByKey.get(key);
      if (mapped) {
        categoryId = mapped.categoryId;
      } else if (key) {
        const u = unknownMap.get(key);
        if (u) u.count++;
        else
          unknownMap.set(key, {
            key,
            sampleDescription: t.counterpartyName ?? t.rawDescription,
            suggestedKind: suggestedKind(t),
            count: 1,
            sampleDate: t.bookingDate,
            sampleAmount: t.amount,
            sampleCurrency: t.currency,
            sampleBank: bank,
            sampleAccountIban: primaryIban,
          });
      }
    }

    drafts.push({
      id,
      bank,
      accountIban: primaryIban,
      accountOwner: owner,
      currency: t.currency,
      bookingDate: t.bookingDate,
      valueDate: t.valueDate,
      amount: t.amount,
      eurAmount,
      fxRate,
      rawDescription: t.rawDescription,
      counterpartyName: t.counterpartyName,
      counterpartyIban: t.counterpartyIban,
      type: t.type,
      isTransfer: t.isTransfer,
      balanceAfter: t.balanceAfter,
      categoryId,
      statementId: '', // проставим ниже
    });
  }

  const statementId = computeStatementId(bank, allIds);
  for (const d of drafts) d.statementId = statementId;

  const alreadyImported =
    (await getStatement(statementId)) != null || (drafts.length === 0 && duplicateCount > 0);

  return {
    fileName,
    bank,
    accounts,
    statementId,
    drafts,
    fxNeeds: Array.from(fxNeedSet.values()),
    unknownKeys: Array.from(unknownMap.values()).sort((a, b) => b.count - a.count),
    newCount: drafts.length,
    duplicateCount,
    alreadyImported,
    periodStart: res.periodStart,
    periodEnd: res.periodEnd,
  };
}

function resolveEur(t: ParsedTxn): { eurAmount: number; fxRate: number; needsFx: boolean } {
  if (t.currency === 'EUR') return { eurAmount: t.amount, fxRate: 1, needsFx: false };
  if (t.eurAmountHint != null) {
    const rate = t.amount !== 0 ? t.eurAmountHint / t.amount : 1;
    return { eurAmount: t.eurAmountHint, fxRate: rate, needsFx: false };
  }
  return { eurAmount: NaN, fxRate: NaN, needsFx: true };
}

export interface CommitOptions {
  /** Курсы для не-EUR операций без готового эквивалента: ключ `${currency}:${date}` → rate. */
  fxRates?: Map<string, number>;
  /** Назначения категорий для ранее неизвестных ключей. */
  categoryByKey?: Map<string, string>;
}

/** Применяет решения пользователя и записывает импорт в БД. Возвращает число добавленных. */
export async function commitImport(prep: ImportPrep, opts: CommitOptions = {}): Promise<number> {
  const { fxRates, categoryByKey } = opts;
  const newMappings: Mapping[] = [];

  for (const d of prep.drafts) {
    if (Number.isNaN(d.eurAmount)) {
      const rate = fxRates?.get(`${d.currency}:${d.bookingDate}`);
      if (rate != null) {
        d.eurAmount = d.amount * rate;
        d.fxRate = rate;
      } else {
        d.eurAmount = d.amount; // запасной вариант: считаем 1:1
        d.fxRate = 1;
      }
    }
    if (d.categoryId == null && !d.isTransfer && categoryByKey) {
      const key = categoryKey(d);
      const cat = categoryByKey.get(key);
      if (cat) {
        d.categoryId = cat;
        newMappings.push({ key, categoryId: cat });
      }
    }
  }

  // Дозаписываем счета (мерджим владельца с уже известными).
  const existingAccounts = await getAllAccounts();
  const accMap = new Map(existingAccounts.map((a) => [a.iban, a]));
  for (const a of prep.accounts) accMap.set(a.iban, a);

  await putAccounts(Array.from(accMap.values()));
  for (const m of dedupeMappings(newMappings)) await putMapping(m);
  await putTxns(prep.drafts);

  const meta: StatementMeta = {
    id: prep.statementId,
    bank: prep.bank,
    fileName: prep.fileName,
    importedAt: Date.now(),
    txnCount: prep.drafts.length,
    periodStart: prep.periodStart,
    periodEnd: prep.periodEnd,
  };
  await putStatement(meta);

  return prep.drafts.length;
}

function dedupeMappings(mappings: Mapping[]): Mapping[] {
  const m = new Map<string, Mapping>();
  for (const x of mappings) m.set(x.key, x);
  return Array.from(m.values());
}
