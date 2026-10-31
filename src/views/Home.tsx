import { useEffect, useState } from 'preact/hooks';
import { ensureSession, rpc, supabase } from '../supabase';
import { go } from '../router';
import type { GameMode, Variant } from '../types';
import { ErrorNote, Page, store, useAction } from '../ui';

export function Home() {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [startupError, setStartupError] = useState<string | null>(null);
  useEffect(() => {
    ensureSession()
      .then(() => supabase.from('variants').select('*').order('id'))
      .then(({ data, error }) => (error ? setStartupError(error.message) : setVariants((data ?? []) as Variant[])))
      .catch((e) => setStartupError(e.message));
  }, []);

  const last = store.get('lastGame');
  const lastRole = store.get('lastRole');

  return (
    <Page title="🐺 Werewolf Party">
      <ErrorNote message={startupError} />
      {last && (
        <section class="card">
          <a class="button" href={`#/${lastRole === 'gm' ? 'gm' : 'g'}/${last}`}>
            Resume your game{lastRole === 'gm' ? ' (as Game Master)' : ''}
          </a>
        </section>
      )}
      <JoinCard />
      <HostCard variants={variants} />
      <GmSignIn />
      <p class="muted center"><a href="#/cards">Print role cards (NFC / QR)</a></p>
    </Page>
  );
}

function JoinCard() {
  const [code, setCode] = useState('');
  const [name, setName] = useState(store.get('name'));
  const { busy, error, run } = useAction();
  async function submit(e: Event) {
    e.preventDefault();
    await run(async () => {
      await ensureSession();
      const r = await rpc<{ game_id: string }>('join_game', { p_code: code, p_name: name });
      store.set('name', name); store.set('lastGame', r.game_id); store.set('lastRole', 'player');
      go(`/g/${r.game_id}`);
    });
  }
  return (
    <form class="card" onSubmit={submit}>
      <h2>Join a game</h2>
      <label>Game code
        <input value={code} maxLength={4} autoCapitalize="characters" placeholder="ABCD"
          onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())} />
      </label>
      <label>Your name
        <input value={name} maxLength={30} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <button disabled={busy || code.length < 4 || !name.trim()}>Join</button>
      <ErrorNote message={error} />
    </form>
  );
}

const MODES: { id: GameMode; title: string; text: string }[] = [
  {
    id: 'role_tokens', title: 'Physical role cards',
    text: 'Each card has an NFC tag (or QR) holding a role. Players pick a card, tap it, and see their role and what it does. If a role goes unpicked, a villager is promoted into it when you start.',
  },
  { id: 'none', title: 'No cards', text: 'Players join with the game code and the app deals roles randomly.' },
];

function HostCard({ variants }: { variants: Variant[] }) {
  const [variant, setVariant] = useState('classic');
  const [dayMin, setDayMin] = useState(45);
  const [nightMin, setNightMin] = useState(10);
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<GameMode>('role_tokens');
  const { busy, error, run } = useAction();
  async function submit(e: Event) {
    e.preventDefault();
    await run(async () => {
      await ensureSession();
      const r = await rpc<{ game_id: string }>('create_game', {
        p_variant: variant, p_day_seconds: Math.round(dayMin * 60), p_night_seconds: Math.round(nightMin * 60),
        p_pin: pin, p_mode: mode,
      });
      store.set('lastGame', r.game_id); store.set('lastRole', 'gm');
      go(`/gm/${r.game_id}`);
    });
  }
  return (
    <form class="card" onSubmit={submit}>
      <h2>Host a game</h2>
      <label>Version
        <select value={variant} onChange={(e) => setVariant((e.target as HTMLSelectElement).value)}>
          {variants.map((v) => <option key={v.id} value={v.id}>{v.name} — {v.description}</option>)}
        </select>
      </label>
      <div class="row">
        <label>Day (minutes)
          <input type="number" min={1} max={1440} value={dayMin}
            onInput={(e) => setDayMin(Number((e.target as HTMLInputElement).value))} />
        </label>
        <label>Night (minutes)
          <input type="number" min={1} max={1440} value={nightMin}
            onInput={(e) => setNightMin(Number((e.target as HTMLInputElement).value))} />
        </label>
      </div>
      <label>GM PIN (4+ characters, lets you recover the GM seat)
        <input value={pin} onInput={(e) => setPin((e.target as HTMLInputElement).value)} />
      </label>
      <fieldset class="modes">
        <legend>How do players get their roles?</legend>
        {MODES.map((m) => (
          <label key={m.id} class="check mode">
            <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
            <span><strong>{m.title}</strong><br /><span class="muted">{m.text}</span></span>
          </label>
        ))}
      </fieldset>
      <button disabled={busy || pin.length < 4}>Create game</button>
      <ErrorNote message={error} />
    </form>
  );
}

function GmSignIn() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const { busy, error, run } = useAction();
  if (!open) {
    return (
      <p class="muted center">
        <a href="#/" onClick={(e) => { e.preventDefault(); setOpen(true); }}>I'm a Game Master on a new device</a>
      </p>
    );
  }
  async function submit(e: Event) {
    e.preventDefault();
    await run(async () => {
      await ensureSession();
      const id = await rpc<string>('claim_gm', { p_code: code, p_pin: pin });
      store.set('lastGame', id); store.set('lastRole', 'gm');
      go(`/gm/${id}`);
    });
  }
  return (
    <form class="card" onSubmit={submit}>
      <h2>Recover the GM seat</h2>
      <label>Game code
        <input value={code} maxLength={4} onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())} />
      </label>
      <label>GM PIN
        <input value={pin} onInput={(e) => setPin((e.target as HTMLInputElement).value)} />
      </label>
      <button disabled={busy || code.length < 4 || pin.length < 4}>Take over as GM</button>
      <ErrorNote message={error} />
    </form>
  );
}
