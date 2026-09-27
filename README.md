# TrAIning

Application Windows (Tauri 2 + React + TypeScript) de journal d'entraînement et de nutrition. Données 100 % locales (SQLite) ; l'IA passe par Claude Desktop via un serveur MCP local (phase 5).

- **Installer l'application (guide pas à pas) : [docs/installation.md](docs/installation.md)**
- Prompts types pour Claude Desktop : [docs/claude-desktop/prompts-types.md](docs/claude-desktop/prompts-types.md)
- Architecture, schéma de base et outils MCP : [docs/architecture.md](docs/architecture.md)
- Format d'export / import du programme : [docs/program-json-format.md](docs/program-json-format.md)

L'installeur Windows est compilé automatiquement par GitHub Actions et publié dans la release
[« derniere-version »](https://github.com/cezeder-lab/TrAIning/releases/tag/derniere-version).

## Avancement

| Phase | Contenu | État |
|---|---|---|
| 1 | Squelette Tauri, SQLite (WAL), couche de données partagée, programme initial, éditeur de programme, export/import JSON | ✅ |
| 2 | Journal de séance, saisie post-séance, historique, médias | ✅ |
| 3 | Export des fiches de séance en image | ✅ |
| 4 | Nutrition, suivi corporel | ✅ |
| 5 | Serveur MCP + Claude Desktop | ✅ |
| 6 | Installeur Windows, sauvegardes | ✅ |

## Développement

Pour utiliser l'application, suivez [docs/installation.md](docs/installation.md) : rien de ce qui suit n'est nécessaire.

### Prérequis (Windows)

- [Node.js](https://nodejs.org) 22 LTS ou plus récent, et pnpm (`corepack enable`)
- [Rust](https://rustup.rs) (toolchain MSVC) et les « Build Tools for Visual Studio » (charge de travail C++)
- WebView2 (déjà présent sous Windows 10/11)

## Commandes

```bash
pnpm install
pnpm dev          # compile le serveur MCP puis lance l'application (Tauri)
pnpm dev:web      # interface seule dans un navigateur (http://localhost:5173), base dans apps/desktop/.dev/
pnpm test         # tests (couche de données, serveur MCP)
pnpm typecheck
pnpm build:mcp    # serveur MCP autonome (apps/mcp-server/dist/training-mcp.exe + sidecar Tauri)
pnpm build        # Ciqual + serveur MCP + installeur NSIS (apps/desktop/src-tauri/target/release/bundle/nsis/)
```

Tests Rust : `cargo test` dans `apps/desktop/src-tauri` (après `pnpm build:mcp`).

Structure : `packages/core` (données, logique métier, partagé), `apps/desktop` (Tauri + React), `apps/mcp-server` (serveur MCP), `scripts/` (préparation de Ciqual).

## Où sont les données ?

`%APPDATA%\fr.training.journal\training.db` (chemin affiché dans **Paramètres → Données**). La variable d'environnement `TRAINING_DB_PATH` permet d'utiliser une autre base.
