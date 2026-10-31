-- Witch potions and clearer Witch / Cupid wording.
--   * Each night the Witch is asked whether to use a potion. At most ONE per night.
--   * Two single-use potions: save (spare the wolves' victim) and poison (kill any player).
--   * Her choice is recorded for the Game Master, who applies it (night actions are not automatic).
-- Run once in the Supabase SQL Editor (after 0001 to 0004). Safe to re-run.

begin;

alter table public.player_private add column if not exists witch_save_used boolean not null default false;
alter table public.player_private add column if not exists witch_poison_used boolean not null default false;
alter table public.player_private add column if not exists witch_round int not null default 0;   -- last night she answered
alter table public.player_private add column if not exists witch_action text;                     -- 'save' | 'poison' | 'pass' for that night
alter table public.player_private add column if not exists witch_target uuid references public.players (id) on delete set null;

update public.roles set description =
  'You have two potions, each usable once per game: one saves the wolves'' victim, one poisons any player. You can use only one potion per night. Each night you will be asked whether to use one.'
 where id = 'witch';
update public.roles set description =
  'On the first night, choose two players (you may choose yourself) to fall in love. They learn each other''s names, and if one dies, the other dies of heartbreak. If one of the two is a werewolf, the lovers win only by being the last players alive.'
 where id = 'cupid';

drop function if exists public.witch_act(uuid, text, uuid);

create function public.witch_act(p_game uuid, p_action text, p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.games;
  me uuid;
  pr public.player_private;
begin
  select * into g from public.games where id = p_game;
  if not found or g.status <> 'night' then raise exception 'The witch acts at night'; end if;
  if p_action not in ('save', 'poison', 'pass') then raise exception 'Unknown action'; end if;

  select p.id into me from public.players p
    join public.player_private x on x.player_id = p.id
   where p.game_id = p_game and p.user_id = (select auth.uid()) and x.role = 'witch' and p.alive;
  if me is null then raise exception 'Only a living Witch can do that'; end if;

  select * into pr from public.player_private where player_id = me;
  if pr.witch_round = g.round then raise exception 'You have already answered tonight'; end if;

  if p_action = 'save' then
    if pr.witch_save_used then raise exception 'Your save potion is already used'; end if;
    update public.player_private set witch_save_used = true, witch_round = g.round,
           witch_action = 'save', witch_target = null where player_id = me;
  elsif p_action = 'poison' then
    if pr.witch_poison_used then raise exception 'Your poison potion is already used'; end if;
    if not exists (select 1 from public.players where id = p_target and game_id = p_game and alive) then
      raise exception 'Choose a living player to poison';
    end if;
    update public.player_private set witch_poison_used = true, witch_round = g.round,
           witch_action = 'poison', witch_target = p_target where player_id = me;
  else
    update public.player_private set witch_round = g.round, witch_action = 'pass', witch_target = null
     where player_id = me;
  end if;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'witch_act'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

commit;
