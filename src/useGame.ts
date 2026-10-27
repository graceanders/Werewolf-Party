import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ensureSession, rpc, supabase } from './supabase';
import type { Game, Message, Player, PlayerPrivate, Role, Vote } from './types';

export interface GameState {
  loading: boolean;
  error: string | null;
  userId: string | null;
  game: Game | null;
  players: Player[];
  privates: PlayerPrivate[];
  roles: Record<string, Role>;
  messages: Message[];
  votes: Vote[];
  pack: { name: string; alive: boolean }[];
  me: Player | null;
  myPrivate: PlayerPrivate | null;
  isGm: boolean;
  refresh: () => void;
}

/** Loads one game and keeps it live. Row-level security decides what each viewer gets back. */
export function useGame(gameId: string): GameState {
  const [state, setState] = useState<Omit<GameState, 'refresh' | 'me' | 'myPrivate' | 'isGm'>>({
    loading: true, error: null, userId: null, game: null, players: [], privates: [],
    roles: {}, messages: [], votes: [], pack: [],
  });
  const timer = useRef<number>();

  const load = useCallback(async () => {
    try {
      const userId = await ensureSession();
      const [g, p, pp, r, m, v] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId).maybeSingle(),
        supabase.from('players').select('*').eq('game_id', gameId).order('joined_at'),
        supabase.from('player_private').select('player_id, alias, role').eq('game_id', gameId),
        supabase.from('roles').select('*'),
        supabase.from('messages').select('id, channel, alias, body, is_gm, created_at')
          .eq('game_id', gameId).order('id', { ascending: false }).limit(300),
        supabase.from('votes').select('round, voter_id, target_id').eq('game_id', gameId),
      ]);
      const failure = g.error ?? p.error ?? pp.error ?? r.error ?? m.error ?? v.error;
      if (failure) throw new Error(failure.message);
      if (!g.data) throw new Error('Game not found, or you are not part of it.');
      const pack = await rpc<{ name: string; alive: boolean }[]>('my_pack', { p_game: gameId });
      setState({
        loading: false, error: null, userId,
        game: g.data as Game,
        players: (p.data ?? []) as Player[],
        privates: (pp.data ?? []) as PlayerPrivate[],
        roles: Object.fromEntries(((r.data ?? []) as Role[]).map((x) => [x.id, x])),
        messages: ((m.data ?? []) as Message[]).reverse(),
        votes: (v.data ?? []) as Vote[],
        pack,
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, [gameId]);

  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(load, 120);
  }, [load]);

  useEffect(() => {
    load();
    const channel = supabase.channel(`game-${gameId}`);
    for (const [table, column] of [
      ['games', 'id'], ['players', 'game_id'], ['player_private', 'game_id'],
      ['messages', 'game_id'], ['votes', 'game_id'],
    ] as const) {
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table, filter: `${column}=eq.${gameId}` }, refresh);
    }
    channel.subscribe();
    const poll = window.setInterval(load, 20000); // safety net if the socket drops
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [gameId, load, refresh]);

  const me = state.players.find((p) => p.user_id === state.userId) ?? null;
  const myPrivate = me ? state.privates.find((x) => x.player_id === me.id) ?? null : null;
  const isGm = !!state.game && state.game.gm_id === state.userId;
  return { ...state, me, myPrivate, isGm, refresh: load };
}
