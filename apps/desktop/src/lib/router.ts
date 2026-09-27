import { useEffect, useState } from 'react';

/** Routeur minimal basé sur le hash (#/programme, #/exercices…). */
export type Route = 'programme' | 'journal' | 'exercices' | 'nutrition' | 'claude' | 'parametres';

export const ROUTES: Route[] = ['programme', 'journal', 'exercices', 'nutrition', 'claude', 'parametres'];

function current(): Route {
  const r = window.location.hash.replace(/^#\/?/, '').split('/')[0] as Route;
  return ROUTES.includes(r) ? r : 'programme';
}

export function navigate(route: Route): void {
  window.location.hash = `/${route}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const on = () => setRoute(current());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
