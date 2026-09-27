import { formatNumber } from '@training/core';
import { useId, type ReactNode } from 'react';
import { useAutosave } from '../lib/useAutosave.ts';

interface FieldShellProps {
  label: string;
  hint?: string;
  className?: string;
  children: (id: string) => ReactNode;
}

function FieldShell({ label, hint, className, children }: FieldShellProps) {
  const id = useId();
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** Texte à sauvegarde automatique ; chaîne vide → null. */
export function TextField(props: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => unknown;
  placeholder?: string;
  hint?: string;
  className?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const { value, change, flush } = useAutosave(props.value ?? '', (v: string) => {
    const t = v.trim();
    if (props.required && !t) return;
    return props.onSave(t === '' ? null : t);
  });
  return (
    <FieldShell label={props.label} hint={props.hint} className={props.className}>
      {(id) => (
        <input
          id={id}
          value={value}
          placeholder={props.placeholder}
          autoFocus={props.autoFocus}
          onChange={(e) => change(e.target.value)}
          onBlur={flush}
        />
      )}
    </FieldShell>
  );
}

export function TextArea(props: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => unknown;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const { value, change, flush } = useAutosave(props.value ?? '', (v: string) =>
    props.onSave(v.trim() === '' ? null : v),
  );
  return (
    <FieldShell label={props.label} className={props.className}>
      {(id) => (
        <textarea
          id={id}
          value={value}
          rows={props.rows ?? 3}
          placeholder={props.placeholder}
          onChange={(e) => change(e.target.value)}
          onBlur={flush}
        />
      )}
    </FieldShell>
  );
}

const fmt = (n: number | null) => (n == null ? '' : formatNumber(n, 3));

/** Nombre à sauvegarde automatique ; accepte la virgule ; vide → null ; invalide → ignoré. */
export function NumberField(props: {
  label: string;
  value: number | null;
  onSave: (v: number | null) => unknown;
  integer?: boolean;
  min?: number;
  max?: number;
  suffix?: string;
  placeholder?: string;
  className?: string;
}) {
  const parse = (s: string): number | null | undefined => {
    const t = s.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return undefined;
    if (props.integer && !Number.isInteger(n)) return undefined;
    if (props.min != null && n < props.min) return undefined;
    if (props.max != null && n > props.max) return undefined;
    return n;
  };
  const { value, change, flush } = useAutosave(fmt(props.value), (s: string) => {
    const n = parse(s);
    if (n !== undefined && n !== props.value) return props.onSave(n);
  });
  const invalid = parse(value) === undefined;
  return (
    <FieldShell label={props.label} className={`field-number ${props.className ?? ''}`}>
      {(id) => (
        <div className="input-suffix">
          <input
            id={id}
            inputMode="decimal"
            value={value}
            placeholder={props.placeholder ?? '—'}
            aria-invalid={invalid}
            onChange={(e) => change(e.target.value)}
            onBlur={flush}
          />
          {props.suffix && <span>{props.suffix}</span>}
        </div>
      )}
    </FieldShell>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onSave: (v: T) => unknown;
  className?: string;
}) {
  return (
    <FieldShell label={props.label} className={props.className}>
      {(id) => (
        <select id={id} value={props.value} onChange={(e) => props.onSave(e.target.value as T)}>
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => unknown;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${props.disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden />
      <span>
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
    </label>
  );
}
