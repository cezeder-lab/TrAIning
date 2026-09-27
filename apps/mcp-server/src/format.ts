import type { CardioSession, DayLog, Food, FoodEntry, Program, WorkoutSession } from '@training/core';
import { formatLoad, formatRir, formatTarget } from '@training/core';

/** Représentations compactes renvoyées à Claude (unités dans les noms de champs). */

export function foodOut(f: Food, badge?: string) {
  return {
    food_id: f.id,
    name: f.name,
    brand: f.brand,
    source: f.source,
    source_ref: f.sourceRef,
    source_version: f.sourceVersion,
    ...(badge ? { priority: badge } : {}),
    values_per: f.basis === '100ml' ? '100 ml' : '100 g',
    reference_state: f.state === 'raw' ? 'cru' : f.state === 'cooked' ? 'cuit' : 'non précisé',
    cooked_yield: f.cookedYield,
    kcal: f.kcal,
    protein_g: f.proteinG,
    carbs_g: f.carbsG,
    sugars_g: f.sugarsG,
    fat_g: f.fatG,
    sat_fat_g: f.satFatG,
    fiber_g: f.fiberG,
    salt_g: f.saltG,
    ...(Object.keys(f.valueFlags).length ? { value_flags: f.valueFlags } : {}),
    portions: f.portions.map((p) => ({ portion_id: p.id, label: p.label, grams: p.grams })),
  };
}

export function entryOut(e: FoodEntry) {
  return {
    entry_id: e.id,
    date: e.date,
    label: e.label,
    quantity: e.quantity,
    unit: e.unit === 'portion' ? (e.portionLabel ?? 'portion') : e.unit,
    grams: e.grams,
    weighed: e.weightState === 'raw' ? 'cru' : e.weightState === 'cooked' ? 'cuit' : undefined,
    kcal: e.kcal,
    protein_g: e.proteinG,
    carbs_g: e.carbsG,
    fat_g: e.fatG,
    fiber_g: e.fiberG,
    source: e.source,
    estimated: e.isEstimated,
    added_by: e.createdVia === 'mcp' ? 'claude' : 'app',
    note: e.note ?? undefined,
  };
}

export function dayLogOut(log: DayLog) {
  return {
    date: log.date,
    day_type: log.dayType,
    day_type_source: log.dayTypeManual ? 'choisi' : 'déduit du journal d’entraînement',
    goal: log.goal
      ? { kcal: log.goal.kcal, protein_g: log.goal.proteinG, carbs_g: log.goal.carbsG, fat_g: log.goal.fatG, fiber_g: log.goal.fiberG }
      : null,
    totals: { kcal: log.totals.kcal, protein_g: log.totals.proteinG, carbs_g: log.totals.carbsG, fat_g: log.totals.fatG, fiber_g: log.totals.fiberG },
    remaining: log.remaining
      ? { kcal: log.remaining.kcal, protein_g: log.remaining.proteinG, carbs_g: log.remaining.carbsG, fat_g: log.remaining.fatG }
      : null,
    estimated_entries: log.estimatedCount,
    meals: log.meals.map((m) => ({
      meal: m.category.name,
      meal_id: m.category.id,
      totals_kcal: m.totals.kcal,
      entries: m.entries.map(entryOut),
    })),
  };
}

export function programOut(p: Program, templateFilter: string | null, includeDisabled: boolean) {
  return {
    program: p.name,
    principles: p.comment,
    templates: p.templates
      .filter((t) => !templateFilter || t.id === templateFilter || t.name.toLowerCase() === templateFilter.toLowerCase())
      .map((t) => ({
        template_id: t.id,
        name: t.name,
        comment: t.comment,
        slots: t.slots
          .filter((s) => includeDisabled || !s.isOptional || s.enabledByDefault)
          .map((s) => ({
            block: s.block,
            block_label: s.blockLabel,
            label: s.label,
            target: formatTarget(s, s.targetUnit, s.perSide),
            load: formatLoad(s.loadKg, s.loadNextKg) || null,
            load_note: s.loadNote,
            rir: formatRir(s.rirMin, s.rirMax) || null,
            rest_s: s.restS,
            comment: s.comment,
            optional: s.isOptional,
            enabled_by_default: s.enabledByDefault,
            alternatives: s.options.map((o, i) => ({
              exercise: o.exerciseName,
              exercise_id: o.exerciseId,
              default: i === 0,
              ...(o.loadKg != null ? { load: formatLoad(o.loadKg, o.loadNextKg) } : {}),
              ...(o.sets != null || o.targetMin != null ? { target: formatTarget({ sets: o.sets ?? s.sets, targetMin: o.targetMin ?? s.targetMin, targetMax: o.targetMax ?? s.targetMax }, s.targetUnit, s.perSide) } : {}),
              ...(o.note ? { note: o.note } : {}),
            })),
          })),
      })),
  };
}

export function cardioOut(c: CardioSession) {
  return {
    cardio_id: c.id,
    date: c.date,
    start_time: c.startTime,
    activity: c.activity,
    duration_min: Math.round((c.durationS / 60) * 10) / 10,
    distance_km: c.distanceM != null ? c.distanceM / 1000 : null,
    speed_kmh: c.speedKmh,
    incline_or_level: c.inclineOrLevel,
    hr_avg: c.hrAvg,
    hr_max: c.hrMax,
    calories_watch_estimate: c.caloriesWatchEst,
    feeling_1_5: c.feeling,
    comment: c.comment,
  };
}

export function sessionOut(s: WorkoutSession, withSets: boolean) {
  const enabled = s.exercises.filter((e) => e.isEnabled || e.setEntries.some((x) => x.isDone));
  return {
    session_id: s.id,
    date: s.date,
    name: s.name,
    status: s.status,
    fatigue_0_10: s.fatigue,
    soreness_0_10: s.soreness,
    comment: s.comment,
    pains: s.pains.map((p) => ({ zone: p.zone, side: p.side, intensity_0_10: p.intensity, context: p.context, note: p.note })),
    exercises: enabled.map((e) => {
      const done = e.setEntries.filter((x) => x.isDone && !x.isWarmup);
      const base = {
        exercise: e.exerciseName,
        slot: e.label,
        optional: e.isOptional,
        planned: [formatTarget(e, e.targetUnit, e.perSide), formatLoad(e.loadKg, null), e.loadNote, formatRir(e.rirMin, e.rirMax)].filter(Boolean).join(' · '),
        sets_done: `${done.length}/${e.setEntries.filter((x) => !x.isWarmup).length}`,
        note: e.note ?? undefined,
      };
      if (!withSets) return base;
      return {
        ...base,
        unit: e.targetUnit,
        sets: e.setEntries.map((x) => ({
          set: x.setIndex + 1,
          load_kg: x.loadKg,
          value: x.value,
          done: x.isDone,
          ...(x.rir != null ? { rir: x.rir } : {}),
          ...(x.rpe != null ? { rpe: x.rpe } : {}),
          ...(x.isWarmup ? { warmup: true } : {}),
        })),
      };
    }),
    cardio: s.cardio.map(cardioOut),
  };
}
