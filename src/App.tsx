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
  { id: 'transactions', label: 'Транзакции', icon: IconList },
  { id: 'settings', label: 'Настройки', icon: IconSettings },
];

export default function App() {
  const data = useAppData();
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [categoryFilter, setCategoryFilter] = useState<string | null | undefined>(undefined);

  function goToCategory(categoryId: string | null) {
    setCategoryFilter(categoryId);
    setTab('transactions');
  }

  function renderNav(className: string) {
    return (
      <nav className={className}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              <Icon className="nav-icon" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>Анализатор выписок</h1>
        {renderNav('nav-top')}
      </header>

      <main>
        {data.loading ? (
          <p className="muted">Загрузка…</p>
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
            onImported={data.reload}
          />
        ) : tab === 'transactions' ? (
          <TransactionsTable
            txns={data.txns}
            accounts={data.accounts}
            categories={data.categories}
            settings={data.settings}
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

      {renderNav('nav-bottom')}

      <footer className="muted small">
        Все данные хранятся локально в вашем браузере (IndexedDB). Ничего не отправляется на
        сервер.
      </footer>
    </div>
  );
}
