-- Werewolf Party: schema, row-level security and game functions.
--
-- Design rules
--   * Clients can only READ tables (RLS-filtered). Every write goes through a
--     SECURITY DEFINER function below, so players can't edit roles or votes.
--   * Secrets live in tables the client can't see or can only see in part:
--       - roles           -> player_private (owner, GM, or everyone once the game ended)
--       - GM PIN hash     -> game_secrets (no grants at all)
--       - chat authorship -> message_authors (GM only), so chat stays anonymous
--   * Physical tokens (NFC / QR) carry only a token code. Roles are dealt to
--     players, never to tokens, so the same tags work for every game and variant.
--
-- Run this whole file once in the Supabase SQL Editor.

-- ---------------------------------------------------------------- catalogue

create table public.roles (
  id          text primary key,
  name        text not null,
  team        text not null check (team in ('village', 'wolf', 'solo')),
  night_order int,
  description text not null
);

create table public.variants (
  id          text primary key,
  name        text not null,
  description text not null
);

insert into public.roles (id, name, team, night_order, description) values
  ('villager',  'Villager',  'village', null, 'You have no special power. Listen, argue and vote out the werewolves before they eat the village.'),
  ('werewolf',  'Werewolf',  'wolf',    2,    'Each night the wolves agree on one villager to eat. By day, blend in. You win when wolves equal or outnumber the village.'),
  ('seer',      'Seer',      'village', 1,    'Each night the Game Master will show you whether one player is a werewolf. Guide the village without painting a target on yourself.'),
  ('doctor',    'Doctor',    'village', 3,    'Each night choose one player to protect from the wolves. You may not protect the same player two nights running.'),
  ('hunter',    'Hunter',    'village', null, 'If you die, for any reason, you immediately take one other player down with you.'),
  ('witch',     'Witch',     'village', 4,    'You have one potion that saves the wolves'' victim and one that kills any player. Each can be used once per game.'),
  ('cupid',     'Cupid',     'village', 0,    'On the first night, choose two players to become lovers. If one dies, the other dies of heartbreak.');

insert into public.variants (id, name, description) values
  ('classic',  'Classic',  'Werewolves, a Seer, a Doctor and villagers.'),
  ('extended', 'Extended', 'Classic plus the Hunter, Witch and Cupid as the group grows.');

-- ------------------------------------------------------------------- tables

create table public.games (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  gm_id          uuid not null,
  variant        text not null references public.variants (id),
  status         text not null default 'lobby' check (status in ('lobby', 'night', 'day', 'ended')),
  round          int  not null default 0,
  day_seconds    int  not null default 2700  check (day_seconds   between 30 and 86400),
  night_seconds  int  not null default 600   check (night_seconds between 30 and 86400),
  phase_ends_at  timestamptz,
  require_tokens boolean not null default true,
  winner         text check (winner in ('village', 'wolf', 'solo', 'none')),
  created_at     timestamptz not null default now()
);

create table public.game_secrets (
  game_id  uuid primary key references public.games (id) on delete cascade,
  pin_hash text not null
);

create table public.players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games (id) on delete cascade,
  user_id    uuid,
  name       text not null check (char_length(name) between 1 and 30),
  alive      boolean not null default true,
  token_code text check (token_code ~ '^[a-z0-9_-]{1,32}$'),
  joined_at  timestamptz not null default now(),
  unique (game_id, token_code)
);
create unique index players_game_user on public.players (game_id, user_id) where user_id is not null;

create table public.player_private (
  player_id uuid primary key references public.players (id) on delete cascade,
  game_id   uuid not null references public.games (id) on delete cascade,
  alias     text not null,
  role      text references public.roles (id),
  unique (game_id, alias)
);

create table public.messages (
  id         bigint generated always as identity primary key,
  game_id    uuid not null references public.games (id) on delete cascade,
  channel    text not null check (channel in ('town', 'wolves', 'dead')),
  alias      text not null,
  body       text not null check (char_length(body) between 1 and 500),
  is_gm      boolean not null default false,
  created_at timestamptz not null default now()
);
create index messages_game_id on public.messages (game_id, id);

