import {
  BLOCK_LABELS,
  addPain,
  addSessionExercise,
  deletePain,
  deleteSession,
  nowIso,
  updateSession,
  type SessionStatus,
  type WorkoutSession,
} from '@training/core';
import { Fragment, useState } from 'react';
import { ExercisePicker } from '../../components/ExercisePicker.tsx';
import { InlineTitle } from '../../components/InlineTitle.tsx';
import { ScalePicker } from '../../components/ScalePicker.tsx';
import { TextArea } from '../../components/fields.tsx';
import { useAction, useApp } from '../../lib/app.tsx';
import { formatDuration, formatLongDate } from '../../lib/dates.ts';
import { useSession } from '../../lib/queries.ts';
import { navigate } from '../../lib/router.ts';
import { SheetExportDialog } from '../sheet-export/SheetExportDialog.tsx';
import { CardioDialog } from './CardioDialog.tsx';
import { SessionExerciseCard } from './SessionExerciseCard.tsx';

const STATUSES: { value: SessionStatus; label: string }[] = [
  { value: 'planned', label: 'Prévue' },
  { value: 'done', label: 'Faite' },
  { value: 'skipped', label: 'Sautée' },
];

export function SessionPage({ id }: { id: string }) {
  const { data: session, isLoading } = useSession(id);
  const run = useAction();
  const { confirm } = useApp();
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (isLoading) return <div className="page-loading">Chargement…</div>;
  if (!session) {
    return (
      <div className="page">
        <p className="empty-state">Séance introuvable (supprimée ?).</p>
        <a className="btn" href="#/journal">
          ← Journal
        </a>
      </div>
    );
  }

  const enabled = session.exercises.filter((e) => e.isEnabled);
  const sets = enabled.flatMap((e) => e.setEntries.filter((s) => !s.isWarmup));
  const done = sets.filter((s) => s.isDone).length;

  const remove = async () => {
    const ok = await confirm({
      title: 'Supprimer la séance',
      message: `Supprimer « ${session.name} » du ${formatLongDate(session.date)} et toutes ses séries ?`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok && (await run(async (db) => (await deleteSession(db, session.id), true)))) navigate('journal');
  };

  const finish = async () => {
    await run((db) => updateSession(db, session.id, { status: 'done', endedAt: session.endedAt ?? nowIso() }), 'Séance enregistrée.');
    navigate('journal');
  };

  return (
    <div className="page session-page">
      <header className="page-header">
        <div className="page-title">
          <a className="eyebrow back-link" href="#/journal">
            ← Journal
          </a>
          <InlineTitle level={1} ariaLabel="Nom de la séance" value={session.name} onSave={(name) => run((db) => updateSession(db, session.id, { name }))} />
          <div className="session-meta">
            <input
              type="date"
              aria-label="Date de la séance"
              value={session.date}
              onChange={(e) => e.target.value && void run((db) => updateSession(db, session.id, { date: e.target.value }))}
            />
            <div className="segmented" role="radiogroup" aria-label="Statut">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={session.status === s.value}
                  className={session.status === s.value ? 'is-selected' : ''}
                  onClick={() => void run((db) => updateSession(db, session.id, { status: s.value }))}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setExporting(true)}>
            Exporter en image
          </button>
          <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => void remove()}>
            Supprimer
          </button>
        </div>
      </header>

      <div className="progress" aria-label={`${done} séries cochées sur ${sets.length}`}>
        <div className="progress-bar" style={{ width: `${sets.length ? (done / sets.length) * 100 : 0}%` }} />
        <span>
          {done}/{sets.length} séries cochées
        </span>
      </div>
      <p className="muted small">
        Valeurs pré-remplies avec le prévu : corrigez seulement les écarts puis cochez. Tout est enregistré immédiatement.
      </p>

      <ol className="session-exercises">
        {session.exercises.map((se, i) => {
          const prev = session.exercises[i - 1];
          const header = !prev || prev.block !== se.block || prev.blockLabel !== se.blockLabel;
          return (
            <Fragment key={se.id}>
              {header && (
                <li className={`block-header block-${se.block}`} aria-hidden>
                  {BLOCK_LABELS[se.block]}
                  {se.blockLabel && <span> — {se.blockLabel}</span>}
                </li>
              )}
              <SessionExerciseCard session={session} se={se} />
            </Fragment>
          );
        })}
      </ol>
      <button type="button" className="btn btn-add" onClick={() => setPicking(true)}>
        + Ajouter un exercice à cette séance
      </button>

      <WellbeingSection session={session} />
      <CardioSection session={session} />

      <div className="row session-footer">
        <div className="spacer" />
        <button type="button" className="btn btn-primary btn-large" onClick={() => void finish()}>
          Terminer la séance
        </button>
      </div>

      {picking && (
        <ExercisePicker
          title="Ajouter un exercice"
          onPick={(exerciseId) => run((db) => addSessionExercise(db, session.id, exerciseId))}
          onClose={() => setPicking(false)}
        />
      )}
      {exporting && <SheetExportDialog source={{ kind: 'session', sessionId: session.id }} onClose={() => setExporting(false)} />}
    </div>
  );
}

