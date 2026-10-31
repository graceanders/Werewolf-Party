# Werewolf Party

A phone-based Werewolf for a long party. Rounds run on configurable timers, roles can be revealed by tapping a physical NFC card (or scanning its QR code), chat is anonymous, and the Game Master has their own view.

- **Frontend:** Vite + Preact + TypeScript, hosted on GitHub Pages.
- **Backend:** Supabase (Postgres, realtime, anonymous auth). All game rules live in `supabase/migrations/`; clients can only read through row-level security and write through functions.

## One-time setup

1. **Database.** In the Supabase dashboard open **SQL Editor**, paste each file in `supabase/migrations/` in order (0001, 0002, 0003) and run it once.
2. **Anonymous sign-ins.** Authentication → Sign In / Providers → turn on **Allow anonymous sign-ins**.
3. **Pages.** In the GitHub repo: Settings → Pages → Source: **GitHub Actions**. Every push to `main` deploys.

The Supabase URL and publishable key are in `src/supabase.ts` (both are safe to be public). Override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` in `.env.local` if needed. Never put the Supabase **secret** key in this repo.

## Run locally

```bash
npm install
npm run dev
```

## How a game works

1. The GM creates a game (version, day/night length, PIN, and how roles are given out) and shares the 4-letter code.
2. **Physical role cards:** players pick a card, tap it, and see their role and what it does. **No cards:** players join by code and the app deals roles randomly.
3. The GM starts the game. With role cards, anyone without a card is dealt a missing role, and if a role was never picked up (say a werewolf), a random villager is promoted into it. Nobody loses a role they picked, and only villagers are promoted.
4. Anyone can join late, with or without a card, and becomes a villager. The GM can switch late joining off.
5. The GM advances night and day, kills players, reassigns roles, and runs night actions with the on-screen script. Players vote by day and chat anonymously (Town, Wolves at night, Graveyard).

## Physical role cards

See [nfc/README.md](nfc/README.md) for the tag contents, tag types and how to write them, and `npm run nfc` to regenerate the files in `nfc/roles/`. The app also has a printable page at `#/cards`. If someone changes phone or browser, the GM taps **Unlink phone**, and the player joins again with the same name to get their seat back.

## Adding variants and roles

Add rows to `roles` and `variants`, and extend `build_deck` in a new migration.

## Not built yet

- Push notifications when the app is closed (in-app banner, vibration, and a browser notification while the tab is open work today).
- Automatic phase change when the timer hits zero (the GM advances it).
- Automated night-action resolution; the GM narrates and applies results.
