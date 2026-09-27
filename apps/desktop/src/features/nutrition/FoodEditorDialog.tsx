import {
  addFoodPortion,
  createCustomFood,
  deleteFoodPortion,
  kcalFromMacros,
  setFoodArchived,
  updateFood,
  type Food,
  type FoodInput,
} from '@training/core';
import { useState } from 'react';
import { Modal } from '../../components/Modal.tsx';
import { useAction, useApp } from '../../lib/app.tsx';
import { SOURCE_LABELS, per100 } from './labels.ts';

const str = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

/** Création / modification d'un aliment perso ; portions et rendement pour tout aliment. */
export function FoodEditorDialog({ food, onClose }: { food?: Food; onClose: () => void }) {
  const run = useAction();
  const { confirm } = useApp();
  const editable = !food || food.source === 'custom';
  const [f, setF] = useState({
    name: food?.name ?? '',
    brand: food?.brand ?? '',
    basis: food?.basis ?? '100g',
    state: food?.state ?? 'na',
    cookedYield: str(food?.cookedYield),
    kcal: str(food?.kcal),
    proteinG: str(food?.proteinG),
    carbsG: str(food?.carbsG),
    sugarsG: str(food?.sugarsG),
    fatG: str(food?.fatG),
    satFatG: str(food?.satFatG),
    fiberG: str(food?.fiberG),
    saltG: str(food?.saltG),
  });
  const [portion, setPortion] = useState({ label: '', grams: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const required = ['kcal', 'proteinG', 'carbsG', 'fatG'] as const;
  const valid = !editable || (f.name.trim() && required.every((k) => num(f[k]) != null && Number.isFinite(num(f[k]))));
  const check = valid && editable ? kcalFromMacros(num(f.proteinG)!, num(f.carbsG)!, num(f.fatG)!) : null;
  const mismatch = check != null && num(f.kcal)! > 0 && Math.abs(check - num(f.kcal)!) / num(f.kcal)! > 0.15;

  const save = async () => {
    if (!valid) return;
    const input: FoodInput = {
      name: f.name,
      brand: f.brand || null,
      basis: f.basis as '100g',
      state: f.state as 'na',
      cookedYield: num(f.cookedYield),
      kcal: num(f.kcal)!,
      proteinG: num(f.proteinG)!,
      carbsG: num(f.carbsG)!,
      fatG: num(f.fatG)!,
      sugarsG: num(f.sugarsG),
      satFatG: num(f.satFatG),
      fiberG: num(f.fiberG),
      saltG: num(f.saltG),
    };
    const ok = await run(async (db) => {
      if (!food) await createCustomFood(db, input);
      else if (editable) await updateFood(db, food.id, input);
      else await updateFood(db, food.id, { state: input.state, cookedYield: input.cookedYield });
      return true;
    }, 'Aliment enregistré.');
    if (ok) onClose();
  };

  const field = (k: keyof typeof f, label: string, disabled = !editable) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input inputMode="decimal" value={f[k]} disabled={disabled} onChange={set(k)} />
    </label>
  );

  return (
    <Modal
      title={food ? food.name : 'Nouvel aliment perso'}
      onClose={onClose}
      width={680}
      footer={
        <>
          {food && (
            <button
              type="button"
              className="btn btn-ghost btn-danger-text"
              onClick={async () => {
                if (await confirm({ title: 'Masquer l’aliment', message: `Masquer « ${food.name} » de la recherche ? Le journal existant n’est pas modifié.`, confirmLabel: 'Masquer', danger: true })) {
                  await run((db) => setFoodArchived(db, food.id, true));
                  onClose();
                }
              }}
            >
              Masquer
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => void save()}>
            Enregistrer
          </button>
        </>
      }
    >
      {food && !editable && (
        <p className="muted small">
          Source : {SOURCE_LABELS[food.source]} ({food.sourceVersion ?? '—'}) · {per100(food)}. Les valeurs de référence ne sont pas modifiables ; vous pouvez
          ajouter des portions et un rendement de cuisson.
        </p>
      )}
      <div className="grid grid-3">
        <label className="field span-2">
          <span className="field-label">Nom *</span>
          <input autoFocus value={f.name} disabled={!editable} onChange={set('name')} />
        </label>
        <label className="field">
          <span className="field-label">Marque</span>
          <input value={f.brand} disabled={!editable} onChange={set('brand')} />
        </label>
        <label className="field">
          <span className="field-label">Valeurs pour</span>
          <select value={f.basis} disabled={!editable} onChange={set('basis')}>
            <option value="100g">100 g</option>
            <option value="100ml">100 ml</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">État de référence</span>
          <select value={f.state} onChange={set('state')}>
            <option value="na">non précisé</option>
            <option value="raw">cru</option>
            <option value="cooked">cuit</option>
          </select>
        </label>
        {field('cookedYield', 'Rendement cuit/cru (ex. 2,5)', false)}
      </div>
      <div className="grid grid-4">
        {field('kcal', 'kcal *')}
        {field('proteinG', 'Protéines (g) *')}
        {field('carbsG', 'Glucides (g) *')}
        {field('fatG', 'Lipides (g) *')}
        {field('sugarsG', 'dont sucres (g)')}
        {field('satFatG', 'dont AG saturés (g)')}
        {field('fiberG', 'Fibres (g)')}
        {field('saltG', 'Sel (g)')}
      </div>
      {mismatch && <p className="warning-text">Les kcal saisies s'écartent de plus de 15 % du calcul par les macros ({check} kcal) : vérifiez l'étiquette.</p>}
      {food && (
        <div className="field">
          <span className="field-label">Portions nommées</span>
          <ul className="link-list">
            {food.portions.map((p) => (
              <li key={p.id}>
                {p.label} = {str(p.grams)} g
                <div className="spacer" />
                <button type="button" className="btn-icon btn-danger-text" aria-label={`Supprimer ${p.label}`} onClick={() => void run((db) => deleteFoodPortion(db, p.id))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="row">
            <input placeholder="ex. 1 pot, 1 œuf" value={portion.label} onChange={(e) => setPortion({ ...portion, label: e.target.value })} aria-label="Nom de la portion" />
            <input placeholder="grammes" inputMode="decimal" style={{ width: 110 }} value={portion.grams} onChange={(e) => setPortion({ ...portion, grams: e.target.value })} aria-label="Poids de la portion" />
            <button
              type="button"
              className="btn"
              disabled={!portion.label.trim() || !(num(portion.grams)! > 0)}
              onClick={async () => {
                if ((await run((db) => addFoodPortion(db, food.id, portion.label, num(portion.grams)!))) !== undefined) setPortion({ label: '', grams: '' });
              }}
            >
              Ajouter
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
