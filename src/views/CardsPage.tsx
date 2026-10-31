import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { ensureSession, supabase } from '../supabase';
import { appUrl } from '../router';
import type { Role } from '../types';
import { ErrorNote, Page } from '../ui';

/** One printable card per role, with the exact link to write to its NFC tag. */
export function CardsPage() {
  const [cards, setCards] = useState<{ role: Role; url: string; qr: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await ensureSession();
        const { data, error: e } = await supabase.from('roles').select('*').order('night_order', { nullsFirst: false });
        if (e) throw new Error(e.message);
        setCards(await Promise.all(((data ?? []) as Role[]).map(async (role) => {
          const url = appUrl(`/r/${role.id}`);
          return { role, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 180 }) };
        })));
      } catch (e) { setError((e as Error).message); }
    })();
  }, []);

  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ }
  }

  return (
    <Page title="Role cards" back="/">
      <section class="card">
        <p>
          Write each role's link to an NFC tag as a <strong>URL record</strong> (the free “NFC Tools” app does this), and
          stick the tag to a card. A tap opens this site, assigns the role, and shows what it does. Print the QR code on
          the card as a backup for phones without NFC.
        </p>
        <p class="muted">
          The description comes from the app, so it is not stored on the tag. Print this page to get the cards.
          The <code>nfc/</code> folder in the repo has the same links as files.
        </p>
      </section>
      <ErrorNote message={error} />
      <div class="qr-grid">
        {cards.map(({ role, url, qr }) => (
          <figure key={role.id} class="qr role-card">
            <h3>{role.name}</h3>
            <img src={qr} alt={`QR for ${role.name}`} />
            <figcaption>{role.description}</figcaption>
            <button class="small ghost no-print" onClick={() => copy(url, role.id)}>{copied === role.id ? 'Copied!' : 'Copy link'}</button>
          </figure>
        ))}
      </div>
    </Page>
  );
}
