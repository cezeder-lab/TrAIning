import { formatNumber } from '@training/core';
import { LineChart } from '../../components/LineChart.tsx';
import { addDays, formatShortDate, today } from '../../lib/dates.ts';
import { useNutritionSummary } from '../../lib/queries.ts';

export function TrendsTab() {
  const to = today();
  const { data: s } = useNutritionSummary(addDays(to, -29), to);
  const { data: s7 } = useNutritionSummary(addDays(to, -6), to);
  if (!s || !s7) return <p className="muted">Chargement…</p>;
  const logged = s.days.filter((d) => d.logged);
  const lastGoal = [...s.days].reverse().find((d) => d.goal?.kcal)?.goal;
  const tiles = [
    { label: 'Moyenne 7 jours', value: s7.averageLogged ? `${formatNumber(s7.averageLogged.kcal, 0)} kcal` : '—', sub: `${s7.loggedDays} jour(s) renseigné(s) sur 7` },
    { label: 'Protéines (moy. 7 j)', value: s7.averageLogged ? `${formatNumber(s7.averageLogged.proteinG, 0)} g` : '—', sub: 'jours renseignés uniquement' },
    { label: 'Moyenne 30 jours', value: s.averageLogged ? `${formatNumber(s.averageLogged.kcal, 0)} kcal` : '—', sub: `${s.loggedDays} jour(s) renseigné(s)` },
    { label: 'Part estimée', value: `${Math.round(s.estimatedShare * 100)} %`, sub: 'des entrées sur 30 jours' },
  ];
  return (
    <div className="trends-tab">
      <div className="stat-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="stat-tile card">
            <span className="stat-label">{t.label}</span>
            <strong className="stat-value">{t.value}</strong>
            <span className="muted small">{t.sub}</span>
          </div>
        ))}
      </div>
      <section className="card chart-grid">
        <LineChart
          title="Énergie par jour renseigné (30 jours)"
          unit="kcal"
          reference={lastGoal?.kcal ? { y: lastGoal.kcal, label: `objectif ${formatNumber(lastGoal.kcal, 0)}` } : undefined}
          series={[{ id: 'kcal', label: 'Énergie', color: 1, points: logged.map((d) => ({ x: d.date, y: d.totals.kcal })) }]}
        />
        <LineChart
          title="Protéines par jour renseigné (30 jours)"
          unit="g"
          reference={lastGoal?.proteinG ? { y: lastGoal.proteinG, label: `objectif ${formatNumber(lastGoal.proteinG, 0)} g` } : undefined}
          series={[{ id: 'p', label: 'Protéines', color: 1, points: logged.map((d) => ({ x: d.date, y: d.totals.proteinG })) }]}
        />
      </section>
      <section className="card">
        <h2>Détail des jours</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Jour</th>
              <th className="num">kcal</th>
              <th className="num">Objectif</th>
              <th className="num">Protéines</th>
              <th className="num">Glucides</th>
              <th className="num">Lipides</th>
              <th className="num">Entrées</th>
            </tr>
          </thead>
          <tbody>
            {[...logged].reverse().map((d) => (
              <tr key={d.date}>
                <td>{formatShortDate(d.date)}</td>
                <td className="num">{formatNumber(d.totals.kcal, 0)}</td>
                <td className="num muted">{d.goal?.kcal != null ? formatNumber(d.goal.kcal, 0) : '—'}</td>
                <td className="num">{formatNumber(d.totals.proteinG, 0)} g</td>
                <td className="num">{formatNumber(d.totals.carbsG, 0)} g</td>
                <td className="num">{formatNumber(d.totals.fatG, 0)} g</td>
                <td className="num muted">
                  {d.entryCount}
                  {d.estimatedCount > 0 && ` (${d.estimatedCount} est.)`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {logged.length === 0 && <p className="muted">Aucun jour renseigné sur les 30 derniers jours.</p>}
      </section>
    </div>
  );
}
