import {
  addFoodEntry,
  cacheOffFoods,
  getFoodsByIds,
  offByBarcode,
  offSearch,
  previewFoodEntry,
  recentFoods,
  searchFoods,
  setFoodFavorite,
  type EntryUnit,
  type Food,
  type SearchBadge,
  type WeightState,
} from '@training/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/Modal.tsx';
import { errorMessage, useAction, useApp } from '../../lib/app.tsx';
import { BADGE_LABELS, SOURCE_LABELS, macros, per100 } from './labels.ts';

interface Candidate {
  food: Food;
  badge: SearchBadge;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Ajout d'un aliment au journal : recherche (toutes sources) → quantité → aperçu → ajout. */
export function AddFoodDialog(props: { date: string; mealId: string; mealName: string; onClose: () => void; onPick?: (food: Food) => void }) {
  const { platform, toast } = useApp();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 180);
  const [online, setOnline] = useState<Candidate[] | null>(null);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [selected, setSelected] = useState<Food | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const { data: local = [] } = useQuery({
    queryKey: ['foodSearch', q],
    queryFn: async (): Promise<Candidate[]> =>
      q ? (await searchFoods(platform.db, q, { limit: 30 })).map((r) => ({ food: r.food, badge: r.badge })) : (await recentFoods(platform.db, 15)).map((food) => ({ food, badge: 'recent' as const })),
  });
  useEffect(() => {
    setOnline(null);
    setActive(0);
  }, [q]);

  const results = [...local, ...(online ?? []).filter((o) => !local.some((l) => l.food.id === o.food.id))];

  const fetchFn = (url: string, init?: RequestInit) => platform.httpFetch(url, init);
  const cacheAndLoad = async (products: Awaited<ReturnType<typeof offSearch>>) => {
    const ids = await cacheOffFoods(platform.db, products);
    const foods = await getFoodsByIds(platform.db, [...ids.values()]);
    return products.map((p) => foods.get(ids.get(p.sourceRef)!)).filter((f): f is Food => !!f);
  };

  const searchOnline = async () => {
    if (!q) return;
    setOnlineBusy(true);
    try {
      const foods = await cacheAndLoad(await offSearch(fetchFn, q));
      setOnline(foods.map((food) => ({ food, badge: 'off' as const })));
      if (!foods.length) toast('Aucun produit trouvé sur Open Food Facts.');
    } catch (err) {
      toast(`Open Food Facts : ${errorMessage(err)}`, 'error');
    } finally {
      setOnlineBusy(false);
    }
  };

  const searchBarcode = async () => {
    setOnlineBusy(true);
    try {
      const p = await offByBarcode(fetchFn, barcode);
      if (!p) {
        toast('Code-barres introuvable sur Open Food Facts (ou valeurs nutritionnelles absentes).', 'error');
        return;
      }
      const [food] = await cacheAndLoad([p]);
      if (food) choose(food);
    } catch (err) {
      toast(`Open Food Facts : ${errorMessage(err)}`, 'error');
    } finally {
      setOnlineBusy(false);
    }
  };

  const choose = (food: Food) => {
    if (props.onPick) {
      props.onPick(food);
      props.onClose();
    } else setSelected(food);
  };

  const move = (delta: number) => {
    if (!results.length) return;
    const next = (active + delta + results.length) % results.length;
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  };

  if (selected) return <QuantityStep food={selected} {...props} onBack={() => setSelected(null)} />;
  if (estimating) return <EstimateStep {...props} initialLabel={query} onBack={() => setEstimating(false)} />;

  return (
    <Modal title={props.onPick ? 'Choisir un aliment' : `Ajouter au ${props.mealName.toLowerCase()}`} onClose={props.onClose} width={680}>
      <input
        className="picker-search"
        autoFocus
        value={query}
        placeholder="Rechercher un aliment (fautes et accents tolérés)…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
          else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
          else if (e.key === 'Enter' && results[active]) (e.preventDefault(), choose(results[active]!.food));
        }}
        aria-label="Recherche d'aliment"
      />
      {!q && results.length > 0 && <p className="muted small">Récemment utilisés</p>}
      <ul className="picker-list food-results" role="listbox" ref={listRef}>
        {results.map((r, i) => (
          <li key={r.food.id} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''} onMouseEnter={() => setActive(i)} onClick={() => choose(r.food)}>
            <div className="food-result-main">
              <span>
                {r.food.name}
                {r.food.brand && <span className="muted"> · {r.food.brand}</span>}
              </span>
              <small>{per100(r.food)}</small>
            </div>
            <span className={`badge badge-source badge-${r.badge}`}>{BADGE_LABELS[r.badge]}</span>
          </li>
        ))}
        {q && results.length === 0 && <li className="picker-empty">Rien dans la base locale pour « {q} ».</li>}
      </ul>
      <div className="food-online">
        <button type="button" className="btn" disabled={!q || onlineBusy} onClick={() => void searchOnline()}>
          {onlineBusy ? 'Recherche…' : 'Chercher sur Open Food Facts'}
        </button>
        <input value={barcode} inputMode="numeric" placeholder="Code-barres" onChange={(e) => setBarcode(e.target.value)} aria-label="Code-barres" onKeyDown={(e) => e.key === 'Enter' && void searchBarcode()} />
        <button type="button" className="btn" disabled={barcode.replace(/\D/g, '').length < 8 || onlineBusy} onClick={() => void searchBarcode()}>
          Chercher
        </button>
        {!props.onPick && (
          <button type="button" className="btn-link" onClick={() => setEstimating(true)}>
            Estimation libre…
          </button>
        )}
      </div>
      <p className="picker-help">↑ ↓ puis Entrée · Priorité : récents, favoris, base perso, Ciqual, Open Food Facts</p>
    </Modal>
  );
}

