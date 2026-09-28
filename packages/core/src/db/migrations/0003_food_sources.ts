/**
 * Nouvelle source d'aliments « cnf » (Fichier canadien sur les éléments nutritifs) et champ
 * `aliases` (mots-clés de recherche). La contrainte CHECK de `food.source` impose de reconstruire
 * la table (clés étrangères désactivées pendant la migration, identifiants et rowid conservés).
 */
export default /* sql */ `
CREATE TABLE food_new (
  num             INTEGER PRIMARY KEY,
  id              TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL CHECK (source IN ('ciqual','cnf','off','custom','recipe')),
  source_ref      TEXT,
  name            TEXT NOT NULL,
  name_norm       TEXT NOT NULL,
  brand           TEXT,
  aliases         TEXT,
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

INSERT INTO food_new (num, id, source, source_ref, name, name_norm, brand, category, basis, state, cooked_yield,
  kcal, protein_g, carbs_g, sugars_g, fat_g, sat_fat_g, fiber_g, salt_g, alcohol_g, extra_nutrients, value_flags,
  is_favorite, use_count, last_used_at, source_version, is_archived, created_via, created_at, updated_at)
SELECT num, id, source, source_ref, name, name_norm, brand, category, basis, state, cooked_yield,
  kcal, protein_g, carbs_g, sugars_g, fat_g, sat_fat_g, fiber_g, salt_g, alcohol_g, extra_nutrients, value_flags,
  is_favorite, use_count, last_used_at, source_version, is_archived, created_via, created_at, updated_at
FROM food;

DROP TABLE food_fts;
DROP TABLE food;
ALTER TABLE food_new RENAME TO food;

CREATE INDEX food_recent ON food(last_used_at DESC) WHERE last_used_at IS NOT NULL;
CREATE INDEX food_name_norm ON food(name_norm);

CREATE VIRTUAL TABLE food_fts USING fts5(
  name, brand, aliases, content='food', content_rowid='num',
  tokenize='trigram remove_diacritics 1'
);
CREATE TRIGGER food_ai AFTER INSERT ON food BEGIN
  INSERT INTO food_fts(rowid, name, brand, aliases) VALUES (new.num, new.name, new.brand, new.aliases);
END;
CREATE TRIGGER food_ad AFTER DELETE ON food BEGIN
  INSERT INTO food_fts(food_fts, rowid, name, brand, aliases) VALUES ('delete', old.num, old.name, old.brand, old.aliases);
END;
CREATE TRIGGER food_au AFTER UPDATE OF name, brand, aliases ON food BEGIN
  INSERT INTO food_fts(food_fts, rowid, name, brand, aliases) VALUES ('delete', old.num, old.name, old.brand, old.aliases);
  INSERT INTO food_fts(rowid, name, brand, aliases) VALUES (new.num, new.name, new.brand, new.aliases);
END;
INSERT INTO food_fts(food_fts) VALUES ('rebuild');

CREATE TABLE food_entry_new (
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
  source            TEXT NOT NULL CHECK (source IN ('ciqual','cnf','off','custom','recipe','estimate')),
  is_estimated      INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  sort              INTEGER NOT NULL,
  created_via       TEXT NOT NULL DEFAULT 'app',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
) STRICT;
INSERT INTO food_entry_new SELECT * FROM food_entry;
DROP TABLE food_entry;
ALTER TABLE food_entry_new RENAME TO food_entry;
CREATE INDEX food_entry_date ON food_entry(date, meal_category_id, sort);
`;
