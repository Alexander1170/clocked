import clsx from 'clsx';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useSync } from '../lib/sync.ts';
import { go } from '../lib/ui.ts';

export function SyncBadge({ withLabel }: { withLabel?: boolean }) {
  const { status, pending } = useSync();
  const bad = status === 'offline' || status === 'error';
  const label =
    status === 'syncing' ? 'Syncing' : status === 'offline' ? 'Offline' : status === 'error' ? 'Can’t reach server' : pending ? `${pending} to sync` : 'Synced';
  const Icon = bad ? CloudOff : status === 'syncing' ? RefreshCw : Cloud;
  return (
    <button
      onClick={() => go('settings')}
      aria-label={`Sync: ${label}`}
      title={label}
      className={clsx(
        'flex h-10 items-center gap-2 rounded-full bg-card text-[13px] font-medium',
        withLabel ? 'px-3.5' : 'w-10 justify-center',
        bad ? 'text-spend' : 'text-ink-3',
      )}
    >
      <Icon size={17} className={clsx(status === 'syncing' && 'animate-spin')} />
      {withLabel && <span>{label}</span>}
    </button>
  );
}
