import {
  createTemplate,
  exportProgram,
  importProgram,
  localDate,
  normalizeText,
  parseProgramJson,
  reorderTemplates,
  updateProgram,
  type Program,
} from '@training/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { InlineTitle } from '../../components/InlineTitle.tsx';
import { PromptDialog } from '../../components/PromptDialog.tsx';
import { TextArea } from '../../components/fields.tsx';
import { errorMessage, useAction, useApp } from '../../lib/app.tsx';
import { useActiveProgram } from '../../lib/queries.ts';
import { moveItem, patchProgramCache } from './programCache.ts';
import { TemplateEditor } from './TemplateEditor.tsx';
import { TemplateTabs } from './TemplateTabs.tsx';

const SELECTED_KEY = 'training.selectedTemplate';

export function ProgramPage() {
  const { data: program, isLoading } = useActiveProgram();
  const [selectedId, setSelectedId] = useState<string | null>(() => sessionStorage.getItem(SELECTED_KEY));
  const [adding, setAdding] = useState(false);
  const run = useAction();
  const qc = useQueryClient();

  const templates = program?.templates ?? [];
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null;

  function reorder(from: number, to: number) {
    if (!program) return;
    const ordered = moveItem(templates, from, to);
    patchProgramCache(qc, (p) => ({ ...p, templates: ordered }));
    void run((db) => reorderTemplates(db, program.id, ordered.map((t) => t.id)));
  }

  const select = (id: string) => {
    setSelectedId(id);
    sessionStorage.setItem(SELECTED_KEY, id);
  };

  // Alt+← / → : séance précédente / suivante ; Alt+Maj+← / → : déplace la séance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !selected) return;
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      e.preventDefault();
      const i = templates.findIndex((t) => t.id === selected.id);
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) {
        const to = i + delta;
        if (to >= 0 && to < templates.length) reorder(i, to);
        return;
      }
      const next = templates[(i + delta + templates.length) % templates.length];
      if (next) select(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (isLoading) return <div className="page-loading">Chargement…</div>;
  if (!program) return <EmptyProgram />;

  return (
    <div className="page program-page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Programme actif</span>
          <InlineTitle
            level={1}
            ariaLabel="Nom du programme"
            value={program.name}
            onSave={(name) => run((db) => updateProgram(db, program.id, { name }))}
          />
        </div>
        <ProgramActions program={program} />
      </header>

      <details className="program-comment" open={!!program.comment}>
        <summary>Principes généraux</summary>
        <TextArea
          label="Commentaire du programme"
          className="label-hidden"
          rows={6}
          value={program.comment}
          placeholder="Principes, consignes générales…"
          onSave={(comment) => run((db) => updateProgram(db, program.id, { comment }))}
        />
      </details>

      <TemplateTabs
        templates={templates}
        selectedId={selected?.id ?? null}
        onSelect={select}
        onReorder={reorder}
        onAdd={() => setAdding(true)}
      />

      {selected ? (
        <TemplateEditor key={selected.id} template={selected} />
      ) : (
        <div className="empty-state">
          <p>Ce programme ne contient aucune séance.</p>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Créer une séance
          </button>
        </div>
      )}

      {adding && (
        <PromptDialog
          title="Nouvelle séance"
          label="Nom de la séance (ex. Full body, Haut du corps)"
          confirmLabel="Créer"
          onClose={() => setAdding(false)}
          onSubmit={async (name) => {
            const id = await run((db) => createTemplate(db, program.id, name));
            if (id) select(id);
          }}
        />
      )}
    </div>
  );
}

function ProgramActions({ program }: { program: Program }) {
  const { platform, toast, confirm } = useApp();
  const run = useAction();

  const doExport = async () => {
    try {
      const json = await exportProgram(platform.db, program.id);
      const slug = normalizeText(program.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'programme';
      const saved = await platform.saveTextFile(`${slug}-${localDate()}.json`, JSON.stringify(json, null, 2));
      if (saved) toast('Programme exporté.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const doImport = async () => {
    let data;
    try {
      const text = await platform.openTextFile();
      if (text == null) return;
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error("Ce fichier n'est pas un JSON valide.");
      }
      data = parseProgramJson(raw);
    } catch (err) {
      toast(errorMessage(err), 'error');
      return;
    }
    const n = data.program.templates.length;
    const ok = await confirm({
      title: 'Importer un programme',
      message:
        `Importer « ${data.program.name} » (${n} séance${n > 1 ? 's' : ''}) et en faire le programme actif ?\n\n` +
        `Le programme actuel « ${program.name} » sera archivé (réactivable dans Paramètres). ` +
        `L'historique des séances n'est pas modifié.`,
      confirmLabel: 'Importer',
    });
    if (ok) await run((db) => importProgram(db, data), 'Programme importé.');
  };

  return (
    <div className="page-actions">
      <button type="button" className="btn" onClick={() => void doImport()}>
        Importer JSON
      </button>
      <button type="button" className="btn" onClick={() => void doExport()}>
        Exporter JSON
      </button>
    </div>
  );
}

function EmptyProgram() {
  return (
    <div className="page">
      <div className="empty-state">
        <p>Aucun programme actif. Importez un programme ou restaurez le programme initial dans les paramètres.</p>
        <a className="btn btn-primary" href="#/parametres">
          Ouvrir les paramètres
        </a>
      </div>
    </div>
  );
}
