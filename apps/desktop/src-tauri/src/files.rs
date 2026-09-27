//! Lecture / écriture de fichiers choisis par l'utilisateur via les boîtes de dialogue
//! (export / import JSON, fiches de séance en PNG).

use base64::Engine;
use tauri::Manager;

#[tauri::command(async)]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Lecture de « {path} » impossible : {e}"))
}

#[tauri::command(async)]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Écriture de « {path} » impossible : {e}"))
}

#[tauri::command(async)]
pub fn read_binary_file(path: String) -> Result<String, String> {
    let bytes =
        std::fs::read(&path).map_err(|e| format!("Lecture de « {path} » impossible : {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Écrit `name` dans le dossier `dir` (créé au besoin) et retourne le chemin complet.
#[tauri::command(async)]
pub fn write_binary_file(dir: String, name: String, base64: String) -> Result<String, String> {
    if name.contains(['/', '\\']) || name.contains("..") {
        return Err("Nom de fichier invalide".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|e| e.to_string())?;
    let dir = std::path::PathBuf::from(dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Création du dossier impossible : {e}"))?;
    let path = dir.join(name);
    std::fs::write(&path, bytes)
        .map_err(|e| format!("Écriture de « {} » impossible : {e}", path.display()))?;
    Ok(path.display().to_string())
}

/// Ressource embarquée dans l'installeur (ex. `ciqual.json.gz`), en base64 ; `None` si absente.
#[tauri::command(async)]
pub fn read_resource(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    if name.contains(['/', '\\']) || name.contains("..") {
        return Err("Nom de ressource invalide".into());
    }
    let path = app
        .path()
        .resolve(format!("resources/{name}"), tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(base64::engine::general_purpose::STANDARD.encode(bytes)))
}
