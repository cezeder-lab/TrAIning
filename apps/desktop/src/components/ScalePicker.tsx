/** Échelle 0-10 (fatigue, courbatures, douleur) ; recliquer sur la valeur l'efface. */
export function ScalePicker(props: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => unknown;
  min?: number;
  max?: number;
  hint?: string;
}) {
  const min = props.min ?? 0;
  const max = props.max ?? 10;
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      <div className="scale" role="radiogroup" aria-label={props.label}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={props.value === v}
            className={`scale-step ${props.value === v ? 'is-selected' : ''} ${props.value != null && v <= props.value ? 'is-filled' : ''}`}
            style={{ ['--level' as string]: (v - min) / (max - min) }}
            onClick={() => props.onChange(props.value === v ? null : v)}
          >
            {v}
          </button>
        ))}
      </div>
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </div>
  );
}
