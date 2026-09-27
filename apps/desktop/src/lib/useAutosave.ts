import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Champ à sauvegarde automatique : valeur locale pendant la saisie, écriture en base
 * après une courte pause (debounce), à la perte de focus et au démontage.
 * La valeur venant de la base remplace la valeur locale quand le champ n'est pas en cours d'édition.
 */
export function useAutosave<T>(serverValue: T, save: (v: T) => unknown, delay = 400) {
  const [value, setValue] = useState<T>(serverValue);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ value, save });
  latest.current = { value, save };

  useEffect(() => {
    if (!dirty.current) setValue(serverValue);
  }, [serverValue]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    void latest.current.save(latest.current.value);
  }, []);

  const change = useCallback(
    (v: T) => {
      setValue(v);
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [flush]);

  return { value, change, flush };
}
