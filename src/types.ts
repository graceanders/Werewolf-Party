export type Status = 'lobby' | 'night' | 'day' | 'ended';
export type Channel = 'town' | 'wolves' | 'dead';
/** none: random deal in the app. role_tokens: physical cards, each NFC tag / QR holds a role. */
export type GameMode = 'none' | 'role_tokens';

export interface Game {
  id: string;
  code: string;
  gm_id: string;
  variant: string;
  status: Status;
  round: number;
  day_seconds: number;
  night_seconds: number;
  phase_ends_at: string | null;
  mode: GameMode;
  allow_late_join: boolean;
  winner: 'village' | 'wolf' | 'solo' | 'none' | null;
}

export interface Player {
  id: string;
  game_id: string;
  user_id: string | null;
  name: string;
  alive: boolean;
}

export interface PlayerPrivate {
  player_id: string;
  alias: string;
  role: string | null;
  notice: string | null;
  lover_id: string | null;
  cupid_done: boolean;
}

export interface Role {
  id: string;
  name: string;
  team: 'village' | 'wolf' | 'solo';
  night_order: number | null;
  description: string;
}

export interface Variant {
  id: string;
  name: string;
  description: string;
}

export interface Message {
  id: number;
  channel: Channel;
  alias: string;
  body: string;
  is_gm: boolean;
  created_at: string;
}

export interface Vote {
  round: number;
  voter_id: string;
  target_id: string;
}
