import {
  addFoodEntry,
  addPain,
  addWaistMeasurement,
  addWeightEntry,
  appendDayNote,
  cacheOffFoods,
  createCustomFood,
  createRecipe,
  deleteFoodEntry,
  DomainError,
  getActiveProgram,
  getBodyMetrics,
  getDayLog,
  getExerciseHistory,
  getFood,
  getFoodEntry,
  getFoodsByIds,
  getGoalsAt,
  getNutritionSummary,
  getRecipe,
  getSession,
  getUserProfile,
  listCardio,
  listExercises,
  listMealCategories,
  listSavedMeals,
  listSessions,
  localDate,
  logMcpWrite,
  logSavedMeal,
  normalizeText,
  offByBarcode,
  offSearch,
  previewFoodEntry,
  searchFoods,
  updateFoodEntry,
  updateSession,
  type Db,
  type Food,
} from '@training/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { cardioOut, dayLogOut, entryOut, foodOut, programOut, sessionOut } from './format.ts';
import { SERVER_INSTRUCTIONS } from './instructions.ts';
import { registerPrompts } from './prompts.ts';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface ServerContext {
  db: Db;
  fetch: FetchFn;
  today?: () => string;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const CONFIRMED = z
  .literal(true)
  .describe("Mettre true UNIQUEMENT après avoir montré le récapitulatif à l'utilisateur et reçu son accord explicite.");

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): Result => ({ content: [{ type: 'text', text: JSON.stringify(data, (_k, v) => (v === undefined ? undefined : v), 1) }] });
const fail = (message: string): Result => ({ content: [{ type: 'text', text: message }], isError: true });

function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}
function checkRange(from: string, to: string, max = 366) {
  if (from > to) throw new DomainError('La date de début doit précéder la date de fin.');
  if (days(from, to) > max) throw new DomainError(`Période limitée à ${max} jours.`);
}

export const VERSION = '0.1.0';

