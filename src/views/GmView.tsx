import { useEffect, useState } from 'preact/hooks';
import { rpc } from '../supabase';
import { appUrl } from '../router';
import { useGame, type GameState } from '../useGame';
import { Chat } from '../components/Chat';
import { Countdown, ErrorNote, Page, useAction } from '../ui';

export function GmView({ gameId }: { gameId: string }) {
  const s = useGame(gameId);
  const { game } = s;
  const [notes, setNotes] = useState<string[]>([]);
  if (s.loading) return <Page title="Loading…"><span /></Page>;
  if (s.error || !game) {
    return <Page title="Can't open this game"><ErrorNote message={s.error} /><a class="button" href="#/">Home</a></Page>;
  }
  if (!s.isGm) {
    return (
      <Page title="Not your game">
        <p>This browser is not the Game Master for this game. Use “I'm a Game Master on a new device” on the home page with the game code and PIN.</p>
        <a class="button" href="#/">Home</a>
      </Page>
    );
  }

  return (
    <Page>
      <header class="status">
        <div>
          <span class="muted">Game Master · {game.variant}</span>
          <h1>Code {game.code}</h1>
        </div>
        {(game.status === 'night' || game.status === 'day') && <Countdown endsAt={game.phase_ends_at} />}
      </header>

      {game.status !== 'ended' && <LateJoin s={s} />}
      {notes.length > 0 && (
        <section class="card">
          <h2>Heads up from the deal</h2>
          <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <button class="ghost" onClick={() => setNotes([])}>Dismiss</button>
        </section>
      )}
      {game.status === 'lobby' && <Lobby s={s} onStarted={setNotes} />}
      {(game.status === 'night' || game.status === 'day') && <Controls s={s} />}
      {game.status === 'ended' && <p class="notice ok">Game over. Roles are now visible to everyone.</p>}

      <Roster s={s} />
      {game.status === 'night' && <NightScript s={s} />}
      <Chat gameId={game.id} messages={s.messages} channels={['town', 'wolves', 'dead']} canWrite={() => null} />
    </Page>
  );
}

function LateJoin({ s }: { s: GameState }) {
  const { game } = s;
  const { busy, error, run } = useAction();
  if (!game) return null;
  return (
    <section class="card">
      <label class="check">
        <input type="checkbox" checked={game.allow_late_join} disabled={busy}
          onChange={(e) => {
            const open = (e.target as HTMLInputElement).checked;
            run(async () => { await rpc('set_late_join', { p_game: game.id, p_open: open }); s.refresh(); });
          }} />
        <span>Let new players join after the game starts (they become villagers)</span>
      </label>
      <ErrorNote message={error} />
    </section>
  );
}

function Lobby({ s, onStarted }: { s: GameState; onStarted: (notes: string[]) => void }) {
  const { game, players, roles, privates } = s;
  const [deck, setDeck] = useState<Record<string, number>>({});
  const [day, setDay] = useState(Math.round((game?.day_seconds ?? 2700) / 60));
  const [night, setNight] = useState(Math.round((game?.night_seconds ?? 600) / 60));
  const start = useAction();
  const timers = useAction();
  const n = players.length;

  useEffect(() => {
    if (!game) return;
    rpc<Record<string, number>>('deck_preview', { p_variant: game.variant, p_n: n }).then(setDeck).catch(() => setDeck({}));
  }, [game?.variant, n]);

  if (!game) return null;
  const joinLink = appUrl('/');
  const fmt = (m: Record<string, number>) => Object.entries(m).map(([id, c]) => `${c}× ${roles[id]?.name ?? id}`).join(', ');
  const picked: Record<string, number> = {};
  for (const pr of privates) if (pr.role) picked[pr.role] = (picked[pr.role] ?? 0) + 1;
  const pickedCount = Object.values(picked).reduce((a, b) => a + b, 0);

  return (
    <section class="card">
      <h2>Lobby</h2>
      <p>
        Players join at <code>{joinLink}</code> with code <strong class="big">{game.code}</strong>
        {game.mode === 'role_tokens' ? ', or just by tapping a role card.' : '.'}
      </p>
      <p class="muted">
        {n} joined{game.mode === 'role_tokens' ? `, ${pickedCount} have picked a role card` : ''}.
      </p>
      {Object.keys(deck).length > 0 ? (
        <p>
          {game.mode === 'role_tokens' ? 'Recommended cards' : 'Deal'} for {n}: {fmt(deck)}
        </p>
      ) : <p class="muted">Need at least 3 players to deal.</p>}
      {game.mode === 'role_tokens' && pickedCount > 0 && <p class="muted">Picked so far: {fmt(picked)}</p>}
      <p class="muted">
        {game.mode === 'role_tokens'
          ? 'When you start, anyone without a card is dealt a role that is missing. If a role was never picked up (say a werewolf), a random villager is promoted into it. Nobody loses a role they picked, and only villagers are promoted.'
          : 'Roles are dealt randomly among the people here when you start.'}
        {' '}Anyone who joins later becomes a villager.
      </p>
      <div class="row">
        <label>Day (min)<input type="number" min={1} value={day} onInput={(e) => setDay(Number((e.target as HTMLInputElement).value))} /></label>
        <label>Night (min)<input type="number" min={1} value={night} onInput={(e) => setNight(Number((e.target as HTMLInputElement).value))} /></label>
        <button class="ghost" disabled={timers.busy}
          onClick={() => timers.run(async () => { await rpc('update_timers', { p_game: game.id, p_day: Math.round(day * 60), p_night: Math.round(night * 60) }); s.refresh(); })}>
          Save
        </button>
      </div>
      <ErrorNote message={timers.error} />
      <button disabled={start.busy || n < 3}
        onClick={() => start.run(async () => {
          const r = await rpc<{ notes: string[] }>('start_game', { p_game: game.id });
          onStarted(r?.notes ?? []);
          s.refresh();
        })}>
        Deal roles and begin night 1
      </button>
      <ErrorNote message={start.error} />
    </section>
  );
}

