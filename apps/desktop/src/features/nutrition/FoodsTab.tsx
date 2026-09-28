import { CNF_ATTRIBUTION, deleteSavedMeal, formatNumber, type Food } from '@training/core';
import { useState } from 'react';
import { errorMessage, useAction, useApp } from '../../lib/app.tsx';
import { importZipFile, reinstallBundled, updateOnline } from '../../lib/foodData.ts';
import { useFoodDataStatus, usePersonalFoods, useSavedMeals } from '../../lib/queries.ts';
import { AddFoodDialog } from './AddFoodDialog.tsx';
import { FoodEditorDialog } from './FoodEditorDialog.tsx';
import { SOURCE_LABELS, per100 } from './labels.ts';
import { RecipeEditorDialog } from './RecipeEditorDialog.tsx';
import { useQueryClient } from '@tanstack/react-query';

export function FoodsTab() {
  const { data } = usePersonalFoods();
  const { data: saved = [] } = useSavedMeals();
  const run = useAction();
  const [editFood, setEditFood] = useState<{ food?: Food } | null>(null);
  const [editRecipe, setEditRecipe] = useState<{ id?: string } | null>(null);
  const [lookup, setLookup] = useState(false);

  const open = (f: Food) => (f.source === 'recipe' ? setEditRecipe({ id: f.id }) : setEditFood({ food: f }));
  const list = (foods: Food[] | undefined, empty: string) =>
    foods?.length ? (
      <ul className="day-items">
        {foods.map((f) => (
          <li key={f.id}>
            <button type="button" className="day-item" onClick={() => open(f)}>
              <span className={`badge badge-source badge-${f.source}`}>{SOURCE_LABELS[f.source]}</span>
              <strong>
                {f.name}
                {f.brand && <span className="muted"> · {f.brand}</span>}
              </strong>
              <small>
                {per100(f)}
                {f.portions.length > 0 && ` · ${f.portions.map((p) => p.label).join(', ')}`}
              </small>
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">{empty}</p>
    );

  return (
    <div className="foods-tab">
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => setEditFood({})}>
          + Aliment perso
        </button>
        <button type="button" className="btn" onClick={() => setEditRecipe({})}>
          + Recette maison
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setLookup(true)}>
          Chercher un aliment (portions, rendement cru/cuit)…
        </button>
      </div>
      <section className="card">
        <h2>Mes aliments et recettes</h2>
        {list(data?.own, 'Aucun aliment perso ni recette pour l’instant.')}
      </section>
      <section className="card">
        <h2>Favoris (tables de référence, Open Food Facts)</h2>
        {list(data?.favorites, 'Ajoutez des favoris avec l’étoile lors de l’ajout d’un aliment.')}
      </section>
      <section className="card">
        <h2>Repas enregistrés</h2>
        {saved.length === 0 && <p className="muted">Aucun. Dans le journal : « Enregistrer ce repas ».</p>}
        <ul className="link-list">
          {saved.map((m) => (
            <li key={m.id}>
              <strong>{m.name}</strong>
              <span className="muted small">
                {m.items.length} aliment(s) · {formatNumber(m.totals.kcal, 0)} kcal
              </span>
              <div className="spacer" />
              <button type="button" className="btn-icon btn-danger-text" aria-label={`Supprimer ${m.name}`} onClick={() => void run((db) => deleteSavedMeal(db, m.id))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>
      <ReferenceBasesCard />
      {editFood && <FoodEditorDialog food={editFood.food} onClose={() => setEditFood(null)} />}
      {editRecipe && <RecipeEditorDialog recipeFoodId={editRecipe.id} onClose={() => setEditRecipe(null)} />}
      {lookup && <AddFoodDialog date="" mealId="" mealName="" onPick={(f) => open(f)} onClose={() => setLookup(false)} />}
    </div>
  );
}

function ReferenceBasesCard() {
  const { platform, toast } = useApp();
  const qc = useQueryClient();
  const { data: status } = useFoodDataStatus();
  const [busy, setBusy] = useState<string | null>(null);

  const wrap = async (fn: () => Promise<{ version: string } | string[]>) => {
    try {
      setBusy('Import en cours…');
      const r = await fn();
      if (Array.isArray(r)) toast(r.length ? `Tables réinstallées : ${r.join(' ; ')}.` : "Aucune table dans l'installeur : utilisez le téléchargement.", r.length ? 'info' : 'error');
      else toast(`${r.version} importé.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
      await qc.invalidateQueries();
    }
  };

  const rows = [
    { source: 'ciqual' as const, name: 'Ciqual (ANSES, France)', s: status?.ciqual, note: 'Référence française. Énergie calculée à partir des macronutriments quand la table ne la donne pas.' },
    { source: 'cnf' as const, name: 'Fichier canadien sur les éléments nutritifs (Santé Canada)', s: status?.cnf, note: 'Noms et portions en français (« 1 contenant », « 3/4 tasse »). ' + CNF_ATTRIBUTION },
  ];

  return (
    <section className="card">
      <h2>Tables de référence</h2>
      <ul className="ref-bases">
        {rows.map((r) => (
          <li key={r.source}>
            <div>
              <strong>{r.name}</strong>
              <div className="muted small">{r.s?.count ? `${r.s.count} aliments · ${r.s.version}` : 'Non installée'}</div>
              <div className="muted small">{r.note}</div>
            </div>
            <button type="button" className="btn" disabled={!!busy} onClick={() => void wrap(() => updateOnline(platform, r.source, setBusy))}>
              Télécharger la dernière version
            </button>
          </li>
        ))}
      </ul>
      {busy && <p className="muted">{busy}</p>}
      <div className="row">
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void wrap(() => reinstallBundled(platform))}>
          Réinstaller les tables de l'application
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!!busy}
          onClick={async () => {
            const path = await platform.pickFile('Archive Ciqual (XML) ou Fichier canadien (CSV)', ['zip']);
            if (path) await wrap(() => importZipFile(platform, path));
          }}
        >
          Importer un fichier .zip…
        </button>
      </div>
      <p className="muted small">
        Les entrées déjà saisies ne changent pas, sauf celles enregistrées à 0 kcal faute d'énergie connue, qui sont recalculées. Les produits de marque
        viennent d'Open Food Facts (recherche en ligne ou code-barres).
      </p>
    </section>
  );
}
