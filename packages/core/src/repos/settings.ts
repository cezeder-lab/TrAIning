import type { Db } from '../db/driver.ts';
import { nowIso } from '../db/util.ts';

/** Paramètres applicatifs stockés en JSON. */
export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  imageExportDir: string | null;
  backupDir: string | null;
  backupKeepDays: number;
  /** Version importée de chaque table de référence embarquée (« Ciqual 2020-07-07#r2 »…). */
  foodDataVersions: Record<string, string>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  imageExportDir: null,
  backupDir: null,
  backupKeepDays: 14,
  foodDataVersions: {},
};

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await db.select<{ key: string; value: string }>('SELECT key, value FROM app_setting');
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue;
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* valeur corrompue : on garde la valeur par défaut */
    }
  }
  return out as unknown as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(db: Db, key: K, value: AppSettings[K]): Promise<void> {
  await db.execute(
    'INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
}

export interface UserProfile {
  displayName: string | null;
  sex: 'M' | 'F' | 'other' | null;
  birthYear: number | null;
  heightCm: number | null;
  goals: string | null;
  musclePriorities: string[];
  physicalConstraints: string | null;
  responsePreferences: string | null;
  updatedAt: string;
}

export async function getUserProfile(db: Db): Promise<UserProfile> {
  const r = (await db.select<Record<string, any>>('SELECT * FROM user_profile WHERE id = 1'))[0] ?? {};
  let priorities: string[] = [];
  try {
    priorities = r.muscle_priorities ? JSON.parse(r.muscle_priorities) : [];
  } catch {
    priorities = [];
  }
  return {
    displayName: r.display_name ?? null,
    sex: r.sex ?? null,
    birthYear: r.birth_year ?? null,
    heightCm: r.height_cm ?? null,
    goals: r.goals ?? null,
    musclePriorities: priorities,
    physicalConstraints: r.physical_constraints ?? null,
    responsePreferences: r.response_preferences ?? null,
    updatedAt: r.updated_at ?? nowIso(),
  };
}

const PROFILE_COLUMNS: Record<string, string> = {
  displayName: 'display_name',
  sex: 'sex',
  birthYear: 'birth_year',
  heightCm: 'height_cm',
  goals: 'goals',
  musclePriorities: 'muscle_priorities',
  physicalConstraints: 'physical_constraints',
  responsePreferences: 'response_preferences',
};

export async function updateUserProfile(
  db: Db,
  patch: Partial<Omit<UserProfile, 'updatedAt'>>,
): Promise<void> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [key, col] of Object.entries(PROFILE_COLUMNS)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(key === 'musclePriorities' ? JSON.stringify(v) : (v as string | number | null));
  }
  sets.push('updated_at = ?');
  params.push(nowIso());
  await db.transaction(async (tx) => {
    await tx.execute('INSERT OR IGNORE INTO user_profile (id, updated_at) VALUES (1, ?)', [nowIso()]);
    await tx.execute(`UPDATE user_profile SET ${sets.join(', ')} WHERE id = 1`, params);
  });
}
