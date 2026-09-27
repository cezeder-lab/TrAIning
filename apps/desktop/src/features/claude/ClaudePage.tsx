import { PROMPTS, listMcpAudit, localDate, renderPrompt } from '@training/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage, useApp } from '../../lib/app.tsx';

interface ConfigInfo {
  path: string;
  dirExists: boolean;
  fileExists: boolean;
  configured: boolean;
  outdated: boolean;
  error: string | null;
}
interface McpInfo {
  exePath: string;
  exeExists: boolean;
  dbPath: string;
  serverKey: string;
  configs: ConfigInfo[];
}

const TOOL_LABELS: Record<string, string> = {
  add_food_entry: 'Aliment ajouté',
  update_food_entry: 'Aliment modifié',
  delete_food_entry: 'Aliment supprimé',
  create_custom_food: 'Aliment perso créé',
  create_recipe: 'Recette créée',
  log_saved_meal: 'Repas enregistré ajouté',
  log_session_note: 'Note de séance',
  add_weight_entry: 'Pesée',
  add_waist_measurement: 'Tour de taille',
};

export function ClaudePage() {
  const { platform, toast } = useApp();
  const qc = useQueryClient();
  const desktop = platform.kind === 'tauri';
  const { data: info, refetch } = useQuery({
    queryKey: ['mcpInfo'],
    queryFn: () => platform.invoke<McpInfo>('mcp_info'),
    enabled: desktop,
  });
  const { data: dbInfo } = useQuery({ queryKey: ['dbInfo'], queryFn: () => platform.dbInfo() });
  const { data: audit = [] } = useQuery({ queryKey: ['mcpAudit'], queryFn: () => listMcpAudit(platform.db, 30) });
  const [test, setTest] = useState<{ ok: boolean; output: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const exePath = info?.exePath ?? 'C:\\Users\\<vous>\\AppData\\Local\\TrAIning\\training-mcp.exe';
  const dbPath = info?.dbPath ?? dbInfo?.path ?? '…';
  const block = JSON.stringify({ mcpServers: { training: { command: exePath, args: ['--db', dbPath] } } }, null, 2);
  const configured = info?.configs.some((c) => c.configured) ?? false;

  const copy = async (text: string, what: string) => {
    try {
      await platform.copyText(text);
      toast(`${what} copié.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const install = async () => {
    setBusy(true);
    try {
      const written = await platform.invoke<string[]>('mcp_install');
      toast(`Configuration écrite : ${written.join(', ')}. Redémarrez Claude Desktop.`);
      await refetch();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    try {
      setTest(await platform.invoke<{ ok: boolean; output: string }>('mcp_self_test'));
    } catch (err) {
      setTest({ ok: false, output: errorMessage(err) });
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['mcpAudit'] });
    }
  };

  const today = localDate();
  return (
    <div className="page claude-page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">IA</span>
          <h1>Connexion Claude Desktop</h1>
        </div>
      </header>
      <p className="muted">
        Claude Desktop lit et écrit dans votre journal grâce à un petit serveur local (MCP) installé avec l'application. Aucune clé API, aucune donnée envoyée
        ailleurs que dans vos conversations avec Claude.
      </p>

      <section className="card">
        <h2>État</h2>
        <dl className="kv">
          <dt>Serveur MCP</dt>
          <dd>
            <code>{exePath}</code>{' '}
            {desktop && (info?.exeExists ? <span className="badge badge-default">présent</span> : <span className="badge badge-estimate">introuvable</span>)}
          </dd>
          <dt>Base de données</dt>
          <dd>
            <code>{dbPath}</code>
          </dd>
          <dt>Claude Desktop</dt>
          <dd>
            {!desktop && 'disponible dans l’application de bureau'}
            {info?.configs.length === 0 && 'emplacement de configuration introuvable'}
            {info?.configs.map((c) => (
              <div key={c.path}>
                <code>{c.path}</code>{' '}
                {c.configured ? (
                  <span className="badge badge-default">connecté</span>
                ) : c.outdated ? (
                  <span className="badge badge-estimate">à mettre à jour</span>
                ) : c.dirExists ? (
                  <span className="badge badge-optional">non configuré</span>
                ) : (
                  <span className="badge badge-optional">Claude Desktop non détecté</span>
                )}
                {c.error && <div className="error-text small">{c.error}</div>}
              </div>
            ))}
          </dd>
        </dl>
      </section>

      <section className="card">
        <h2>Connexion en 3 étapes</h2>
        <ol className="steps">
          <li>
            Installez Claude Desktop pour Windows et connectez-vous.{' '}
            <button type="button" className="btn-link" onClick={() => void platform.openExternal('https://claude.ai/download')}>
              claude.ai/download
            </button>
          </li>
          <li>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={!desktop || busy || !info?.exeExists} onClick={() => void install()}>
                {configured ? 'Reconfigurer Claude Desktop' : 'Connecter automatiquement'}
              </button>
              <span className="muted small">ajoute « training » à claude_desktop_config.json (une copie de sauvegarde est gardée)</span>
            </div>
          </li>
          <li>
            Quittez complètement Claude Desktop (clic droit sur son icône près de l'horloge → Quitter), puis rouvrez-le. Dans une conversation, demandez
            « Quel est mon programme ? » : Claude doit utiliser l'outil <code>get_program</code>.
          </li>
        </ol>
        <div className="row">
          <button type="button" className="btn" disabled={!desktop || busy} onClick={() => void runTest()}>
            Tester l'accès à la base
          </button>
          {test && (
            <span className={test.ok ? 'badge badge-default' : 'badge badge-estimate'}>{test.ok ? 'Test réussi' : 'Échec'}</span>
          )}
        </div>
        {test && <pre className="code-block">{test.output}</pre>}
        <details>
          <summary className="muted">Configuration manuelle (bloc à coller dans claude_desktop_config.json)</summary>
          <pre className="code-block">{block}</pre>
          <button type="button" className="btn" onClick={() => void copy(block, 'Bloc de configuration')}>
            Copier le bloc
          </button>
          <p className="muted small">
            Fichier : %APPDATA%\Claude\claude_desktop_config.json (Claude Desktop → Paramètres → Développeur → Modifier la configuration). Si le fichier
            contient déjà « mcpServers », ajoutez seulement l'entrée « training ».
          </p>
        </details>
      </section>

      <section className="card">
        <h2>Prompts types</h2>
        <p className="muted">Aussi disponibles dans Claude Desktop via le bouton « + » → TrAIning.</p>
        {PROMPTS.map((p) => {
          const text = renderPrompt(p, { from: today, to: today, repas: 'Déjeuner', jours: '7' });
          return (
            <details key={p.name} className="prompt-item">
              <summary>
                <strong>{p.title}</strong> <span className="muted small">— {p.description}</span>
              </summary>
              <pre className="code-block">{text}</pre>
              <button type="button" className="btn" onClick={() => void copy(text, 'Prompt')}>
                Copier
              </button>
            </details>
          );
        })}
      </section>

      <section className="card">
        <h2>Dernières écritures faites par Claude</h2>
        {audit.length === 0 && <p className="muted">Aucune pour l'instant.</p>}
        {audit.length > 0 && (
          <table className="data-table">
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="muted small">{new Date(a.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{TOOL_LABELS[a.tool] ?? a.tool}</td>
                  <td className="muted small audit-args">{summarize(a.args)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function summarize(json: string): string {
  try {
    const a = JSON.parse(json) as Record<string, unknown>;
    delete a.user_confirmed;
    return Object.entries(a)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' · ')
      .slice(0, 200);
  } catch {
    return json.slice(0, 200);
  }
}
