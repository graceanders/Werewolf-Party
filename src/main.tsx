import { render } from 'preact';
import { useRoute } from './router';
import { Home } from './views/Home';
import { RoleTagView } from './views/RoleTagView';
import { CardsPage } from './views/CardsPage';
import { PlayerView } from './views/PlayerView';
import { GmView } from './views/GmView';
import './styles.css';

function App() {
  const route = useRoute();
  const parts = route.split('/').filter(Boolean);
  if (parts[0] === 'r' && parts[1]) return <RoleTagView role={parts[1]} />;
  if (parts[0] === 'g' && parts[1]) return <PlayerView gameId={parts[1]} />;
  if (parts[0] === 'gm' && parts[1]) return <GmView gameId={parts[1]} />;
  if (parts[0] === 'cards') return <CardsPage />;
  return <Home />;
}

render(<App />, document.getElementById('app')!);
