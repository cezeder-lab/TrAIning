import type { Db } from '../db/driver.ts';
import { newId } from '../db/ids.ts';
import { DomainError, bool, nowIso } from '../db/util.ts';
import type { ExerciseMedia } from '../types.ts';

type R = Record<string, any>;

function mapMedia(r: R): ExerciseMedia {
  return {
    id: r.id,
    exerciseId: r.exercise_id,
    kind: r.kind,
    filePath: r.file_path,
    url: r.url,
    caption: r.caption,
    isThumbnail: bool(r.is_thumbnail),
    sort: r.sort,
  };
}

export async function listMedia(db: Db, exerciseId: string): Promise<ExerciseMedia[]> {
  return (await db.select<R>('SELECT * FROM exercise_media WHERE exercise_id = ? ORDER BY sort', [exerciseId])).map(mapMedia);
}

const VIDEO_HOSTS = /(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vimeo\.com|facebook\.com)/i;

async function insertMedia(db: Db, exerciseId: string, m: Omit<ExerciseMedia, 'id' | 'exerciseId' | 'sort'>): Promise<string> {
  const id = newId();
  await db.transaction(async (tx) => {
    const hasThumb = (await tx.select('SELECT 1 FROM exercise_media WHERE exercise_id = ? AND is_thumbnail = 1', [exerciseId])).length > 0;
    await tx.execute(
      `INSERT INTO exercise_media (id, exercise_id, kind, file_path, url, caption, is_thumbnail, sort, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(sort) + 1, 0) FROM exercise_media WHERE exercise_id = ?), ?)`,
      [
        id, exerciseId, m.kind, m.filePath, m.url, m.caption,
        // La première image devient la miniature par défaut.
        !hasThumb && (m.kind === 'image' || m.kind === 'gif'),
        exerciseId, nowIso(),
      ],
    );
  });
  return id;
}

/** Image ou GIF déjà copié dans le dossier des médias (chemin relatif). */
export async function addMediaFile(db: Db, exerciseId: string, filePath: string, caption: string | null = null): Promise<string> {
  const kind = /\.gif$/i.test(filePath) ? 'gif' : 'image';
  return insertMedia(db, exerciseId, { kind, filePath, url: null, caption, isThumbnail: false });
}

export async function addMediaLink(db: Db, exerciseId: string, url: string, caption: string | null = null): Promise<string> {
  const clean = url.trim();
  if (!/^https?:\/\/\S+$/i.test(clean)) throw new DomainError('Lien invalide : il doit commencer par http:// ou https://.');
  return insertMedia(db, exerciseId, {
    kind: VIDEO_HOSTS.test(clean) ? 'video_link' : 'link',
    filePath: null,
    url: clean,
    caption,
    isThumbnail: false,
  });
}

export async function updateMediaCaption(db: Db, id: string, caption: string | null): Promise<void> {
  await db.execute('UPDATE exercise_media SET caption = ? WHERE id = ?', [caption, id]);
}

export async function setMediaThumbnail(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const m = (await tx.select<R>('SELECT exercise_id, kind FROM exercise_media WHERE id = ?', [id]))[0];
    if (!m) throw new DomainError('Média introuvable.');
    if (m.kind !== 'image' && m.kind !== 'gif') throw new DomainError('Seule une image peut servir de miniature.');
    await tx.execute('UPDATE exercise_media SET is_thumbnail = 0 WHERE exercise_id = ?', [m.exercise_id]);
    await tx.execute('UPDATE exercise_media SET is_thumbnail = 1 WHERE id = ?', [id]);
  });
}

/** Supprime le média ; retourne le fichier local à effacer (s'il y en a un). */
export async function deleteMedia(db: Db, id: string): Promise<string | null> {
  const m = (await db.select<R>('SELECT file_path FROM exercise_media WHERE id = ?', [id]))[0];
  if (!m) return null;
  await db.execute('DELETE FROM exercise_media WHERE id = ?', [id]);
  return m.file_path;
}

/** Miniature par exercice (image marquée, sinon la première image). */
export async function getThumbnails(db: Db, exerciseIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (exerciseIds.length === 0) return map;
  const rows = await db.select<R>(
    `SELECT exercise_id, file_path FROM exercise_media
      WHERE kind IN ('image','gif') AND exercise_id IN (${exerciseIds.map(() => '?').join(',')})
      ORDER BY is_thumbnail DESC, sort`,
    exerciseIds,
  );
  for (const r of rows) if (!map.has(r.exercise_id)) map.set(r.exercise_id, r.file_path);
  return map;
}
