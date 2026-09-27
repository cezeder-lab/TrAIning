import {
  addMediaFile,
  addMediaLink,
  deleteMedia,
  normalizeText,
  setMediaThumbnail,
  updateMediaCaption,
  type Exercise,
} from '@training/core';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal.tsx';
import { TextField } from '../../components/fields.tsx';
import { errorMessage, useAction, useApp } from '../../lib/app.tsx';
import { useMedia } from '../../lib/queries.ts';

export function ExerciseMediaTab({ exercise }: { exercise: Exercise }) {
  const { platform, toast } = useApp();
  const run = useAction();
  const { data: media = [] } = useMedia(exercise.id);
  const [url, setUrl] = useState('');
  const [freeDb, setFreeDb] = useState(false);
  const images = media.filter((m) => m.kind === 'image' || m.kind === 'gif');
  const links = media.filter((m) => m.kind === 'video_link' || m.kind === 'link');

  const addImage = async () => {
    try {
      const rel = await platform.pickImage('exercises');
      if (rel) await run((db) => addMediaFile(db, exercise.id, rel), 'Image ajoutée.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const remove = async (id: string) => {
    const file = await run((db) => deleteMedia(db, id));
    if (file) await platform.deleteMediaFile(file).catch(() => undefined);
  };

  return (
    <div className="media-tab">
      <div className="row">
        <button type="button" className="btn" onClick={() => void addImage()}>
          + Image / GIF depuis le disque
        </button>
        <button type="button" className="btn" onClick={() => setFreeDb(true)}>
          Images libres (free-exercise-db)
        </button>
      </div>

      {images.length > 0 ? (
        <ul className="media-grid">
          {images.map((m) => (
            <li key={m.id} className={m.isThumbnail ? 'is-thumbnail' : ''}>
              <img src={platform.mediaUrl(m.filePath!)} alt={m.caption ?? exercise.name} loading="lazy" />
              <TextField label="Légende" className="label-hidden" value={m.caption} placeholder="Légende" onSave={(c) => run((db) => updateMediaCaption(db, m.id, c))} />
              <div className="row">
                <button
                  type="button"
                  className="btn-link"
                  disabled={m.isThumbnail}
                  onClick={() => void run((db) => setMediaThumbnail(db, m.id))}
                >
                  {m.isThumbnail ? '★ Miniature des fiches' : '☆ Utiliser comme miniature'}
                </button>
                <div className="spacer" />
                <button type="button" className="btn-icon btn-danger-text" aria-label="Supprimer l'image" onClick={() => void remove(m.id)}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Aucune image. La miniature choisie apparaît sur les fiches de séance exportées.</p>
      )}

      <h3 className="section-title">Liens (vidéos Instagram, YouTube…)</h3>
      <ul className="link-list">
        {links.map((m) => (
          <li key={m.id}>
            <span className="badge badge-optional">{m.kind === 'video_link' ? 'Vidéo' : 'Lien'}</span>
            <button type="button" className="btn-link link-url" onClick={() => void platform.openExternal(m.url!)} title={m.url!}>
              {m.caption || m.url}
            </button>
            <div className="spacer" />
            <button type="button" className="btn-icon btn-danger-text" aria-label="Supprimer le lien" onClick={() => void remove(m.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if ((await run((db) => addMediaLink(db, exercise.id, url), 'Lien ajouté.')) !== undefined) setUrl('');
        }}
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/…" style={{ flex: 1 }} aria-label="Lien" />
        <button type="submit" className="btn" disabled={!url.trim()}>
          Ajouter le lien
        </button>
      </form>
      {freeDb && <FreeExerciseDbDialog exercise={exercise} onClose={() => setFreeDb(false)} />}
    </div>
  );
}

// --- free-exercise-db (github.com/yuhonas/free-exercise-db, domaine public / Unlicense) ---

interface FreeExercise {
  id: string;
  name: string;
  equipment: string | null;
  primaryMuscles: string[];
  images: string[];
}

const FREE_DB_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main';
let datasetPromise: Promise<FreeExercise[]> | null = null;

function FreeExerciseDbDialog({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const { platform, toast } = useApp();
  const run = useAction();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<FreeExercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    datasetPromise ??= platform.httpFetch(`${FREE_DB_BASE}/dist/exercises.json`).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    datasetPromise.then(setData, (err) => {
      datasetPromise = null;
      setError(`Téléchargement impossible (${errorMessage(err)}). Vérifiez la connexion internet.`);
    });
  }, [platform]);

  const results = useMemo(() => {
    const tokens = normalizeText(query).split(' ').filter(Boolean);
    if (!data || tokens.length === 0) return [];
    return data.filter((e) => tokens.every((t) => normalizeText(`${e.name} ${e.equipment ?? ''}`).includes(t))).slice(0, 24);
  }, [data, query]);

  const importImages = async (fx: FreeExercise) => {
    setBusy(fx.id);
    try {
      for (const img of fx.images) {
        const res = await platform.httpFetch(`${FREE_DB_BASE}/exercises/${img}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const rel = await platform.saveMediaBytes(bytes, img.split('.').pop() ?? 'jpg', 'exercises');
        await run((db) => addMediaFile(db, exercise.id, rel, `${fx.name} — free-exercise-db (domaine public)`));
      }
      toast(`${fx.images.length} image(s) importée(s).`);
      onClose();
    } catch (err) {
      toast(`Import impossible : ${errorMessage(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={`Images libres pour « ${exercise.name} »`} onClose={onClose} width={760}>
      <p className="muted small">
        Base libre de droits (domaine public) d'environ 800 exercices, en anglais. Cherchez avec le nom anglais : « dumbbell
        curl », « lateral raise », « romanian deadlift »…
      </p>
      <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom anglais de l'exercice" aria-label="Recherche" />
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <p className="muted">Chargement de la base…</p>}
      <ul className="freedb-results">
        {results.map((fx) => (
          <li key={fx.id}>
            {fx.images[0] && <img src={`${FREE_DB_BASE}/exercises/${fx.images[0]}`} alt="" loading="lazy" />}
            <div>
              <strong>{fx.name}</strong>
              <small>{[fx.equipment, fx.primaryMuscles.join(', ')].filter(Boolean).join(' · ')}</small>
            </div>
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void importImages(fx)}>
              {busy === fx.id ? 'Import…' : `Importer ${fx.images.length} image(s)`}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
