//! Sauvegardes de la base : automatique quotidienne avec rotation, manuelle, export complet
//! (base + médias) et restauration.

use crate::db::DbState;
use rusqlite::{Connection, OpenFlags, MAIN_DB};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager, State};

const AUTO_PREFIX: &str = "training-auto-";
const DEFAULT_KEEP: usize = 14;

fn setting(state: &DbState, key: &str) -> Option<serde_json::Value> {
    state
        .with_conn(|c| {
            c.query_row("SELECT value FROM app_setting WHERE key = ?1", [key], |r| {
                r.get::<_, String>(0)
            })
        })
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

pub fn backup_dir(state: &DbState) -> PathBuf {
    match setting(state, "backupDir") {
        Some(serde_json::Value::String(s)) if !s.is_empty() => PathBuf::from(s),
        _ => state.data_dir().join("backups"),
    }
}

fn keep_count(state: &DbState) -> usize {
    setting(state, "backupKeepDays")
        .and_then(|v| v.as_u64())
        .map(|n| n.clamp(1, 365) as usize)
        .unwrap_or(DEFAULT_KEEP)
}

fn local_stamp(state: &DbState) -> Result<String, String> {
    state.with_conn(|c| {
        c.query_row(
            "SELECT strftime('%Y-%m-%d_%H%M%S', 'now', 'localtime')",
            [],
            |r| r.get(0),
        )
    })
}

/// Copie cohérente de la base (même pendant une écriture) via VACUUM INTO.
fn vacuum_into(state: &DbState, dest: &Path) -> Result<(), String> {
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Dossier de sauvegarde inaccessible : {e}"))?;
    }
    let _ = std::fs::remove_file(dest);
    let target = dest.display().to_string().replace('\'', "''");
    state.with_conn(|c| c.execute_batch(&format!("VACUUM INTO '{target}'")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    name: String,
    path: String,
    size: u64,
    modified_ms: u64,
    automatic: bool,
}

fn list_in(dir: &Path) -> Vec<BackupFile> {
    let mut out: Vec<BackupFile> = std::fs::read_dir(dir)
        .map(|it| {
            it.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    if !name.ends_with(".db") {
                        return None;
                    }
                    let meta = e.metadata().ok()?;
                    Some(BackupFile {
                        automatic: name.starts_with(AUTO_PREFIX),
                        path: e.path().display().to_string(),
                        size: meta.len(),
                        modified_ms: meta
                            .modified()
                            .ok()?
                            .duration_since(SystemTime::UNIX_EPOCH)
                            .ok()?
                            .as_millis() as u64,
                        name,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out
}

/// Ne garde que les `keep` sauvegardes automatiques les plus récentes (d'après l'horodatage du nom).
fn rotate(dir: &Path, keep: usize) {
    let mut autos: Vec<BackupFile> = list_in(dir).into_iter().filter(|b| b.automatic).collect();
    autos.sort_by(|a, b| b.name.cmp(&a.name));
    for old in autos.into_iter().skip(keep) {
        let _ = std::fs::remove_file(old.path);
    }
}

/// Sauvegarde automatique si la dernière date de plus de 20 h.
pub fn run_daily_backup(state: &DbState) -> Result<Option<PathBuf>, String> {
    let dir = backup_dir(state);
    let recent = list_in(&dir)
        .into_iter()
        .find(|b| b.automatic)
        .is_some_and(|b| {
            let age = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or_default()
                .saturating_sub(b.modified_ms);
            age < 20 * 3600 * 1000
        });
    if recent {
        return Ok(None);
    }
    let dest = dir.join(format!("{AUTO_PREFIX}{}.db", local_stamp(state)?));
    vacuum_into(state, &dest)?;
    rotate(&dir, keep_count(state));
    Ok(Some(dest))
}

pub fn spawn_backup_scheduler(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        loop {
            if let Err(e) = run_daily_backup(&app.state::<DbState>()) {
                eprintln!("Sauvegarde automatique impossible : {e}");
            }
            std::thread::sleep(Duration::from_secs(3600));
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    dir: String,
    keep: usize,
    files: Vec<BackupFile>,
}

#[tauri::command(async)]
pub fn backup_status(state: State<'_, DbState>) -> BackupStatus {
    let dir = backup_dir(&state);
    BackupStatus {
        files: list_in(&dir),
        keep: keep_count(&state),
        dir: dir.display().to_string(),
    }
}

#[tauri::command(async)]
pub fn backup_now(state: State<'_, DbState>) -> Result<String, String> {
    let dir = backup_dir(&state);
    let dest = dir.join(format!("training-manuel-{}.db", local_stamp(&state)?));
    vacuum_into(&state, &dest)?;
    Ok(dest.display().to_string())
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<u64> {
    let mut n = 0;
    std::fs::create_dir_all(dst)?;
    for e in std::fs::read_dir(src)?.flatten() {
        let to = dst.join(e.file_name());
        if e.file_type()?.is_dir() {
            n += copy_dir(&e.path(), &to)?;
        } else {
            std::fs::copy(e.path(), to)?;
            n += 1;
        }
    }
    Ok(n)
}

/// Export complet dans `<parent>/TrAIning-sauvegarde-<date>` : base + dossier des médias.
#[tauri::command(async)]
pub fn export_all(state: State<'_, DbState>, parent: String) -> Result<String, String> {
    let folder = Path::new(&parent).join(format!("TrAIning-sauvegarde-{}", local_stamp(&state)?));
    vacuum_into(&state, &folder.join("training.db"))?;
    let media = crate::media::media_dir(&state);
    if media.exists() {
        copy_dir(&media, &folder.join("media"))
            .map_err(|e| format!("Copie des médias impossible : {e}"))?;
    }
    Ok(folder.display().to_string())
}

/// Vérifie qu'un fichier est bien une base TrAIning lisible.
fn validate_backup(path: &Path) -> Result<i64, String> {
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Fichier illisible : {e}"))?;
    c.query_row("SELECT max(version) FROM schema_migration", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(|_| "Ce fichier n'est pas une sauvegarde TrAIning.".to_string())
}

/// Restaure une sauvegarde dans la base ouverte (copie de sécurité préalable).
/// Si un dossier `media` accompagne le fichier (export complet), les médias sont recopiés.
#[tauri::command(async)]
pub fn restore_backup(state: State<'_, DbState>, path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    validate_backup(&src)?;
    let safety = backup_dir(&state).join(format!(
        "training-avant-restauration-{}.db",
        local_stamp(&state)?
    ));
    vacuum_into(&state, &safety)?;
    state.with_conn_mut(|c| c.restore(MAIN_DB, &src, None::<fn(rusqlite::backup::Progress)>))?;
    if let Some(media) = src.parent().map(|p| p.join("media")).filter(|p| p.is_dir()) {
        copy_dir(&media, &crate::media::media_dir(&state))
            .map_err(|e| format!("Base restaurée, mais copie des médias impossible : {e}"))?;
    }
    Ok(safety.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_state(name: &str) -> DbState {
        let dir =
            std::env::temp_dir().join(format!("training-backup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let s = DbState::new(dir.join("training.db")).unwrap();
        s.with_conn(|c| {
            c.execute_batch(
                "CREATE TABLE schema_migration (version INTEGER PRIMARY KEY) STRICT;
                 INSERT INTO schema_migration VALUES (2);
                 CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
                 CREATE TABLE t (x TEXT) STRICT; INSERT INTO t VALUES ('avant');",
            )
        })
        .unwrap();
        s
    }

    #[test]
    fn sauvegarde_quotidienne_rotation_et_restauration() {
        let s = temp_state("a");
        let first = run_daily_backup(&s).unwrap().expect("première sauvegarde");
        assert!(first.exists());
        assert!(
            run_daily_backup(&s).unwrap().is_none(),
            "pas deux sauvegardes auto le même jour"
        );

        let dir = backup_dir(&s);
        for i in 0..20 {
            std::fs::write(
                dir.join(format!("{AUTO_PREFIX}2020-01-{:02}_000000.db", i + 1)),
                b"x",
            )
            .unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
        std::fs::write(dir.join("training-manuel-x.db"), b"x").unwrap();
        rotate(&dir, 3);
        let files = list_in(&dir);
        assert_eq!(files.iter().filter(|f| f.automatic).count(), 3);
        assert!(
            files.iter().any(|f| f.name == "training-manuel-x.db"),
            "les manuelles ne tournent pas"
        );

        s.with_conn(|c| c.execute("UPDATE t SET x = 'après'", []))
            .unwrap();
        restore_into(&s, &first);
        let x: String = s
            .with_conn(|c| c.query_row("SELECT x FROM t", [], |r| r.get(0)))
            .unwrap();
        assert_eq!(x, "avant");
        assert!(validate_backup(&dir.join("training-manuel-x.db")).is_err());
    }

    fn restore_into(s: &DbState, src: &Path) {
        validate_backup(src).unwrap();
        s.with_conn_mut(|c| c.restore(MAIN_DB, src, None::<fn(rusqlite::backup::Progress)>))
            .unwrap();
    }
}
