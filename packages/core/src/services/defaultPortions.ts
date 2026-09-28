import { normalizeText } from '../db/util.ts';

/**
 * Portions usuelles pour les aliments génériques (Ciqual, FCÉN) qui n'en ont pas.
 * Poids moyens indicatifs (partie comestible), modifiables ensuite dans l'application.
 * La première règle dont le motif correspond au nom (normalisé) s'applique.
 */
interface Rule {
  match: RegExp;
  exclude?: RegExp;
  portions: [label: string, grams: number][];
}

const RULES: Rule[] = [
  { match: /^(oeuf|oeufs)\b/, exclude: /poudre|jaune|blanc d|caille/, portions: [['1 œuf moyen', 50], ['1 gros œuf', 60]] },
  { match: /\b(yaourt|yogourt|yoghourt)\b.*\b(grec|grecque)\b/, portions: [['1 pot', 150], ['1 cuillère à soupe', 20]] },
  { match: /\b(yaourt|yogourt|yoghourt)\b/, portions: [['1 pot', 125]] },
  { match: /\bskyr\b/, portions: [['1 pot', 150]] },
  { match: /^fromage (blanc|frais)\b/, portions: [['1 pot individuel', 100], ['1 cuillère à soupe', 30]] },
  { match: /^petit.suisse/, portions: [['1 petit-suisse', 60]] },
  { match: /^lait\b/, exclude: /poudre|concentre|coco/, portions: [['1 verre', 200], ['1 bol', 250]] },
  { match: /^(boisson|jus)\b/, portions: [['1 verre', 200]] },
  { match: /^pain de mie/, portions: [['1 tranche', 25]] },
  { match: /^baguette|^pain courant|^pain, baguette/, portions: [['1/4 de baguette', 60], ['1 tranche', 30]] },
  { match: /^pain\b/, exclude: /epice|chapelure/, portions: [['1 tranche', 35]] },
  { match: /^biscotte/, portions: [['1 biscotte', 8]] },
  { match: /^croissant/, portions: [['1 croissant', 45]] },
  { match: /^pain au chocolat/, portions: [['1 pain au chocolat', 65]] },
  { match: /(flocons d.avoine|avoine, flocons|muesli|cereales pour petit)/, portions: [['1 cuillère à soupe', 10], ['1 bol', 40]] },
  { match: /^(riz|pates|pate alimentaire|spaghetti|macaroni|semoule|quinoa|boulgour|lentille|pois chiche)\b.*\bcuit/, portions: [['1 assiette', 250], ['1 cuillère à soupe', 25]] },
  { match: /^(riz|pates|pate alimentaire|spaghetti|macaroni|semoule|quinoa|boulgour|lentille|pois chiche)\b.*\b(cru|sec)/, portions: [['1 portion sèche', 80]] },
  { match: /^pomme de terre\b/, exclude: /frite|chips|puree|flocon/, portions: [['1 pomme de terre moyenne', 150]] },
  { match: /^banane\b/, exclude: /seche|plantain/, portions: [['1 banane moyenne', 120]] },
  { match: /^pomme\b/, exclude: /de terre|seche|compote|jus/, portions: [['1 pomme moyenne', 150]] },
  { match: /^poire\b/, exclude: /seche|jus/, portions: [['1 poire moyenne', 150]] },
  { match: /^orange\b/, exclude: /jus/, portions: [['1 orange moyenne', 150]] },
  { match: /^(clementine|mandarine)\b/, portions: [['1 fruit', 60]] },
  { match: /^kiwi\b/, portions: [['1 kiwi', 75]] },
  { match: /^peche\b|^nectarine\b/, portions: [['1 fruit moyen', 130]] },
  { match: /^abricot\b/, exclude: /sec/, portions: [['1 abricot', 45]] },
  { match: /^avocat\b/, portions: [['1/2 avocat', 80]] },
  { match: /^tomate\b/, exclude: /concentre|sauce|seche|ketchup/, portions: [['1 tomate moyenne', 120]] },
  { match: /^carotte\b/, exclude: /jus/, portions: [['1 carotte moyenne', 100]] },
  { match: /^(courgette|concombre)\b/, portions: [['1/2 pièce', 150]] },
  { match: /^(poulet|dinde)\b.*\b(filet|escalope|blanc)\b/, portions: [['1 filet', 120]] },
  { match: /^(boeuf|steak)\b.*\bhache\b|^steak hache/, portions: [['1 steak haché', 100]] },
  { match: /^jambon\b/, portions: [['1 tranche', 45]] },
  { match: /^thon\b.*\b(naturel|conserve|appertise)/, portions: [['1 petite boîte égouttée', 100]] },
  { match: /^saumon\b/, portions: [['1 pavé', 125]] },
  { match: /^(emmental|comte|gruyere|camembert|brie|chevre|mozzarella|cheddar|parmesan|fromage)\b/, exclude: /blanc|frais|rape/, portions: [['1 portion', 30]] },
  { match: /\brape\b/, portions: [['1 cuillère à soupe', 10]] },
  { match: /^huile\b/, portions: [['1 cuillère à soupe', 10], ['1 cuillère à café', 4]] },
  { match: /^beurre\b/, exclude: /cacahuete|arachide|amande/, portions: [['1 noisette', 5], ['1 portion (plaquette)', 10]] },
  { match: /^(beurre de cacahuete|beurre d.arachide|puree d.amande|puree de cacahuete)/, portions: [['1 cuillère à soupe', 15]] },
  { match: /^(sucre|cassonade)\b/, portions: [['1 morceau', 5], ['1 cuillère à café', 5]] },
  { match: /^(miel|confiture)\b/, portions: [['1 cuillère à café', 7], ['1 cuillère à soupe', 20]] },
  { match: /^(amande|noix|noisette|cacahuete|arachide|noix de cajou|pistache)\b/, exclude: /puree|beurre|lait|huile/, portions: [['1 poignée', 30]] },
  { match: /^chocolat\b/, exclude: /boisson|poudre|lait chocol/, portions: [['1 carré', 5]] },
  { match: /^compote\b/, portions: [['1 pot ou gourde', 90]] },
  { match: /^(creme fraiche|creme epaisse)\b/, portions: [['1 cuillère à soupe', 15]] },
];

export function defaultPortionsFor(name: string): { label: string; grams: number }[] {
  const n = normalizeText(name);
  for (const r of RULES) {
    if (r.match.test(n) && !(r.exclude && r.exclude.test(n))) return r.portions.map(([label, grams]) => ({ label, grams }));
  }
  return [];
}

/** Ajoute les portions usuelles aux aliments d'une source qui n'en ont aucune. */
export async function applyDefaultPortions(db: import('../db/driver.ts').Db, sources: string[]): Promise<number> {
  const rows = await db.select<{ id: string; name: string }>(
    `SELECT f.id, f.name FROM food f
      WHERE f.source IN (${sources.map(() => '?').join(',')})
        AND NOT EXISTS (SELECT 1 FROM food_portion p WHERE p.food_id = f.id)`,
    sources,
  );
  let n = 0;
  await db.transaction(async (tx) => {
    for (const r of rows) {
      for (const [i, p] of defaultPortionsFor(r.name).entries()) {
        await tx.execute('INSERT INTO food_portion (id, food_id, label, grams, is_default, sort) VALUES (?, ?, ?, ?, ?, ?)', [
          crypto.randomUUID(), r.id, p.label, p.grams, i === 0, i,
        ]);
        n++;
      }
    }
  });
  return n;
}
