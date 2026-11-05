mod sidecar;

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use sidecar::SidecarProcess;

struct AppState {
    sidecar: Arc<Mutex<Option<SidecarProcess>>>,
    jar_dir: PathBuf,
    sidecar_jar_path: String,   // ← جدید (برای respawn)
}

// ═══════════════════════════════════════════════════════════
// Path Resolution
// ═══════════════════════════════════════════════════════════

fn find_jar_dir() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        let dev_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../jar_files");
        return PathBuf::from(dev_path);
    }

    #[cfg(not(debug_assertions))]
    {
        let exe = std::env::current_exe().unwrap();
        let exe_dir = exe.parent().unwrap();
        exe_dir.join("jar_files")
    }
}

fn find_jar_path(app: &tauri::AppHandle) -> Option<String> {
    #[cfg(debug_assertions)]
    {
        let dev_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../sidecar/build/libs/mcsrc-sidecar.jar"
        );
        if std::path::Path::new(dev_path).exists() {
            return Some(dev_path.to_string());
        }
    }

    if let Ok(path) = app
        .path()
        .resolve("mcsrc-sidecar.jar", tauri::path::BaseDirectory::Resource)
    {
        if path.exists() {
            let path_str = path.to_string_lossy().to_string();
            let clean = path_str.strip_prefix(r"\\?\").unwrap_or(&path_str).to_string();
            return Some(clean);
        }
    }

    None
}

fn version_to_filename(version: &str) -> String {
    let safe: String = version
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    format!("{}.jar", safe.trim())
}

// ═══════════════════════════════════════════════════════════
// Sidecar Commands
// ═══════════════════════════════════════════════════════════

#[tauri::command]
fn sidecar_ping(state: State<'_, AppState>) -> Result<Value, String> {
    let mut guard = state.sidecar.lock().map_err(|e| e.to_string())?;
    let sc = guard.as_mut().ok_or("Sidecar not started")?;
    sc.request("ping", json!({})).map_err(|e| e.to_string())
}

#[tauri::command]
fn sidecar_version(state: State<'_, AppState>) -> Result<Value, String> {
    let mut guard = state.sidecar.lock().map_err(|e| e.to_string())?;
    let sc = guard.as_mut().ok_or("Sidecar not started")?;
    sc.request("version", json!({})).map_err(|e| e.to_string())
}

/// Legacy sync decompile (برای تست)
#[tauri::command]
fn sidecar_decompile(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    jar_path: String,
    output_dir: String,
) -> Result<Value, String> {
    let mut guard = state.sidecar.lock().map_err(|e| e.to_string())?;
    let sc = guard.as_mut().ok_or("Sidecar not started")?;

    let id = sc
        .send(
            "decompile",
            json!({
                "jarPath": jar_path,
                "outputDir": output_dir,
            }),
        )
        .map_err(|e| e.to_string())?;

    loop {
        let msg = sc
            .read_message()
            .map_err(|e| e.to_string())?
            .ok_or("Sidecar closed stdout")?;

        if msg.get("type").and_then(|v| v.as_str()) == Some("progress") {
            let _ = app.emit("sidecar-progress", &msg);
            continue;
        }

        if msg.get("id").and_then(|v| v.as_str()) == Some(&id) {
            return Ok(msg);
        }
    }
}

// ═══════════════════════════════════════════════════════════
// JAR File Operations
// ═══════════════════════════════════════════════════════════

#[tauri::command]
fn jar_exists(state: State<'_, AppState>, version: String) -> Result<bool, String> {
    let filename = version_to_filename(&version);
    let path = state.jar_dir.join(&filename);
    Ok(path.exists())
}

#[tauri::command]
async fn read_jar(state: State<'_, AppState>, version: String) -> Result<Vec<u8>, String> {
    let filename = version_to_filename(&version);
    let path = state.jar_dir.join(&filename);
    if !path.exists() {
        return Err(format!("JAR not found: {}", filename));
    }
    // فایل بزرگه — توی blocking thread بخون تا UI هنگ نکنه
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", filename, e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn write_jar(
    state: State<'_, AppState>,
    version: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let filename = version_to_filename(&version);
    let path = state.jar_dir.join(&filename);
    std::fs::create_dir_all(&state.jar_dir).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Failed to write {}: {}", filename, e))?;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    println!("[jar] Wrote {} ({} bytes)", filename, size);
    Ok(())
}

#[tauri::command]
fn list_jars(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    std::fs::create_dir_all(&state.jar_dir).map_err(|e| e.to_string())?;
    let entries = std::fs::read_dir(&state.jar_dir).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("jar") {
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            result.push(json!({ "name": name, "size": size }));
        }
    }
    Ok(result)
}

#[tauri::command]
fn get_jar_dir(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.jar_dir.to_string_lossy().to_string())
}

// ═══════════════════════════════════════════════════════════
// Decompile / Source Cache Operations
// ═══════════════════════════════════════════════════════════

#[tauri::command]
fn is_source_cached(state: State<'_, AppState>, version: String) -> Result<bool, String> {
    let cache_dir = state.jar_dir.join("sources").join(&version);
    if !cache_dir.exists() {
        return Ok(false);
    }
    let mut dir = cache_dir.read_dir().map_err(|e| e.to_string())?;
    Ok(dir.next().is_some())
}

