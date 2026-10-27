import { useEffect, useRef, useState } from 'preact/hooks';
import { rpc } from '../supabase';
import type { Channel, Message } from '../types';
import { ErrorNote, useAction } from '../ui';

const LABELS: Record<Channel, string> = { town: 'Town', wolves: 'Wolves', dead: 'Graveyard' };

export function Chat({ gameId, messages, channels, canWrite }: {
  gameId: string; messages: Message[]; channels: Channel[]; canWrite: (c: Channel) => string | null;
}) {
  const [channel, setChannel] = useState<Channel>(channels[0] ?? 'town');
  const [text, setText] = useState('');
  const { busy, error, run } = useAction();
  const list = useRef<HTMLDivElement>(null);
  const active = channels.includes(channel) ? channel : channels[0] ?? 'town';
  const shown = messages.filter((m) => m.channel === active);
  const blocked = canWrite(active);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [shown.length, active]);

  async function send(e: Event) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    await run(async () => {
      await rpc('send_message', { p_game: gameId, p_channel: active, p_body: body });
      setText('');
    });
  }

  return (
    <section class="card chat">
      <div class="tabs">
        {channels.map((c) => (
          <button key={c} class={c === active ? 'tab on' : 'tab'} onClick={() => setChannel(c)}>{LABELS[c]}</button>
        ))}
      </div>
      <div class="messages" ref={list}>
        {shown.length === 0 && <p class="muted">Nothing said yet.</p>}
        {shown.map((m) => (
          <p key={m.id} class={m.is_gm ? 'msg gm' : 'msg'}>
            <strong>{m.alias}</strong> {m.body}
          </p>
        ))}
      </div>
      <form class="row" onSubmit={send}>
        <input value={text} maxLength={500} disabled={!!blocked}
          placeholder={blocked ?? 'Say something (anonymous)…'}
          onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        <button disabled={busy || !!blocked || !text.trim()}>Send</button>
      </form>
      <ErrorNote message={error} />
    </section>
  );
}
