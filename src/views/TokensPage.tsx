import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { appUrl } from '../router';
import { Page, store } from '../ui';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function makeCodes(n: number): string[] {
  const out = new Set<string>();
  while (out.size < n) {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    out.add(Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join(''));
  }
  return [...out];
}

/** Token codes are just names for physical tokens; roles are never stored on them. */
export function TokensPage() {
  const [count, setCount] = useState(Number(store.get('tokenCount')) || 12);
  const [codes, setCodes] = useState<string[]>(() => {
    try { return JSON.parse(store.get('tokenCodes') || '[]') as string[]; } catch { return []; }
  });
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all(codes.map(async (c) => [c, await QRCode.toDataURL(appUrl(`/t/${c}`), { margin: 1, width: 180 })] as const))
      .then((pairs) => live && setQrs(Object.fromEntries(pairs)));
    return () => { live = false; };
  }, [codes]);

  function generate() {
    const next = makeCodes(Math.min(Math.max(count, 1), 60));
    store.set('tokenCodes', JSON.stringify(next)); store.set('tokenCount', String(count));
    setCodes(next);
  }
  async function copyAll() {
    await navigator.clipboard.writeText(codes.map((c) => appUrl(`/t/${c}`)).join('\n'));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Page title="Physical tokens" back="/">
      <section class="card">
        <p>
          Write one link to each NFC tag as a <strong>URL record</strong> (the free “NFC Tools” app does this).
          iPhones and Android phones open it with a tap, no app needed. Print the QR code onto the token as a backup.
        </p>
        <div class="row">
          <label>How many tokens
            <input type="number" min={1} max={60} value={count}
              onInput={(e) => setCount(Number((e.target as HTMLInputElement).value))} />
          </label>
          <button onClick={generate}>{codes.length ? 'Regenerate' : 'Generate'}</button>
        </div>
        {codes.length > 0 && <button class="ghost" onClick={copyAll}>{copied ? 'Copied!' : 'Copy all links'}</button>}
        <p class="muted">The same tokens work for every game and every game version. Regenerating makes the old tags useless.</p>
      </section>
      <div class="qr-grid">
        {codes.map((c) => (
          <figure key={c} class="qr">
            {qrs[c] && <img src={qrs[c]} alt={`QR for token ${c}`} />}
            <figcaption>{c}</figcaption>
          </figure>
        ))}
      </div>
    </Page>
  );
}
