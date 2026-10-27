-- Fix: `deck || 'werewolf'` makes Postgres parse the literal as an array
-- ("malformed array literal"). Use array_append so the element type is explicit.
-- Safe to run on its own: it only replaces one function.
create or replace function public.build_deck(p_variant text, p_n int) returns text[]
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

-- create or replace keeps existing grants, but restate the lock-down to be sure.
revoke all on function public.build_deck(text, int) from public, anon, authenticated;
