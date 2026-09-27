import { useAutosave } from '../lib/useAutosave.ts';

/** Titre éditable sur place (nom du programme, d'une séance). Vide → refusé. */
export function InlineTitle(props: {
  value: string;
  onSave: (v: string) => unknown;
  level: 1 | 2;
  ariaLabel: string;
}) {
  const { value, change, flush } = useAutosave(props.value, (v: string) => {
    if (v.trim() && v.trim() !== props.value) return props.onSave(v.trim());
  });
  return (
    <input
      className={`inline-title inline-title-${props.level}`}
      aria-label={props.ariaLabel}
      value={value}
      onChange={(e) => change(e.target.value)}
      onBlur={() => {
        if (!value.trim()) change(props.value);
        flush();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