create table public.message_authors (
  message_id bigint primary key references public.messages (id) on delete cascade,
  player_id  uuid references public.players (id) on delete set null
);

create table public.votes (
  game_id   uuid not null references public.games (id) on delete cascade,
  round     int  not null,
  voter_id  uuid not null references public.players (id) on delete cascade,
  target_id uuid not null references public.players (id) on delete cascade,
  primary key (game_id, round, voter_id)
);

alter table public.roles           enable row level security;
alter table public.variants        enable row level security;
alter table public.games           enable row level security;
alter table public.game_secrets    enable row level security;
alter table public.players         enable row level security;
alter table public.player_private  enable row level security;
alter table public.messages        enable row level security;
alter table public.message_authors enable row level security;
alter table public.votes           enable row level security;

-- ------------------------------------------------------- policy helper fns

create function public.is_gm(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.games where id = g and gm_id = (select auth.uid()));
$$;

create function public.is_member(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_gm(g)
      or exists (select 1 from public.players where game_id = g and user_id = (select auth.uid()));
$$;

create function public.owns_player(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.players where id = pid and user_id = (select auth.uid()));
$$;

create function public.my_role(g uuid) returns text
language sql stable security definer set search_path = '' as $$
  select pp.role
    from public.player_private pp
    join public.players p on p.id = pp.player_id
   where pp.game_id = g and p.user_id = (select auth.uid());
$$;

create function public.my_alive(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select alive from public.players where game_id = g and user_id = (select auth.uid())), true);
$$;

-- ----------------------------------------------------------------- policies

create policy roles_read    on public.roles    for select to authenticated using (true);
create policy variants_read on public.variants for select to authenticated using (true);

create policy games_read   on public.games   for select to authenticated using (public.is_member(id));
create policy players_read on public.players for select to authenticated using (public.is_member(game_id));
create policy votes_read   on public.votes   for select to authenticated using (public.is_member(game_id));

create policy private_read on public.player_private for select to authenticated using (
  public.is_gm(game_id)
  or public.owns_player(player_id)
  or (public.is_member(game_id)
      and exists (select 1 from public.games g where g.id = game_id and g.status = 'ended'))
);

create policy messages_read on public.messages for select to authenticated using (
  public.is_gm(game_id)
  or (public.is_member(game_id) and (
        channel = 'town'
        or (channel = 'wolves' and public.my_role(game_id) = 'werewolf')
        or (channel = 'dead'   and not public.my_alive(game_id))
     ))
);

create policy authors_read on public.message_authors for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_gm(m.game_id))
);

-- game_secrets: RLS on, no policy, no grant -> unreachable from the client.

grant select on public.roles, public.variants, public.games, public.players,
                public.player_private, public.messages, public.message_authors,
                public.votes to authenticated;

-- --------------------------------------------------------------- deck logic

-- Role counts for a variant and player count. Pure composition (not shuffled).
create function public.build_deck(p_variant text, p_n int) returns text[]
language plpgsql stable set search_path = '' as $$
declare
  deck text[] := '{}';
  wolves int;
  i int;
begin
  if p_n < 3 then raise exception 'Need at least 3 players'; end if;
  wolves := greatest(1, round(p_n / 4.0)::int);
  for i in 1..wolves loop deck := array_append(deck, 'werewolf'::text); end loop;
  if p_n >= 4 then deck := array_append(deck, 'seer'::text); end if;
  if p_n >= 6 then deck := array_append(deck, 'doctor'::text); end if;
  if p_variant = 'extended' then
    if p_n >= 7 then deck := array_append(deck, 'hunter'::text); end if;
    if p_n >= 8 then deck := array_append(deck, 'cupid'::text); end if;
    if p_n >= 9 then deck := array_append(deck, 'witch'::text); end if;
  end if;
  while coalesce(array_length(deck, 1), 0) < p_n loop deck := array_append(deck, 'villager'::text); end loop;
  return deck;
end $$;

