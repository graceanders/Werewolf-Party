# Werewolf Party

A phone-based Werewolf for a long party. Rounds run on configurable timers, roles are revealed by tapping a physical NFC token (or scanning its QR code), chat is anonymous, and the Game Master has their own view.

- **Frontend:** Vite + Preact + TypeScript, hosted on GitHub Pages.
- **Backend:** Supabase (Postgres, realtime, anonymous auth). All game rules live in `supabase/migrations/0001_init.sql`; clients can only read through row-level security and write through functions.

## One-time setup

1. **Database.** In the Supabase dashboard open **SQL Editor**, paste `supabase/migrations/0001_init.sql`, and run it once.
2. **Anonymous sign-ins.** Authentication → Sign In / Providers → turn on **Allow anonymous sign-ins**.
3. **Pages.** In the GitHub repo: Settings → Pages → Source: **GitHub Actions**. Every push to `main` deploys.

The Supabase URL and publishable key are in `src/supabase.ts` (both are safe to be public). Override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` in `.env.local` if needed. Never put the Supabase **secret** key in this repo.

## Run locally

```bash
npm install
npm run dev
```

## How a game works

1. The GM creates a game (version, day/night length, PIN) and shares the 4-letter code.
2. Players join by code, or by tapping a token, which checks them in.
3. The GM starts the game. Roles are dealt **only among players who are present**, so a werewolf can never be stranded on an unclaimed token. Anyone arriving later becomes a villager (the GM can reassign).
4. The GM advances night and day, kills players, reassigns roles, and runs night actions with the on-screen script. Players vote by day and chat anonymously (Town, Wolves at night, Graveyard).

## Physical tokens

Open `#/tokens` to generate token codes and QR codes. Write each link to an NFC tag as a plain URL record (e.g. with the free NFC Tools app). Tags hold only a token ID, never a role, so the same tags work for every game and variant. The first phone to tap a token owns it; other phones see "already claimed". If someone changes phone or browser, the GM taps **Unlink phone** and the player taps the token again.

## Adding variants and roles

Add rows to `roles` and `variants`, and extend `build_deck` in a new migration.

## Not built yet

- Push notifications when the app is closed (in-app banner, vibration, and a browser notification while the tab is open work today).
- Automatic phase change when the timer hits zero (the GM advances it).
- Automated night-action resolution; the GM narrates and applies results.
