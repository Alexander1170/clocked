import { create } from 'zustand';
import { useEffect, useState } from 'react';
import type { LocalDate } from '../../shared/types.ts';

// ---- Sheets (modal panels) -------------------------------------------------

export type SheetSpec =
  | { kind: 'add' }
  | { kind: 'expense'; id?: string; date?: LocalDate }
  | { kind: 'gig'; id?: string; jobId?: string; date?: LocalDate }
  | { kind: 'order'; id: string }
  | { kind: 'endDash'; id: string }
  | { kind: 'day'; jobId: string; date: LocalDate }
  | { kind: 'job'; id?: string; type?: 'scheduled' | 'gig' }
  | { kind: 'bill'; id?: string; fromTx?: string };

export const useSheets = create<{
  stack: SheetSpec[];
  open(s: SheetSpec): void;
  replace(s: SheetSpec): void;
  close(): void;
}>()((set) => ({
  stack: [],
  open: (s) => set((st) => ({ stack: [...st.stack, s] })),
  replace: (s) => set((st) => ({ stack: [...st.stack.slice(0, -1), s] })),
  close: () => set((st) => ({ stack: st.stack.slice(0, -1) })),
}));

export const openSheet = (s: SheetSpec) => useSheets.getState().open(s);
export const closeSheet = () => useSheets.getState().close();

// ---- Toasts ----------------------------------------------------------------

export interface Toast {
  id: number;
  title: string;
  detail?: string;
  tone?: 'money' | 'plain';
}

let toastId = 0;
export const useToasts = create<{ toasts: Toast[]; push(t: Omit<Toast, 'id'>): void; dismiss(id: number): void }>()((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 3800);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = (t: Omit<Toast, 'id'>) => useToasts.getState().push(t);

// ---- Theme (per device, not synced) ----------------------------------------

export type ThemePref = 'system' | 'light' | 'dark';
const THEME_KEY = 'clocked.theme';

function readTheme(): ThemePref {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(t: ThemePref) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0A0B0D' : '#F3F4F6'));
}

export const useTheme = create<{ theme: ThemePref; setTheme(t: ThemePref): void }>()((set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode */
    }
    applyTheme(theme);
    set({ theme });
  },
}));

export function initTheme() {
  applyTheme(useTheme.getState().theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(useTheme.getState().theme));
}

// ---- Routing (hash based, works offline and in the installed app) ----------

export type Route = 'today' | 'earnings' | 'spending' | 'jobs' | 'settings' | 'bills' | 'bank';
const ROUTES: Route[] = ['today', 'earnings', 'spending', 'jobs', 'settings', 'bills', 'bank'];

function readRoute(): Route {
  const r = location.hash.replace(/^#\/?/, '').split('?')[0] as Route;
  return ROUTES.includes(r) ? r : 'today';
}

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(route: Route) {
  location.hash = route === 'today' ? '/' : `/${route}`;
}