-- {"werewolf": 2, "seer": 1, ...} for the GM's lobby preview.
create function public.deck_preview(p_variant text, p_n int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_n < 3 then return '{}'::jsonb; end if;
  return (select coalesce(jsonb_object_agg(r, c), '{}'::jsonb)
            from (select r, count(*) c from unnest(public.build_deck(p_variant, p_n)) r group by r) t);
end $$;

-- ----------------------------------------------------------- internal utils

create function public._gen_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ';
  c text;
  i int;
begin
  loop
    c := '';
    for i in 1..4 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.games where code = c);
  end loop;
  return c;
end $$;

-- Finds or creates the caller's player row (and its anonymous chat alias).
-- Anyone arriving after the deal becomes a plain villager.
create function public._ensure_player(p_game uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  pid uuid;
  st text;
  adjs text[] := array['Grey','Crimson','Silent','Sly','Bold','Misty','Amber','Hollow','Swift','Ashen',
                       'Wild','Quiet','Rusty','Pale','Dusky','Bright','Gloomy','Frosty','Lucky','Nimble'];
  beasts text[] := array['Fox','Owl','Badger','Raven','Stag','Hare','Otter','Lynx','Heron','Mole',
                         'Boar','Crow','Newt','Wren','Moth','Toad','Finch','Pike','Vole','Bat'];
  a text;
  tries int := 0;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select id into pid from public.players where game_id = p_game and user_id = uid;
  if pid is not null then return pid; end if;

  if p_name is null or char_length(trim(p_name)) = 0 then raise exception 'Enter your name'; end if;
  select status into st from public.games where id = p_game;
  if st = 'ended' then raise exception 'That game has ended'; end if;

  insert into public.players (game_id, user_id, name)
  values (p_game, uid, left(trim(p_name), 30)) returning id into pid;

  loop
    a := adjs[1 + floor(random() * array_length(adjs, 1))::int] || ' ' ||
         beasts[1 + floor(random() * array_length(beasts, 1))::int];
    begin
      insert into public.player_private (player_id, game_id, alias, role)
      values (pid, p_game, a, case when st = 'lobby' then null else 'villager' end);
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 60 then raise exception 'No chat aliases left'; end if;
    end;
  end loop;
  return pid;
end $$;

-- ------------------------------------------------------------------- lobby

create function public.create_game(
  p_variant text, p_day_seconds int, p_night_seconds int, p_pin text, p_require_tokens boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  gid uuid;
  c text;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if p_pin is null or char_length(p_pin) < 4 then raise exception 'GM PIN must be at least 4 characters'; end if;
  if not exists (select 1 from public.variants where id = p_variant) then raise exception 'Unknown variant'; end if;
  c := public._gen_code();
  insert into public.games (code, gm_id, variant, day_seconds, night_seconds, require_tokens)
  values (c, uid, p_variant, p_day_seconds, p_night_seconds, coalesce(p_require_tokens, true))
  returning id into gid;
  insert into public.game_secrets (game_id, pin_hash) values (gid, extensions.crypt(p_pin, extensions.gen_salt('bf')));
  return jsonb_build_object('game_id', gid, 'code', c);
end $$;

-- Take over the GM seat from a new device/browser using the PIN.
create function public.claim_gm(p_code text, p_pin text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  gid uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select g.id into gid
    from public.games g join public.game_secrets s on s.game_id = g.id
   where g.code = upper(trim(p_code)) and s.pin_hash = extensions.crypt(p_pin, s.pin_hash);
  if gid is null then raise exception 'Wrong game code or PIN'; end if;
  update public.games set gm_id = uid where id = gid;
  return gid;
end $$;

create function public.join_game(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid;
  pid uuid;
begin
  select id into gid from public.games where code = upper(trim(p_code));
  if gid is null then raise exception 'No game with that code'; end if;
  pid := public._ensure_player(gid, p_name);
  return jsonb_build_object('game_id', gid, 'player_id', pid);
end $$;

-- A phone tapped a physical token. Possession of the token is the check-in:
--   free token         -> bind it to the caller (creating the player if needed)
--   caller's own token -> 'mine'
--   token of a player the GM unlinked -> rebind to this device
--   anyone else's      -> 'taken' (no peeking)
create function public.tap_token(p_code text, p_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  g public.games;
  tok text := lower(trim(p_token));
  ex public.players;
  pid uuid;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if tok !~ '^[a-z0-9_-]{1,32}$' then raise exception 'Unreadable token'; end if;
  select * into g from public.games where code = upper(trim(p_code));
  if not found then raise exception 'No game with that code'; end if;

  select * into ex from public.players where game_id = g.id and token_code = tok;
  if found then
    if ex.user_id = uid then
      return jsonb_build_object('status', 'mine', 'game_id', g.id, 'player_id', ex.id);
    elsif ex.user_id is null
          and not exists (select 1 from public.players where game_id = g.id and user_id = uid) then
      update public.players set user_id = uid where id = ex.id;
      return jsonb_build_object('status', 'ok', 'game_id', g.id, 'player_id', ex.id);
    else
      return jsonb_build_object('status', 'taken', 'game_id', g.id);
    end if;
  end if;

  pid := public._ensure_player(g.id, p_name);
  update public.players set token_code = tok where id = pid;   -- also swaps a previously held token
  return jsonb_build_object('status', 'ok', 'game_id', g.id, 'player_id', pid);
end $$;

-- -------------------------------------------------------------- GM controls

create function public.start_game(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  pids uuid[];
  deck text[];
  n int;
  missing int;
  i int;
begin
  if not public.is_gm(p_game) then raise exception 'Only the Game Master can do that'; end if;
  select * into g from public.games where id = p_game for update;
  if g.status <> 'lobby' then raise exception 'The game has already started'; end if;

  select array_agg(id order by random()) into pids from public.players where game_id = p_game;
  n := coalesce(array_length(pids, 1), 0);
  if g.require_tokens then
    select count(*) into missing from public.players where game_id = p_game and token_code is null;
    if missing > 0 then raise exception '% player(s) have not tapped a token yet', missing; end if;
  end if;

  -- Deal to the players actually here, so no role is ever left on an
  -- unclaimed token. (build_deck raises if fewer than 3.)
  deck := public.build_deck(g.variant, n);
  select array_agg(r order by random()) into deck from unnest(deck) r;
  for i in 1..n loop
    update public.player_private set role = deck[i] where player_id = pids[i];
  end loop;

  update public.games
     set status = 'night', round = 1, phase_ends_at = now() + make_interval(secs => g.night_seconds)
   where id = p_game;
  return public.deck_preview(g.variant, n);
end $$;

create function public.advance_phase(p_game uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  if not public.is_gm(p_game) then raise exception 'Only the Game Master can do that'; end if;
  select * into g from public.games where id = p_game for update;
  if g.status = 'night' then
    update public.games set status = 'day', phase_ends_at = now() + make_interval(secs => g.day_seconds) where id = p_game;
    return 'day';
  elsif g.status = 'day' then
    update public.games set status = 'night', round = g.round + 1,
           phase_ends_at = now() + make_interval(secs => g.night_seconds) where id = p_game;
    return 'night';
  end if;
  raise exception 'The game is not running';
end $$;

create function public.extend_phase(p_game uuid, p_seconds int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_gm(p_game) then raise exception 'Only the Game Master can do that'; end if;
  if p_seconds not between -3600 and 3600 then raise exception 'Out of range'; end if;
  update public.games
     set phase_ends_at = greatest(coalesce(phase_ends_at, now()), now()) + make_interval(secs => p_seconds)
   where id = p_game and status in ('night', 'day');
end $$;

create function public.update_timers(p_game uuid, p_day int, p_night int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_gm(p_game) then raise exception 'Only the Game Master can do that'; end if;
  update public.games set day_seconds = p_day, night_seconds = p_night where id = p_game;
end $$;

create function public.set_alive(p_player uuid, p_alive boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  select game_id into gid from public.players where id = p_player;
  if gid is null or not public.is_gm(gid) then raise exception 'Only the Game Master can do that'; end if;
  update public.players set alive = p_alive where id = p_player;
end $$;

create function public.reassign_role(p_player uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  select game_id into gid from public.players where id = p_player;
  if gid is null or not public.is_gm(gid) then raise exception 'Only the Game Master can do that'; end if;
  if not exists (select 1 from public.roles where id = p_role) then raise exception 'Unknown role'; end if;
  update public.player_private set role = p_role where player_id = p_player;
end $$;

-- Lost phone / switched browser: free the seat so the token can be tapped again.
create function public.unlink_device(p_player uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  select game_id into gid from public.players where id = p_player;
  if gid is null or not public.is_gm(gid) then raise exception 'Only the Game Master can do that'; end if;
  update public.players set user_id = null where id = p_player;
end $$;

create function public.kick_player(p_player uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  select game_id into gid from public.players where id = p_player;
  if gid is null or not public.is_gm(gid) then raise exception 'Only the Game Master can do that'; end if;
  delete from public.players where id = p_player;
end $$;

create function public.end_game(p_game uuid, p_winner text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_gm(p_game) then raise exception 'Only the Game Master can do that'; end if;
  update public.games set status = 'ended', winner = p_winner, phase_ends_at = null where id = p_game;
end $$;

-- ------------------------------------------------------------ player actions

create function public.send_message(p_game uuid, p_channel text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  p record;
  st text;
  mid bigint;
  body text := trim(p_body);
begin
  if body is null or body = '' then return; end if;
  if p_channel not in ('town', 'wolves', 'dead') then raise exception 'Unknown channel'; end if;

  if public.is_gm(p_game) then
    insert into public.messages (game_id, channel, alias, body, is_gm)
    values (p_game, p_channel, 'Narrator', left(body, 500), true);
    return;
  end if;

  select pl.id, pl.alive, pp.alias, pp.role into p
    from public.players pl join public.player_private pp on pp.player_id = pl.id
   where pl.game_id = p_game and pl.user_id = uid;
  if not found then raise exception 'Join the game first'; end if;
  select status into st from public.games where id = p_game;

  if p_channel = 'town' then
    if st <> 'ended' then
      if not p.alive then raise exception 'The dead cannot speak to the town'; end if;
      if st = 'night' then raise exception 'The village is asleep'; end if;
    end if;
  elsif p_channel = 'wolves' then
    if p.role is distinct from 'werewolf' or not p.alive or st <> 'night' then
      raise exception 'Only living werewolves may use this channel, at night';
    end if;
  elsif p_channel = 'dead' then
    if p.alive then raise exception 'Only the dead may use this channel'; end if;
  end if;

  insert into public.messages (game_id, channel, alias, body)
  values (p_game, p_channel, p.alias, left(body, 500)) returning id into mid;
  insert into public.message_authors (message_id, player_id) values (mid, p.id);
end $$;

-- Pass null to withdraw a vote.
create function public.cast_vote(p_game uuid, p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  me record;
  g public.games;
begin
  select * into g from public.games where id = p_game;
  select id, alive into me from public.players where game_id = p_game and user_id = uid;
  if me.id is null then raise exception 'Join the game first'; end if;
  if g.status <> 'day' then raise exception 'Voting is only open by day'; end if;
  if not me.alive then raise exception 'The dead cannot vote'; end if;

  if p_target is null then
    delete from public.votes where game_id = p_game and round = g.round and voter_id = me.id;
    return;
  end if;
  if not exists (select 1 from public.players where id = p_target and game_id = p_game and alive) then
    raise exception 'Pick a living player';
  end if;
  insert into public.votes (game_id, round, voter_id, target_id)
  values (p_game, g.round, me.id, p_target)
  on conflict (game_id, round, voter_id) do update set target_id = excluded.target_id;
end $$;

-- Wolves learn who their packmates are.
create function public.my_pack(p_game uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.my_role(p_game) is distinct from 'werewolf' then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'alive', p.alive) order by p.name), '[]'::jsonb)
            from public.players p join public.player_private pp on pp.player_id = p.id
           where pp.game_id = p_game and pp.role = 'werewolf');
end $$;

-- ---------------------------------------------------------- function grants
-- Lock every function down, then open only the ones the client may call.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not in ('build_deck', '_gen_code', '_ensure_player') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------- realtime
alter publication supabase_realtime add table
  public.games, public.players, public.player_private, public.messages, public.votes;
