import { useEffect, useState } from 'react';

/** Routeur minimal basé sur le hash : #/journal, #/journal/<id-séance>… */
export type Route = 'programme' | 'journal' | 'exercices' | 'nutrition' | 'corps' | 'claude' | 'parametres';

export const ROUTES: Route[] = ['programme', 'journal', 'exercices', 'nutrition', 'corps', 'claude', 'parametres'];

export interface Location {
  route: Route;
  param: string | null;
}

function current(): Location {
  const [r, param] = window.location.hash.replace(/^#\/?/, '').split('/');
  const route = ROUTES.includes(r as Route) ? (r as Route) : 'programme';
  return { route, param: param ? decodeURIComponent(param) : null };
}

export function navigate(route: Route, param?: string): void {
  window.location.hash = param ? `/${route}/${encodeURIComponent(param)}` : `/${route}`;
}

export function useLocation(): Location {
  const [loc, setLoc] = useState<Location>(current);
  useEffect(() => {
    const on = () => setLoc(current());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return loc;
}