export function createServer(ctx: ServerContext): McpServer {
  const { db } = ctx;
  const today = ctx.today ?? (() => localDate());
  const server = new McpServer({ name: 'training', title: 'TrAIning — journal entraînement & nutrition', version: VERSION }, { instructions: SERVER_INSTRUCTIONS });

  /** Enregistre un outil : validation stricte, erreurs métier renvoyées lisiblement. */
  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    handler: (args: z.output<z.ZodObject<S>>) => Promise<unknown>,
    opts: { write?: boolean; title?: string } = {},
  ) => {
    server.registerTool(
      name,
      {
        title: opts.title,
        description,
        inputSchema: z.object(shape).strict(),
        annotations: { readOnlyHint: !opts.write, destructiveHint: name.startsWith('delete'), openWorldHint: name === 'search_food' },
      },
      (async (args: z.output<z.ZodObject<S>>) => {
        try {
          const out = await handler(args);
          if (opts.write) await logMcpWrite(db, name, args).catch(() => undefined);
          return ok(out);
        } catch (err) {
          if (err instanceof z.ZodError) return fail(`Paramètres invalides : ${err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}`);
          return fail(err instanceof Error ? err.message : String(err));
        }
      }) as never,
    );
  };

  // ------------------------------------------------------------------ Profil

  tool(
    'get_user_profile',
    "Profil de l'utilisateur : objectifs, priorités musculaires, contraintes physiques, préférences de réponse, objectifs nutritionnels par type de jour, repas du journal, programme actif et date du jour. À appeler en début de conversation.",
    {},
    async () => {
      const profile = await getUserProfile(db);
      const goals = await getGoalsAt(db, today());
      const program = await getActiveProgram(db);
      return {
        today: today(),
        units: { weight: 'kg', food: 'g / ml' },
        profile: {
          name: profile.displayName,
          sex: profile.sex,
          birth_year: profile.birthYear,
          height_cm: profile.heightCm,
          goals: profile.goals,
          muscle_priorities: profile.musclePriorities,
          physical_constraints: profile.physicalConstraints,
          response_preferences: profile.responsePreferences,
        },
        nutrition_goals: Object.fromEntries(
          Object.entries(goals).map(([k, g]) => [k, { kcal: g!.kcal, protein_g: g!.proteinG, carbs_g: g!.carbsG, fat_g: g!.fatG, fiber_g: g!.fiberG, since: g!.validFrom }]),
        ),
        nutrition_goal_rule: "Un type de jour sans objectif propre (ou sans une valeur) reprend l'objectif « default ».",
        meals: (await listMealCategories(db)).map((m) => ({ meal_id: m.id, name: m.name })),
        active_program: program ? { name: program.name, templates: program.templates.map((t) => t.name) } : null,
      };
    },
  );

  // ------------------------------------------------------------------ Nutrition

  tool(
    'search_food',
    "Cherche un aliment dans toutes les sources et renvoie ses valeurs nutritionnelles et sa source : récents, favoris, base perso et recettes, Ciqual (ANSES), puis Open Food Facts en ligne (produits de marque, code-barres). Tolère fautes et accents. C'est la seule source autorisée de valeurs nutritionnelles.",
    {
      query: z.string().min(2).max(120).optional().describe('Nom de l’aliment, ex. « skyr », « riz basmati cuit »'),
      barcode: z.string().min(8).max(14).optional().describe('Code-barres EAN (Open Food Facts)'),
      include_online: z.boolean().default(true).describe('Interroger Open Food Facts si la base locale donne peu de résultats'),
      limit: z.number().int().min(1).max(25).default(10),
    },
    async ({ query, barcode, include_online, limit }) => {
      if (!query && !barcode) throw new DomainError('Indiquez query ou barcode.');
      const notes: string[] = [];
      const out: ReturnType<typeof foodOut>[] = [];
      if (barcode) {
        const code = barcode.replace(/\D/g, '');
        const local = (await db.select<{ id: string }>("SELECT id FROM food WHERE source = 'off' AND source_ref = ?", [code]))[0];
        let food: Food | null = local ? await getFood(db, local.id) : null;
        if (!food && include_online) {
          try {
            const p = await offByBarcode(ctx.fetch, code);
            if (p) {
              const ids = await cacheOffFoods(db, [p]);
              food = await getFood(db, ids.get(p.sourceRef)!);
            }
          } catch (err) {
            notes.push(`Open Food Facts indisponible : ${err instanceof Error ? err.message : err}`);
          }
        }
        if (food) out.push(foodOut(food, 'code-barres'));
        else notes.push('Code-barres introuvable.');
      }
      if (query) {
        const local = await searchFoods(db, query, { limit });
        out.push(...local.map((r) => foodOut(r.food, r.badge)));
        if (include_online && local.length < 5) {
          try {
            const products = await offSearch(ctx.fetch, query, 10);
            const ids = await cacheOffFoods(db, products);
            const foods = await getFoodsByIds(db, [...ids.values()]);
            for (const p of products) {
              const f = foods.get(ids.get(p.sourceRef)!);
              if (f && !out.some((o) => o.food_id === f.id)) out.push(foodOut(f, 'off'));
            }
          } catch (err) {
            notes.push(`Open Food Facts indisponible : ${err instanceof Error ? err.message : err}`);
          }
        }
      }
      if (!out.length) notes.push('Aucun résultat. Reformulez (nom générique, sans marque) avant d’envisager une estimation.');
      return { results: out.slice(0, limit + 10), notes };
    },
  );

  tool(
    'get_food_details',
    'Détail complet d’un aliment (toutes valeurs, drapeaux « traces » ou sous le seuil, portions nommées, rendement cru/cuit, ingrédients si recette).',
    { food_id: z.string() },
    async ({ food_id }) => {
      const f = await getFood(db, food_id);
      if (!f) throw new DomainError('Aliment introuvable.');
      const recipe = f.source === 'recipe' ? await getRecipe(db, food_id) : null;
      return {
        ...foodOut(f),
        ...(recipe
          ? {
              recipe: {
                total_cooked_g: recipe.totalCookedG,
                servings: recipe.servings,
                ingredients: recipe.ingredients.map((i) => ({ food: i.foodName, food_id: i.foodId, quantity_g: i.quantityG, weighed: i.weightState })),
              },
            }
          : {}),
      };
    },
  );

  const entryShape = {
    date: DATE.optional().describe('Par défaut : aujourd’hui'),
    meal: z.string().describe('Repas : identifiant ou nom (ex. « Déjeuner »), voir get_user_profile'),
    food_id: z.string().optional().describe('Aliment trouvé via search_food (obligatoire sauf estimation libre)'),
    label: z.string().max(200).optional().describe('Libellé, requis pour une estimation libre sans food_id'),
    quantity: z.number().positive().max(100000),
    unit: z.enum(['g', 'ml', 'portion']).describe('portion = portion nommée de l’aliment (portion_id)'),
    portion_id: z.string().optional(),
    weight_state: z.enum(['raw', 'cooked']).optional().describe('Poids pesé cru ou cuit (converti si le rendement de cuisson est connu)'),
    estimated: z.boolean().describe('true si la quantité ou les valeurs sont estimées'),
    estimated_nutrients: z
      .object({ kcal: z.number().min(0), protein_g: z.number().min(0), carbs_g: z.number().min(0), fat_g: z.number().min(0), fiber_g: z.number().min(0).optional() })
      .strict()
      .optional()
      .describe('Valeurs TOTALES de l’entrée, seulement pour une estimation libre (dernier recours)'),
    note: z.string().max(500).optional(),
    user_confirmed: CONFIRMED,
  };

  tool(
    'add_food_entry',
    'Ajoute un aliment au journal. Préalable obligatoire : récapitulatif (aliment, quantité, kcal, macros, source) montré à l’utilisateur et confirmé. Sans food_id, uniquement en dernier recours avec label, estimated=true et estimated_nutrients.',
    entryShape,
    async (a) => {
      if (!a.food_id && !(a.estimated && a.label && a.estimated_nutrients)) {
        throw new DomainError('Sans food_id, fournissez label, estimated=true et estimated_nutrients (dernier recours).');
      }
      const input = {
        date: a.date ?? today(),
        meal: a.meal,
        foodId: a.food_id ?? null,
        label: a.label ?? null,
        quantity: a.quantity,
        unit: a.unit,
        portionId: a.portion_id ?? null,
        weightState: a.weight_state,
        estimated: a.estimated,
        estimatedNutrients: a.estimated_nutrients
          ? { kcal: a.estimated_nutrients.kcal, proteinG: a.estimated_nutrients.protein_g, carbsG: a.estimated_nutrients.carbs_g, fatG: a.estimated_nutrients.fat_g, fiberG: a.estimated_nutrients.fiber_g ?? null }
          : null,
        note: a.note ?? null,
      };
      const preview = await previewFoodEntry(db, input);
      const entry = await addFoodEntry(db, input, 'mcp');
      const log = await getDayLog(db, entry.date);
      return { added: entryOut(entry), warnings: preview.warnings, day: { totals: dayLogOut(log).totals, goal: dayLogOut(log).goal, remaining: dayLogOut(log).remaining } };
    },
    { write: true },
  );

  tool(
    'update_food_entry',
    'Modifie une entrée du journal (quantité, unité, portion, cru/cuit, repas, date, note, drapeau estimé) ; les valeurs sont recalculées. Confirmation préalable obligatoire.',
    {
      entry_id: z.string(),
      quantity: z.number().positive().max(100000).optional(),
      unit: z.enum(['g', 'ml', 'portion']).optional(),
      portion_id: z.string().optional(),
      weight_state: z.enum(['raw', 'cooked']).optional(),
      meal: z.string().optional(),
      date: DATE.optional(),
      note: z.string().max(500).optional(),
      estimated: z.boolean().optional(),
      user_confirmed: CONFIRMED,
    },
    async (a) => {
      const before = await getFoodEntry(db, a.entry_id);
      if (!before) throw new DomainError('Entrée introuvable.');
      const after = await updateFoodEntry(db, a.entry_id, {
        quantity: a.quantity,
        unit: a.unit,
        portionId: a.portion_id,
        weightState: a.weight_state,
        meal: a.meal,
        date: a.date,
        note: a.note,
        estimated: a.estimated,
      });
      return { before: entryOut(before), after: entryOut(after), day_totals: dayLogOut(await getDayLog(db, after.date)).totals };
    },
    { write: true },
  );

  tool(
    'delete_food_entry',
    'Supprime une entrée du journal alimentaire. Confirmation préalable obligatoire.',
    { entry_id: z.string(), user_confirmed: CONFIRMED },
    async ({ entry_id }) => {
      const e = await deleteFoodEntry(db, entry_id);
      if (!e) throw new DomainError('Entrée introuvable.');
      return { deleted: entryOut(e), day_totals: dayLogOut(await getDayLog(db, e.date)).totals };
    },
    { write: true },
  );

  tool(
    'get_day_log',
    'Journal alimentaire d’un jour : entrées par repas (source, estimé), totaux, objectif du type de jour et reste à consommer.',
    { date: DATE.optional().describe('Par défaut : aujourd’hui') },
    async ({ date }) => dayLogOut(await getDayLog(db, date ?? today())),
  );

  tool(
    'get_nutrition_summary',
    'Bilan nutritionnel sur une période (max 366 jours) : totaux par jour, objectif de chaque jour, moyenne des jours renseignés, jours non renseignés, part des entrées estimées.',
    { from: DATE, to: DATE },
    async ({ from, to }) => {
      checkRange(from, to);
      const s = await getNutritionSummary(db, from, to);
      return {
        from,
        to,
        days_in_period: s.days.length,
        logged_days: s.loggedDays,
        unlogged_days: s.days.filter((d) => !d.logged).map((d) => d.date),
        average_of_logged_days: s.averageLogged && { kcal: s.averageLogged.kcal, protein_g: s.averageLogged.proteinG, carbs_g: s.averageLogged.carbsG, fat_g: s.averageLogged.fatG, fiber_g: s.averageLogged.fiberG },
        estimated_entries_share: s.estimatedShare,
        days: s.days
          .filter((d) => d.logged)
          .map((d) => ({
            date: d.date,
            day_type: d.dayType,
            kcal: d.totals.kcal,
            protein_g: d.totals.proteinG,
            carbs_g: d.totals.carbsG,
            fat_g: d.totals.fatG,
            goal_kcal: d.goal?.kcal ?? null,
            goal_protein_g: d.goal?.proteinG ?? null,
            entries: d.entryCount,
            estimated_entries: d.estimatedCount,
          })),
      };
    },
  );

  tool(
    'create_custom_food',
    'Crée un aliment dans la base perso (valeurs pour 100 g ou 100 ml, ex. lues sur une étiquette). Confirmation préalable obligatoire.',
    {
      name: z.string().min(1).max(200),
      brand: z.string().max(120).optional(),
      basis: z.enum(['100g', '100ml']).default('100g'),
      reference_state: z.enum(['raw', 'cooked', 'na']).default('na'),
      cooked_yield: z.number().min(0.05).max(10).optional().describe('Poids cuit / poids cru'),
      kcal: z.number().min(0).max(1000),
      protein_g: z.number().min(0).max(100),
      carbs_g: z.number().min(0).max(100),
      fat_g: z.number().min(0).max(100),
      sugars_g: z.number().min(0).max(100).optional(),
      sat_fat_g: z.number().min(0).max(100).optional(),
      fiber_g: z.number().min(0).max(100).optional(),
      salt_g: z.number().min(0).max(100).optional(),
      portions: z.array(z.object({ label: z.string().min(1).max(80), grams: z.number().positive() }).strict()).max(10).optional(),
      source_note: z.string().max(200).describe('Origine des valeurs, ex. « étiquette du produit »'),
      user_confirmed: CONFIRMED,
    },
    async (a) => {
      const id = await createCustomFood(
        db,
        {
          name: a.name, brand: a.brand ?? null, basis: a.basis, state: a.reference_state, cookedYield: a.cooked_yield ?? null,
          kcal: a.kcal, proteinG: a.protein_g, carbsG: a.carbs_g, fatG: a.fat_g, sugarsG: a.sugars_g ?? null,
          satFatG: a.sat_fat_g ?? null, fiberG: a.fiber_g ?? null, saltG: a.salt_g ?? null, portions: a.portions, sourceNote: a.source_note,
        },
        'mcp',
      );
      return { created: foodOut((await getFood(db, id))!) };
    },
    { write: true },
  );

  tool(
    'create_recipe',
    'Crée une recette maison à partir d’aliments existants (food_id de search_food) : valeurs calculées pour 100 g de plat cuit et par part. Confirmation préalable obligatoire.',
    {
      name: z.string().min(1).max(200),
      ingredients: z
        .array(z.object({ food_id: z.string(), quantity_g: z.number().positive(), weight_state: z.enum(['raw', 'cooked', 'na']).default('na') }).strict())
        .min(1),
      total_cooked_g: z.number().positive().optional().describe('Poids total du plat pesé après cuisson'),
      servings: z.number().positive().max(100).optional(),
      user_confirmed: CONFIRMED,
    },
    async (a) => {
      const id = await createRecipe(
        db,
        {
          name: a.name,
          ingredients: a.ingredients.map((i) => ({ foodId: i.food_id, quantityG: i.quantity_g, weightState: i.weight_state })),
          totalCookedG: a.total_cooked_g ?? null,
          servings: a.servings ?? null,
        },
        'mcp',
      );
      const r = (await getRecipe(db, id))!;
      return { created: foodOut(r.food), total: { kcal: r.totals.kcal, protein_g: r.totals.proteinG, carbs_g: r.totals.carbsG, fat_g: r.totals.fatG } };
    },
    { write: true },
  );

  tool(
    'get_saved_meals',
    'Repas enregistrés (« petit-déj habituel »…) avec leurs aliments et totaux.',
    { query: z.string().max(80).optional() },
    async ({ query }) =>
      (await listSavedMeals(db, query)).map((m) => ({
        saved_meal_id: m.id,
        name: m.name,
        items: m.items.map((i) => ({ food: i.foodName, quantity: i.quantity, unit: i.unit })),
        totals: { kcal: m.totals.kcal, protein_g: m.totals.proteinG, carbs_g: m.totals.carbsG, fat_g: m.totals.fatG },
      })),
  );

  tool(
    'log_saved_meal',
    'Ajoute un repas enregistré au journal (quantités multipliées par scale). Confirmation préalable obligatoire.',
    { saved_meal_id: z.string(), date: DATE.optional(), meal: z.string().optional(), scale: z.number().positive().max(10).default(1), user_confirmed: CONFIRMED },
    async (a) => {
      const entries = await logSavedMeal(db, a.saved_meal_id, a.date ?? today(), a.meal ?? null, a.scale, 'mcp');
      return { added: entries.map(entryOut), day_totals: dayLogOut(await getDayLog(db, a.date ?? today())).totals };
    },
    { write: true },
  );

  // ------------------------------------------------------------------ Entraînement

  tool(
    'get_program',
    'Programme d’entraînement actif : principes, séances types, exercices dans l’ordre, alternatives, cibles (séries × reps, charge, RIR, repos), exercices optionnels.',
    { template: z.string().optional().describe('Nom ou id d’une séance (ex. « Push »)'), include_disabled: z.boolean().default(true) },
    async ({ template, include_disabled }) => {
      const p = await getActiveProgram(db);
      if (!p) throw new DomainError('Aucun programme actif.');
      return programOut(p, template ?? null, include_disabled);
    },
  );

  tool(
    'get_sessions',
    'Séances de musculation sur une période (max 366 jours) : statut, séries réalisées vs prévues, RIR, fatigue, courbatures, douleurs, cardio rattaché.',
    {
      from: DATE,
      to: DATE,
      template: z.string().optional().describe('Filtrer sur un nom de séance'),
      detail: z.enum(['summary', 'sets']).default('sets'),
    },
    async ({ from, to, template, detail }) => {
      checkRange(from, to);
      const list = (await listSessions(db, from, to)).filter((s) => !template || normalizeText(s.name).includes(normalizeText(template)));
      const out = [];
      for (const s of list) out.push(sessionOut((await getSession(db, s.id))!, detail === 'sets'));
      return { from, to, count: out.length, sessions: out };
    },
  );

  tool(
    'get_exercise_history',
    'Historique d’un exercice (séries cochées uniquement) : par séance, séries, charge max, volume, 1RM estimé (estimation Epley, pas une mesure).',
    {
      exercise: z.string().describe('Nom (tolérant) ou id de l’exercice'),
      from: DATE.optional(),
      to: DATE.optional(),
      limit: z.number().int().min(1).max(200).default(20).describe('Nombre de séances les plus récentes'),
    },
    async ({ exercise, from, to, limit }) => {
      const all = await listExercises(db, { includeArchived: true });
      const n = normalizeText(exercise);
      let matches = all.filter((e) => e.id === exercise || normalizeText(e.name) === n);
      if (!matches.length) {
        const tokens = n.split(' ');
        matches = all.filter((e) => tokens.every((t) => normalizeText(e.name).includes(t)));
      }
      if (!matches.length) throw new DomainError(`Exercice « ${exercise} » introuvable.`);
      if (matches.length > 1) {
        return { ambiguous: true, candidates: matches.map((m) => ({ exercise_id: m.id, name: m.name })), hint: 'Rappelez l’outil avec l’id voulu.' };
      }
      const ex = matches[0]!;
      const h = await getExerciseHistory(db, ex.id, { from, to, limit });
      return {
        exercise: ex.name,
        exercise_id: ex.id,
        sessions_found: h.length,
        note: h.length < 3 ? 'Peu de séances : tendance non significative.' : undefined,
        history: h.map((p) => ({
          date: p.date,
          session: p.sessionName,
          unit: p.unit,
          sets: p.sets.map((s) => ({ load_kg: s.loadKg, value: s.value, ...(s.rir != null ? { rir: s.rir } : {}) })),
          max_load_kg: p.maxLoadKg,
          volume_kg: p.volumeKg,
          e1rm_kg_estimate: p.e1rmKg,
        })),
      };
    },
  );

  tool(
    'get_cardio_sessions',
    'Séances de cardio sur une période (max 366 jours). Les calories viennent de la montre : ce sont des estimations.',
    { from: DATE, to: DATE, activity: z.string().optional() },
    async ({ from, to, activity }) => {
      checkRange(from, to);
      const list = await listCardio(db, { from, to, activity });
      return { from, to, count: list.length, total_minutes: Math.round(list.reduce((s, c) => s + c.durationS, 0) / 60), sessions: list.map(cardioOut) };
    },
  );

  tool(
    'log_session_note',
    'Ajoute à une séance (ou au jour s’il n’y en a pas) un commentaire, la fatigue et les courbatures (0-10) et des douleurs (zone, côté, intensité 0-10). N’écrase pas les commentaires existants. Ne modifie ni les séries ni le programme.',
    {
      session_id: z.string().optional(),
      date: DATE.optional().describe('Utilisé si session_id absent (par défaut : aujourd’hui)'),
      comment: z.string().max(2000).optional(),
      fatigue: z.number().int().min(0).max(10).optional(),
      soreness: z.number().int().min(0).max(10).optional(),
      pains: z
        .array(
          z
            .object({
              zone: z.string().min(1).max(80),
              side: z.enum(['left', 'right', 'both', 'center']).optional(),
              intensity: z.number().int().min(0).max(10),
              context: z.string().max(200).optional(),
              note: z.string().max(500).optional(),
            })
            .strict(),
        )
        .max(10)
        .optional(),
    },
    async (a) => {
      let session = a.session_id ? await getSession(db, a.session_id) : null;
      if (a.session_id && !session) throw new DomainError('Séance introuvable.');
      const date = session?.date ?? a.date ?? today();
      if (!session) {
        const same = await listSessions(db, date, date);
        if (same.length > 1) {
          return { ambiguous: true, sessions: same.map((s) => ({ session_id: s.id, name: s.name })), hint: 'Précisez session_id.' };
        }
        if (same.length === 1) session = await getSession(db, same[0]!.id);
      }
      if (session) {
        const comment = a.comment ? (session.comment ? `${session.comment}\n${a.comment}` : a.comment) : undefined;
        await updateSession(db, session.id, { comment, fatigue: a.fatigue, soreness: a.soreness });
      } else if (a.comment || a.fatigue != null || a.soreness != null) {
        const parts = [a.comment, a.fatigue != null ? `fatigue ${a.fatigue}/10` : null, a.soreness != null ? `courbatures ${a.soreness}/10` : null].filter(Boolean);
        await appendDayNote(db, date, parts.join(' · '));
      }
      for (const p of a.pains ?? []) {
        await addPain(db, { date, sessionId: session?.id ?? null, zone: p.zone, side: p.side ?? null, intensity: p.intensity, context: p.context ?? null, note: p.note ?? null }, 'mcp');
      }
      return { attached_to: session ? { session_id: session.id, name: session.name, date } : { day: date }, saved: { comment: !!a.comment, fatigue: a.fatigue, soreness: a.soreness, pains: a.pains?.length ?? 0 } };
    },
    { write: true },
  );

  // ------------------------------------------------------------------ Corps

  tool(
    'get_body_metrics',
    'Poids (pesées irrégulières), moyenne glissante 7 jours calculée sur les pesées disponibles (avec leur nombre), tendance sur 28 jours seulement si les données suffisent, tours de taille.',
    { from: DATE.optional().describe('Par défaut : 30 jours avant `to`'), to: DATE.optional().describe('Par défaut : aujourd’hui') },
    async (a) => {
      const to = a.to ?? today();
      const from = a.from ?? new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
      checkRange(from, to, 731);
      const m = await getBodyMetrics(db, from, to);
      return {
        from,
        to,
        weigh_ins: m.weights.length,
        weights: m.weights.map((w) => ({ date: w.date, weight_kg: w.weightKg, avg7_kg: w.avg7, avg7_based_on: w.avg7Count })),
        trend: m.trend.status === 'ok' ? { status: 'ok', kg_per_week: m.trend.kgPerWeek, weigh_ins: m.trend.points, span_days: m.trend.spanDays } : { status: 'insufficient', reason: m.trend.reason },
        waist_cm: m.waist.map((w) => ({ date: w.date, value_cm: w.valueCm })),
      };
    },
  );

  tool(
    'add_weight_entry',
    'Enregistre une pesée (au plus une par jour). Si une pesée existe déjà ce jour-là, erreur sauf replace_existing=true (à demander à l’utilisateur).',
    {
      date: DATE.optional(),
      weight_kg: z.number().min(20).max(400),
      time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      note: z.string().max(300).optional(),
      replace_existing: z.boolean().default(false),
    },
    async (a) => {
      const w = await addWeightEntry(db, { date: a.date ?? today(), weightKg: a.weight_kg, time: a.time ?? null, note: a.note ?? null, replaceExisting: a.replace_existing }, 'mcp');
      return { saved: { date: w.date, weight_kg: w.weightKg } };
    },
    { write: true },
  );

  tool(
    'add_waist_measurement',
    'Enregistre un tour de taille en cm (au plus un par jour ; replace_existing=true pour remplacer).',
    { date: DATE.optional(), value_cm: z.number().min(20).max(300), note: z.string().max(300).optional(), replace_existing: z.boolean().default(false) },
    async (a) => {
      const w = await addWaistMeasurement(db, { date: a.date ?? today(), valueCm: a.value_cm, note: a.note ?? null, replaceExisting: a.replace_existing }, 'mcp');
      return { saved: { date: w.date, value_cm: w.valueCm } };
    },
    { write: true },
  );

  registerPrompts(server, today);
  return server;
}
