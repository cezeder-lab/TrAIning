/** Schéma initial : transverse + entraînement (programme, séances, cardio, douleurs). */
export default /* sql */ `
CREATE TABLE app_setting (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
) STRICT;

CREATE TABLE user_profile (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  display_name          TEXT,
  sex                   TEXT CHECK (sex IN ('M','F','other')),
  birth_year            INTEGER,
  height_cm             REAL,
  goals                 TEXT,
  muscle_priorities     TEXT,
  physical_constraints  TEXT,
  response_preferences  TEXT,
  updated_at            TEXT NOT NULL
) STRICT;

CREATE TABLE day_info (
  date        TEXT PRIMARY KEY,
  day_type    TEXT CHECK (day_type IN ('rest','training','cardio')),
  note        TEXT,
  updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE mcp_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  tool         TEXT NOT NULL,
  args         TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT
) STRICT;

CREATE TABLE muscle_group (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  region  TEXT NOT NULL CHECK (region IN ('upper','lower','core')),
  sort    INTEGER NOT NULL
) STRICT;

CREATE TABLE exercise (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  name_norm        TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('weight','bodyweight','cardio','isometric')),
  equipment        TEXT,
  technique_notes  TEXT,
  origin           TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('seed','user','free_exercise_db','import')),
  external_ref     TEXT,
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
  file_path     TEXT,
  url           TEXT,
  caption       TEXT,
  is_thumbnail  INTEGER NOT NULL DEFAULT 0,
  sort          INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  CHECK ((kind IN ('image','gif') AND file_path IS NOT NULL)
      OR (kind IN ('video_link','link') AND url IS NOT NULL))
) STRICT;
CREATE INDEX exercise_media_exercise ON exercise_media(exercise_id, sort);

CREATE TABLE program (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  comment     TEXT,
  is_active   INTEGER NOT NULL DEFAULT 0,
  origin      TEXT NOT NULL CHECK (origin IN ('seed','user','import')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX program_single_active ON program(is_active) WHERE is_active = 1;

CREATE TABLE workout_template (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  comment     TEXT,
  sort        INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;
CREATE INDEX workout_template_program ON workout_template(program_id, sort);

CREATE TABLE template_slot (
  id                  TEXT PRIMARY KEY,
  template_id         TEXT NOT NULL REFERENCES workout_template(id) ON DELETE CASCADE,
  sort                INTEGER NOT NULL,
  block               TEXT NOT NULL DEFAULT 'work' CHECK (block IN ('warmup','work','finisher','cooldown')),
  block_label         TEXT,
  label               TEXT,
  sets                INTEGER,
  target_min          REAL,
  target_max          REAL,
  target_unit         TEXT NOT NULL DEFAULT 'reps' CHECK (target_unit IN ('reps','s','m','min')),
  per_side            INTEGER NOT NULL DEFAULT 0,
  load_kg             REAL,
  load_next_kg        REAL,
  load_note           TEXT,
  rir_min             INTEGER,
  rir_max             INTEGER,
  rest_s              INTEGER,
  comment             TEXT,
  is_optional         INTEGER NOT NULL DEFAULT 0,
  enabled_by_default  INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
) STRICT;
CREATE INDEX template_slot_template ON template_slot(template_id, sort);

CREATE TABLE slot_option (
  id            TEXT PRIMARY KEY,
  slot_id       TEXT NOT NULL REFERENCES template_slot(id) ON DELETE CASCADE,
  exercise_id   TEXT NOT NULL REFERENCES exercise(id),
  sort          INTEGER NOT NULL,
  sets          INTEGER,
  target_min    REAL,
  target_max    REAL,
  load_kg       REAL,
  load_next_kg  REAL,
  note          TEXT,
  UNIQUE (slot_id, exercise_id)
) STRICT;
CREATE INDEX slot_option_exercise ON slot_option(exercise_id);

CREATE TABLE workout_session (
  id           TEXT PRIMARY KEY,
  template_id  TEXT REFERENCES workout_template(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  date         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','skipped')),
  started_at   TEXT,
  ended_at     TEXT,
  fatigue      INTEGER CHECK (fatigue BETWEEN 0 AND 10),
  soreness     INTEGER CHECK (soreness BETWEEN 0 AND 10),
  comment      TEXT,
  created_via  TEXT NOT NULL DEFAULT 'app',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;
CREATE INDEX workout_session_date ON workout_session(date);

CREATE TABLE session_exercise (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE,
  template_slot_id  TEXT REFERENCES template_slot(id) ON DELETE SET NULL,
  sort              INTEGER NOT NULL,
  block             TEXT NOT NULL CHECK (block IN ('warmup','work','finisher','cooldown')),
  block_label       TEXT,
  label             TEXT,
  exercise_id       TEXT NOT NULL REFERENCES exercise(id),
  alternatives      TEXT,
  sets              INTEGER,
  target_min        REAL,
  target_max        REAL,
  target_unit       TEXT NOT NULL DEFAULT 'reps' CHECK (target_unit IN ('reps','s','m','min')),
  per_side          INTEGER NOT NULL DEFAULT 0,
  load_kg           REAL,
  load_note         TEXT,
  rir_min           INTEGER,
  rir_max           INTEGER,
  rest_s            INTEGER,
  planned_comment   TEXT,
  note              TEXT,
  is_optional       INTEGER NOT NULL DEFAULT 0,
  is_enabled        INTEGER NOT NULL DEFAULT 1,
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
  planned_value        REAL,
  load_kg              REAL,
  value                REAL,
  is_done              INTEGER NOT NULL DEFAULT 0,
  rir                  REAL,
  rpe                  REAL,
  comment              TEXT,
  updated_at           TEXT NOT NULL,
  UNIQUE (session_exercise_id, set_index)
) STRICT;

CREATE TABLE pain_entry (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  session_id   TEXT REFERENCES workout_session(id) ON DELETE SET NULL,
  zone         TEXT NOT NULL,
  side         TEXT CHECK (side IN ('left','right','both','center')),
  intensity    INTEGER NOT NULL CHECK (intensity BETWEEN 0 AND 10),
  context      TEXT,
  note         TEXT,
  created_via  TEXT NOT NULL DEFAULT 'app',
  created_at   TEXT NOT NULL
) STRICT;
CREATE INDEX pain_entry_date ON pain_entry(date);

CREATE TABLE cardio_session (
  id                  TEXT PRIMARY KEY,
  date                TEXT NOT NULL,
  start_time          TEXT,
  session_id          TEXT REFERENCES workout_session(id) ON DELETE SET NULL,
  activity            TEXT NOT NULL,
  duration_s          INTEGER NOT NULL,
  distance_m          REAL,
  speed_kmh           REAL,
  incline_or_level    TEXT,
  hr_avg              INTEGER,
  hr_max              INTEGER,
  calories_watch_est  INTEGER,
  feeling             INTEGER CHECK (feeling BETWEEN 1 AND 5),
  comment             TEXT,
  created_via         TEXT NOT NULL DEFAULT 'app',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
) STRICT;
CREATE INDEX cardio_session_date ON cardio_session(date);
`;
