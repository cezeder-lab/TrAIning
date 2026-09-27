# TrAIning

Application Windows (Tauri 2 + React + TypeScript) de journal d'entraînement et de nutrition. Données 100 % locales (SQLite) ; l'IA passe par Claude Desktop via un serveur MCP local (phase 5).

- Architecture, schéma de base et outils MCP : [docs/architecture.md](docs/architecture.md)
- Format d'export / import du programme : [docs/program-json-format.md](docs/program-json-format.md)

## Avancement

| Phase | Contenu | État |
|---|---|---|
| 1 | Squelette Tauri, SQLite (WAL), couche de données partagée, programme initial, éditeur de programme, export/import JSON | ✅ |
| 2 | Journal de séance, saisie post-séance, historique, médias | à venir |
| 3 | Export des fiches de séance en image | à venir |
| 4 | Nutrition, suivi corporel | à venir |
| 5 | Serveur MCP + Claude Desktop | à venir |
| 6 | Installeur Windows, sauvegardes | à venir |

## Prérequis (Windows)

- [Node.js](https://nodejs.org) 22 LTS ou plus récent, et pnpm (`corepack enable`)
- [Rust](https://rustup.rs) (toolchain MSVC) et les « Build Tools for Visual Studio » (charge de travail C++)
- WebView2 (déjà présent sous Windows 10/11)

## Commandes

```bash
pnpm install
pnpm dev          # lance l'application (Tauri)
pnpm dev:web      # interface seule dans un navigateur (http://localhost:5173), base dans apps/desktop/.dev/
pnpm test         # tests de la couche de données (Vitest)
pnpm typecheck
pnpm build        # application de production (installeur finalisé en phase 6)
```

Tests Rust : `cargo test` dans `apps/desktop/src-tauri`.

## Où sont les données ?

`%APPDATA%\fr.training.journal\training.db` (chemin affiché dans **Paramètres → Données**). La variable d'environnement `TRAINING_DB_PATH` permet d'utiliser une autre base.
