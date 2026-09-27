import { CARDIO_ACTIVITIES, createCardio, deleteCardio, updateCardio, type CardioInput, type CardioSession } from '@training/core';
import { useState } from 'react';
import { Modal } from '../../components/Modal.tsx';
import { ScalePicker } from '../../components/ScalePicker.tsx';
import { useAction, useApp } from '../../lib/app.tsx';

const num = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const str = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

/** Création / modification d'une séance de cardio. */
export function CardioDialog(props: { date: string; sessionId?: string | null; cardio?: CardioSession; onClose: () => void }) {
  const c = props.cardio;
  const run = useAction();
  const { confirm } = useApp();
  const [f, setF] = useState({
    date: c?.date ?? props.date,
    startTime: c?.startTime ?? '',
    activity: c?.activity ?? '',
    minutes: c ? str(Math.round((c.durationS / 60) * 10) / 10) : '',
    distanceKm: c?.distanceM != null ? str(c.distanceM / 1000) : '',
    speedKmh: str(c?.speedKmh),
    inclineOrLevel: c?.inclineOrLevel ?? '',
    hrAvg: str(c?.hrAvg),
    hrMax: str(c?.hrMax),
    calories: str(c?.caloriesWatchEst),
    feeling: c?.feeling ?? null,
    comment: c?.comment ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const minutes = num(f.minutes);
  const valid = f.activity.trim() !== '' && minutes != null && minutes > 0;

  const save = async () => {
    if (!valid) return;
    const km = num(f.distanceKm);
    const toInt = (s: string) => (num(s) == null ? null : Math.round(num(s)!));
    const input: CardioInput = {
      date: f.date,
      startTime: f.startTime || null,
      sessionId: c?.sessionId ?? props.sessionId ?? null,
      activity: f.activity.trim(),
      durationS: Math.round(minutes! * 60),
      distanceM: km == null ? null : Math.round(km * 1000),
      speedKmh: num(f.speedKmh),
      inclineOrLevel: f.inclineOrLevel.trim() || null,
      hrAvg: toInt(f.hrAvg),
      hrMax: toInt(f.hrMax),
      caloriesWatchEst: toInt(f.calories),
      feeling: f.feeling,
      comment: f.comment.trim() || null,
    };
    const ok = await run(async (db) => {
      if (c) await updateCardio(db, c.id, input);
      else await createCardio(db, input);
      return true;
    }, c ? 'Cardio mis à jour.' : 'Cardio enregistré.');
    if (ok) props.onClose();
  };

  const remove = async () => {
    if (!c) return;
    if (!(await confirm({ title: 'Supprimer le cardio', message: `Supprimer « ${c.activity} » du ${c.date} ?`, confirmLabel: 'Supprimer', danger: true }))) return;
    if (await run(async (db) => (await deleteCardio(db, c.id), true))) props.onClose();
  };

  return (
    <Modal
      title={c ? 'Modifier le cardio' : 'Nouvelle séance de cardio'}
      onClose={props.onClose}
      width={620}
      footer={
        <>
          {c && (
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => void remove()}>
              Supprimer
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={props.onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => void save()}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="grid grid-3">
        <label className="field span-2">
          <span className="field-label">Activité *</span>
          <input list="cardio-activities" autoFocus value={f.activity} onChange={set('activity')} placeholder="ex. Marche inclinée" />
          <datalist id="cardio-activities">
            {CARDIO_ACTIVITIES.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span className="field-label">Durée (min) *</span>
          <input inputMode="decimal" value={f.minutes} onChange={set('minutes')} />
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" value={f.date} onChange={set('date')} />
        </label>
        <label className="field">
          <span className="field-label">Heure</span>
          <input type="time" value={f.startTime} onChange={set('startTime')} />
        </label>
        <label className="field">
          <span className="field-label">Inclinaison / niveau</span>
          <input value={f.inclineOrLevel} onChange={set('inclineOrLevel')} placeholder="ex. 12 %, niveau 8" />
        </label>
        <label className="field">
          <span className="field-label">Vitesse (km/h)</span>
          <input inputMode="decimal" value={f.speedKmh} onChange={set('speedKmh')} />
        </label>
        <label className="field">
          <span className="field-label">Distance (km)</span>
          <input inputMode="decimal" value={f.distanceKm} onChange={set('distanceKm')} />
        </label>
        <label className="field">
          <span className="field-label">Calories montre (estimation)</span>
          <input inputMode="numeric" value={f.calories} onChange={set('calories')} />
        </label>
        <label className="field">
          <span className="field-label">FC moyenne</span>
          <input inputMode="numeric" value={f.hrAvg} onChange={set('hrAvg')} />
        </label>
        <label className="field">
          <span className="field-label">FC max</span>
          <input inputMode="numeric" value={f.hrMax} onChange={set('hrMax')} />
        </label>
      </div>
      <ScalePicker label="Ressenti (1 = très dur, 5 = très facile)" min={1} max={5} value={f.feeling} onChange={(feeling) => setF({ ...f, feeling })} />
      <label className="field">
        <span className="field-label">Commentaire</span>
        <textarea rows={2} value={f.comment} onChange={set('comment')} />
      </label>
    </Modal>
  );
}
