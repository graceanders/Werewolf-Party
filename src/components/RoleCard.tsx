import { useState } from 'preact/hooks';
import type { Role } from '../types';

const ICONS: Record<string, string> = {
  villager: '🧑‍🌾', werewolf: '🐺', seer: '🔮', doctor: '🩺', hunter: '🏹', witch: '🧪', cupid: '💘',
};

/** Hidden by default so a glance over the shoulder doesn't spoil the game. */
export function RoleCard({ role, alias, packmates }: {
  role: Role | null; alias: string; packmates: { name: string; alive: boolean }[];
}) {
  const [shown, setShown] = useState(false);
  if (!role) {
    return <section class="card"><h2>Your role</h2><p class="muted">Roles are dealt when the Game Master starts the game.</p></section>;
  }
  return (
    <section class={`card role ${shown ? role.team : ''}`}>
      <h2>Your role</h2>
      {shown ? (
        <>
          <div class="role-icon">{ICONS[role.id] ?? '❔'}</div>
          <h3>{role.name}</h3>
          <p>{role.description}</p>
          {role.id === 'werewolf' && packmates.length > 0 && (
            <p class="pack">Your pack: {packmates.map((p) => (p.alive ? p.name : `${p.name} ✝`)).join(', ')}</p>
          )}
          <p class="muted">Chat alias: {alias}</p>
        </>
      ) : (
        <p class="muted">Tap to reveal. Make sure nobody is looking.</p>
      )}
      <button class="ghost" onClick={() => setShown(!shown)}>{shown ? 'Hide role' : 'Show role'}</button>
    </section>
  );
}
