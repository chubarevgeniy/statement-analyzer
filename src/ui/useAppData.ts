import { useCallback, useEffect, useState } from 'react';
import type { Account, Category, Mapping, Settings, StatementMeta, StoredTxn } from '../types';
import { getAllAccounts, getAllStatements, getAllTxns } from '../db/transactionsDb';
import { ensureSeeded, getCategories, getMappings, getSettings } from '../db/categoriesDb';

export interface AppData {
  txns: StoredTxn[];
  accounts: Account[];
  statements: StatementMeta[];
  categories: Category[];
  mappings: Mapping[];
  settings: Settings;
}

export interface UseAppData extends AppData {
  loading: boolean;
  reload: () => Promise<void>;
}

const EMPTY: AppData = {
  txns: [],
  accounts: [],
  statements: [],
  categories: [],
  mappings: [],
  settings: { key: 'app', excludedCategoryIds: ['internal', 'savings'], selectedOwners: [] },
};

export function useAppData(): UseAppData {
  const [data, setData] = useState<AppData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    await ensureSeeded();
    const [txns, accounts, statements, categories, mappings, settings] = await Promise.all([
      getAllTxns(),
      getAllAccounts(),
      getAllStatements(),
      getCategories(),
      getMappings(),
      getSettings(),
    ]);
    setData({ txns, accounts, statements, categories, mappings, settings });
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...data, loading, reload };
}
