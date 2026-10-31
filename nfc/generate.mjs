// Builds the NFC tag contents for every role: `npm run nfc`
//
// Reads the role list straight from the Supabase `roles` table, so a role added
// to the database gets a tag the next time this runs. For each role it writes,
// into nfc/roles/:
//   <role>.url.txt   the link to write to the tag (URL record)
//   <role>.text.txt  optional text record with the role description
//   <role>.png       QR code of the same link, as a printable backup
// plus cards.html, a printable sheet with one card per role.
//
// Usage: npm run nfc [-- https://your-site/base/]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';

const SITE = (process.argv[2] ?? 'https://graceanders.github.io/Werewolf-Party/').replace(/\/?$/, '/');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://xjtuhraxdwqqhpmfcnmh.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_KEY ?? 'sb_publishable_9qXCCDDXOt3_-zDAom-f1w_4DUUheQ2';
const out = join(dirname(fileURLToPath(import.meta.url)), 'roles');
mkdirSync(out, { recursive: true });

// Node 20 has no built-in WebSocket; this script never uses realtime.
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: class NoSocket {} },
});
const { error: authError } = await supabase.auth.signInAnonymously();
if (authError) throw new Error(`Could not sign in to Supabase: ${authError.message}`);
const { data: roles, error } = await supabase.from('roles').select('*').order('night_order', { nullsFirst: false });
if (error) throw new Error(error.message);

// Rough NDEF size so you can pick a tag. Usable bytes: NTAG213 ~137, NTAG215 ~492, NTAG216 ~868.
const bytes = (s) => new TextEncoder().encode(s).length;
const urlRecord = (u) => 4 + 1 + bytes(u.replace(/^https?:\/\/(www\.)?/, ''));
const textRecord = (t) => 4 + 3 + bytes(t);
const tag = (n) => (n <= 137 ? 'NTAG213' : n <= 492 ? 'NTAG215' : 'NTAG216');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const cards = [];
console.log(`Site: ${SITE}\n`);
for (const r of roles) {
  const url = `${SITE}#/r/${r.id}`;
  const text = `${r.name}: ${r.description}`;
  writeFileSync(join(out, `${r.id}.url.txt`), url);
  writeFileSync(join(out, `${r.id}.text.txt`), text);
  const png = await QRCode.toBuffer(url, { margin: 2, width: 400 });
  writeFileSync(join(out, `${r.id}.png`), png);
  const urlOnly = urlRecord(url) + 3;
  const both = urlOnly + textRecord(text);
  console.log(`${r.name.padEnd(10)} link only ~${urlOnly} B (${tag(urlOnly)})   link + description ~${both} B (${tag(both)})`);
  cards.push(`
    <article class="${r.team}">
      <h2>${esc(r.name)}</h2>
      <img src="data:image/png;base64,${png.toString('base64')}" alt="QR code for ${esc(r.name)}" />
      <p>${esc(r.description)}</p>
      <code>${esc(url)}</code>
    </article>`);
}

writeFileSync(join(out, 'cards.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Werewolf role tags</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
  article { border: 2px solid #999; border-radius: 12px; padding: 12px; break-inside: avoid; text-align: center; }
  article.wolf { border-color: #c33; } article.village { border-color: #2a8; }
  img { width: 170px; height: 170px; } h2 { margin: 0 0 6px; } code { font-size: 10px; word-break: break-all; color: #555; }
</style></head><body>
<h1>Werewolf role tags</h1>
<p>One card per role. Make one tag per player you expect, using the recommended mix from the Game Master screen.</p>
<div class="grid">${cards.join('')}</div>
</body></html>`);

console.log(`\nWrote ${roles.length} roles to ${out}`);
