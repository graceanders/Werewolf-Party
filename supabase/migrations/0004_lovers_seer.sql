-- Cupid and lovers, plus the Seer's wording.
--   * Cupid picks two players (themselves allowed) on night 1, from their own phone.
--   * Each lover gets a private notice naming the other. Only if one of the pair is a
--     werewolf does it also say "one of you is a werewolf" (without saying which, so two
--     werewolves in love don't learn about each other).
--   * If a lover dies, the other dies of heartbreak.
--   * The Seer now sees a player's true role.
-- Run once in the Supabase SQL Editor (after 0001 to 0003). Safe to re-run.

begin;

alter table public.player_private add column if not exists lover_id uuid references public.players (id) on delete set null;
alter table public.player_private add column if not exists cupid_done boolean not null default false;

alter table public.games drop constraint if exists games_winner_check;
alter table public.games add constraint games_winner_check check (winner in ('village', 'wolf', 'solo', 'lovers', 'none'));

update public.roles set description =
  'Each night you learn one player''s true role. Guide the village without painting a target on yourself.'
 where id = 'seer';
update public.roles set description =
  'On the first night, choose two players (you may choose yourself) to fall in love. They learn each other''s names, and if one dies, the other dies of heartbreak.'
 where id = 'cupid';

drop function if exists public.cupid_link(uuid, uuid, uuid);

-- Cupid (or the GM, as a fallback) links two players.
create function public.cupid_link(p_game uuid, p_a uuid, p_b uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  gm boolean := public.is_gm(p_game);
  caller uuid;
  ra text; rb text;
  na text; nb text;
  wolfy boolean;
  extra text;
begin
  select * into g from public.games where id = p_game;
  if not found then raise exception 'No such game'; end if;
  if g.status in ('lobby', 'ended') then raise exception 'The game is not running'; end if;

  if not gm then
    select p.id into caller from public.players p
      join public.player_private pp on pp.player_id = p.id
     where p.game_id = p_game and p.user_id = (select auth.uid()) and pp.role = 'cupid' and p.alive;
    if caller is null then raise exception 'Only Cupid can do that'; end if;
    if g.status <> 'night' or g.round <> 1 then raise exception 'Cupid only chooses on the first night'; end if;
  end if;

  if exists (select 1 from public.player_private where game_id = p_game and cupid_done) then
    raise exception 'The lovers have already been chosen';
  end if;
  if p_a is null or p_b is null or p_a = p_b then raise exception 'Choose two different players'; end if;

  select pp.role, p.name into ra, na from public.players p join public.player_private pp on pp.player_id = p.id
   where p.id = p_a and p.game_id = p_game and p.alive;
  select pp.role, p.name into rb, nb from public.players p join public.player_private pp on pp.player_id = p.id
   where p.id = p_b and p.game_id = p_game and p.alive;
  if na is null or nb is null then raise exception 'Both lovers must be living players in this game'; end if;

  wolfy := ra = 'werewolf' or rb = 'werewolf';
  extra := case when wolfy then
    E'\nOne of you is a werewolf. Your goal is now to survive together, so you must eliminate everyone else.'
    else '' end;

  update public.player_private set lover_id = p_b,
    notice = concat_ws(E'\n\n', notice,
      format('💘 Cupid has made you fall in love with %s. If either of you dies, the other dies of heartbreak.%s', nb, extra))
   where player_id = p_a;
  update public.player_private set lover_id = p_a,
    notice = concat_ws(E'\n\n', notice,
      format('💘 Cupid has made you fall in love with %s. If either of you dies, the other dies of heartbreak.%s', na, extra))
   where player_id = p_b;
  update public.player_private set cupid_done = true where game_id = p_game and role = 'cupid';
end $$;

-- Killing one lover kills the other (heartbreak).
create or replace function public.set_alive(p_player uuid, p_alive boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid;
  lid uuid;
  pname text;
begin
  select game_id, name into gid, pname from public.players where id = p_player;
  if gid is null or not public.is_gm(gid) then raise exception 'Only the Game Master can do that'; end if;
  update public.players set alive = p_alive where id = p_player;
  if not p_alive then
    select lover_id into lid from public.player_private where player_id = p_player;
    if lid is not null and exists (select 1 from public.players where id = lid and alive) then
      update public.players set alive = false where id = lid;
      update public.player_private
         set notice = concat_ws(E'\n\n', notice, format('💔 %s has died, and you die of heartbreak.', pname))
       where player_id = lid;
    end if;
  end if;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('cupid_link', 'set_alive')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;