/// ⭐ نسخه async — روی blocking thread اجرا می‌شه تا UI هنگ نکنه
#[tauri::command]
async fn decompile_version(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    version: String,
) -> Result<Value, String> {
    let jar_filename = version_to_filename(&version);
    let jar_path = state.jar_dir.join(&jar_filename);

    if !jar_path.exists() {
        return Err(format!("JAR not found: {}", jar_filename));
    }

    let cache_dir = state.jar_dir.join("sources").join(&version);
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    println!("[decompile] Version {} → {}", version, cache_dir.display());

    // Arc<Mutex> clone می‌کنیم تا بتونیم توی thread جدا بفرستیم
    let sidecar_arc = state.sidecar.clone();
    let app_clone = app.clone();
    let version_clone = version.clone();

    // روی blocking thread اجرا می‌شه — UI هنگ نمی‌کنه
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let mut guard = sidecar_arc.lock().map_err(|e| e.to_string())?;
        let sc = guard.as_mut().ok_or("Sidecar not started")?;

        let id = sc
            .send(
                "decompile",
                json!({
                    "jarPath": jar_path.to_string_lossy(),
                    "outputDir": cache_dir.to_string_lossy(),
                }),
            )
            .map_err(|e| e.to_string())?;

        loop {
            let msg = sc
                .read_message()
                .map_err(|e| e.to_string())?
                .ok_or("Sidecar closed stdout")?;

            if msg.get("type").and_then(|v| v.as_str()) == Some("progress") {
                let _ = app_clone.emit("decompile-progress", &msg);
                continue;
            }

            if msg.get("id").and_then(|v| v.as_str()) == Some(&id) {
                return Ok(msg);
            }
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    println!("[decompile] Completed version {}", version_clone);
    Ok(result)
}

#[tauri::command]
fn read_class_source(
    state: State<'_, AppState>,
    version: String,
    class_name: String,
) -> Result<String, String> {
    let cache_dir = state.jar_dir.join("sources").join(&version);
    let normalized = class_name.replace('.', "/");
    let file_path = cache_dir.join(format!("{}.java", normalized));

    if !file_path.exists() {
        return Err(format!(
            "Not found: {} (in {})",
            normalized,
            cache_dir.display()
        ));
    }

    std::fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_cached_versions(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let sources_dir = state.jar_dir.join("sources");
    if !sources_dir.exists() {
        return Ok(vec![]);
    }
    let mut result = Vec::new();
    for entry in sources_dir.read_dir().map_err(|e| e.to_string())? {
        if let Ok(entry) = entry {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                result.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    Ok(result)
}

// ═══════════════════════════════════════════════════════════
// App Entry Point
// ═══════════════════════════════════════════════════════════

#[tauri::command]
async fn cancel_decompile(state: State<'_, AppState>) -> Result<(), String> {
    let sidecar_arc = state.sidecar.clone();
    let jar_path = state.sidecar_jar_path.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut guard = sidecar_arc.lock().map_err(|e| e.to_string())?;

        // کشتن sidecar فعلی
        if let Some(mut sc) = guard.take() {
            println!("[cancel] Killing sidecar");
            sc.kill();
        }

        // respawn
        println!("[cancel] Respawning sidecar");
        let new_sc = SidecarProcess::spawn("java", &jar_path)
            .map_err(|e| format!("Failed to respawn sidecar: {}", e))?;
        *guard = Some(new_sc);

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}


/// پوشه cache رو توی مسیر مقصد کپی می‌کنه
#[tauri::command]
async fn copy_sources_to(
    state: State<'_, AppState>,
    version: String,
    target: String,
) -> Result<Value, String> {
    let source_dir = state.jar_dir.join("sources").join(&version);
    if !source_dir.exists() {
        return Err(format!("Sources not cached for {}", version));
    }

    let target_root = PathBuf::from(&target);
    let target_dir = target_root.join(&version);

    // اگه مقصد از قبل هست، پاکش کن
    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    let count = copy_dir_recursive(&source_dir, &target_dir)
        .map_err(|e| e.to_string())?;

    println!("[export] Copied {} entries to {}", count, target_dir.display());

    Ok(json!({
        "ok": true,
        "copied": count,
        "target": target_dir.to_string_lossy(),
    }))
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> std::io::Result<usize> {
    std::fs::create_dir_all(dst)?;
    let mut count = 0;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            count += copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
            count += 1;
        }
    }
    Ok(count)
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();

            let jar_path =
                find_jar_path(&handle).ok_or("Could not find mcsrc-sidecar.jar")?;

            println!("[mcsrc] Starting sidecar from: {}", jar_path);

            let sidecar = SidecarProcess::spawn("java", &jar_path)
                .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

            let jar_dir = find_jar_dir();
            println!("[mcsrc] JAR directory: {}", jar_dir.display());

            app.manage(AppState {
                sidecar: Arc::new(Mutex::new(Some(sidecar))),
                jar_dir,
                sidecar_jar_path: jar_path,   // ← جدید
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sidecar_ping,
            sidecar_version,
            sidecar_decompile,
            cancel_decompile,       // ← جدید
            jar_exists,
            read_jar,
            write_jar,
            list_jars,
            get_jar_dir,
            is_source_cached,
            decompile_version,
            read_class_source,
            list_cached_versions,
            copy_sources_to,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}