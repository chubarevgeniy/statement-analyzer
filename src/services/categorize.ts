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
