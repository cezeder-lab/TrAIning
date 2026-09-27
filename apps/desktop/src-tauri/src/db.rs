//! Connexion SQLite unique de l'application.
//!
//! Le front (couche `@training/core`) envoie ses requêtes via trois commandes génériques
//! et sérialise lui-même les transactions. Ce module ne contient aucune logique métier.

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Serialize;
use serde_json::{Map, Value as Json};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct DbState {
    conn: Mutex<Connection>,
    path: PathBuf,
}

/// Ouvre (ou crée) la base avec les mêmes PRAGMA que le serveur MCP.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(Duration::from_millis(5000))?;
    Ok(conn)
}

impl DbState {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let conn = open(&path).map_err(|e| format!("Ouverture de la base impossible : {e}"))?;
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    /// Dossier contenant la base (médias, sauvegardes par défaut).
    pub fn data_dir(&self) -> PathBuf {
        self.path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default()
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "Connexion à la base indisponible".to_string())?;
        f(&conn).map_err(|e| e.to_string())
    }

    pub(crate) fn with_conn_mut<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| "Connexion à la base indisponible".to_string())?;
        f(&mut conn).map_err(|e| e.to_string())
    }

    pub fn data_version(&self) -> Result<i64, String> {
        self.with_conn(|c| c.query_row("PRAGMA data_version", [], |r| r.get(0)))
    }
}

fn to_sql(v: &Json) -> Result<Value, String> {
    Ok(match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().ok_or("nombre invalide")?),
        },
        Json::String(s) => Value::Text(s.clone()),
        _ => return Err("type de paramètre non pris en charge".into()),
    })
}

fn from_sql(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null | ValueRef::Blob(_) => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map_or(Json::Null, Json::Number),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
    }
}

fn to_params(params: &[Json]) -> Result<Vec<Value>, String> {
    params.iter().map(to_sql).collect()
}

pub fn select(
    conn: &Connection,
    sql: &str,
    params: &[Value],
) -> rusqlite::Result<Vec<Map<String, Json>>> {
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let mut rows = stmt.query(params_from_iter(params.iter()))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), from_sql(row.get_ref(i)?));
        }
        out.push(obj);
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResult {
    changes: usize,
    last_insert_rowid: i64,
}

#[tauri::command(async)]
pub fn db_select(
    state: State<'_, DbState>,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Map<String, Json>>, String> {
    let params = to_params(&params)?;
    state.with_conn(|c| select(c, &sql, &params))
}

#[tauri::command(async)]
pub fn db_execute(
    state: State<'_, DbState>,
    sql: String,
    params: Vec<Json>,
) -> Result<ExecuteResult, String> {
    let params = to_params(&params)?;
    state.with_conn(|c| {
        let changes = c.execute(&sql, params_from_iter(params.iter()))?;
        Ok(ExecuteResult {
            changes,
            last_insert_rowid: c.last_insert_rowid(),
        })
    })
}

#[tauri::command(async)]
pub fn db_exec(state: State<'_, DbState>, sql: String) -> Result<(), String> {
    state.with_conn(|c| c.execute_batch(&sql))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    path: String,
    data_dir: String,
    media_dir: String,
}

#[tauri::command]
pub fn db_info(state: State<'_, DbState>) -> DbInfo {
    DbInfo {
        path: state.path.display().to_string(),
        data_dir: state.data_dir().display().to_string(),
        media_dir: crate::media::media_dir(&state).display().to_string(),
    }
}

/// Surveille `PRAGMA data_version` : la valeur ne change que lorsqu'une *autre* connexion
/// (le serveur MCP) a validé une écriture. On prévient alors le front, qui recharge ses données.
pub fn spawn_change_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<i64> = None;
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let Ok(version) = app.state::<DbState>().data_version() else {
                continue;
            };
            if last.is_some_and(|l| l != version) {
                let _ = app.emit("db-changed", ());
            }
            last = Some(version);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecte_les_ecritures_d_une_autre_connexion() {
        let dir = std::env::temp_dir().join(format!("training-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.db");
        let _ = std::fs::remove_file(&path);
        let a = DbState::new(path.clone()).unwrap();
        a.with_conn(|c| c.execute_batch("CREATE TABLE t (x TEXT) STRICT"))
            .unwrap();
        let v1 = a.data_version().unwrap();
        a.with_conn(|c| c.execute("INSERT INTO t VALUES ('a')", []))
            .unwrap();
        assert_eq!(
            v1,
            a.data_version().unwrap(),
            "ses propres écritures ne comptent pas"
        );
        let b = open(&path).unwrap();
        b.execute("INSERT INTO t VALUES ('b')", []).unwrap();
        assert_ne!(v1, a.data_version().unwrap());
        let mode: String = b
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
    }

    #[test]
    fn fts5_trigram_disponible() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE VIRTUAL TABLE f USING fts5(x, tokenize='trigram remove_diacritics 1');
             INSERT INTO f VALUES ('Crème fraîche');",
        )
        .unwrap();
        let rows = select(
            &c,
            "SELECT x FROM f WHERE f MATCH ?",
            &[Value::Text("creme".into())],
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn conversions_json() {
        let c = Connection::open_in_memory().unwrap();
        let params = to_params(&[
            Json::from(1),
            Json::from(2.5),
            Json::Bool(true),
            Json::Null,
            Json::from("é"),
        ])
        .unwrap();
        let rows = select(&c, "SELECT ? AS a, ? AS b, ? AS c, ? AS d, ? AS e", &params).unwrap();
        assert_eq!(
            Json::Object(rows[0].clone()),
            serde_json::json!({"a":1,"b":2.5,"c":1,"d":null,"e":"é"})
        );
    }
}
