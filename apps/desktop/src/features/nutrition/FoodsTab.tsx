import { deleteSavedMeal, formatNumber, type Food } from '@training/core';
import { useState } from 'react';
import { errorMessage, useAction, useApp } from '../../lib/app.tsx';
import { importBundledCiqual, importCiqualZipFile, updateCiqualOnline } from '../../lib/ciqual.ts';
import { useCiqualStatus, usePersonalFoods, useSavedMeals } from '../../lib/queries.ts';
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
        <h2>Favoris (Ciqual, Open Food Facts)</h2>
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
      <CiqualCard />
      {editFood && <FoodEditorDialog food={editFood.food} onClose={() => setEditFood(null)} />}
      {editRecipe && <RecipeEditorDialog recipeFoodId={editRecipe.id} onClose={() => setEditRecipe(null)} />}
      {lookup && <AddFoodDialog date="" mealId="" mealName="" onPick={(f) => open(f)} onClose={() => setLookup(false)} />}
    </div>
  );
}

function CiqualCard() {
  const { platform, toast } = useApp();
  const qc = useQueryClient();
  const { data: status } = useCiqualStatus();
  const [busy, setBusy] = useState<string | null>(null);

  const wrap = async (fn: () => Promise<{ version: string; inserted?: number; updated?: number; count?: number } | false | null>) => {
    try {
      setBusy('Import en cours…');
      const r = await fn();
      if (r) toast(`Ciqual à jour : ${r.version}.`);
      else if (r === false) toast("Pas de base Ciqual dans l'installeur : utilisez le téléchargement ou un fichier.", 'error');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
      await qc.invalidateQueries();
    }
  };

  return (
    <section className="card">
      <h2>Base Ciqual (ANSES)</h2>
      <p className="muted">
        {status?.count ? `${status.count} aliments · ${status.version}` : 'Non installée.'} Table de composition nutritionnelle de référence (Licence Ouverte
        Etalab).
      </p>
      {busy && <p className="muted">{busy}</p>}
      <div className="row">
        {!status?.count && (
          <button type="button" className="btn" disabled={!!busy} onClick={() => void wrap(() => importBundledCiqual(platform))}>
            Installer depuis l'application
          </button>
        )}
        <button type="button" className="btn" disabled={!!busy} onClick={() => void wrap(() => updateCiqualOnline(platform, setBusy))}>
          Télécharger la dernière version
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!!busy}
          onClick={async () => {
            const path = await platform.pickFile('Archive Ciqual (XML, .zip)', ['zip']);
            if (path) await wrap(() => importCiqualZipFile(platform, path));
          }}
        >
          Importer un fichier .zip…
        </button>
      </div>
      <p className="muted small">
        Fichier manuel : sur ciqual.anses.fr, rubrique téléchargement, prendre l'archive « XML ». Les entrées déjà saisies ne changent pas.
      </p>
    </section>
  );
}
