import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export const store = {
  get(key: string): string {
    try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

/** After tapping a role tag, show the role straight away on the next screen (once). */
export function flagReveal() {
  try { sessionStorage.setItem('reveal', '1'); } catch { /* private mode */ }
}
export function consumeReveal(): boolean {
  try {
    const on = sessionStorage.getItem('reveal') === '1';
    sessionStorage.removeItem('reveal');
    return on;
  } catch { return false; }
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

export function Countdown({ endsAt }: { endsAt: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!endsAt) return null;
  const left = new Date(endsAt).getTime() - now;
  return <span class={`clock${left <= 0 ? ' over' : ''}`}>{left <= 0 ? "Time's up" : fmtClock(left)}</span>;
}

export function Page({ title, children, back }: { title?: string; children: ComponentChildren; back?: string }) {
  return (
    <main class="page">
      {back && <a class="back" href={`#${back}`}>← Back</a>}
      {title && <h1>{title}</h1>}
      {children}
    </main>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <p class="error" role="alert">{message}</p> : null;
}

/** Runs an async action and exposes busy/error state for buttons and forms. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try { return await fn(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return { busy, error, run, setError };
}
