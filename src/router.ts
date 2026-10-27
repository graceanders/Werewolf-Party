import { useEffect, useState } from 'preact/hooks';

const read = () => location.hash.replace(/^#/, '') || '/';

export function useRoute(): string {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function go(path: string) {
  location.hash = path;
}

/** Full link that opens `path` in this app, for NFC tags and sharing. */
export function appUrl(path: string) {
  return `${location.origin}${import.meta.env.BASE_URL}#${path}`;
}
