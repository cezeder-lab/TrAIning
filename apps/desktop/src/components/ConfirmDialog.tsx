import { Modal } from './Modal.tsx';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog(props: ConfirmRequest & { onClose: (ok: boolean) => void }) {
  return (
    <Modal
      title={props.title}
      onClose={() => props.onClose(false)}
      width={440}
      footer={
        <>
          <button type="button" className="btn" onClick={() => props.onClose(false)}>
            Annuler
          </button>
          <button
            type="button"
            autoFocus
            className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => props.onClose(true)}
          >
            {props.confirmLabel ?? 'Confirmer'}
          </button>
        </>
      }
    >
      <p className="pre-line">{props.message}</p>
    </Modal>
  );
}
