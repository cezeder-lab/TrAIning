import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { openNodeDb } from '../src/drivers/node.ts';
import {
  addFoodEntry,
  applyDefaultPortions,
  cnfStatus,
  getDayLog,
  getFood,
  importCiqual,
  importCnf,
  initDatabase,
  mapOffProduct,
  migrate,
  packFoods,
  parseCnfZip,
  parseCsv,
  recomputeEntriesMissingEnergy,
  searchFoods,
  seedReferenceData,
  unpackFoods,
  type ExternalFood,
} from '../src/index.ts';

const BOM = '﻿';
/** Archive au format réel du FCÉN 2026 (en-têtes relevés sur le fichier officiel). */
function cnfZip() {
  const foodName = `${BOM}Food_Code,Food_Description_EN,Food_Description_FR,Alternate_Description_EN,Alternate_Description_FR,Food_Source_Code,USDA_NDB_Code,CNF_Food_Group_Code,Comment_EN,Comment_FR,ScientificName,Food_Last_Updated_Date
6979,"Yogourt (yogurt), Greek style, fat free, 0-0.5% M.F., plain","Yogourt, Grec, sans gras, 0-0,5% M.G., nature","yogurt, yoghurt","Yaourt, yoghourt, sans matières grasses",37,,1,,,,2026-01-28
2,Cheese souffle,Soufflé au fromage,,,20,,22,,,,2012-06-28
3,"Chicken, broiler, breast, meat only, roasted","Poulet à griller, poitrine, chair seulement, rôti",,,0,,5,,,,2012-06-28
${Array.from({ length: 100 }, (_, i) => `${900 + i},Test ${i},Aliment test ${i},,,0,,1,,,,2020-01-01`).join('\r\n')}
`;
  const amounts = [
    'Food_Code,Nutrient_Code,Nutrient_Amount,STD_Error,Observations,Nutrient_Source_Code,Nutrient_Last_Updated_Date',
    '6979,203,10.300000000,,,37,2026-01-01', '6979,204,0.400000000,,,37,2026-01-01', '6979,205,3.900000000,,,37,2026-01-01',
    '6979,208,59.000000000,,,37,2026-01-01', '6979,269,3.200000000,,,37,2026-01-01', '6979,307,36.000000000,,,37,2026-01-01',
    '2,203,9.544150000,0.0000,0.0,51,2010-04-16', '2,204,15.704700000,0.0000,0.0,51,2010-04-16', '2,205,7.1,,,51,2010-04-16', '2,291,0.3,,,51,2010-04-16',
    '3,203,31.02,,,0,2010-01-01', '3,204,3.57,,,0,2010-01-01', '3,208,165,,,0,2010-01-01', '3,205,0,,,0,2010-01-01',
    ...Array.from({ length: 100 }, (_, i) => `${900 + i},208,100,,,0,2020-01-01`),
  ].join('\r\n');
  const measureName = `${BOM}Measure_Code,Measure_Description_and_Unit_EN,Measure_Description_and_Unit_FR\n341,"1 container (175 g)","1 contenant (175 g)"\n383,100 g,100 g\n12,"3/4 cup","3/4 tasse"\n`;
  const conversion = `${BOM}Food_Code,Measure_Type_Code,Measure_Code,Measure_Weight_Conversion,Measure_Weight_Conversion_Last_Updated_Date\n6979,6,341,175,2026-01-01\n6979,6,383,100,2026-01-01\n6979,6,12,180.5,2026-01-01\n6979,3,750,0,1997-05-01\n`;
  const groups = `${BOM}CNF_Food_Group_Code,CNF_Food_Group_Description_EN,CNF_Food_Group_Description_FR\n1,Dairy and Egg Products,Produits laitiers et d'oeufs\n`;
  return zipSync({
    'Food_Name.csv': strToU8(foodName),
    'Nutrient_Amount.csv': strToU8(`${BOM}${amounts}`),
    'Measure_Name.csv': strToU8(measureName),
    'Measure_Weight_Conversion.csv': strToU8(conversion),
    'CNF_Food_Group.csv': strToU8(groups),
    'Guide.pdf': strToU8('%PDF'),
  });
}

