//! Lecture / écriture de fichiers texte choisis par l'utilisateur via la boîte de dialogue
//! (export / import JSON du programme).

#[tauri::command(async)]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Lecture de « {path} » impossible : {e}"))
}

#[tauri::command(async)]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Écriture de « {path} » impossible : {e}"))
}
