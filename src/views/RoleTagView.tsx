import { useEffect, useState } from 'preact/hooks';
import { ensureSession, rpc, supabase } from '../supabase';
import { go } from '../router';
import { ErrorNote, Page, flagReveal, store, useAction } from '../ui';

interface TapResult { status: 'assigned' | 'already'; game_id: string; role: string }

/** Landing page for a role card: https://…/#/r/<role>. The first tap assigns that role. */
export function RoleTagView({ role }: { role: string }) {
  const [phase, setPhase] = useState<'working' | 'ask'>('working');
  const [code, setCode] = useState('');
  const [name, setName] = useState(store.get('name'));
  const { busy, error, run, setError } = useAction();

  async function tap(gameCode: string, playerName: string | null) {
    const r = await rpc<TapResult>('tap_role', { p_code: gameCode, p_role: role, p_name: playerName });
    store.set('lastGame', r.game_id); store.set('lastRole', 'player');
    flagReveal();
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
  }, [role]);

  async function submit(e: Event) {
    e.preventDefault();
    await run(async () => { store.set('name', name); await tap(code, name); });
  }

  if (phase === 'working') return <Page title="Reading card…"><ErrorNote message={error} /></Page>;
  return (
    <Page title="Reveal your role">
      <form class="card" onSubmit={submit}>
        <p class="muted">Enter the game code and your name. Your role appears on the next screen. Keep it secret!</p>
        <label>Game code
          <input value={code} maxLength={4} autoCapitalize="characters"
            onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())} />
        </label>
        <label>Your name
          <input value={name} maxLength={30} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <button disabled={busy || code.length < 4 || !name.trim()}>Reveal role</button>
        <ErrorNote message={error} />
      </form>
    </Page>
  );
}
