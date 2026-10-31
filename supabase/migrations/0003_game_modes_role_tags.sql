-- Two ways to run a game, chosen by the host:
--   none        -> no physical cards; roles are dealt randomly in the app
--   role_tokens -> physical role cards: each NFC tag / QR holds a ROLE. A player picks
--                  a card, taps it, and is assigned that role with its description.
--
-- Safety net when the game starts (role_tokens): if a role the game needs was never
-- picked up (a werewolf nobody grabbed), a VILLAGER is promoted into it. Roles that
-- players picked are never taken away, and only villagers are ever promoted.
-- Anyone can join late, without a card, and becomes a villager.
--
-- This also removes the earlier "check-in token" idea, which role cards replace.
-- Run once in the Supabase SQL Editor (after 0001 and 0002).

-- This script is safe to run more than once, and runs as one transaction: it either
-- fully applies or changes nothing.
begin;

-- ------------------------------------------------------------------ schema

alter table public.games add column if not exists mode text not null default 'none';
alter table public.games drop constraint if exists games_mode_check;
update public.games set mode = 'none' where mode not in ('none', 'role_tokens');
alter table public.games add constraint games_mode_check check (mode in ('none', 'role_tokens'));
alter table public.games add column if not exists allow_late_join boolean not null default true;

alter table public.games drop column if exists require_tokens;
alter table public.players drop column if exists token_code;
alter table public.player_private add column if not exists notice text;   -- private message to the player

-- ----------------------------------------------------------- old functions

drop function if exists public.create_game(text, int, int, text, boolean);
drop function if exists public.create_game(text, int, int, text, text);
drop function if exists public.tap_token(text, text, text);
drop function if exists public.tap_role(text, text, text);
drop function if exists public.set_late_join(uuid, boolean);
drop function if exists public.clear_notice(uuid);

-- ------------------------------------------------------------ create a game

