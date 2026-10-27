import { useEffect, useRef, useState } from 'preact/hooks';
import { rpc } from '../supabase';
import { useGame } from '../useGame';
import type { Channel } from '../types';
import { Chat } from '../components/Chat';
import { RoleCard } from '../components/RoleCard';
import { Countdown, ErrorNote, Page, useAction } from '../ui';

const PHASE_LABEL = { lobby: 'Gathering', night: 'Night 🌙', day: 'Day ☀️', ended: 'Game over' } as const;

export function PlayerView({ gameId }: { gameId: string }) {
  const s = useGame(gameId);
  const { game, me, myPrivate, roles } = s;
  const banner = usePhaseAlerts(game?.status, game?.round);

  if (s.loading) return <Page title="Loading…"><span /></Page>;
  if (s.error || !game) {
    return <Page title="Can't open this game"><ErrorNote message={s.error} /><a class="button" href="#/">Home</a></Page>;
  }
  if (s.isGm && !me) {
    return <Page title="You are the Game Master"><a class="button" href={`#/gm/${game.id}`}>Open GM view</a></Page>;
  }

  const role = myPrivate?.role ? roles[myPrivate.role] ?? null : null;
  const dead = !!me && !me.alive;
  const channels: Channel[] = ['town', ...(role?.id === 'werewolf' ? ['wolves' as const] : []), ...(dead ? ['dead' as const] : [])];
  const canWrite = (c: Channel): string | null => {
    if (game.status === 'ended') return null;
    if (c === 'dead') return dead ? null : 'Only the dead can talk here';
    if (c === 'wolves') return !dead && game.status === 'night' ? null : 'The pack speaks only at night';
    if (dead) return 'You are dead. Use the Graveyard.';
    return game.status === 'night' ? 'The village is asleep' : null;
  };

  return (
    <Page>
      {banner && <div class="banner">{banner}</div>}
      <header class="status">
        <div>
          <span class="muted">Game {game.code}</span>
          <h1>{PHASE_LABEL[game.status]}{game.round > 0 && game.status !== 'ended' ? ` · round ${game.round}` : ''}</h1>
        </div>
        {game.status !== 'lobby' && game.status !== 'ended' && <Countdown endsAt={game.phase_ends_at} />}
      </header>

      {game.status === 'ended' && <EndCard s={s} />}
      {me && !me.alive && game.status !== 'ended' && <p class="notice dead">You have died. You can still watch and chat in the Graveyard.</p>}

      {game.status === 'lobby' && me && <CheckIn s={s} />}
      <RoleCard role={role} alias={myPrivate?.alias ?? ''} packmates={s.pack} />
      <Players s={s} />
      <Chat gameId={game.id} messages={s.messages} channels={channels} canWrite={canWrite} />
      <NotifyButton />
    </Page>
  );
}

function CheckIn({ s }: { s: ReturnType<typeof useGame> }) {
  const { game, me } = s;
  const [token, setToken] = useState('');
  const { busy, error, run } = useAction();
  if (!game || !me) return null;
  if (me.token_code) {
    return <p class="notice ok">✓ Checked in with token <code>{me.token_code}</code>. Waiting for the Game Master to start.</p>;
  }
  return (
    <section class="card">
      <h2>Check in</h2>
      <p>{game.require_tokens
        ? 'Pick up a token and tap it with your phone to check in.'
        : 'You are in. The Game Master will start soon.'}</p>
      {game.require_tokens && (
        <form class="row" onSubmit={(e) => {
          e.preventDefault();
          run(async () => { await rpc('tap_token', { p_code: game.code, p_token: token, p_name: null }); s.refresh(); });
        }}>
          <input placeholder="or type the token code" value={token}
            onInput={(e) => setToken((e.target as HTMLInputElement).value)} />
          <button disabled={busy || !token.trim()}>Claim</button>
        </form>
      )}
      <ErrorNote message={error} />
    </section>
  );
}

function Players({ s }: { s: ReturnType<typeof useGame> }) {
  const { game, me, players, votes } = s;
  const { busy, error, run } = useAction();
  if (!game) return null;
  const tally = new Map<string, number>();
  const mine = votes.find((v) => v.round === game.round && v.voter_id === me?.id)?.target_id;
  for (const v of votes) if (v.round === game.round) tally.set(v.target_id, (tally.get(v.target_id) ?? 0) + 1);
  const canVote = game.status === 'day' && !!me?.alive;

  return (
    <section class="card">
      <h2>Players ({players.filter((p) => p.alive).length} alive / {players.length})</h2>
      <ul class="players">
        {players.map((p) => (
          <li key={p.id} class={p.alive ? '' : 'dead'}>
            <span>{p.alive ? '' : '✝ '}{p.name}{p.id === me?.id ? ' (you)' : ''}</span>
            {game.status === 'lobby' && game.require_tokens && <span class={p.token_code ? 'ok' : 'muted'}>{p.token_code ? '✓' : '…'}</span>}
            {game.status === 'day' && (tally.get(p.id) ?? 0) > 0 && <span class="count">{tally.get(p.id)} votes</span>}
            {canVote && p.alive && p.id !== me?.id && (
              <button class={mine === p.id ? 'small on' : 'small'} disabled={busy}
                onClick={() => run(async () => { await rpc('cast_vote', { p_game: game.id, p_target: mine === p.id ? null : p.id }); s.refresh(); })}>
                {mine === p.id ? 'Voted' : 'Vote'}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorNote message={error} />
    </section>
  );
}

function EndCard({ s }: { s: ReturnType<typeof useGame> }) {
  const { game, players, privates, roles } = s;
  if (!game) return null;
  const winner = game.winner === 'wolf' ? 'The werewolves win! 🐺' : game.winner === 'village' ? 'The village wins! 🏡'
    : game.winner === 'solo' ? 'A lone survivor wins!' : 'No winner this time.';
  return (
    <section class="card">
      <h2>{winner}</h2>
      <ul class="players">
        {players.map((p) => {
          const r = privates.find((x) => x.player_id === p.id)?.role;
          return <li key={p.id}><span>{p.name}</span><span class="muted">{r ? roles[r]?.name : ''}</span></li>;
        })}
      </ul>
    </section>
  );
}

/** Buzzes the phone, and shows a system notification if the tab is in the background. */
function usePhaseAlerts(status?: string, round?: number): string | null {
  const prev = useRef<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  useEffect(() => {
    if (!status) return;
    const key = `${status}:${round}`;
    const before = prev.current;
    prev.current = key;
    if (before === null || before === key) return;
    const text = status === 'night' ? 'Night falls. Close your eyes… 🌙'
      : status === 'day' ? 'The sun rises. Time to talk and vote ☀️'
      : status === 'ended' ? 'The game is over.' : null;
    if (!text) return;
    setBanner(text);
    navigator.vibrate?.([200, 100, 200]);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Werewolf Party', { body: text });
    }
    const id = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(id);
  }, [status, round]);
  return banner;
}

function NotifyButton() {
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  if (perm !== 'default') return null;
  return (
    <p class="center">
      <button class="ghost" onClick={async () => setPerm(await Notification.requestPermission())}>
        Alert me when a round ends
      </button>
    </p>
  );
}
