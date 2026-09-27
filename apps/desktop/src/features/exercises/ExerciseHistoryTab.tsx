import { formatNumber, type Exercise } from '@training/core';
import { LineChart } from '../../components/LineChart.tsx';
import { formatShortDate } from '../../lib/dates.ts';
import { useExerciseHistory } from '../../lib/queries.ts';
import { navigate } from '../../lib/router.ts';

const UNIT_LABEL: Record<string, string> = { reps: '', s: ' s', m: ' m', min: ' min' };

export function ExerciseHistoryTab({ exercise }: { exercise: Exercise }) {
  const { data: history = [], isLoading } = useExerciseHistory(exercise.id);
  if (isLoading) return <p className="muted">Chargement…</p>;
  if (history.length === 0) {
    return <p className="muted">Pas encore de séance enregistrée avec cet exercice (seules les séries cochées comptent).</p>;
  }
  const byReps = history.some((h) => h.unit === 'reps');
  const hasLoad = history.some((h) => h.maxLoadKg != null);
  const set = (s: { loadKg: number | null; value: number | null }, unit: string) =>
    `${s.loadKg != null ? `${formatNumber(s.loadKg)} × ` : ''}${s.value != null ? formatNumber(s.value) : '?'}${UNIT_LABEL[unit] ?? ''}`;

  return (
    <div className="history-tab">
      <div className="chart-grid">
        {hasLoad && (
          <LineChart title="Charge max" unit="kg" series={[{ id: 'max', label: 'Charge max', color: 1, points: history.map((h) => ({ x: h.date, y: h.maxLoadKg })) }]} />
        )}
        {byReps && hasLoad && (
          <LineChart title="Volume (charge × répétitions)" unit="kg" series={[{ id: 'vol', label: 'Volume', color: 1, points: history.map((h) => ({ x: h.date, y: h.volumeKg })) }]} />
        )}
        {byReps && hasLoad && (
          <LineChart
            title="Meilleure série — 1RM estimé"
            note="estimation (Epley), pas une mesure"
            unit="kg"
            series={[{ id: 'e1rm', label: '1RM estimé', color: 1, points: history.map((h) => ({ x: h.date, y: h.e1rmKg })) }]}
          />
        )}
        {(!hasLoad || !byReps) && (
          <LineChart
            title={`Total par séance${UNIT_LABEL[history[0]!.unit] ? ` (${UNIT_LABEL[history[0]!.unit]!.trim()})` : ' (répétitions)'}`}
            series={[{ id: 'tot', label: 'Total', color: 1, points: history.map((h) => ({ x: h.date, y: h.totalValue })) }]}
          />
        )}
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Séance</th>
            <th>Séries réalisées</th>
            <th className="num">Max</th>
            <th className="num">Volume</th>
            <th className="num">1RM est.</th>
          </tr>
        </thead>
        <tbody>
          {[...history].reverse().map((h) => (
            <tr key={h.sessionId}>
              <td>
                <button type="button" className="btn-link" onClick={() => navigate('journal', h.sessionId)}>
                  {formatShortDate(h.date)}
                </button>
              </td>
              <td>{h.sessionName}</td>
              <td>{h.sets.map((s) => set(s, h.unit)).join(' · ')}</td>
              <td className="num">{h.maxLoadKg != null ? `${formatNumber(h.maxLoadKg)} kg` : '—'}</td>
              <td className="num">{h.volumeKg != null ? `${formatNumber(h.volumeKg, 0)} kg` : '—'}</td>
              <td className="num">{h.e1rmKg != null ? `≈ ${formatNumber(h.e1rmKg, 1)} kg` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
