import { buildSessionSheet, buildTemplateSheet, normalizeText, setSetting, type SheetData } from '@training/core';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal.tsx';
import { Toggle } from '../../components/fields.tsx';
import { errorMessage, useAction, useApp } from '../../lib/app.tsx';
import { today } from '../../lib/dates.ts';
import { useActiveProgram, useSettings } from '../../lib/queries.ts';
import { canvasToPng, loadImage, renderSheet } from './renderSheet.ts';

export type SheetSource =
  | { kind: 'template'; templateId: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'program' };

interface Page {
  name: string;
  url: string;
  png: Uint8Array;
}

const slug = (s: string) => normalizeText(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seance';

/** Export des fiches de séance en PNG : aperçu, copie dans le presse-papiers, enregistrement. */
export function SheetExportDialog({ source, onClose }: { source: SheetSource; onClose: () => void }) {
  const { platform, toast } = useApp();
  const run = useAction();
  const { data: settings } = useSettings();
  const { data: program } = useActiveProgram();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [onePerBlock, setOnePerBlock] = useState(false);
  const [thumbnails, setThumbnails] = useState(true);
  const [date, setDate] = useState<string>(source.kind === 'session' ? '' : today());
  const [pages, setPages] = useState<Page[]>([]);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(true);

  const templateIds = useMemo(() => {
    if (source.kind === 'template') return [source.templateId];
    if (source.kind === 'program') return program?.templates.map((t) => t.id) ?? [];
    return [];
  }, [source, program]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      setBusy(true);
      try {
        const sheets: SheetData[] =
          source.kind === 'session'
            ? [await buildSessionSheet(platform.db, source.sessionId)]
            : await Promise.all(templateIds.map((id) => buildTemplateSheet(platform.db, id, date || null)));
        const images = new Map<string, HTMLImageElement>();
        if (thumbnails) {
          const rels = new Set(sheets.flatMap((s) => s.exercises.map((e) => e.thumbnail).filter((t): t is string => !!t)));
          for (const rel of rels) {
            try {
              const bytes = await platform.mediaBytes(rel);
              const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
              urls.push(url);
              const img = await loadImage(url);
              if (img) images.set(rel, img);
            } catch {
              /* image manquante : fiche sans miniature */
            }
          }
        }
        const out: Page[] = [];
        for (const sheet of sheets) {
          const canvases = renderSheet(sheet, { theme, onePerBlock, thumbnails, images });
          for (const [i, canvas] of canvases.entries()) {
            const png = await canvasToPng(canvas);
            const url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
            urls.push(url);
            const base = `${sheet.date ?? 'fiche'}_${slug(sheet.title)}`;
            out.push({ name: canvases.length > 1 ? `${base}_${i + 1}.png` : `${base}.png`, url, png });
          }
        }
        if (!cancelled) {
          setPages(out);
          setSelected(0);
        }
      } catch (err) {
        if (!cancelled) toast(errorMessage(err), 'error');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 0);
    };
  }, [source, templateIds, theme, onePerBlock, thumbnails, date, platform, toast]);

  const chooseDir = async () => {
    const dir = await platform.pickDirectory("Dossier d'export des fiches (ex. OneDrive synchronisé avec le téléphone)");
    if (dir) await run((db) => setSetting(db, 'imageExportDir', dir));
    return dir;
  };

  const saveAll = async () => {
    const dir = settings?.imageExportDir ?? (await chooseDir());
    if (!dir) return;
    try {
      for (const p of pages) await platform.writeBinaryFile(dir, p.name, p.png);
      toast(`${pages.length} image(s) enregistrée(s) dans ${dir}.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const copy = async () => {
    const p = pages[selected];
    if (!p) return;
    try {
      await platform.copyImageToClipboard(p.png);
      toast(pages.length > 1 ? `Image ${selected + 1}/${pages.length} copiée.` : 'Image copiée dans le presse-papiers.');
    } catch (err) {
      toast(`Copie impossible : ${errorMessage(err)}`, 'error');
    }
  };

  return (
    <Modal
      title={source.kind === 'program' ? 'Exporter toutes les séances en images' : 'Exporter la fiche en image'}
      onClose={onClose}
      width={900}
      footer={
        <>
          <span className="muted small export-dir">
            Dossier : {settings?.imageExportDir ?? 'non choisi'}{' '}
            <button type="button" className="btn-link" onClick={() => void chooseDir()}>
              changer
            </button>
          </span>
          <div className="spacer" />
          <button type="button" className="btn" disabled={busy || !pages.length} onClick={() => void copy()}>
            Copier l'image {pages.length > 1 ? `${selected + 1}` : ''}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !pages.length} onClick={() => void saveAll()}>
            Enregistrer {pages.length > 1 ? `les ${pages.length} images` : "l'image"}
          </button>
        </>
      }
    >
      <div className="export-options">
        <div className="segmented" role="radiogroup" aria-label="Thème de la fiche">
          {(['dark', 'light'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? 'is-selected' : ''} onClick={() => setTheme(t)}>
              {t === 'dark' ? 'Fond sombre' : 'Fond clair'}
            </button>
          ))}
        </div>
        {source.kind !== 'session' && (
          <label className="row">
            <span className="field-label">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        <Toggle label="Une image par bloc" checked={onePerBlock} onChange={setOnePerBlock} />
        <Toggle label="Miniatures des mouvements" checked={thumbnails} onChange={setThumbnails} />
      </div>
      <div className="export-preview" aria-busy={busy}>
        {busy && <p className="muted">Rendu en cours…</p>}
        {!busy &&
          pages.map((p, i) => (
            <button key={p.url} type="button" className={`export-page ${i === selected ? 'is-selected' : ''}`} onClick={() => setSelected(i)} title={p.name}>
              <img src={p.url} alt={`Aperçu ${p.name}`} />
              <small>{p.name}</small>
            </button>
          ))}
      </div>
    </Modal>
  );
}
