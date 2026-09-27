/** Nutrition (aliments, recettes, journal, objectifs) et suivi corporel. */
export default /* sql */ `
CREATE TABLE food (
  num             INTEGER PRIMARY KEY,
  id              TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL CHECK (source IN ('ciqual','off','custom','recipe')),
  source_ref      TEXT,
  name            TEXT NOT NULL,
  name_norm       TEXT NOT NULL,
  brand           TEXT,
  category        TEXT,
  basis           TEXT NOT NULL DEFAULT '100g' CHECK (basis IN ('100g','100ml')),
  state           TEXT NOT NULL DEFAULT 'na' CHECK (state IN ('raw','cooked','na')),
  cooked_yield    REAL,
  kcal            REAL,
  protein_g       REAL,
  carbs_g         REAL,
  sugars_g        REAL,
  fat_g           REAL,
  sat_fat_g       REAL,
  fiber_g         REAL,
  salt_g          REAL,
  alcohol_g       REAL,
  extra_nutrients TEXT,
  value_flags     TEXT,
  is_favorite     INTEGER NOT NULL DEFAULT 0,
  use_count       INTEGER NOT NULL DEFAULT 0,
  last_used_at    TEXT,
  source_version  TEXT,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  created_via     TEXT NOT NULL DEFAULT 'app',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (source, source_ref)
) STRICT;
CREATE INDEX food_recent ON food(last_used_at DESC) WHERE last_used_at IS NOT NULL;
CREATE INDEX food_name_norm ON food(name_norm);

CREATE VIRTUAL TABLE food_fts USING fts5(
  name, brand, content='food', content_rowid='num',
  tokenize='trigram remove_diacritics 1'
);
CREATE TRIGGER food_ai AFTER INSERT ON food BEGIN
  INSERT INTO food_fts(rowid, name, brand) VALUES (new.num, new.name, new.brand);
END;
CREATE TRIGGER food_ad AFTER DELETE ON food BEGIN
  INSERT INTO food_fts(food_fts, rowid, name, brand) VALUES ('delete', old.num, old.name, old.brand);
END;
CREATE TRIGGER food_au AFTER UPDATE OF name, brand ON food BEGIN
  INSERT INTO food_fts(food_fts, rowid, name, brand) VALUES ('delete', old.num, old.name, old.brand);
  INSERT INTO food_fts(rowid, name, brand) VALUES (new.num, new.name, new.brand);
END;

CREATE TABLE food_portion (
  id          TEXT PRIMARY KEY,
  food_id     TEXT NOT NULL REFERENCES food(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  grams       REAL NOT NULL CHECK (grams > 0),
  is_default  INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL
) STRICT;
CREATE INDEX food_portion_food ON food_portion(food_id, sort);

CREATE TABLE recipe (
  food_id         TEXT PRIMARY KEY REFERENCES food(id) ON DELETE CASCADE,
  total_cooked_g  REAL,
  servings        REAL,
  instructions    TEXT
) STRICT;

CREATE TABLE recipe_ingredient (
  id              TEXT PRIMARY KEY,
  recipe_food_id  TEXT NOT NULL REFERENCES recipe(food_id) ON DELETE CASCADE,
  food_id         TEXT NOT NULL REFERENCES food(id),
  quantity_g      REAL NOT NULL CHECK (quantity_g > 0),
  weight_state    TEXT NOT NULL DEFAULT 'na' CHECK (weight_state IN ('raw','cooked','na')),
  sort            INTEGER NOT NULL
) STRICT;

CREATE TABLE meal_category (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort       INTEGER NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE food_entry (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL,
  meal_category_id  TEXT NOT NULL REFERENCES meal_category(id),
  food_id           TEXT REFERENCES food(id) ON DELETE SET NULL,
  label             TEXT NOT NULL,
  quantity          REAL NOT NULL CHECK (quantity > 0),
  unit              TEXT NOT NULL CHECK (unit IN ('g','ml','portion')),
  portion_id        TEXT REFERENCES food_portion(id) ON DELETE SET NULL,
  portion_label     TEXT,
  grams             REAL NOT NULL,
  weight_state      TEXT NOT NULL DEFAULT 'na' CHECK (weight_state IN ('raw','cooked','na')),
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

CREATE TABLE saved_meal (
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

CREATE TABLE nutrition_goal (
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

CREATE TABLE body_weight (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL UNIQUE,
  time         TEXT,
  weight_kg    REAL NOT NULL CHECK (weight_kg BETWEEN 20 AND 400),
  note         TEXT,
  created_via  TEXT NOT NULL DEFAULT 'app',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;

CREATE TABLE body_measurement (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'waist',
  value_cm     REAL NOT NULL CHECK (value_cm BETWEEN 20 AND 300),
  note         TEXT,
  created_via  TEXT NOT NULL DEFAULT 'app',
  created_at   TEXT NOT NULL,
  UNIQUE (date, kind)
) STRICT;

CREATE TABLE body_photo (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  pose        TEXT CHECK (pose IN ('front','side','back','other')),
  note        TEXT,
  created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX body_photo_date ON body_photo(date);
`;
