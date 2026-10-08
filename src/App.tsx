import { useEffect } from 'react';
import { useData } from './lib/store.ts';
import { startSync } from './lib/sync.ts';
import { DEFAULT_CATEGORIES } from './lib/categories.ts';
import { DEFAULT_SETTINGS } from './lib/hooks.ts';
import { useRoute } from './lib/ui.ts';
import { DepositWatcher, SheetHost, Sidebar, TabBar, Toaster } from './components/Shell.tsx';
import { Today } from './screens/Today.tsx';
import { Earnings } from './screens/Earnings.tsx';
import { Spending } from './screens/Spending.tsx';
import { Jobs } from './screens/Jobs.tsx';
import { Settings } from './screens/Settings.tsx';
import { Plan } from './screens/Plan.tsx';
import { Bank } from './screens/Bank.tsx';
import { Categories } from './screens/Categories.tsx';
import { Insights } from './screens/Insights.tsx';
import { Review } from './screens/Review.tsx';

let booted = false;

async function boot() {
  if (booted) return;
  booted = true;
  const store = useData.getState();
  await store.load();
  for (const c of DEFAULT_CATEGORIES) store.seed('categories', c);
  store.seed('settings', DEFAULT_SETTINGS);
  startSync();
}

export default function App() {
  const ready = useData((s) => s.ready);
  const route = useRoute();
  useEffect(() => void boot(), []);

  if (!ready) return <div className="min-h-dvh bg-page" />;

  return (
    <div className="min-h-dvh bg-page text-ink">
      <Sidebar route={route} />
      <main className="lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 pt-[max(env(safe-area-inset-top),16px)] pb-[calc(env(safe-area-inset-bottom)+152px)] sm:px-6 lg:px-10 lg:pt-8 lg:pb-16">
          {route === 'today' && <Today />}
          {route === 'earnings' && <Earnings />}
          {route === 'insights' && <Insights />}
          {route === 'spending' && <Spending />}
          {route === 'jobs' && <Jobs />}
          {route === 'settings' && <Settings />}
          {route === 'plan' && <Plan />}
          {route === 'bank' && <Bank />}
          {route === 'categories' && <Categories />}
          {route === 'review' && <Review />}
        </div>
      </main>
      <TabBar route={route} />
      <SheetHost />
      <Toaster />
      <DepositWatcher />
    </div>
  );
}
