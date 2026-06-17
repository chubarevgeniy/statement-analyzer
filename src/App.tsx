import { useState } from 'react';
import { useAppData } from './ui/useAppData';
import { useTheme } from './ui/theme';
import { ImportPanel } from './components/ImportPanel';
import { Dashboard } from './components/Dashboard';
import { TransactionsTable } from './components/TransactionsTable';
import { SettingsPanel } from './components/SettingsPanel';
import { IconDashboard, IconImport, IconList, IconSettings } from './ui/icons';

type Tab = 'dashboard' | 'import' | 'transactions' | 'settings';

const TABS: { id: Tab; label: string; icon: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'dashboard', label: 'Дашборд', icon: IconDashboard },
  { id: 'import', label: 'Импорт', icon: IconImport },
  { id: 'transactions', label: 'Операции', icon: IconList },
  { id: 'settings', label: 'Ещё', icon: IconSettings },
];

const TITLES: Record<Tab, string> = {
  dashboard: 'Дашборд',
  import: 'Импорт',
  transactions: 'Операции',
  settings: 'Настройки',
};

export default function App() {
  const data = useAppData();
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [categoryFilter, setCategoryFilter] = useState<string | null | undefined>(undefined);

  function goToCategory(categoryId: string | null) {
    setCategoryFilter(categoryId);
    setTab('transactions');
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <span className="app-subtitle">Анализатор выписок</span>
          <h1 className="app-title">{TITLES[tab]}</h1>
        </div>
      </header>

      <main className="app-main">
        {data.loading ? (
          <div className="screen">
            <p className="muted">Загрузка…</p>
          </div>
        ) : tab === 'dashboard' ? (
          <Dashboard
            txns={data.txns}
            accounts={data.accounts}
            categories={data.categories}
            settings={data.settings}
            onSettingsChange={data.reload}
            onViewCategory={goToCategory}
            theme={theme.resolved}
          />
        ) : tab === 'import' ? (
          <ImportPanel
            categories={data.categories}
            accounts={data.accounts}
            settings={data.settings}
            mappings={data.mappings}
            onImported={data.reload}
          />
        ) : tab === 'transactions' ? (
          <TransactionsTable
            txns={data.txns}
            accounts={data.accounts}
            categories={data.categories}
            settings={data.settings}
            mappings={data.mappings}
            onChange={data.reload}
            presetCategoryId={categoryFilter}
          />
        ) : (
          <SettingsPanel
            categories={data.categories}
            mappings={data.mappings}
            accounts={data.accounts}
            statements={data.statements}
            settings={data.settings}
            onChange={data.reload}
            themeMode={theme.mode}
            onThemeModeChange={theme.setMode}
          />
        )}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="tab-icon">
                <Icon />
              </span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
