import {
  addBodyPhoto,
  addWaistMeasurement,
  addWeightEntry,
  deleteBodyPhoto,
  deleteMeasurement,
  deleteWeightEntry,
  formatNumber,
  TREND_WINDOW_DAYS,
} from '@training/core';
import { useState } from 'react';
import { LineChart } from '../../components/LineChart.tsx';
import { errorMessage, useAction, useApp } from '../../lib/app.tsx';
import { addDays, formatShortDate, today } from '../../lib/dates.ts';
import { useBodyMetrics, useBodyPhotos } from '../../lib/queries.ts';

const RANGES = [
  { days: 30, label: '30 j' },
  { days: 90, label: '3 mois' },
  { days: 365, label: '1 an' },
];

export function BodyPage() {
  const [range, setRange] = useState(90);
  const to = today();
  const { data: m } = useBodyMetrics(addDays(to, -range + 1), to);
  const run = useAction();
  const { confirm } = useApp();
  const [weight, setWeight] = useState({ date: today(), kg: '' });
  const [waist, setWaist] = useState({ date: today(), cm: '' });
  const num = (s: string) => Number(s.replace(',', '.'));

  const saveWeight = async () => {
    const kg = num(weight.kg);
    if (!(kg >= 20 && kg <= 400)) return;
    const existing = m?.weights.find((w) => w.date === weight.date);
    if (existing && !(await confirm({ title: 'Remplacer la pesée', message: `Une pesée existe déjà ce jour-là (${formatNumber(existing.weightKg)} kg). La remplacer ?`, confirmLabel: 'Remplacer' }))) return;
    if ((await run((db) => addWeightEntry(db, { date: weight.date, weightKg: kg, replaceExisting: !!existing }), 'Pesée enregistrée.')) !== undefined) setWeight({ ...weight, kg: '' });
  };

  const saveWaist = async () => {
    const cm = num(waist.cm);
    if (!(cm >= 20 && cm <= 300)) return;
    const existing = m?.waist.find((w) => w.date === waist.date);
    if (existing && !(await confirm({ title: 'Remplacer la mesure', message: `Un tour de taille existe déjà ce jour-là (${formatNumber(existing.valueCm)} cm). Le remplacer ?`, confirmLabel: 'Remplacer' }))) return;
    if ((await run((db) => addWaistMeasurement(db, { date: waist.date, valueCm: cm, replaceExisting: !!existing }), 'Tour de taille enregistré.')) !== undefined) setWaist({ ...waist, cm: '' });
  };

  const trend = m?.trend;
  return (
    <div className="page body-page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Suivi corporel</span>
          <h1>Corps</h1>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Période">
          {RANGES.map((r) => (
            <button key={r.days} type="button" role="radio" aria-checked={range === r.days} className={range === r.days ? 'is-selected' : ''} onClick={() => setRange(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
      </header>

      <div className="stat-tiles">
        <div className="stat-tile card">
          <span className="stat-label">Dernière pesée</span>
          <strong className="stat-value">{m?.latest ? `${formatNumber(m.latest.weightKg)} kg` : '—'}</strong>
          <span className="muted small">{m?.latest ? formatShortDate(m.latest.date) : 'aucune sur la période'}</span>
        </div>
        <div className="stat-tile card">
          <span className="stat-label">Moyenne 7 jours</span>
          <strong className="stat-value">{m?.latest ? `${formatNumber(m.latest.avg7)} kg` : '—'}</strong>
          <span className="muted small">{m?.latest ? `sur ${m.latest.avg7Count} pesée(s) disponible(s)` : ''}</span>
        </div>
        <div className="stat-tile card">
          <span className="stat-label">Tendance ({TREND_WINDOW_DAYS} j)</span>
          <strong className="stat-value">{trend?.status === 'ok' ? `${trend.kgPerWeek > 0 ? '+' : ''}${formatNumber(trend.kgPerWeek)} kg/sem.` : '—'}</strong>
          <span className="muted small">{trend?.status === 'ok' ? `sur ${trend.points} pesées, ${trend.spanDays} jours` : trend?.reason}</span>
        </div>
      </div>

      <section className="card">
        <h2>Poids</h2>
        <p className="muted small">Aucune obligation de se peser chaque jour : la moyenne ne tient compte que des pesées disponibles.</p>
        <form className="row" onSubmit={(e) => (e.preventDefault(), void saveWeight())}>
          <input type="date" value={weight.date} onChange={(e) => setWeight({ ...weight, date: e.target.value })} aria-label="Date de la pesée" style={{ width: 'auto' }} />
          <div className="input-suffix" style={{ width: 130 }}>
            <input inputMode="decimal" placeholder="Poids" value={weight.kg} onChange={(e) => setWeight({ ...weight, kg: e.target.value })} aria-label="Poids en kg" />
            <span>kg</span>
          </div>
          <button type="submit" className="btn btn-primary" disabled={!(num(weight.kg) >= 20 && num(weight.kg) <= 400)}>
            Enregistrer
          </button>
        </form>
        {m && m.weights.length > 0 && (
          <LineChart
            title="Poids"
            unit="kg"
            height={220}
            series={[
              { id: 'w', label: 'Pesée', color: 2, kind: 'dots', points: m.weights.map((w) => ({ x: w.date, y: w.weightKg })) },
              { id: 'avg', label: 'Moyenne 7 jours', color: 1, points: m.weights.map((w) => ({ x: w.date, y: w.avg7 })) },
            ]}
          />
        )}
        {m && m.weights.length > 0 && (
          <details>
            <summary className="muted">Toutes les pesées ({m.weights.length})</summary>
            <table className="data-table">
              <tbody>
                {[...m.weights].reverse().map((w) => (
                  <tr key={w.id}>
                    <td>{formatShortDate(w.date)}</td>
                    <td className="num">{formatNumber(w.weightKg)} kg</td>
                    <td className="num muted">moy. {formatNumber(w.avg7)} ({w.avg7Count})</td>
                    <td>{w.createdVia === 'mcp' && <span className="badge badge-optional">via Claude</span>}</td>
                    <td>
                      <button type="button" className="btn-icon btn-danger-text" aria-label="Supprimer la pesée" onClick={() => void run((db) => deleteWeightEntry(db, w.id))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>

      <section className="card">
        <h2>Tour de taille</h2>
        <form className="row" onSubmit={(e) => (e.preventDefault(), void saveWaist())}>
          <input type="date" value={waist.date} onChange={(e) => setWaist({ ...waist, date: e.target.value })} aria-label="Date de la mesure" style={{ width: 'auto' }} />
          <div className="input-suffix" style={{ width: 130 }}>
            <input inputMode="decimal" placeholder="Tour" value={waist.cm} onChange={(e) => setWaist({ ...waist, cm: e.target.value })} aria-label="Tour de taille en cm" />
            <span>cm</span>
          </div>
          <button type="submit" className="btn" disabled={!(num(waist.cm) >= 20 && num(waist.cm) <= 300)}>
            Enregistrer
          </button>
        </form>
        {m && m.waist.length > 0 && (
          <>
            <LineChart title="Tour de taille" unit="cm" height={160} series={[{ id: 'waist', label: 'Tour de taille', color: 1, points: m.waist.map((w) => ({ x: w.date, y: w.valueCm })) }]} />
            <ul className="link-list">
              {[...m.waist].reverse().map((w) => (
                <li key={w.id}>
                  {formatShortDate(w.date)} — {formatNumber(w.valueCm)} cm
                  <div className="spacer" />
                  <button type="button" className="btn-icon btn-danger-text" aria-label="Supprimer la mesure" onClick={() => void run((db) => deleteMeasurement(db, w.id))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <PhotosSection />
    </div>
  );
}

function PhotosSection() {
  const { platform, toast, confirm } = useApp();
  const { data: photos = [] } = useBodyPhotos();
  const run = useAction();
  const [date, setDate] = useState(today());
  const [pose, setPose] = useState('front');

  const add = async () => {
    try {
      const rel = await platform.pickImage('body');
      if (rel) await run((db) => addBodyPhoto(db, date, rel, pose), 'Photo ajoutée.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <section className="card">
      <h2>Photos</h2>
      <p className="muted small">Stockées uniquement sur cet ordinateur, dans le dossier des données de l'application.</p>
      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date de la photo" style={{ width: 'auto' }} />
        <select value={pose} onChange={(e) => setPose(e.target.value)} aria-label="Pose" style={{ width: 'auto' }}>
          <option value="front">Face</option>
          <option value="side">Profil</option>
          <option value="back">Dos</option>
          <option value="other">Autre</option>
        </select>
        <button type="button" className="btn" onClick={() => void add()}>
          + Ajouter une photo
        </button>
      </div>
      {photos.length > 0 && (
        <ul className="media-grid">
          {photos.map((p) => (
            <li key={p.id}>
              <img src={platform.mediaUrl(p.filePath)} alt={`Photo du ${p.date}`} loading="lazy" />
              <div className="row">
                <span className="small">
                  {formatShortDate(p.date)} · {({ front: 'face', side: 'profil', back: 'dos' } as Record<string, string>)[p.pose ?? ''] ?? 'autre'}
                </span>
                <div className="spacer" />
                <button
                  type="button"
                  className="btn-icon btn-danger-text"
                  aria-label="Supprimer la photo"
                  onClick={async () => {
                    if (!(await confirm({ title: 'Supprimer la photo', message: 'Supprimer définitivement cette photo ?', confirmLabel: 'Supprimer', danger: true }))) return;
                    const file = await run((db) => deleteBodyPhoto(db, p.id));
                    if (file) await platform.deleteMediaFile(file).catch(() => undefined);
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
