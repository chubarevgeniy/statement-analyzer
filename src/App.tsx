import { useState } from 'react';
import { useAppData } from './ui/useAppData';
import { ImportPanel } from './components/ImportPanel';
import { Dashboard } from './components/Dashboard';
import { TransactionsTable } from './components/TransactionsTable';
import { SettingsPanel } from './components/SettingsPanel';

type Tab = 'dashboard' | 'import' | 'transactions' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Дашборд' },
  { id: 'import', label: 'Импорт' },
  { id: 'transactions', label: 'Транзакции' },
  { id: 'settings', label: 'Настройки' },
];

export default function App() {
  const data = useAppData();
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="app">
      <header>
        <h1>Анализатор выписок</h1>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
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
          />
        ) : tab === 'import' ? (
          <ImportPanel categories={data.categories} onImported={data.reload} />
        ) : tab === 'transactions' ? (
          <TransactionsTable
            txns={data.txns}
            accounts={data.accounts}
            categories={data.categories}
            onChange={data.reload}
          />
        ) : (
          <SettingsPanel
            categories={data.categories}
            mappings={data.mappings}
            accounts={data.accounts}
            statements={data.statements}
            onChange={data.reload}
          />
        )}
      </main>

      <footer className="muted small">
        Все данные хранятся локально в вашем браузере (IndexedDB). Ничего не отправляется на сервер.
      </footer>
    </div>
  );
}
