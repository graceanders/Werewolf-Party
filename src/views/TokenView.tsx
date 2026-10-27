import { useEffect, useState } from 'preact/hooks';
import { ensureSession, rpc, supabase } from '../supabase';
import { go } from '../router';
import { ErrorNote, Page, store, useAction } from '../ui';

interface TapResult { status: 'ok' | 'mine' | 'taken'; game_id: string }

/** Landing page for an NFC tag or QR code: https://…/#/t/<token>. */
export function TokenView({ token }: { token: string }) {
  const [phase, setPhase] = useState<'working' | 'ask' | 'taken'>('working');
  const [code, setCode] = useState('');
  const [name, setName] = useState(store.get('name'));
  const { busy, error, run, setError } = useAction();

  async function tap(gameCode: string, playerName: string | null) {
    const r = await rpc<TapResult>('tap_token', { p_code: gameCode, p_token: token, p_name: playerName });
    if (r.status === 'taken') { setPhase('taken'); return; }
    store.set('lastGame', r.game_id); store.set('lastRole', 'player');
    go(`/g/${r.game_id}`);
  }

  useEffect(() => {
    (async () => {
      try {
        const uid = await ensureSession();
        // Already in a running game on this device? Use it, no typing needed.
        const { data } = await supabase.from('players')
          .select('game_id, games!inner(code, status)').eq('user_id', uid)
          .neq('games.status', 'ended').order('joined_at', { ascending: false }).limit(1);
        const game = (data?.[0] as unknown as { games: { code: string } } | undefined)?.games;
        if (game) await tap(game.code, null);
        else setPhase('ask');
      } catch (e) {
        setError((e as Error).message);
        setPhase('ask');
      }
    })();
  }, [token]);

  async function submit(e: Event) {
    e.preventDefault();
    await run(async () => { store.set('name', name); await tap(code, name); });
  }

  if (phase === 'working') return <Page title="Reading token…"><ErrorNote message={error} /></Page>;
  if (phase === 'taken') {
    return (
      <Page title="Token already claimed">
        <section class="card">
          <p>Someone else has already picked up this token. Grab a different one.</p>
          <p class="muted">If this is your token and you changed phone or browser, ask the Game Master to unlink your device, then tap it again.</p>
          <a class="button" href="#/">Home</a>
        </section>
      </Page>
    );
  }
  return (
    <Page title="Check in with your token">
      <form class="card" onSubmit={submit}>
        <p class="muted">Enter the game code and your name. Your role stays secret until the game starts.</p>
        <label>Game code
          <input value={code} maxLength={4} autoCapitalize="characters"
            onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())} />
        </label>
        <label>Your name
          <input value={name} maxLength={30} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <button disabled={busy || code.length < 4 || !name.trim()}>Claim token</button>
        <ErrorNote message={error} />
      </form>
    </Page>
  );
}
