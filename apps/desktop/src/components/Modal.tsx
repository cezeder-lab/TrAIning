import { useEffect, useRef, type ReactNode } from 'react';

/** Fenêtre modale basée sur <dialog> : focus piégé, Échap pour fermer. */
export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      style={{ width: props.width ?? 520 }}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      <header className="modal-header">
        <h2>{props.title}</h2>
        <button type="button" className="btn-icon" aria-label="Fermer" onClick={props.onClose}>
          ✕
        </button>
      </header>
      <div className="modal-body">{props.children}</div>
      {props.footer && <footer className="modal-footer">{props.footer}</footer>}
    </dialog>
  );
}
