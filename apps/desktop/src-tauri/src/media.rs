//! Fichiers médias (images d'exercices, photos corporelles) rangés dans `<données>/media`.
//! La base ne stocke que des chemins relatifs à ce dossier.

use crate::db::DbState;
use base64::Engine;
use std::path::{Component, Path, PathBuf};
use tauri::State;

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp"];

pub fn media_dir(state: &DbState) -> PathBuf {
    state.data_dir().join("media")
}

/// Refuse les chemins absolus ou remontant hors du dossier (`..`).
fn safe_relative(rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.components().all(|c| matches!(c, Component::Normal(_))) {
        Ok(p.to_path_buf())
    } else {
        Err(format!("Chemin de média invalide : {rel}"))
    }
}

fn new_name(subdir: &str, ext: &str) -> Result<PathBuf, String> {
    let ext = ext.trim_start_matches('.').to_lowercase();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Format d'image non pris en charge : .{ext}"));
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    Ok(safe_relative(subdir)?.join(format!("{nanos:x}.{ext}")))
}

fn to_rel_string(p: &Path) -> String {
    p.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

/// Copie une image choisie par l'utilisateur dans le dossier des médias.
#[tauri::command(async)]
pub fn import_media_file(
    state: State<'_, DbState>,
    src: String,
    subdir: String,
) -> Result<String, String> {
    let ext = Path::new(&src)
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_default();
    let rel = new_name(&subdir, &ext)?;
    let dest = media_dir(&state).join(&rel);
    std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::copy(&src, &dest).map_err(|e| format!("Copie de l'image impossible : {e}"))?;
    Ok(to_rel_string(&rel))
}

/// Enregistre une image reçue en base64 (téléchargement, photo).
#[tauri::command(async)]
pub fn save_media_bytes(
    state: State<'_, DbState>,
    base64: String,
    ext: String,
    subdir: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|e| e.to_string())?;
    let rel = new_name(&subdir, &ext)?;
    let dest = media_dir(&state).join(&rel);
    std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(to_rel_string(&rel))
}

#[tauri::command(async)]
pub fn delete_media_file(state: State<'_, DbState>, rel: String) -> Result<(), String> {
    let path = media_dir(&state).join(safe_relative(&rel)?);
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chemins_relatifs_securises() {
        assert!(safe_relative("exercises/a.jpg").is_ok());
        assert!(safe_relative("../a.jpg").is_err());
        assert!(safe_relative("/etc/passwd").is_err());
        assert!(new_name("exercises", "exe").is_err());
        assert!(new_name("exercises", "JPG")
            .unwrap()
            .to_string_lossy()
            .ends_with(".jpg"));
    }
}
