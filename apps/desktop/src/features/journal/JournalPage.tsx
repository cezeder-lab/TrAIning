import { createFreeSession, createSessionFromTemplate, type CardioSession, type SessionSummary } from '@training/core';
import { useMemo, useState } from 'react';
import { Modal } from '../../components/Modal.tsx';
import { useAction } from '../../lib/app.tsx';
import { formatDuration, formatLongDate, monthGrid, parseDate, today } from '../../lib/dates.ts';
import { useActiveProgram, useCardioList, useSessions } from '../../lib/queries.ts';
import { navigate } from '../../lib/router.ts';
import { CardioDialog } from './CardioDialog.tsx';

const STATUS_LABEL = { planned: 'Prévue', done: 'Faite', skipped: 'Sautée' } as const;
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

export function JournalPage() {
  const [selected, setSelected] = useState(today());
  const [month, setMonth] = useState(() => {
    const d = parseDate(today());
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [planning, setPlanning] = useState(false);
  const [cardio, setCardio] = useState<{ edit?: CardioSession } | null>(null);

  const weeks = useMemo(() => monthGrid(month.y, month.m), [month]);
  const from = weeks[0]![0]!;
  const to = weeks.at(-1)!.at(-1)!;
  const { data: sessions = [] } = useSessions(from, to);
  const { data: cardioList = [] } = useCardioList(from, to);

  const byDate = useMemo(() => {
    const map = new Map<string, { sessions: SessionSummary[]; cardio: CardioSession[] }>();
    const get = (d: string) => map.get(d) ?? (map.set(d, { sessions: [], cardio: [] }), map.get(d)!);
    for (const s of sessions) get(s.date).sessions.push(s);
    for (const c of cardioList) get(c.date).cardio.push(c);
    return map;
  }, [sessions, cardioList]);

  const shiftMonth = (delta: number) => {
    const d = new Date(month.y, month.m + delta, 1);
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
  };
  const goToday = () => {
    const d = parseDate(today());
    setMonth({ y: d.getFullYear(), m: d.getMonth() });
    setSelected(today());
  };

  const day = byDate.get(selected) ?? { sessions: [], cardio: [] };
  const monthLabel = new Date(month.y, month.m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  return (
    <div className="page page-wide journal-page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Entraînement</span>
          <h1>Journal</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setCardio({})}>
            + Cardio
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setPlanning(true)}>
            + Séance
          </button>
        </div>
      </header>

      <div className="journal-layout">
        <section className="calendar card" aria-label="Calendrier">
          <div className="calendar-nav">
            <button type="button" className="btn-icon" aria-label="Mois précédent" onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <h2 className="calendar-title">{monthLabel}</h2>
            <button type="button" className="btn-icon" aria-label="Mois suivant" onClick={() => shiftMonth(1)}>
              ›
            </button>
            <div className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={goToday}>
              Aujourd'hui
            </button>
          </div>
          <div className="calendar-grid" role="grid">
            {WEEKDAYS.map((w) => (
              <div key={w} className="calendar-weekday" role="columnheader">
                {w}
              </div>
            ))}
            {weeks.flat().map((d) => {
              const items = byDate.get(d);
              const inMonth = parseDate(d).getMonth() === month.m;
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  aria-selected={d === selected}
                  aria-label={formatLongDate(d)}
                  className={`calendar-day ${inMonth ? '' : 'is-outside'} ${d === today() ? 'is-today' : ''} ${d === selected ? 'is-selected' : ''}`}
                  onClick={() => setSelected(d)}
                  onDoubleClick={() => {
                    setSelected(d);
                    setPlanning(true);
                  }}
                >
                  <span className="calendar-date">{parseDate(d).getDate()}</span>
                  {items?.sessions.map((s) => (
                    <span key={s.id} className={`chip-session status-${s.status}`}>
                      {s.name}
                      {s.maxPain != null && s.maxPain > 0 && <i className="pain-dot" title={`Douleur ${s.maxPain}/10`} />}
                    </span>
                  ))}
                  {items?.cardio.map((c) => (
                    <span key={c.id} className="chip-cardio">
                      {c.activity}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="day-panel card" aria-label="Détail du jour">
          <h2 className="day-title">{formatLongDate(selected)}</h2>
          {day.sessions.length === 0 && day.cardio.length === 0 && <p className="muted">Rien de prévu ce jour-là.</p>}
          <ul className="day-items">
            {day.sessions.map((s) => (
              <li key={s.id}>
                <button type="button" className="day-item" onClick={() => navigate('journal', s.id)}>
                  <span className={`status-pill status-${s.status}`}>{STATUS_LABEL[s.status]}</span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.doneSets}/{s.plannedSets} séries cochées
                    {s.fatigue != null && ` · fatigue ${s.fatigue}/10`}
                    {s.maxPain != null && ` · douleur ${s.maxPain}/10`}
                  </small>
                </button>
              </li>
            ))}
            {day.cardio.map((c) => (
              <li key={c.id}>
                <button type="button" className="day-item" onClick={() => setCardio({ edit: c })}>
                  <span className="status-pill status-cardio">Cardio</span>
                  <strong>{c.activity}</strong>
                  <small>
                    {formatDuration(c.durationS)}
                    {c.inclineOrLevel && ` · ${c.inclineOrLevel}`}
                    {c.caloriesWatchEst != null && ` · ≈ ${c.caloriesWatchEst} kcal (montre)`}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => setPlanning(true)}>
              + Séance ce jour
            </button>
            <button type="button" className="btn" onClick={() => setCardio({})}>
              + Cardio
            </button>
          </div>
          <p className="muted small">Astuce : double-clic sur un jour pour y planifier une séance.</p>
        </aside>
      </div>

      {planning && <PlanDialog date={selected} onClose={() => setPlanning(false)} />}
      {cardio && <CardioDialog date={selected} cardio={cardio.edit} onClose={() => setCardio(null)} />}
    </div>
  );
}

/** Planifier une séance : à partir d'un template ou libre. */
function PlanDialog({ date: initialDate, onClose }: { date: string; onClose: () => void }) {
  const { data: program } = useActiveProgram();
  const run = useAction();
  const [date, setDate] = useState(initialDate);
  const [freeName, setFreeName] = useState('');

  const create = async (fn: () => Promise<string | undefined>) => {
    const id = await fn();
    if (id) {
      onClose();
      navigate('journal', id);
    }
  };

  return (
    <Modal title="Nouvelle séance" onClose={onClose} width={520}>
      <label className="field">
        <span className="field-label">Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="field">
        <span className="field-label">À partir du programme « {program?.name} »</span>
        <div className="template-choices">
          {program?.templates.map((t, i) => (
            <button
              key={t.id}
              type="button"
              className="template-choice"
              autoFocus={i === 0}
              onClick={() => void create(() => run((db) => createSessionFromTemplate(db, t.id, date)))}
            >
              <strong>{t.name}</strong>
              <small>{t.slots.filter((s) => !s.isOptional).length} exercices</small>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Ou séance libre</span>
        <div className="row">
          <input value={freeName} placeholder="Nom (ex. Full body)" onChange={(e) => setFreeName(e.target.value)} style={{ flex: 1 }} />
          <button
            type="button"
            className="btn"
            disabled={!freeName.trim()}
            onClick={() => void create(() => run((db) => createFreeSession(db, date, freeName)))}
          >
            Créer
          </button>
        </div>
      </div>
    </Modal>
  );
}
