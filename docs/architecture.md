# TrAIning — architecture

Proposition validée le 27/09/2026 (voir [§5](#5-décisions-validées)). Ce document couvre :

1. [Architecture technique et choix structurants](#1-architecture-technique)
2. [Arborescence du projet](#2-arborescence-du-projet)
3. [Schéma de base de données](#3-schéma-de-base-de-données)
4. [Liste finale des outils MCP](#4-serveur-mcp--liste-finale-des-outils)
5. [Décisions validées](#5-décisions-validées)

---

## 1. Architecture technique

```
┌──────────────────────────── Application Tauri (TrAIning.exe) ───────────────────────────┐
│  WebView (React + TS)                                                                     │
│    UI ──► TanStack Query ──► @training/core (repos, services, validation Zod)             │
│                                   │  driver « tauri »                                     │
│                                   ▼                                                       │
│  Rust (src-tauri) : 1 connexion rusqlite ── commandes db_select / db_execute / db_batch   │
│                     + surveillance PRAGMA data_version ──► événement « db-changed »       │
│                     + sauvegarde quotidienne (VACUUM INTO + rotation)                     │
└───────────────────────────────────────────┬───────────────────────────────────────────────┘
                                            │   training.db (SQLite, WAL)
┌───────────────────────────────────────────┴───────────────────────────────────────────────┐
│  training-mcp.exe (Node SEA, stdio)  ◄── lancé par Claude Desktop                         │
│    @modelcontextprotocol/sdk ──► @training/core (mêmes repos) ── driver « node:sqlite »   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### Choix structurants

| Sujet | Choix | Raison |
|---|---|---|
| Couche d'accès aux données | Package TypeScript `@training/core` écrit contre une interface `Db` minimale (`select`, `execute`, `transaction`). Toute la logique métier (requêtes, calculs nutritionnels, 1RM estimé, import/export JSON, seed, recherche floue) est dans ce package. | Exigence « pas de logique dupliquée » : l'app et le serveur MCP appellent exactement les mêmes fonctions. |
| Driver côté app | Commandes Rust maison sur **une seule connexion `rusqlite`** (feature `bundled`, FTS5 inclus), sérialisées par un mutex côté TS. Transactions en `BEGIN IMMEDIATE`. | `tauri-plugin-sql` utilise un pool sqlx : les transactions interactives peuvent s'exécuter sur des connexions différentes. Une connexion unique est plus sûre et on maîtrise les PRAGMA. Le Rust reste minimal (~200 lignes). |
| Driver côté MCP | `node:sqlite` (intégré à Node ≥ 22.5, SQLite 3.51, FTS5 + tokenizer trigram vérifiés). | Pas d'addon natif → le serveur se compile en **un seul `.exe`** via Node SEA. |
| Migrations | Scripts SQL numérotés (modules TS exportant le SQL) dans `core/src/db/migrations/`, appliqués par un migrateur TS commun (table `schema_migration`), à l'ouverture, en transaction. L'app et le serveur MCP vérifient la version ; le MCP refuse de démarrer si la base est plus récente que lui. | Une seule source de vérité du schéma. |
| PRAGMA (chaque connexion) | `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`. | WAL = lecture/écriture concurrente app + MCP. `FULL` = aucune transaction validée perdue même en cas de coupure (coût négligeable ici). |
| Détection des écritures MCP | Un thread Rust interroge `PRAGMA data_version` toutes les ~700 ms ; la valeur ne change que si **une autre connexion** a validé une écriture → émission d'un événement Tauri → invalidation du cache TanStack Query. | Fiable, quasi gratuit, ne réagit pas aux écritures de l'app elle-même. |
| Identifiants | `TEXT` UUID v7 (triables chronologiquement), générés en TS. | Import/export JSON et fusion sans collision. |
| Dates | `date` en `YYYY-MM-DD` (heure locale), horodatages en ISO 8601. Poids stockés en kg, quantités en g/ml ; conversion lb éventuelle à l'affichage. | |
| Tables | `STRICT` (typage vérifié par SQLite). | |
| Écriture immédiate | Chaque modification est persistée tout de suite (cases, valeurs de série) ; champs texte en autosave (debounce 300 ms + flush à la perte de focus / fermeture). | Aucune perte en cas de crash. |
| Validation | Schémas **Zod** dans `core` réutilisés : formulaires, import JSON, et schémas d'entrée des outils MCP (le SDK MCP accepte Zod). | Schémas stricts sans duplication. |
| UI | React 19 + Vite, TanStack Query, routeur minimal par hash, dnd-kit (glisser-déposer, souris et clavier), graphiques à partir de la phase 2, raccourcis clavier (`?` affiche l'aide), thème clair/sombre via variables CSS. | |
| Export image | Rendu **Canvas 2D** dédié (pas de capture de fenêtre) : mesure exacte du texte → pagination fiable, 1170 px de large, ratio 9:19,5. Presse-papiers via `tauri-plugin-clipboard-manager`, écriture fichier via commande Rust. | Plus déterministe que HTML→PNG pour la pagination. |
| Médias | Fichiers copiés dans `<données>/media/…`, la base ne stocke que le chemin relatif. | Base légère, sauvegardes rapides. |
| Emplacements (Windows) | Base : `%APPDATA%\fr.training.journal\training.db`. App + `training-mcp.exe` : dossier d'installation NSIS (par défaut `%LOCALAPPDATA%\TrAIning\`). | Le chemin exact est affiché dans la page « Connexion Claude Desktop ». |

### Sources de données externes

- **Ciqual (ANSES)** — Licence Ouverte Etalab. Un instantané pré-converti (`ciqual.json.gz`) est embarqué dans l'installeur et importé au premier lancement ; un bouton « Mettre à jour Ciqual » retélécharge les fichiers XML officiels et les passe dans le **même parseur** (dans `core`). Import en upsert sur le code Ciqual → les identifiants restent stables et le journal n'est pas cassé.
- **Open Food Facts** — API publique (recherche par nom, lecture par code-barres) avec `User-Agent` identifié ; chaque produit consulté est mis en cache dans `food` (`source='off'`). Données ODbL : mention de la source dans l'UI.
- **free-exercise-db** (`yuhonas`, Unlicense) — import optionnel à la demande (JSON + images), phase 2.

---

## 2. Arborescence du projet

Monorepo **pnpm workspaces**.

```
TrAIning/
├─ package.json                  # scripts globaux : dev, build, test, build:mcp, build:installer
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ docs/
│  ├─ architecture.md            # ce document
│  ├─ program-json-format.md     # format d'export/import du programme
│  └─ claude-desktop/
│     ├─ claude_desktop_config.example.json
│     └─ prompts-types.md        # prompts à coller dans Claude Desktop (phase 5)
├─ scripts/
│  ├─ prepare-ciqual.mjs         # XML Ciqual → apps/desktop/src-tauri/resources/ciqual.json.gz
│  └─ fetch-free-exercise-db.mjs # (optionnel) récupération du dataset libre
├─ packages/
│  └─ core/                      # @training/core — couche d'accès aux données partagée
│     ├─ package.json            # exports : "." (navigateur+node), "./node" (driver node:sqlite)
│     ├─ src/
│     │  ├─ db/
│     │  │  ├─ driver.ts         # interface Db { select, execute, transaction }
│     │  │  ├─ migrate.ts        # migrateur versionné
│     │  │  ├─ pragmas.ts
│     │  │  ├─ ids.ts            # uuidv7
│     │  │  └─ migrations/       # 0001_init.sql, 0002_….sql (importés en texte)
│     │  ├─ drivers/
│     │  │  └─ node.ts           # node:sqlite (MCP, tests, mode navigateur de dev)
│     │  ├─ schemas/             # Zod : exercise, program, session, food, entry, body, profile, programJson
│     │  ├─ repos/               # accès aux données, 1 fichier par agrégat
│     │  │  ├─ exercises.ts  program.ts  sessions.ts  cardio.ts  pain.ts
│     │  │  ├─ foods.ts  portions.ts  recipes.ts  entries.ts  savedMeals.ts  goals.ts
│     │  │  └─ body.ts  profile.ts  settings.ts  audit.ts
│     │  ├─ services/
│     │  │  ├─ seed/initialProgram.ts   # programme initial codé en dur
│     │  │  ├─ seed/referenceData.ts    # groupes musculaires, catégories de repas
│     │  │  ├─ programJson.ts           # export/import JSON (validation Zod)
│     │  │  ├─ sessionFactory.ts        # template → séance pré-remplie
│     │  │  ├─ trainingStats.ts         # charge max, volume, 1RM estimé (Epley/Brzycki)
│     │  │  ├─ nutritionCalc.ts         # quantité → g → nutriments, cru/cuit, recettes
│     │  │  ├─ foodSearch.ts            # recherche floue + priorités de source
│     │  │  ├─ bodyStats.ts             # moyenne mobile 7 j, tendance
│     │  │  ├─ ciqual/parser.ts         # parseur XML Ciqual (script de build + mise à jour in-app)
│     │  │  └─ off/client.ts            # client Open Food Facts + mapping
│     │  └─ index.ts
│     └─ test/                   # Vitest sur base en mémoire (driver node)
├─ apps/
│  ├─ desktop/                   # application Tauri 2
│  │  ├─ index.html  vite.config.ts  package.json
│  │  ├─ dev/devDbBridge.ts      # `pnpm dev:web` : l'UI dans un navigateur, base servie par node:sqlite
│  │  ├─ src/
│  │  │  ├─ main.tsx  router.tsx
│  │  │  ├─ lib/                 # platform.ts (driver Tauri ou HTTP de dev), app.tsx, queries.ts, router.ts…
│  │  │  ├─ components/          # UI génériques (Button, NumberField, Dialog, CommandPalette…)
│  │  │  ├─ features/
│  │  │  │  ├─ program/          # éditeur de programme, drag & drop, import/export JSON
│  │  │  │  ├─ journal/          # calendrier / liste des séances
│  │  │  │  ├─ session/          # saisie post-séance, cardio, métadonnées
│  │  │  │  ├─ exercise/         # fiche exercice : médias, notes, historique
│  │  │  │  ├─ sheet-export/     # rendu Canvas des fiches de séance
│  │  │  │  ├─ nutrition/        # journal, recherche, recettes, objectifs
│  │  │  │  ├─ body/             # poids, tour de taille, photos
│  │  │  │  ├─ claude/           # page « Connexion Claude Desktop »
│  │  │  │  └─ settings/         # profil, unités, dossiers, sauvegardes, restauration programme
│  │  │  └─ styles/
│  │  └─ src-tauri/
│  │     ├─ Cargo.toml  tauri.conf.json  capabilities/default.json
│  │     ├─ binaries/            # training-mcp-x86_64-pc-windows-msvc.exe (sidecar, généré)
│  │     ├─ resources/           # ciqual.json.gz
│  │     └─ src/
│  │        ├─ main.rs  lib.rs
│  │        ├─ db.rs             # connexion rusqlite, PRAGMA, commandes, watcher data_version
│  │        ├─ backup.rs         # sauvegarde quotidienne + rotation, export/restauration
│  │        └─ files.rs          # médias, écriture PNG, dossiers configurables
│  └─ mcp-server/                # @training/mcp-server
│     ├─ package.json  sea-config.json
│     ├─ src/
│     │  ├─ index.ts             # parse --db, ouvre la base, démarre le transport stdio
│     │  ├─ server.ts            # instructions globales + enregistrement des outils/prompts
│     │  ├─ tools/nutrition.ts  training.ts  body.ts  profile.ts
│     │  ├─ prompts.ts           # prompts MCP (analyse hebdo, saisie repas, bilan)
│     │  └─ format.ts            # mise en forme compacte des réponses
│     └─ scripts/build-sea.mjs   # esbuild → bundle unique → Node SEA → training-mcp.exe
└─ .github/workflows/            # (phase 6) build Windows + installeur
```

---

## 3. Schéma de base de données

La migration `0001` (phase 1) crée les tables transverses et entraînement (§3.1 à §3.3) ; la migration `0002` (phase 4) ajoute les tables nutrition et corps (§3.4, §3.5).

Conventions : `id TEXT` = UUID v7 ; booléens `INTEGER` 0/1 ; `created_via` ∈ `app | mcp | import | seed` pour tracer l'origine des écritures.

### 3.1 Transverse

```sql
CREATE TABLE schema_migration (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
) STRICT;

CREATE TABLE app_setting (          -- thème, unités, dossier d'export, dossier/rotation de sauvegarde…
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL              -- JSON
) STRICT;

CREATE TABLE user_profile (         -- une seule ligne ; lu par get_user_profile
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  display_name          TEXT,
  sex                   TEXT CHECK (sex IN ('M','F','other')),
  birth_year            INTEGER,
  height_cm             REAL,
  goals                 TEXT,       -- objectifs (texte libre)
  muscle_priorities     TEXT,       -- JSON ["haut des pectoraux", "deltoïde latéral"]
  physical_constraints  TEXT,       -- ex. « épaule gauche sensible au développé »
  response_preferences  TEXT,       -- ex. « réponses concises, tableaux »
  updated_at            TEXT NOT NULL
) STRICT;

CREATE TABLE day_info (             -- type de jour (objectifs nutrition) + note libre du jour
  date        TEXT PRIMARY KEY,
  day_type    TEXT CHECK (day_type IN ('rest','training','cardio')),
  note        TEXT,
  updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE mcp_audit (            -- journal des écritures faites par Claude (affiché dans l'app)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  tool        TEXT NOT NULL,
  args        TEXT NOT NULL,        -- JSON
  entity_type TEXT,
  entity_id   TEXT
) STRICT;
```

### 3.2 Entraînement — référentiel et programme

```sql
CREATE TABLE muscle_group (         -- liste de référence (seed), ex. 'chest_upper', 'delt_lateral'
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,      -- « Pectoraux (haut) »
  region TEXT NOT NULL,             -- haut du corps / bas du corps / tronc
  sort   INTEGER NOT NULL
) STRICT;

CREATE TABLE exercise (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  name_norm        TEXT NOT NULL,   -- minuscules sans accents (recherche, dédoublonnage)
  kind             TEXT NOT NULL CHECK (kind IN ('weight','bodyweight','cardio','isometric')),
  equipment        TEXT,            -- haltères, poulie, machine, barre EZ… (libre)
  technique_notes  TEXT,
  origin           TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('seed','user','free_exercise_db','import')),
  external_ref     TEXT,            -- id free-exercise-db
  is_archived      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX exercise_name_active_uq ON exercise(name_norm) WHERE is_archived = 0;

CREATE TABLE exercise_muscle (
  exercise_id      TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
  muscle_group_id  TEXT NOT NULL REFERENCES muscle_group(id),
  role             TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','secondary')),
  PRIMARY KEY (exercise_id, muscle_group_id)
) STRICT;

CREATE TABLE exercise_media (
  id            TEXT PRIMARY KEY,
  exercise_id   TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('image','gif','video_link','link')),
  file_path     TEXT,               -- relatif à <données>/media (image, gif)
  url           TEXT,               -- Instagram, YouTube… (video_link, link)
  caption       TEXT,
  is_thumbnail  INTEGER NOT NULL DEFAULT 0,  -- miniature utilisée dans les fiches image
  sort          INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  CHECK ((kind IN ('image','gif') AND file_path IS NOT NULL)
      OR (kind IN ('video_link','link') AND url IS NOT NULL))
) STRICT;

CREATE TABLE program (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  comment     TEXT,                 -- principes généraux
  is_active   INTEGER NOT NULL DEFAULT 0,
  origin      TEXT NOT NULL CHECK (origin IN ('seed','user','import')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX program_single_active ON program(is_active) WHERE is_active = 1;

CREATE TABLE workout_template (      -- Push, Pull, Legs, Abdos…
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  comment     TEXT,
  sort        INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE template_slot (
  id                  TEXT PRIMARY KEY,
  template_id         TEXT NOT NULL REFERENCES workout_template(id) ON DELETE CASCADE,
  sort                INTEGER NOT NULL,
  block               TEXT NOT NULL DEFAULT 'work'
                      CHECK (block IN ('warmup','work','finisher','cooldown')),
  block_label         TEXT,         -- sous-titre de bloc : « Dynamique », « Gainage / posture »
  label               TEXT,         -- nom du slot quand il y a des alternatives : « Tirage horizontal »
  sets                INTEGER,      -- NULL = non précisé (Dips, étirements)
  target_min          REAL,         -- 6   (reps, secondes ou mètres selon target_unit)
  target_max          REAL,         -- 8   (= target_min si valeur fixe)
  target_unit         TEXT NOT NULL DEFAULT 'reps' CHECK (target_unit IN ('reps','s','m','min')),
  per_side            INTEGER NOT NULL DEFAULT 0,   -- « / côté »
  load_kg             REAL,         -- 22
  load_next_kg        REAL,         -- 24  (« 22 → 24 kg » : palier visé)
  load_note           TEXT,         -- « poids du corps », « 1RM estimé ~120 kg »
  rir_min             INTEGER,      -- 2   (« 2-3 reps en réserve »)
  rir_max             INTEGER,      -- 3
  rest_s              INTEGER,
  comment             TEXT,
  is_optional         INTEGER NOT NULL DEFAULT 0,
  enabled_by_default  INTEGER NOT NULL DEFAULT 1,   -- Dips : optionnel + désactivé
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
) STRICT;
CREATE INDEX template_slot_template ON template_slot(template_id, sort);

CREATE TABLE slot_option (           -- exercices au choix ; sort = 0 → choix par défaut
  id            TEXT PRIMARY KEY,
  slot_id       TEXT NOT NULL REFERENCES template_slot(id) ON DELETE CASCADE,
  exercise_id   TEXT NOT NULL REFERENCES exercise(id),
  sort          INTEGER NOT NULL,
  -- surcharges propres à une alternative (NULL = valeur du slot)
  sets          INTEGER,
  target_min    REAL,
  target_max    REAL,
  load_kg       REAL,               -- « 26 kg (rowing haltère) », « Roman chair 20 kg »
  load_next_kg  REAL,
  note          TEXT,
  UNIQUE (slot_id, exercise_id)
) STRICT;
```

### 3.3 Entraînement — séances

La séance est une **copie indépendante** du template au moment de sa création (modifier le programme ne réécrit pas l'historique).

```sql
CREATE TABLE workout_session (
  id           TEXT PRIMARY KEY,
  template_id  TEXT REFERENCES workout_template(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,       -- copie du nom du template (ou libre)
  date         TEXT NOT NULL,       -- placement libre, pas de semaine figée
  status       TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','skipped')),
  started_at   TEXT,
  ended_at     TEXT,
  fatigue      INTEGER CHECK (fatigue BETWEEN 0 AND 10),
  soreness     INTEGER CHECK (soreness BETWEEN 0 AND 10),   -- courbatures
  comment      TEXT,
  created_via  TEXT NOT NULL DEFAULT 'app',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;
CREATE INDEX workout_session_date ON workout_session(date);

CREATE TABLE session_exercise (      -- instance d'un slot dans une séance
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE,
  template_slot_id  TEXT REFERENCES template_slot(id) ON DELETE SET NULL,
  sort              INTEGER NOT NULL,
  block             TEXT NOT NULL CHECK (block IN ('warmup','work','finisher','cooldown')),
  block_label       TEXT,
  label             TEXT,
  exercise_id       TEXT NOT NULL REFERENCES exercise(id),   -- alternative retenue
  alternatives      TEXT,           -- JSON [exercise_id…] : options disponibles (copie)
  sets              INTEGER,        -- cibles copiées du slot/option
  target_min        REAL,
  target_max        REAL,
  target_unit       TEXT NOT NULL DEFAULT 'reps',
  per_side          INTEGER NOT NULL DEFAULT 0,
  load_kg           REAL,
  load_note         TEXT,
  rir_min           INTEGER,
  rir_max           INTEGER,
  rest_s            INTEGER,
  planned_comment   TEXT,
  note              TEXT,           -- remarque saisie pendant/après la séance
  is_optional       INTEGER NOT NULL DEFAULT 0,
  is_enabled        INTEGER NOT NULL DEFAULT 1,   -- slot optionnel activé pour cette séance
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped'))
) STRICT;
CREATE INDEX session_exercise_session ON session_exercise(session_id, sort);
CREATE INDEX session_exercise_exercise ON session_exercise(exercise_id);

CREATE TABLE set_entry (
  id                   TEXT PRIMARY KEY,
  session_exercise_id  TEXT NOT NULL REFERENCES session_exercise(id) ON DELETE CASCADE,
  set_index            INTEGER NOT NULL,
  is_warmup            INTEGER NOT NULL DEFAULT 0,
  planned_load_kg      REAL,
  planned_value        REAL,        -- reps (ou s / m selon target_unit du parent)
  load_kg              REAL,        -- réel ; pré-rempli = prévu
  value                REAL,        -- réel ; pré-rempli = prévu
  is_done              INTEGER NOT NULL DEFAULT 0,   -- case cochée ; seules les séries cochées comptent
  rir                  REAL,
  rpe                  REAL,
  comment              TEXT,
  updated_at           TEXT NOT NULL,
  UNIQUE (session_exercise_id, set_index)
) STRICT;

CREATE TABLE pain_entry (            -- douleurs : plusieurs zones possibles par séance / jour
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  session_id   TEXT REFERENCES workout_session(id) ON DELETE SET NULL,
  zone         TEXT NOT NULL,       -- « épaule », « genou », « lombaires »… (liste suggérée + libre)
  side         TEXT CHECK (side IN ('left','right','both','center')),
  intensity    INTEGER NOT NULL CHECK (intensity BETWEEN 0 AND 10),
  context      TEXT,                -- exercice ou mouvement déclencheur
  note         TEXT,
  created_via  TEXT NOT NULL DEFAULT 'app',
  created_at   TEXT NOT NULL
) STRICT;
CREATE INDEX pain_entry_date ON pain_entry(date);

CREATE TABLE cardio_session (
  id                  TEXT PRIMARY KEY,
  date                TEXT NOT NULL,
  start_time          TEXT,
  session_id          TEXT REFERENCES workout_session(id) ON DELETE SET NULL,  -- si fait après la muscu
  activity            TEXT NOT NULL,   -- marche inclinée, elliptique, HIIT… (suggestions + libre)
  duration_s          INTEGER NOT NULL,
  distance_m          REAL,
  speed_kmh           REAL,
  incline_or_level    TEXT,            -- libre : niveaux machine non standardisés
  hr_avg              INTEGER,
  hr_max              INTEGER,
  calories_watch_est  INTEGER,         -- toujours affiché comme estimation
  feeling             INTEGER CHECK (feeling BETWEEN 1 AND 5),
  comment             TEXT,
  created_via         TEXT NOT NULL DEFAULT 'app',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
) STRICT;
CREATE INDEX cardio_session_date ON cardio_session(date);
```

Statistiques (non stockées, calculées dans `core/services/trainingStats.ts`) : charge max, volume (Σ charge × reps des séries cochées, hors échauffement), meilleure série estimée (1RM Epley, plafonné à 12 reps), nombre de séances. Un slot optionnel non fait n'a aucune série cochée → il est naturellement exclu.

### 3.4 Nutrition

```sql
CREATE TABLE food (
  num             INTEGER PRIMARY KEY, -- rowid stable (l'index FTS externe s'y réfère ; VACUUM ne le renumérote pas)
  id              TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL CHECK (source IN ('ciqual','off','custom','recipe')),
  source_ref      TEXT,             -- code Ciqual / code-barres EAN
  name            TEXT NOT NULL,
  name_norm       TEXT NOT NULL,
  brand           TEXT,
  category        TEXT,
  basis           TEXT NOT NULL DEFAULT '100g' CHECK (basis IN ('100g','100ml')),
  state           TEXT NOT NULL DEFAULT 'na' CHECK (state IN ('raw','cooked','na')),
  cooked_yield    REAL,             -- poids cuit / poids cru (ex. pâtes ≈ 2,2) → conversion cru ↔ cuit
  kcal            REAL,
  protein_g       REAL,
  carbs_g         REAL,
  sugars_g        REAL,
  fat_g           REAL,
  sat_fat_g       REAL,
  fiber_g         REAL,
  salt_g          REAL,
  alcohol_g       REAL,
  extra_nutrients TEXT,             -- JSON : autres constituants (micro-nutriments Ciqual…)
  value_flags     TEXT,             -- JSON : « traces », « < 0,5 », valeurs manquantes
  is_favorite     INTEGER NOT NULL DEFAULT 0,
  use_count       INTEGER NOT NULL DEFAULT 0,
  last_used_at    TEXT,             -- alimente « récents »
  source_version  TEXT,             -- version Ciqual, date de récupération OFF
  is_archived     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (source, source_ref)
) STRICT;
CREATE INDEX food_recent ON food(last_used_at DESC) WHERE last_used_at IS NOT NULL;

-- Recherche floue : index trigram insensible à la casse et aux accents (FTS5, externe à `food`,
-- synchronisé par triggers). Les candidats sont ensuite classés en TS : similarité
-- (Damerau-Levenshtein par mot) + bonus récents > favoris > perso/recettes > Ciqual > OFF.
CREATE VIRTUAL TABLE food_fts USING fts5(
  name, brand, content='food', content_rowid='num',
  tokenize='trigram remove_diacritics 1'
);
-- + triggers food_ai / food_ad / food_au

CREATE TABLE food_portion (          -- portions nommées : « 1 skyr » = 150 g, « 1 œuf » = 60 g
  id          TEXT PRIMARY KEY,
  food_id     TEXT NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  grams       REAL NOT NULL CHECK (grams > 0),
  is_default  INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL
) STRICT;

CREATE TABLE recipe (                -- une recette EST un aliment (food.source = 'recipe')
  food_id         TEXT PRIMARY KEY REFERENCES food(id) ON DELETE CASCADE,
  total_cooked_g  REAL,             -- poids total cuit pesé → valeurs /100 g cuit
  servings        REAL,
  instructions    TEXT
) STRICT;

CREATE TABLE recipe_ingredient (
  id              TEXT PRIMARY KEY,
  recipe_food_id  TEXT NOT NULL REFERENCES recipe(food_id) ON DELETE CASCADE,
  food_id         TEXT NOT NULL REFERENCES food(id),
  quantity_g      REAL NOT NULL CHECK (quantity_g > 0),
  weight_state    TEXT NOT NULL DEFAULT 'raw' CHECK (weight_state IN ('raw','cooked','na')),
  sort            INTEGER NOT NULL
) STRICT;
-- Les nutriments /100 g de la recette sont recalculés et stockés dans `food` à chaque modification.

CREATE TABLE meal_category (         -- configurable ; seed : Petit-déjeuner, Déjeuner, Collation, Dîner
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort       INTEGER NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE food_entry (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL,
  meal_category_id  TEXT NOT NULL REFERENCES meal_category(id),
  food_id           TEXT REFERENCES food(id) ON DELETE SET NULL,   -- NULL = estimation libre
  label             TEXT NOT NULL,  -- nom affiché (copie)
  quantity          REAL NOT NULL CHECK (quantity > 0),
  unit              TEXT NOT NULL CHECK (unit IN ('g','ml','portion')),
  portion_id        TEXT REFERENCES food_portion(id) ON DELETE SET NULL,
  grams             REAL NOT NULL,  -- quantité résolue en g (ou ml)
  weight_state      TEXT NOT NULL DEFAULT 'na' CHECK (weight_state IN ('raw','cooked','na')),
  -- instantané des valeurs au moment de la saisie (l'historique ne bouge pas si l'aliment est modifié)
  kcal              REAL NOT NULL,
  protein_g         REAL NOT NULL,
  carbs_g           REAL NOT NULL,
  fat_g             REAL NOT NULL,
  fiber_g           REAL,
  sugars_g          REAL,
  sat_fat_g         REAL,
  salt_g            REAL,
  source            TEXT NOT NULL CHECK (source IN ('ciqual','off','custom','recipe','estimate')),
  is_estimated      INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  sort              INTEGER NOT NULL,
  created_via       TEXT NOT NULL DEFAULT 'app',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
) STRICT;
CREATE INDEX food_entry_date ON food_entry(date, meal_category_id, sort);

CREATE TABLE saved_meal (            -- repas enregistrés réutilisables
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  meal_category_id  TEXT REFERENCES meal_category(id) ON DELETE SET NULL,
  note              TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
) STRICT;

CREATE TABLE saved_meal_item (
  id             TEXT PRIMARY KEY,
  saved_meal_id  TEXT NOT NULL REFERENCES saved_meal(id) ON DELETE CASCADE,
  food_id        TEXT NOT NULL REFERENCES food(id),
  quantity       REAL NOT NULL,
  unit           TEXT NOT NULL CHECK (unit IN ('g','ml','portion')),
  portion_id     TEXT REFERENCES food_portion(id) ON DELETE SET NULL,
  weight_state   TEXT NOT NULL DEFAULT 'na',
  sort           INTEGER NOT NULL
) STRICT;

CREATE TABLE nutrition_goal (        -- objectifs versionnés par date et par type de jour
  id          TEXT PRIMARY KEY,
  day_type    TEXT NOT NULL CHECK (day_type IN ('default','rest','training','cardio')),
  valid_from  TEXT NOT NULL,
  kcal        REAL,
  protein_g   REAL,
  carbs_g     REAL,
  fat_g       REAL,
  fiber_g     REAL,
  UNIQUE (day_type, valid_from)
) STRICT;
```

Type de jour : `day_info.day_type` s'il est renseigné, sinon déduit (séance muscu faite → `training`, cardio seul → `cardio`, sinon `rest`) ; à défaut d'objectif spécifique, on retombe sur `default`.

### 3.5 Suivi corporel

```sql
CREATE TABLE body_weight (          -- pesées irrégulières : aucune n'est obligatoire
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL UNIQUE, -- au plus une pesée par jour (remplacement explicite)
  time         TEXT,
  weight_kg    REAL NOT NULL CHECK (weight_kg BETWEEN 20 AND 400),
  note         TEXT,
  created_via  TEXT NOT NULL DEFAULT 'app',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;

CREATE TABLE body_measurement (      -- tour de taille (hebdo) ; extensible (hanches, bras…)
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'waist',
  value_cm    REAL NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (date, kind)
) STRICT;

CREATE TABLE body_photo (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  file_path   TEXT NOT NULL,          -- relatif à <données>/media/body
  pose        TEXT CHECK (pose IN ('front','side','back','other')),
  note        TEXT,
  created_at  TEXT NOT NULL
) STRICT;
```

### 3.6 Correspondance avec le programme initial (seed)

| Cas du programme | Représentation |
|---|---|
| « Échauffement : Suspension barre » | slot `block='warmup'`, sans séries/reps imposées |
| « 22 → 24 kg » | `load_kg=22`, `load_next_kg=24` |
| « Élévations latérales (haltères OU poulie) » | 1 slot, 2 `slot_option` (2 exercices distincts) |
| « 26 kg (rowing haltère) » | charge portée par l'option rowing haltère (`slot_option.load_kg`) |
| RDL / Extension lombaire Roman chair 20 kg 3 × 8 | 1 slot `label='Chaîne postérieure'`, option 1 RDL 3 × 8, option 2 Roman chair avec surcharges `load_kg=20`, `sets=3`, `target=8` ; commentaire « ne pas faire les deux » |
| Squat « 90 kg (1RM estimé ~120 kg) », « 2-3 reps en réserve » | `load_kg=90`, `load_note='1RM estimé ~120 kg'`, `rir_min=2`, `rir_max=3` |
| Développé épaules optionnel | `is_optional=1`, `enabled_by_default=1`, commentaire douleur épaule gauche |
| Dips | `is_optional=1`, `enabled_by_default=0`, `sets=NULL` |
| « Fin : Étirements » | slot `block='cooldown'`, optionnel |
| Abdos : blocs Dynamique / Gainage | `block='work'`, `block_label` = « Dynamique » / « Gainage / posture » ; tous `is_optional=1` |
| « 3 × 30-45 s », « 3 × 30-40 m », « / côté » | `target_unit='s'` / `'m'`, `per_side=1` |
| Principes généraux | `program.comment` |

« Restaurer le programme initial » : crée un nouveau programme à partir du seed et l'active ; l'ancien est **archivé** (pas supprimé), l'historique des séances n'est pas touché (les séances sont des copies).

---

## 4. Serveur MCP — liste finale des outils

Transport stdio, `@modelcontextprotocol/sdk`, schémas d'entrée Zod stricts (`.strict()` : tout champ inconnu est refusé). Dates `YYYY-MM-DD` (défaut : aujourd'hui, heure locale). Toute écriture est marquée `created_via='mcp'` et tracée dans `mcp_audit`.

### Instructions globales du serveur (champ `instructions`)

> - Les valeurs nutritionnelles proviennent **uniquement** de `search_food` / `get_food_details`. Une estimation n'est permise qu'en dernier recours, avec `estimated=true` et en le disant explicitement.
> - Si une quantité est floue (« une assiette », « un bol »), poser une question courte ou proposer une estimation chiffrée explicite avant d'écrire.
> - Avant tout `add_food_entry`, `update_food_entry` ou `delete_food_entry` : récapituler (aliment, quantité, kcal, P/G/L, source) et **attendre la confirmation** de l'utilisateur. Le paramètre `user_confirmed: true` ne doit être envoyé qu'après cette confirmation.
> - Analyse d'entraînement : factuelle et concise ; distinguer **mesuré / estimé / probable** ; pas de conclusion forte sur données insuffisantes (le dire) ; en cas de douleur, adapter la sélection d'exercices plutôt que conseiller de « pousser ».
> - Lire `get_user_profile` en début de conversation pour connaître objectifs, contraintes et préférences de réponse.

### Nutrition

| Outil | Entrée | Sortie / comportement |
|---|---|---|
| `search_food` | `query?` (≥ 2 car.) **ou** `barcode?`, `sources?` (sous-ensemble de `recent, favorite, custom, recipe, ciqual, off`), `include_online` (déf. `true`), `limit` (1-25, déf. 10) | Liste classée : `food_id`, nom, marque, **source** + référence, base (100 g/ml), état cru/cuit, kcal, P/G/L/fibres, portions nommées. Les produits OFF trouvés sont mis en cache. |
| `get_food_details` | `food_id` | Tous les nutriments, drapeaux (traces, < x), portions, rendement cru/cuit, ingrédients si recette, version de la source. |
| `add_food_entry` | `date?`, `meal` (nom ou id de catégorie), `food_id?`, `label?` (obligatoire sans `food_id`), `quantity` > 0, `unit` (`g`/`ml`/`portion`), `portion_id?`, `weight_state?` (`raw`/`cooked`), `estimated` (bool, obligatoire), `estimated_nutrients?` {kcal, protein_g, carbs_g, fat_g} (obligatoire si pas de `food_id`), `note?`, `user_confirmed: true` | Entrée créée + valeurs calculées + totaux du jour mis à jour. |
| `update_food_entry` | `entry_id`, champs modifiables (quantité, unité, portion, repas, date, note, estimated), `user_confirmed: true` | Entrée avant/après + totaux du jour. |
| `delete_food_entry` | `entry_id`, `user_confirmed: true` | Entrée supprimée (résumé) + totaux du jour. |
| `get_day_log` | `date?` | Entrées par repas (avec source/estimé), totaux, objectifs du type de jour, reste à consommer. |
| `get_nutrition_summary` | `from`, `to` (≤ 366 j) | Totaux par jour, moyennes, écarts aux objectifs, jours non renseignés, part d'entrées estimées. |
| `create_custom_food` | `name`, `brand?`, `basis`, `kcal`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g?`, `sugars_g?`, `sat_fat_g?`, `salt_g?`, `state?`, `cooked_yield?`, `portions?` [{label, grams}], `source_note` (ex. « étiquette ») | Aliment perso créé (après confirmation, même règle). |
| `create_recipe` | `name`, `ingredients` [{food_id, quantity_g, weight_state}] (≥ 1), `total_cooked_g?`, `servings?`, `portions?` | Recette créée : valeurs /100 g et /portion. |

### Entraînement

| Outil | Entrée | Sortie |
|---|---|---|
| `get_program` | `template?` (nom ou id), `include_disabled` (déf. `true`) | Programme actif : commentaire, templates, slots ordonnés, alternatives, cibles, optionnel/désactivé. |
| `get_sessions` | `from`, `to`, `template?`, `detail` (`summary` / `sets`, déf. `sets`) | Séances : statut, exercices faits/sautés, séries réelles vs prévues, RIR/RPE, fatigue, courbatures, douleurs, cardio associé. |
| `get_exercise_history` | `exercise` (id ou nom, recherche floue), `from?`, `to?`, `limit` (déf. 20 séances) | Par séance : meilleure série, charge max, volume, 1RM estimé (marqué **estimé**), tendance + nombre de points. |
| `get_cardio_sessions` | `from`, `to`, `activity?` | Séances cardio ; calories montre marquées estimation. |
| `log_session_note` | `session_id?` **ou** `date`, `comment?`, `fatigue?` (0-10), `soreness?` (0-10), `pains?` [{zone, side?, intensity 0-10, context?, note?}] | Ajoute (n'écrase pas) commentaire et métadonnées ; si aucune séance ce jour-là, rattache au jour (`day_info` / `pain_entry` sans séance). |

### Corps

| Outil | Entrée | Sortie |
|---|---|---|
| `get_body_metrics` | `from`, `to` | Pesées, moyenne glissante 7 j **calculée sur les pesées disponibles** (avec leur nombre), tendance kg/semaine seulement si les données suffisent (sinon le dire), tours de taille. |
| `add_weight_entry` | `date?`, `weight_kg` (20-400), `time?`, `note?`, `replace_existing` (déf. `false`) | Pesée créée ; erreur explicite si une pesée existe déjà ce jour et `replace_existing=false`. |

### Profil

| Outil | Entrée | Sortie |
|---|---|---|
| `get_user_profile` | — | Profil, objectifs nutritionnels par type de jour, priorités musculaires, contraintes physiques, préférences de réponse, catégories de repas, unités. |

### Prompts MCP (menu « + » de Claude Desktop)

`analyse_hebdo`, `saisie_repas`, `bilan_nutrition` — mêmes textes que `docs/claude-desktop/prompts-types.md`.

### Volontairement absents

Aucune suppression ni modification de programme, template ou séance via MCP ; pas d'écriture de séance de musculation (seulement des notes).

### Outils complémentaires (validés)

| Outil | Entrée | Sortie |
|---|---|---|
| `add_waist_measurement` | `date?`, `value_cm`, `note?`, `replace_existing` (déf. `false`) | Tour de taille enregistré. |
| `get_saved_meals` | `query?` | Repas enregistrés avec leurs aliments et totaux. |
| `log_saved_meal` | `saved_meal_id`, `date?`, `meal?`, `scale?` (déf. 1), `user_confirmed: true` | Entrées créées + totaux du jour (même règle de confirmation). |

### Livrables de connexion

- `pnpm build:mcp` → esbuild (bundle unique) → Node SEA → `training-mcp.exe`, copié en sidecar Tauri et installé à côté de l'app.
- Bloc `claude_desktop_config.json` (généré par l'app avec les vrais chemins) :

```json
{
  "mcpServers": {
    "training": {
      "command": "C:\\Users\\<vous>\\AppData\\Local\\TrAIning\\training-mcp.exe",
      "args": ["--db", "C:\\Users\\<vous>\\AppData\\Roaming\\fr.training.journal\\training.db"]
    }
  }
}
```

- Page « Connexion Claude Desktop » : bloc ci-dessus avec bouton copier, bouton « Ouvrir le dossier de config », test de connexion (lance `training-mcp.exe --self-test --db …` qui ouvre la base, vérifie la version du schéma et lit une ligne), historique des écritures faites par Claude (`mcp_audit`).

---

## 5. Décisions validées

1. **Accès SQLite côté app** : une connexion unique gérée en Rust (`rusqlite`), plutôt que `tauri-plugin-sql`.
2. **Serveur MCP** : exécutable autonome `training-mcp.exe` (Node SEA + `node:sqlite`), installé à côté de l'app.
3. **Journal alimentaire** : chaque entrée garde une copie de ses valeurs nutritionnelles ; modifier un aliment ne réécrit pas l'historique.
4. **Bloc `cooldown`** (« Retour au calme ») en plus d'échauffement / travail / finisher ; les étirements du programme initial sont optionnels.
5. **Pesées irrégulières** : au plus une par jour, aucune obligation. La moyenne sur 7 jours et la tendance sont calculées sur les pesées disponibles et indiquent sur combien de pesées elles reposent ; en dessous d'un minimum, l'app et Claude le disent au lieu d'afficher une tendance.
6. **`user_confirmed: true`** exigé par les outils MCP qui écrivent dans le journal alimentaire.
7. **Outils MCP complémentaires** `add_waist_measurement`, `get_saved_meals`, `log_saved_meal` : inclus.
8. **Unités** : kg uniquement.