function QuantityStep(props: { food: Food; date: string; mealId: string; mealName: string; onBack: () => void; onClose: () => void }) {
  const { platform } = useApp();
  const run = useAction();
  const f = props.food;
  const defaultPortion = f.portions.find((p) => p.isDefault) ?? f.portions[0];
  const [qty, setQty] = useState(defaultPortion ? '1' : '100');
  const [unitKey, setUnitKey] = useState<string>(defaultPortion ? `p:${defaultPortion.id}` : 'g');
  const [state, setState] = useState<WeightState>(f.state);
  const [favorite, setFavorite] = useState(f.isFavorite);
  const quantity = Number(qty.replace(',', '.'));
  const unit: EntryUnit = unitKey.startsWith('p:') ? 'portion' : f.basis === '100ml' ? 'ml' : 'g';
  const portionId = unitKey.startsWith('p:') ? unitKey.slice(2) : null;
  const valid = Number.isFinite(quantity) && quantity > 0;
  const input = { date: props.date, meal: props.mealId, foodId: f.id, quantity, unit, portionId, weightState: state };

  const { data: preview } = useQuery({
    queryKey: ['entryPreview', input],
    queryFn: () => previewFoodEntry(platform.db, input),
    enabled: valid,
  });

  const add = async () => {
    if (!valid) return;
    if (await run((db) => addFoodEntry(db, input), `${f.name} ajouté.`)) props.onClose();
  };

  return (
    <Modal
      title={`Ajouter au ${props.mealName.toLowerCase()}`}
      onClose={props.onClose}
      width={600}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={props.onBack}>
            ← Retour
          </button>
          <div className="spacer" />
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => void add()}>
            Ajouter
          </button>
        </>
      }
    >
      <div className="food-head">
        <div>
          <strong>{f.name}</strong>
          {f.brand && <span className="muted"> · {f.brand}</span>}
          <div className="muted small">
            {SOURCE_LABELS[f.source]} · {per100(f)}
            {Object.keys(f.valueFlags).length > 0 && ' · certaines valeurs « traces » ou sous le seuil de détection'}
          </div>
        </div>
        <button
          type="button"
          className={`btn-icon star ${favorite ? 'is-on' : ''}`}
          aria-pressed={favorite}
          aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          onClick={() => {
            setFavorite(!favorite);
            void run((db) => setFoodFavorite(db, f.id, !favorite));
          }}
        >
          {favorite ? '★' : '☆'}
        </button>
      </div>
      <div className="qty-row">
        <label className="field">
          <span className="field-label">Quantité</span>
          <input autoFocus inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        </label>
        <label className="field">
          <span className="field-label">Unité</span>
          <select value={unitKey} onChange={(e) => setUnitKey(e.target.value)}>
            <option value="g">{f.basis === '100ml' ? 'ml' : 'grammes'}</option>
            {f.portions.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {p.label} ({p.grams} g)
              </option>
            ))}
          </select>
        </label>
        {f.state !== 'na' && (
          <label className="field">
            <span className="field-label">Pesé</span>
            <select value={state} onChange={(e) => setState(e.target.value as WeightState)}>
              <option value="raw">cru</option>
              <option value="cooked">cuit</option>
            </select>
          </label>
        )}
      </div>
      {preview && (
        <div className="entry-preview">
          <strong>{Math.round(preview.nutrients.kcal ?? 0)} kcal</strong>
          <span>{macros(preview.nutrients)}</span>
          <span className="muted small">{preview.grams} {f.basis === '100ml' ? 'ml' : 'g'}</span>
          {preview.warnings.map((w) => (
            <p key={w} className="warning-text">
              {w}
            </p>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Estimation sans aliment de référence : marquée « estimée ». */
function EstimateStep(props: { date: string; mealId: string; mealName: string; initialLabel: string; onBack: () => void; onClose: () => void }) {
  const run = useAction();
  const [f, setF] = useState({ label: props.initialLabel, kcal: '', p: '', c: '', fat: '' });
  const num = (s: string) => Number(s.replace(',', '.'));
  const valid = f.label.trim() && [f.kcal, f.p, f.c, f.fat].every((s) => s.trim() !== '' && Number.isFinite(num(s)) && num(s) >= 0);
  const add = async () => {
    if (!valid) return;
    const ok = await run(
      (db) =>
        addFoodEntry(db, {
          date: props.date,
          meal: props.mealId,
          label: f.label.trim(),
          quantity: 1,
          unit: 'portion',
          estimated: true,
          estimatedNutrients: { kcal: num(f.kcal), proteinG: num(f.p), carbsG: num(f.c), fatG: num(f.fat) },
        }),
      'Estimation ajoutée.',
    );
    if (ok) props.onClose();
  };
  const field = (key: keyof typeof f, label: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input inputMode="decimal" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
    </label>
  );
  return (
    <Modal
      title="Estimation libre"
      onClose={props.onClose}
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={props.onBack}>
            ← Retour
          </button>
          <div className="spacer" />
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => void add()}>
            Ajouter l'estimation
          </button>
        </>
      }
    >
      <p className="muted small">À utiliser en dernier recours (restaurant, plat inconnu) : l'entrée est marquée « estimée ».</p>
      <label className="field">
        <span className="field-label">Libellé</span>
        <input autoFocus value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="ex. Part de pizza (restaurant)" />
      </label>
      <div className="grid grid-4">
        {field('kcal', 'kcal')}
        {field('p', 'Protéines (g)')}
        {field('c', 'Glucides (g)')}
        {field('fat', 'Lipides (g)')}
      </div>
    </Modal>
  );
}