describe('Fichier canadien (FCÉN)', () => {
  it('lit le CSV (guillemets, BOM) et convertit les valeurs', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
    const { foods, version } = parseCnfZip(cnfZip(), '2026');
    expect(version).toBe('FCÉN 2026');
    const y = foods.find((f) => f.sourceRef === '6979')!;
    expect(y).toMatchObject({ name: 'Yogourt, Grec, sans gras, 0-0,5% M.G., nature', category: "Produits laitiers et d'oeufs", kcal: 59, proteinG: 10.3, carbsG: 3.9, saltG: 0.09 });
    expect(y.portions).toEqual([{ label: '1 contenant (175 g)', grams: 175 }, { label: '3/4 tasse', grams: 180.5 }]);
    expect(y.aliases).toContain('Yaourt');
    // Soufflé : pas d'énergie → calculée ; glucides disponibles = total − fibres.
    const s = foods.find((f) => f.sourceRef === '2')!;
    expect(s.carbsG).toBe(6.8);
    expect(s.flags).toEqual({ kcal: 'calculée à partir des macronutriments' });
    expect(foods.find((f) => f.sourceRef === '3')!.state).toBe('cooked');
  });

  it('importe, cherche en français ou en anglais, garde le format compact', async () => {
    const h = openNodeDb(':memory:');
    await initDatabase(h.db);
    const { foods, version } = parseCnfZip(cnfZip(), '2026');
    expect(unpackFoods(JSON.parse(JSON.stringify(packFoods(foods, version, 'cnf'))))).toEqual(foods);
    await importCnf(h.db, foods, version);
    expect(await cnfStatus(h.db)).toEqual({ count: 103, version: 'FCÉN 2026' });
    const r = await searchFoods(h.db, 'yaourt grec');
    expect(r[0]).toMatchObject({ badge: 'cnf' });
    expect(r[0]!.food.portions.map((p) => p.label)).toEqual(['1 contenant (175 g)', '3/4 tasse']);
    expect((await searchFoods(h.db, 'greek yogurt'))[0]!.food.sourceRef).toBe('6979');
    expect((await searchFoods(h.db, 'poitrine de poulet roti'))[0]!.food.sourceRef).toBe('3');
  });
});

describe('mise à jour d’une base existante', () => {
  it('migre la version 2 (données conservées) et corrige les entrées à 0 kcal', async () => {
    const h = openNodeDb(':memory:');
    await migrate(h.db, { upTo: 2 });
    await seedReferenceData(h.db);
    // Ancien import Ciqual : yaourt à la grecque sans énergie.
    const old: ExternalFood = { sourceRef: '19860', name: 'Yaourt à la grecque, nature', category: null, state: 'na', kcal: null, proteinG: 3.32, carbsG: 4.21, sugarsG: null, fatG: 9.22, satFatG: null, fiberG: 0, saltG: null, alcoholG: null };
    const fillers = Array.from({ length: 100 }, (_, i) => ({ ...old, sourceRef: `f${i}`, name: `Aliment ${i}`, kcal: 50 }));
    await importCiqual(h.db, [old, ...fillers], 'Ciqual 2020-07-07');
    const yid = (await searchFoods(h.db, 'yaourt grecque'))[0]!.food.id;
    await h.db.execute('UPDATE food SET is_favorite = 1 WHERE id = ?', [yid]);
    const e = await addFoodEntry(h.db, { date: '2026-09-28', meal: 'breakfast', foodId: yid, quantity: 150, unit: 'g' });
    expect(e.kcal).toBe(0);

    await initDatabase(h.db); // migration 3
    const food = (await getFood(h.db, yid))!;
    expect(food.isFavorite).toBe(true);
    expect((await searchFoods(h.db, 'yaourt grec'))[0]!.food.id).toBe(yid);
    expect((await h.db.select('PRAGMA foreign_key_check')).length).toBe(0);
    expect((await h.db.select('PRAGMA foreign_keys'))[0]).toMatchObject({ foreign_keys: 1 });

    // Réimport corrigé (énergie calculée) puis recalcul du journal.
    await importCiqual(h.db, [{ ...old, kcal: 113, flags: { kcal: 'calculée à partir des macronutriments' } }, ...fillers], 'Ciqual 2020-07-07');
    expect(await recomputeEntriesMissingEnergy(h.db)).toBe(1);
    expect((await getDayLog(h.db, '2026-09-28')).totals.kcal).toBe(Math.round(113 * 1.5));
    expect(await applyDefaultPortions(h.db, ['ciqual'])).toBeGreaterThan(0);
    expect((await getFood(h.db, yid))!.portions[0]).toMatchObject({ label: '1 pot', grams: 150 });
  });

  it('Open Food Facts : énergie calculée si absente', () => {
    const f = mapOffProduct({ code: '1', product_name: 'Skyr sans énergie', nutriments: { proteins_100g: 10, carbohydrates_100g: 4, fat_100g: 0.2 } })!;
    expect(f.kcal).toBe(58);
    expect(f.flags).toEqual({ kcal: 'calculée à partir des macronutriments' });
  });
});
