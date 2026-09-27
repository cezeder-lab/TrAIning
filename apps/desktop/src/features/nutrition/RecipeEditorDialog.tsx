import { createRecipe, getRecipe, previewRecipe, updateRecipe, type Food, type RecipeInput, type WeightState } from '@training/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal.tsx';
import { useAction, useApp } from '../../lib/app.tsx';
import { AddFoodDialog } from './AddFoodDialog.tsx';
import { macros } from './labels.ts';

interface Ing {
  foodId: string;
  name: string;
  qty: string;
  state: WeightState;
  hasState: boolean;
}

const num = (s: string) => Number(s.replace(',', '.'));

/** Recette maison : ingrédients + poids total cuit → valeurs /100 g et par part. */
export function RecipeEditorDialog({ recipeFoodId, onClose }: { recipeFoodId?: string; onClose: () => void }) {
  const { platform } = useApp();
  const run = useAction();
  const [name, setName] = useState('');
  const [ings, setIngs] = useState<Ing[]>([]);
  const [cooked, setCooked] = useState('');
  const [servings, setServings] = useState('');
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!recipeFoodId) return;
    void getRecipe(platform.db, recipeFoodId).then((r) => {
      if (!r) return;
      setName(r.food.name);
      setIngs(r.ingredients.map((i) => ({ foodId: i.foodId, name: i.foodName, qty: String(i.quantityG), state: i.weightState as WeightState, hasState: i.weightState !== 'na' })));
      setCooked(r.totalCookedG ? String(r.totalCookedG) : '');
      setServings(r.servings ? String(r.servings) : '');
    });
  }, [recipeFoodId, platform]);

  const input: RecipeInput | null =
    name.trim() && ings.length && ings.every((i) => num(i.qty) > 0)
      ? {
          name,
          ingredients: ings.map((i) => ({ foodId: i.foodId, quantityG: num(i.qty), weightState: i.state })),
          totalCookedG: cooked.trim() && num(cooked) > 0 ? num(cooked) : null,
          servings: servings.trim() && num(servings) > 0 ? num(servings) : null,
        }
      : null;
  const { data: preview } = useQuery({ queryKey: ['recipePreview', input], queryFn: () => previewRecipe(platform.db, input!), enabled: !!input });

  const save = async () => {
    if (!input) return;
    const ok = await run(async (db) => {
      if (recipeFoodId) await updateRecipe(db, recipeFoodId, input);
      else await createRecipe(db, input);
      return true;
    }, 'Recette enregistrée.');
    if (ok) onClose();
  };

  const addIngredient = (food: Food) =>
    setIngs((l) => [...l, { foodId: food.id, name: food.name, qty: '100', state: food.state, hasState: food.state !== 'na' }]);

  return (
    <Modal
      title={recipeFoodId ? 'Modifier la recette' : 'Nouvelle recette'}
      onClose={onClose}
      width={720}
      footer={
        <>
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" disabled={!input} onClick={() => void save()}>
            Enregistrer
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Nom de la recette *</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Chili con carne maison" />
      </label>
      <div className="field">
        <span className="field-label">Ingrédients (poids tels que pesés)</span>
        <table className="data-table">
          <tbody>
            {ings.map((i, k) => (
              <tr key={`${i.foodId}-${k}`}>
                <td>{i.name}</td>
                <td style={{ width: 120 }}>
                  <div className="input-suffix">
                    <input inputMode="decimal" value={i.qty} aria-label={`Quantité de ${i.name}`} onChange={(e) => setIngs(ings.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} />
                    <span>g</span>
                  </div>
                </td>
                <td style={{ width: 110 }}>
                  {i.hasState && (
                    <select value={i.state} aria-label="Pesé" onChange={(e) => setIngs(ings.map((x, j) => (j === k ? { ...x, state: e.target.value as WeightState } : x)))}>
                      <option value="raw">cru</option>
                      <option value="cooked">cuit</option>
                    </select>
                  )}
                </td>
                <td style={{ width: 40 }}>
                  <button type="button" className="btn-icon btn-danger-text" aria-label={`Retirer ${i.name}`} onClick={() => setIngs(ings.filter((_, j) => j !== k))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setPicking(true)}>
          + Ingrédient
        </button>
      </div>
      <div className="grid grid-3">
        <label className="field">
          <span className="field-label">Poids total cuit (g)</span>
          <input inputMode="decimal" value={cooked} onChange={(e) => setCooked(e.target.value)} placeholder="plat pesé après cuisson" />
        </label>
        <label className="field">
          <span className="field-label">Nombre de parts</span>
          <input inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} />
        </label>
      </div>
      {preview && (
        <div className="entry-preview">
          <span>
            <strong>Pour 100 g :</strong> {macros(preview.per100)}
          </span>
          {preview.perServing && (
            <span>
              <strong>Par part ({Math.round(preview.weight / num(servings))} g) :</strong> {macros(preview.perServing)}
            </span>
          )}
          <span className="muted small">
            Total : {macros(preview.totals)} pour {Math.round(preview.weight)} g{!cooked && ' (poids cuit non renseigné : somme des ingrédients)'}
          </span>
        </div>
      )}
      {picking && <AddFoodDialog date="" mealId="" mealName="" onPick={addIngredient} onClose={() => setPicking(false)} />}
    </Modal>
  );
}