function Controls({ s }: { s: GameState }) {
  const { game } = s;
  const { busy, error, run } = useAction();
  const [ending, setEnding] = useState(false);
  if (!game) return null;
  const act = (fn: string, args: Record<string, unknown>) => run(async () => { await rpc(fn, args); s.refresh(); });
  return (
    <section class="card">
      <h2>{game.status === 'night' ? 'Night' : 'Day'} {game.round}</h2>
      <div class="row wrap">
        <button disabled={busy} onClick={() => act('advance_phase', { p_game: game.id })}>
          {game.status === 'night' ? 'Begin day ☀️' : 'Begin night 🌙'}
        </button>
        <button class="ghost" disabled={busy} onClick={() => act('extend_phase', { p_game: game.id, p_seconds: 300 })}>+5 min</button>
        <button class="ghost" disabled={busy} onClick={() => act('extend_phase', { p_game: game.id, p_seconds: -300 })}>−5 min</button>
      </div>
      {!ending ? (
        <button class="ghost danger" onClick={() => setEnding(true)}>End game…</button>
      ) : (
        <div class="row wrap">
          <span>Winner:</span>
          {(['village', 'wolf', 'lovers', 'solo', 'none'] as const).map((w) => (
            <button key={w} class="small" disabled={busy} onClick={() => act('end_game', { p_game: game.id, p_winner: w })}>{w}</button>
          ))}
          <button class="small ghost" onClick={() => setEnding(false)}>Cancel</button>
        </div>
      )}
      <ErrorNote message={error} />
    </section>
  );
}

function Roster({ s }: { s: GameState }) {
  const { game, players, privates, roles, votes } = s;
  const { busy, error, run } = useAction();
  const [confirmKick, setConfirmKick] = useState<string | null>(null);
  if (!game) return null;
  const act = (fn: string, args: Record<string, unknown>) => run(async () => { await rpc(fn, args); s.refresh(); });
  const tally = new Map<string, number>();
  for (const v of votes) if (v.round === game.round) tally.set(v.target_id, (tally.get(v.target_id) ?? 0) + 1);
  const dealt = game.status !== 'lobby';

  return (
    <section class="card">
      <h2>Players ({players.filter((p) => p.alive).length} alive / {players.length})</h2>
      <ul class="roster">
        {players.map((p) => {
          const pr = privates.find((x) => x.player_id === p.id);
          return (
            <li key={p.id} class={p.alive ? '' : 'dead'}>
              <div class="who">
                <strong>{p.alive ? '' : '✝ '}{p.name}</strong>
                <span class="muted"> “{pr?.alias}”</span>
                {pr?.lover_id && <span class="muted"> · 💘 {players.find((x) => x.id === pr.lover_id)?.name}</span>}
                {!p.user_id && <span class="warn"> · device unlinked</span>}
                {(tally.get(p.id) ?? 0) > 0 && <span class="count">{tally.get(p.id)} votes</span>}
              </div>
              <div class="row wrap">
                {(dealt || pr?.role) && (
                  <select value={pr?.role ?? ''} disabled={busy}
                    onChange={(e) => act('reassign_role', { p_player: p.id, p_role: (e.target as HTMLSelectElement).value })}>
                    {Object.values(roles).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}
                {dealt && game.status !== 'ended' && (
                  <button class="small ghost" disabled={busy} onClick={() => act('set_alive', { p_player: p.id, p_alive: !p.alive })}>
                    {p.alive ? 'Kill' : 'Revive'}
                  </button>
                )}
                <button class="small ghost" disabled={busy || !p.user_id} onClick={() => act('unlink_device', { p_player: p.id })}>Unlink phone</button>
                {confirmKick === p.id ? (
                  <button class="small danger" disabled={busy} onClick={() => { setConfirmKick(null); act('kick_player', { p_player: p.id }); }}>Confirm remove</button>
                ) : (
                  <button class="small ghost danger" onClick={() => setConfirmKick(p.id)}>Remove</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <ErrorNote message={error} />
    </section>
  );
}

/** Who to wake, in order, during the night. */
function NightScript({ s }: { s: GameState }) {
  const { players, privates, roles } = s;
  const steps = Object.values(roles)
    .filter((r) => r.night_order !== null)
    .sort((a, b) => (a.night_order ?? 0) - (b.night_order ?? 0))
    .map((r) => ({
      role: r,
      holders: players.filter((p) => privates.find((x) => x.player_id === p.id)?.role === r.id),
    }))
    .filter((x) => x.holders.length > 0);
  if (steps.length === 0) return null;
  return (
    <section class="card">
      <h2>Night script</h2>
      <ol>
        {steps.map(({ role, holders }) => (
          <li key={role.id}>
            <strong>{role.name}</strong>: {holders.map((p) => (p.alive ? p.name : `${p.name} ✝`)).join(', ')}
            <div class="muted">{role.description}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
