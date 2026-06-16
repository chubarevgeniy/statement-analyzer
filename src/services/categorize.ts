import type { StoredTxn } from '../types';
import { updateTxnCategory } from '../db/transactionsDb';
import { putMapping } from '../db/categoriesDb';
import { categoryKey } from './categoryKey';

/** Назначает категорию операции и запоминает маппинг для будущих импортов. */
export async function assignCategory(t: StoredTxn, categoryId: string | null): Promise<void> {
  await updateTxnCategory(t.id, categoryId);
  if (categoryId && !t.isTransfer) {
    const key = categoryKey(t);
    if (key) await putMapping({ key, categoryId });
  }
}

/**
 * Массово назначает категорию набору операций (для групповых действий на вкладке
 * «Транзакции»). Маппинги по ключам сохраняются один раз — чтобы будущие импорты и
 * «обновление» однотипных операций попадали в ту же категорию.
 */
export async function assignCategoryBulk(
  txns: StoredTxn[],
  categoryId: string | null,
): Promise<void> {
  for (const t of txns) await updateTxnCategory(t.id, categoryId);
  if (categoryId) {
    const keys = new Set<string>();
    for (const t of txns) {
      if (t.isTransfer) continue;
      const key = categoryKey(t);
      if (key) keys.add(key);
    }
    for (const key of keys) await putMapping({ key, categoryId });
  }
}

/**
 * Применяет назначения категорий по ключам сразу к набору операций
 * (используется групповым «разбором как при импорте» и ИИ-категоризацией).
 */
export async function applyChoicesToTxns(
  txns: StoredTxn[],
  categoryByKey: Map<string, string>,
): Promise<void> {
  for (const t of txns) {
    if (t.isTransfer) continue;
    const key = categoryKey(t);
    const categoryId = categoryByKey.get(key);
    if (categoryId) await updateTxnCategory(t.id, categoryId);
  }
  for (const [key, categoryId] of categoryByKey) await putMapping({ key, categoryId });
}
