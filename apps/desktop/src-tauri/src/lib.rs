mod db;
mod files;

use tauri::Manager;

/// Chemin de la base : `TRAINING_DB_PATH` si défini, sinon `<AppData>/training.db`
/// (`%APPDATA%\fr.training.journal\training.db` sous Windows).
fn database_path(app: &tauri::App) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    if let Ok(p) = std::env::var("TRAINING_DB_PATH") {
        return Ok(p.into());
    }
    Ok(app.path().app_data_dir()?.join("training.db"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = db::DbState::new(database_path(app)?)?;
            app.manage(state);
            db::spawn_change_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_select,
            db::db_execute,
            db::db_exec,
            db::db_info,
            files::read_text_file,
            files::write_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
