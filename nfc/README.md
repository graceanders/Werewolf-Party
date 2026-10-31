# NFC role cards

Each role gets its own physical card with an NFC tag on it. A player picks a card from a bowl, taps it with their phone, and the app assigns that role and shows what it does. This is the **Physical role cards** game mode.

## What is on the tag

| File in `roles/` | What it is |
|---|---|
| `<role>.url.txt` | The link to write as a **URL record**. This is the part that matters. |
| `<role>.text.txt` | Optional **text record** with the role description. |
| `<role>.png` | QR code for the same link, to print on the card as a backup. |
| `cards.html` | Printable sheet, one card per role. Open it and print. |

You can also print cards from the app itself: open the site and use **Print role cards**.

The description the player reads comes from the app, not from the tag. Phones open the link and the app shows the role and its description. That also means changing a role's wording in the database updates every tag you've already written.

**The text record is optional and rarely seen.** iPhones and most Android phones only act on the link when a tag is tapped; the text is for NFC reader apps. It also needs a bigger tag (see below). Skip it unless you want the tag to be readable on its own.

## Which tags to buy

| Tag | Fits |
|---|---|
| NTAG213 (about 137 usable bytes) | the link only. Cheapest, and all you need. |
| NTAG215 (about 492 bytes) | the link plus the description |
| NTAG216 (about 868 bytes) | the same, with room to spare |

Stickers, coins or cards all work. iPhone XS and newer and nearly every Android phone read them with no app.

## Writing a tag

1. Install a free NFC writer app (**NFC Tools** on Android or iPhone).
2. Write → Add a record → **URL / URI**, and paste the contents of the role's `.url.txt`.
3. Optional: Add a record → **Text**, and paste the contents of `.text.txt`.
4. Tap **Write**, hold the tag to the back of your phone.
5. Test it: tap the tag and check the browser opens the right page.
6. When it works, lock the tag (Other → **Lock tag**) so nobody can overwrite it. This can't be undone.

## How many of each

The Game Master lobby shows the **recommended cards** for the number of players that have joined (for example, 1 werewolf, 1 seer and 3 villagers for 5 players). Make a few spare villager cards. Villagers are the role most often needed.

## What if the bowl is wrong

When the game starts, the app compares what people picked with the recommended mix:

- Players who joined without a card are dealt a role that is missing.
- If a role is still missing (say nobody grabbed a werewolf), a **random villager is promoted** into it. That player sees a private note that their role changed, and the Game Master sees who it was.
- **Nobody ever loses a role they picked.** Only villagers are promoted, and extra roles (a third werewolf, say) stay as picked.
- If a role is missing and there is no villager to promote, the Game Master is told and can assign it by hand.
- Anyone who joins after the start becomes a villager, with or without a card. The Game Master can switch late joining off.

## Honest limits of this mode

Role cards work on trust. The link on each tag names its role, and this folder is public, so a determined player could read a tag with an NFC reader app, or type a role's link by hand, and give themselves a role they want. For a friendly party that is usually fine, and the Game Master can see every player's role. If you want a mode that can't be gamed this way, use **No cards**, where the app deals the roles in secret.

## Regenerating

```bash
npm run nfc
```

This reads the roles from the database and rewrites everything in `roles/`. To point the links somewhere else (for example a custom domain):

```bash
npm run nfc -- https://example.com/werewolf/
```

Tags you've already written keep working as long as the site stays at the same address.
