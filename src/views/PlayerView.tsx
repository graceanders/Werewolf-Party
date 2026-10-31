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

      <Notice s={s} />
      <Lover s={s} />
      <CupidPicker s={s} />
      {game.status === 'lobby' && me && <Waiting s={s} />}
      <RoleCard role={role} alias={myPrivate?.alias ?? ''} packmates={s.pack}
        waitingText={game.mode === 'role_tokens' ? 'Tap a role card to find out who you are.' : undefined} />
      <Players s={s} />
      <Chat gameId={game.id} messages={s.messages} channels={channels} canWrite={canWrite} />
      <NotifyButton />
    </Page>
  );
}

function Waiting({ s }: { s: ReturnType<typeof useGame> }) {
  const { game, me, myPrivate } = s;
  if (!game || !me) return null;
  if (game.mode === 'role_tokens' && !myPrivate?.role) {
    return (
      <section class="card">
        <h2>Pick your role</h2>
        <p>Take one role card from the bowl and tap it with your phone (or scan its QR code). Only tap one: the first tap is final.</p>
        <p class="muted">No card? The Game Master will deal you a role when the game starts.</p>
      </section>
    );
  }
  return <p class="notice ok">✓ You're in. Waiting for the Game Master to start.</p>;
}

/** Private message from the Game Master, e.g. after a role change. */
function Notice({ s }: { s: ReturnType<typeof useGame> }) {
  const { game, myPrivate } = s;
  const { busy, run } = useAction();
  if (!game || !myPrivate?.notice) return null;
  return (
    <section class="card notice-card">
      <p>{myPrivate.notice}</p>
      <button class="ghost" disabled={busy}
        onClick={() => run(async () => { await rpc('clear_notice', { p_game: game.id }); s.refresh(); })}>
        Got it
      </button>
    </section>
  );
}

/** Who you are in love with, kept on screen so you know who to protect. */
function Lover({ s }: { s: ReturnType<typeof useGame> }) {
  const partner = s.players.find((p) => p.id === s.myPrivate?.lover_id);
  if (!partner) return null;
  return <p class="notice">💘 You are in love with <strong>{partner.name}</strong>{partner.alive ? '' : ' ✝'}. If one of you dies, so does the other.</p>;
}

/** Cupid chooses the two lovers on the first night. */
function CupidPicker({ s }: { s: ReturnType<typeof useGame> }) {
  const { game, me, myPrivate, players } = s;
  const { busy, error, run } = useAction();
  const [picked, setPicked] = useState<string[]>([]);
  if (!game || !me || myPrivate?.role !== 'cupid' || myPrivate.cupid_done || !me.alive) return null;
  if (game.status !== 'night' || game.round !== 1) return null;
  const toggle = (id: string) => setPicked((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < 2 ? [...c, id] : c));
  return (
    <section class="card">
      <h2>Cupid: choose two lovers</h2>
      <p class="muted">Pick any two players, yourself included. They will be told who the other is.</p>
      <ul class="players">
        {players.filter((p) => p.alive).map((p) => (
          <li key={p.id}>
            <span>{p.name}{p.id === me.id ? ' (you)' : ''}</span>
            <button class={picked.includes(p.id) ? 'small on' : 'small'} disabled={busy} onClick={() => toggle(p.id)}>
              {picked.includes(p.id) ? 'Chosen' : 'Choose'}
            </button>
          </li>
        ))}
      </ul>
      <button disabled={busy || picked.length !== 2}
        onClick={() => run(async () => { await rpc('cupid_link', { p_game: game.id, p_a: picked[0], p_b: picked[1] }); s.refresh(); })}>
        Make them fall in love
      </button>
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
