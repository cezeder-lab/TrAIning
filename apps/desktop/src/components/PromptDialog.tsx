import { useState } from 'react';
import { Modal } from './Modal.tsx';

/** Demande un texte court (ex. nom d'une nouvelle séance). */
export function PromptDialog(props: {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => unknown;
  onClose: () => void;
}) {
  const [value, setValue] = useState(props.initial ?? '');
  const submit = async () => {
    if (!value.trim()) return;
    await props.onSubmit(value.trim());
    props.onClose();
  };
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" disabled={!value.trim()} onClick={() => void submit()}>
            {props.confirmLabel ?? 'Valider'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="prompt-input">{props.label}</label>
        <input
          id="prompt-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </div>
    </Modal>
  );
}