create function public.create_game(
  p_variant text, p_day_seconds int, p_night_seconds int, p_pin text, p_mode text
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
  if p_mode not in ('none', 'role_tokens') then raise exception 'Unknown game mode'; end if;
  c := public._gen_code();
  insert into public.games (code, gm_id, variant, day_seconds, night_seconds, mode)
  values (c, uid, p_variant, p_day_seconds, p_night_seconds, p_mode)
  returning id into gid;
  insert into public.game_secrets (game_id, pin_hash) values (gid, extensions.crypt(p_pin, extensions.gen_salt('bf')));
  return jsonb_build_object('game_id', gid, 'code', c);
end $$;

-- ------------------------------------------------------------------ joining

-- Finds or creates the caller's player row (and its anonymous chat alias).
--   * a phone the GM unlinked can get its seat back by joining again with the same name
--   * anyone arriving after the deal becomes a plain villager (unless the GM closed joining)
create or replace function public._ensure_player(p_game uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  pid uuid;
  g public.games;
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
  select * into g from public.games where id = p_game;
  if g.status = 'ended' then raise exception 'That game has ended'; end if;

  select id into pid from public.players
   where game_id = p_game and user_id is null and lower(name) = lower(trim(p_name))
   order by joined_at limit 1;
  if pid is not null then
    update public.players set user_id = uid where id = pid;
    return pid;
  end if;

  if g.status <> 'lobby' and not g.allow_late_join then
    raise exception 'This game is closed to new players';
  end if;

  insert into public.players (game_id, user_id, name)
  values (p_game, uid, left(trim(p_name), 30)) returning id into pid;

  loop
    a := adjs[1 + floor(random() * array_length(adjs, 1))::int] || ' ' ||
         beasts[1 + floor(random() * array_length(beasts, 1))::int];
    begin
      insert into public.player_private (player_id, game_id, alias, role)
      values (pid, p_game, a, case when g.status = 'lobby' then null else 'villager' end);
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 60 then raise exception 'No chat aliases left'; end if;
    end;
  end loop;
  return pid;
end $$;

-- A phone tapped a ROLE card. The first tap assigns that role; later taps never
-- change it (they just show the role the player already has).
create function public.tap_role(p_code text, p_role text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  g public.games;
  pid uuid;
  cur text;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select * into g from public.games where code = upper(trim(p_code));
  if not found then raise exception 'No game with that code'; end if;
  if g.mode <> 'role_tokens' then raise exception 'This game does not use role cards'; end if;
  if not exists (select 1 from public.roles where id = p_role) then raise exception 'Unknown role card'; end if;

  select p.id, pp.role into pid, cur
    from public.players p join public.player_private pp on pp.player_id = p.id
   where p.game_id = g.id and p.user_id = uid;

  if pid is null then
    pid := public._ensure_player(g.id, p_name);        -- needs a name; late joiners become villagers
    select role into cur from public.player_private where player_id = pid;
  end if;

  if cur is not null then
    return jsonb_build_object('status', 'already', 'game_id', g.id, 'role', cur);
  end if;

  update public.player_private set role = p_role where player_id = pid;
  return jsonb_build_object('status', 'assigned', 'game_id', g.id, 'role', p_role);
end $$;

-- ------------------------------------------------------------------- dealing

create or replace function public.start_game(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  n int;
  deck text[];
  rem text[];
  specials text[];
  upids uuid[];
  vids uuid[] := '{}';
  r record;
  idx int;
  i int;
  u int;
  k int;
  notes text[] := '{}';
begin
  if not public.is_gm(p_game) then raise exception 'Only the Game Master can do that'; end if;
  select * into g from public.games where id = p_game for update;
  if g.status <> 'lobby' then raise exception 'The game has already started'; end if;

  select count(*) into n from public.players where game_id = p_game;
  deck := public.build_deck(g.variant, n);                       -- raises if fewer than 3

  -- Roles already held from cards come out of the recommended deck.
  -- Whatever is left in `rem` is what the game still needs.
  rem := deck;
  for r in select player_id, role from public.player_private where game_id = p_game and role is not null loop
    idx := array_position(rem, r.role);
    if idx is not null then
      rem := rem[1:idx - 1] || rem[idx + 1:array_length(rem, 1)];
    end if;
    if r.role = 'villager' then vids := array_append(vids, r.player_id); end if;   -- promotion candidates
  end loop;

  -- Missing special roles, werewolves first. Villagers are never "missing".
  select array_agg(x order by (x <> 'werewolf'), random()) into specials
    from unnest(rem) x where x <> 'villager';

  -- 1. Players with no role yet (no card, joined before the start) fill the gaps.
  select array_agg(player_id order by random()) into upids
    from public.player_private where game_id = p_game and role is null;
  u := coalesce(array_length(upids, 1), 0);
  for i in 1..u loop
    update public.player_private set role = coalesce(specials[i], 'villager') where player_id = upids[i];
  end loop;
  if coalesce(array_length(specials, 1), 0) > u then
    specials := specials[u + 1:array_length(specials, 1)];
  else
    specials := '{}';
  end if;

  -- 2. Roles still missing go to villagers. Nobody who picked another role loses it.
  if coalesce(array_length(vids, 1), 0) > 0 then
    select array_agg(x order by random()) into vids from unnest(vids) x;
  end if;
  k := coalesce(array_length(specials, 1), 0);
  for i in 1..k loop
    if i <= coalesce(array_length(vids, 1), 0) then
      update public.player_private
         set role = specials[i], notice = 'The Game Master changed your role. Open your role card to see it.'
       where player_id = vids[i];
      notes := array_append(notes, format('Nobody picked %s, so %s was promoted from villager.',
        (select name from public.roles where id = specials[i]),
        (select name from public.players where id = vids[i])));
    else
      notes := array_append(notes, format('Nobody picked %s and there was no villager to promote. Assign it by hand if you want it in play.',
        (select name from public.roles where id = specials[i])));
    end if;
  end loop;

  update public.games
     set status = 'night', round = 1, phase_ends_at = now() + make_interval(secs => g.night_seconds)
   where id = p_game;
  return jsonb_build_object('deck', public.deck_preview(g.variant, n), 'notes', to_jsonb(notes));
end $$;

-- ------------------------------------------------------------ GM and player

create function public.set_late_join(p_game uuid, p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_gm(p_game) then raise exception 'Only the Game Master can do that'; end if;
  update public.games set allow_late_join = p_open where id = p_game;
end $$;

create function public.clear_notice(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.player_private pp set notice = null
   where pp.game_id = p_game
     and exists (select 1 from public.players p
                  where p.id = pp.player_id and p.user_id = (select auth.uid()));
end $$;

-- A changed role after the start is announced to that player privately.
create or replace function public.reassign_role(p_player uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid;
  st text;
begin
  select game_id into gid from public.players where id = p_player;
  if gid is null or not public.is_gm(gid) then raise exception 'Only the Game Master can do that'; end if;
  if not exists (select 1 from public.roles where id = p_role) then raise exception 'Unknown role'; end if;
  select status into st from public.games where id = gid;
  update public.player_private
     set notice = case when st <> 'lobby' and role is distinct from p_role
                       then 'The Game Master changed your role. Open your role card to see it.' else notice end,
         role = p_role
   where player_id = p_player;
end $$;

-- ------------------------------------------------------------------- grants
-- New and replaced functions start with default grants; lock them down like 0001 did.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('create_game', 'tap_role', 'start_game', 'set_late_join', 'clear_notice',
                         'reassign_role', '_ensure_player')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname <> '_ensure_player' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;