const PAIN_ZONES = ['Épaule', 'Coude', 'Poignet', 'Nuque', 'Haut du dos', 'Bas du dos', 'Hanche', 'Genou', 'Cheville', 'Pectoral'];
const SIDES = [
  { value: '', label: '—' },
  { value: 'left', label: 'Gauche' },
  { value: 'right', label: 'Droite' },
  { value: 'both', label: 'Les deux' },
  { value: 'center', label: 'Centre' },
] as const;
const SIDE_LABEL: Record<string, string> = { left: 'gauche', right: 'droite', both: 'des deux côtés', center: 'centre' };

function WellbeingSection({ session }: { session: WorkoutSession }) {
  const run = useAction();
  const [pain, setPain] = useState({ zone: '', side: '', intensity: null as number | null, note: '' });

  const add = async () => {
    if (!pain.zone.trim() || pain.intensity == null) return;
    const ok = await run((db) =>
      addPain(db, {
        date: session.date,
        sessionId: session.id,
        zone: pain.zone,
        side: (pain.side || null) as 'left' | null,
        intensity: pain.intensity!,
        note: pain.note || null,
      }),
    );
    if (ok) setPain({ zone: '', side: '', intensity: null, note: '' });
  };

  return (
    <section className="card">
      <h2>Ressenti</h2>
      <div className="grid grid-2">
        <ScalePicker label="Fatigue (0 = en forme, 10 = épuisé)" value={session.fatigue} onChange={(fatigue) => run((db) => updateSession(db, session.id, { fatigue }))} />
        <ScalePicker label="Courbatures (0 = aucune, 10 = fortes)" value={session.soreness} onChange={(soreness) => run((db) => updateSession(db, session.id, { soreness }))} />
      </div>

      <div className="field">
        <span className="field-label">Douleurs</span>
        {session.pains.length > 0 && (
          <ul className="pain-list">
            {session.pains.map((p) => (
              <li key={p.id}>
                <span className="pain-level" style={{ ['--level' as string]: p.intensity / 10 }}>
                  {p.intensity}/10
                </span>
                <strong>{p.zone}</strong>
                {p.side && <span>{SIDE_LABEL[p.side]}</span>}
                {p.note && <span className="muted">— {p.note}</span>}
                {p.createdVia === 'mcp' && <span className="badge badge-optional">via Claude</span>}
                <div className="spacer" />
                <button type="button" className="btn-icon btn-danger-text" aria-label="Supprimer cette douleur" onClick={() => void run((db) => deletePain(db, p.id))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="pain-form">
          <input list="pain-zones" placeholder="Zone (ex. Épaule)" value={pain.zone} onChange={(e) => setPain({ ...pain, zone: e.target.value })} aria-label="Zone douloureuse" />
          <datalist id="pain-zones">
            {PAIN_ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <select value={pain.side} onChange={(e) => setPain({ ...pain, side: e.target.value })} aria-label="Côté">
            {SIDES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <input placeholder="Précision (mouvement, moment…)" value={pain.note} onChange={(e) => setPain({ ...pain, note: e.target.value })} aria-label="Précision" />
        </div>
        <ScalePicker label="Intensité" value={pain.intensity} onChange={(intensity) => setPain({ ...pain, intensity })} />
        <button type="button" className="btn" disabled={!pain.zone.trim() || pain.intensity == null} onClick={() => void add()} style={{ alignSelf: 'flex-start' }}>
          + Ajouter la douleur
        </button>
      </div>

      <TextArea label="Commentaire de séance" rows={3} value={session.comment} onSave={(comment) => run((db) => updateSession(db, session.id, { comment }))} />
    </section>
  );
}

function CardioSection({ session }: { session: WorkoutSession }) {
  const [dialog, setDialog] = useState<{ edit?: WorkoutSession['cardio'][number] } | null>(null);
  return (
    <section className="card">
      <h2>Cardio</h2>
      {session.cardio.length === 0 && <p className="muted">Pas de cardio rattaché à cette séance.</p>}
      <ul className="day-items">
        {session.cardio.map((c) => (
          <li key={c.id}>
            <button type="button" className="day-item" onClick={() => setDialog({ edit: c })}>
              <strong>{c.activity}</strong>
              <small>
                {formatDuration(c.durationS)}
                {c.speedKmh != null && ` · ${c.speedKmh} km/h`}
                {c.inclineOrLevel && ` · ${c.inclineOrLevel}`}
                {c.hrAvg != null && ` · FC moy. ${c.hrAvg}`}
                {c.caloriesWatchEst != null && ` · ≈ ${c.caloriesWatchEst} kcal (estimation montre)`}
              </small>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setDialog({})}>
        + Cardio
      </button>
      {dialog && <CardioDialog date={session.date} sessionId={session.id} cardio={dialog.edit} onClose={() => setDialog(null)} />}
    </section>
  );
}
