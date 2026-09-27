//! Connexion à Claude Desktop : chemin du serveur MCP (sidecar), fichier de configuration
//! `claude_desktop_config.json`, installation automatique et test.

use crate::db::DbState;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;

const SERVER_KEY: &str = "training";

fn exe_name() -> &'static str {
    if cfg!(windows) {
        "training-mcp.exe"
    } else {
        "training-mcp"
    }
}

/// Le serveur MCP est installé à côté de l'application (sidecar Tauri).
pub fn mcp_exe_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.parent().unwrap_or(Path::new(".")).join(exe_name()))
}

/// Emplacements possibles du fichier de configuration de Claude Desktop.
pub fn config_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let file = "claude_desktop_config.json";
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            out.push(Path::new(&appdata).join("Claude").join(file));
        }
        // Version Microsoft Store : dossier virtualisé.
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if let Ok(entries) = std::fs::read_dir(Path::new(&local).join("Packages")) {
                for e in entries.flatten() {
                    if e.file_name().to_string_lossy().starts_with("Claude_") {
                        out.push(
                            e.path()
                                .join("LocalCache")
                                .join("Roaming")
                                .join("Claude")
                                .join(file),
                        );
                    }
                }
            }
        }
    } else if let Ok(home) = std::env::var("HOME") {
        if cfg!(target_os = "macos") {
            out.push(
                Path::new(&home)
                    .join("Library/Application Support/Claude")
                    .join(file),
            );
        } else {
            out.push(Path::new(&home).join(".config/Claude").join(file));
        }
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigInfo {
    path: String,
    dir_exists: bool,
    file_exists: bool,
    configured: bool,
    /// Configuration « training » présente mais pointant ailleurs.
    outdated: bool,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInfo {
    exe_path: String,
    exe_exists: bool,
    db_path: String,
    server_key: &'static str,
    configs: Vec<ConfigInfo>,
}

fn read_config(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&text).map_err(|e| {
        format!("Fichier JSON invalide ({e}) : corrigez-le ou supprimez-le avant de réessayer.")
    })
}

fn server_entry(exe: &Path, db: &Path) -> Value {
    json!({ "command": exe.display().to_string(), "args": ["--db", db.display().to_string()] })
}

#[tauri::command]
pub fn mcp_info(state: State<'_, DbState>) -> Result<McpInfo, String> {
    let exe = mcp_exe_path()?;
    let expected = server_entry(&exe, state.path());
    let configs = config_candidates()
        .into_iter()
        .map(|p| {
            let (current, error) = match read_config(&p) {
                Ok(v) => (
                    v.get("mcpServers").and_then(|s| s.get(SERVER_KEY)).cloned(),
                    None,
                ),
                Err(e) => (None, Some(e)),
            };
            ConfigInfo {
                dir_exists: p.parent().is_some_and(Path::exists),
                file_exists: p.exists(),
                configured: current.as_ref() == Some(&expected),
                outdated: current.is_some() && current.as_ref() != Some(&expected),
                error,
                path: p.display().to_string(),
            }
        })
        .collect();
    Ok(McpInfo {
        exe_exists: exe.exists(),
        exe_path: exe.display().to_string(),
        db_path: state.path().display().to_string(),
        server_key: SERVER_KEY,
        configs,
    })
}

/// Ajoute (ou met à jour) l'entrée « training » dans la configuration de Claude Desktop,
/// en conservant les autres serveurs et en gardant une copie de sauvegarde.
pub fn install_into(path: &Path, exe: &Path, db: &Path) -> Result<(), String> {
    let mut config = read_config(path)?;
    if !config.is_object() {
        return Err("La configuration existante n'est pas un objet JSON.".into());
    }
    if path.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or_default();
        let backup = path.with_extension(format!("json.bak-{stamp}"));
        std::fs::copy(path, backup).map_err(|e| format!("Sauvegarde impossible : {e}"))?;
    }
    let servers = config
        .as_object_mut()
        .unwrap()
        .entry("mcpServers")
        .or_insert_with(|| json!({}));
    if !servers.is_object() {
        *servers = json!({});
    }
    servers
        .as_object_mut()
        .unwrap()
        .insert(SERVER_KEY.into(), server_entry(exe, db));
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(path, text)
        .map_err(|e| format!("Écriture de {} impossible : {e}", path.display()))
}

#[tauri::command(async)]
pub fn mcp_install(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let exe = mcp_exe_path()?;
    if !exe.exists() {
        return Err(format!("Serveur MCP introuvable : {}", exe.display()));
    }
    let candidates = config_candidates();
    // Claude Desktop installé = son dossier existe ; à défaut, emplacement standard.
    let mut targets: Vec<&PathBuf> = candidates
        .iter()
        .filter(|p| p.parent().is_some_and(Path::exists))
        .collect();
    if targets.is_empty() {
        targets = candidates.iter().take(1).collect();
    }
    if targets.is_empty() {
        return Err("Emplacement de la configuration de Claude Desktop introuvable.".into());
    }
    let mut written = Vec::new();
    for p in targets {
        install_into(p, &exe, state.path())?;
        written.push(p.display().to_string());
    }
    Ok(written)
}

#[derive(Serialize)]
pub struct SelfTest {
    ok: bool,
    output: String,
}

#[tauri::command(async)]
pub fn mcp_self_test(state: State<'_, DbState>) -> Result<SelfTest, String> {
    let exe = mcp_exe_path()?;
    if !exe.exists() {
        return Err(format!("Serveur MCP introuvable : {}", exe.display()));
    }
    let mut cmd = Command::new(&exe);
    cmd.arg("--self-test").arg("--db").arg(state.path());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd
        .output()
        .map_err(|e| format!("Lancement impossible : {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr)
        .lines()
        .filter(|l| !l.contains("ExperimentalWarning") && !l.contains("--trace-warnings"))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(SelfTest {
        ok: out.status.success(),
        output: if stdout.is_empty() { stderr } else { stdout },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installe_sans_ecraser_les_autres_serveurs() {
        let dir = std::env::temp_dir().join(format!("claude-cfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("claude_desktop_config.json");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            &path,
            r#"{"mcpServers":{"autre":{"command":"x"}},"theme":"dark"}"#,
        )
        .unwrap();
        install_into(
            &path,
            Path::new("C:\\App\\training-mcp.exe"),
            Path::new("C:\\Data\\training.db"),
        )
        .unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["mcpServers"]["autre"]["command"], "x");
        assert_eq!(
            v["mcpServers"]["training"]["command"],
            "C:\\App\\training-mcp.exe"
        );
        assert_eq!(
            v["mcpServers"]["training"]["args"][1],
            "C:\\Data\\training.db"
        );
        let backups = std::fs::read_dir(&dir)
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains(".bak-")
            })
            .count();
        assert_eq!(backups, 1);
        std::fs::write(&path, "{ pas du json").unwrap();
        assert!(install_into(&path, Path::new("a"), Path::new("b")).is_err());
    }
}
