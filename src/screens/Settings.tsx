import { useRef } from 'react';
import { ArrowLeft, Briefcase, ChevronRight, Download, Landmark, RefreshCw, Store, Tags, Upload } from 'lucide-react';
import type { BaseRecord, Change, CollectionName } from '../../shared/types.ts';
import { COLLECTIONS } from '../../shared/types.ts';
import { useData } from '../lib/store.ts';
import { syncNow, useSync } from '../lib/sync.ts';
import { useSettings } from '../lib/hooks.ts';
import { go, toast, useTheme, type ThemePref } from '../lib/ui.ts';
import { clock, dayLabel } from '../lib/format.ts';
import { Card, Segmented, SectionTitle } from '../components/ui.tsx';
import { SyncBadge } from '../components/SyncBadge.tsx';

function exportData() {
  const t = useData.getState().t;
  const out: Change[] = [];
  for (const c of COLLECTIONS) for (const rec of Object.values(t[c])) out.push({ c, rec });
  const blob = new Blob([JSON.stringify({ app: 'clocked', version: 1, exportedAt: new Date().toISOString(), records: out }, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `clocked-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file: File) {
  const parsed = JSON.parse(await file.text()) as { app?: string; records?: Change[] };
  if (parsed.app !== 'clocked' || !Array.isArray(parsed.records)) throw new Error('That file isn’t a Clocked backup.');
  const { t, put } = useData.getState();
  let n = 0;
  for (const { c, rec } of parsed.records) {
    if (!(COLLECTIONS as readonly string[]).includes(c) || !rec?.id) continue;
    const have = t[c as CollectionName][rec.id] as BaseRecord | undefined;
    if (have && have.updatedAt >= rec.updatedAt) continue;
    put(c as CollectionName, rec as never);
    n += 1;
  }
  return n;
}

export function Settings() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const put = useData((s) => s.put);
  const sync = useSync();
  const file = useRef<HTMLInputElement>(null);

  return (
    <div className="max-w-2xl">
      <header className="flex items-center gap-3 py-2">
        <button onClick={() => go('today')} aria-label="Back" className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink lg:hidden">
          <ArrowLeft size={19} />
        </button>
        <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">Settings</h1>
      </header>

      <SectionTitle>Look</SectionTitle>
      <Card className="space-y-5 p-5">
        <div>
          <span className="label">Theme on this device</span>
          <Segmented<ThemePref>
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <div>
          <span className="label">Weeks start on</span>
          <Segmented<'1' | '0'>
            label="Week start"
            value={String(settings.weekStartsOn) as '1' | '0'}
            onChange={(v) => put('settings', { ...settings, weekStartsOn: v === '0' ? 0 : 1 })}
            options={[
              { value: '1', label: 'Monday' },
              { value: '0', label: 'Sunday' },
            ]}
          />
        </div>
      </Card>

      <SectionTitle>Money</SectionTitle>
      <Card className="space-y-5 p-5">
        <button onClick={() => go('jobs')} className="flex w-full items-center gap-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised">
            <Briefcase size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Jobs</span>
            <span className="block text-[13px] text-ink-2">Your pay, schedules, and gig work</span>
          </span>
          <ChevronRight size={18} className="text-ink-3" />
        </button>
        <button onClick={() => go('bank')} className="flex w-full items-center gap-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised">
            <Landmark size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Bank connection</span>
            <span className="block text-[13px] text-ink-2">Bring in bank transactions through Plaid</span>
          </span>
          <ChevronRight size={18} className="text-ink-3" />
        </button>
        <button onClick={() => go('review')} className="flex w-full items-center gap-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised">
            <Store size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Bank transactions</span>
            <span className="block text-[13px] text-ink-2">
              {settings.trackFrom ? `Counting from ${dayLabel(settings.trackFrom)}. ` : ''}Rename, hide, or tie them to bills
            </span>
          </span>
          <ChevronRight size={18} className="text-ink-3" />
        </button>
        <button onClick={() => go('categories')} className="flex w-full items-center gap-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised">
            <Tags size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Categories</span>
            <span className="block text-[13px] text-ink-2">Add, rename, or remove spending categories</span>
          </span>
          <ChevronRight size={18} className="text-ink-3" />
        </button>
        <div>
          <span className="label">Spread set-asides over</span>
          <Segmented<'workdays' | 'everyday'>
            label="Spread set-asides over"
            value={settings.billSpread ?? 'workdays'}
            onChange={(v) => put('settings', { ...settings, billSpread: v })}
            options={[
              { value: 'workdays', label: 'Days I work' },
              { value: 'everyday', label: 'Every day' },
            ]}
          />
          <p className="mt-1.5 text-[13px] text-ink-3">For bills, savings, and wish list. Days you work are days you're scheduled, including paid days off.</p>
        </div>
      </Card>

      <SectionTitle>Sync</SectionTitle>
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <SyncBadge withLabel />
          <button className="btn btn-sm btn-secondary" onClick={() => void syncNow()}>
            <RefreshCw size={15} /> Sync now
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-ink-2">Server</dt>
          <dd className="truncate text-right">{location.host}</dd>
          <dt className="text-ink-2">Last synced</dt>
          <dd className="num text-right">{sync.lastSync ? clock(sync.lastSync) : 'Not yet'}</dd>
          <dt className="text-ink-2">Waiting to send</dt>
          <dd className="num text-right">{sync.pending}</dd>
        </dl>
        {sync.error && <p className="mt-3 text-[13px] text-spend">{sync.error}</p>}
        <p className="mt-4 text-[13px] text-ink-2">
          Your data lives on your home server and on each device. Changes made offline sync when you're back on Tailscale.
        </p>
      </Card>

      <SectionTitle>Your data</SectionTitle>
      <Card className="flex flex-wrap gap-2 p-5">
        <button className="btn btn-secondary" onClick={exportData}>
          <Download size={17} /> Export backup
        </button>
        <button className="btn btn-secondary" onClick={() => file.current?.click()}>
          <Upload size={17} /> Restore from file
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const n = await importData(f);
              toast({ title: n ? `Restored ${n} records` : 'Nothing new in that file' });
            } catch (err) {
              toast({ title: 'Couldn’t restore', detail: err instanceof Error ? err.message : String(err) });
            }
          }}
        />
        <p className="w-full pt-1 text-[13px] text-ink-2">The server also keeps two weeks of daily backups.</p>
      </Card>

      <p className="mt-8 text-center text-[12px] text-ink-3">Clocked {__APP_VERSION__}</p>
    </div>
  );
}
