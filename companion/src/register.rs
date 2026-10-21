//! Registers the companion as a Firefox native-messaging host, per user.
//!
//! `install` copies the running executable to a stable per-user folder (so the
//! download can be deleted) and points Firefox at it: through a manifest in
//! ~/.mozilla/native-messaging-hosts on Linux, and through a registry key naming
//! the manifest on Windows.

use serde_json::json;
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const HOST_NAME: &str = "captions_companion";
pub const EXTENSION_ID: &str = "captions@zerathul.local";

pub fn install() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    crate::capture::check_requirements()?;

    let current = env::current_exe().map_err(|e| format!("can't locate this program: {e}"))?;
    let dir = install_dir()?;
    let exe = dir.join(current.file_name().ok_or("can't locate this program")?);
    fs::create_dir_all(&dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    if !same_file(&current, &exe) {
        fs::copy(&current, &exe).map_err(|e| {
            format!("can't copy to {}: {e} (if captions are running, stop them and try again)", exe.display())
        })?;
    }

    let manifest = manifest_path()?;
    if let Some(parent) = manifest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("can't create {}: {e}", parent.display()))?;
    }
    let contents = serde_json::to_string_pretty(&json!({
        "name": HOST_NAME,
        "description": "Captions: records Firefox's audio output for DRM-protected videos",
        "path": exe,
        "type": "stdio",
        "allowed_extensions": [EXTENSION_ID],
    }))
    .expect("JSON");
    fs::write(&manifest, contents + "\n").map_err(|e| format!("can't write {}: {e}", manifest.display()))?;

    #[cfg(windows)]
    windows_registry::CURRENT_USER
        .create(REGISTRY_KEY)
        .and_then(|key| key.set_string("", manifest.to_string_lossy().as_ref()))
        .map_err(|e| format!("can't register with Firefox: {e}"))?;

    Ok(format!(
        "Installed {}.\nFirefox will start it for videos with DRM; restart captions if they're running.",
        exe.display()
    ))
}

pub fn uninstall() -> Result<String, String> {
    #[cfg(windows)]
    match windows_registry::CURRENT_USER.remove_tree(REGISTRY_KEY) {
        Ok(()) => {}
        // ERROR_FILE_NOT_FOUND: never registered.
        Err(e) if e.code() == windows::core::HRESULT::from_win32(2) => {}
        Err(e) => return Err(format!("can't unregister from Firefox: {e}")),
    }
    let manifest = manifest_path()?;
    remove(&manifest)?;

    // Windows can't delete a running executable; its installer removes the folder.
    #[cfg(not(windows))]
    {
        let dir = install_dir()?;
        if let Err(e) = fs::remove_dir_all(&dir)
            && e.kind() != io::ErrorKind::NotFound
        {
            return Err(format!("can't remove {}: {e}", dir.display()));
        }
    }
    Ok("Uninstalled the Captions companion.".into())
}

fn remove(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(format!("can't remove {}: {e}", path.display())),
        _ => Ok(()),
    }
}

fn same_file(a: &Path, b: &Path) -> bool {
    matches!((a.canonicalize(), b.canonicalize()), (Ok(a), Ok(b)) if a == b)
}

fn var_path(name: &str) -> Result<PathBuf, String> {
    env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from).ok_or(format!("{name} is not set"))
}

#[cfg(windows)]
const REGISTRY_KEY: &str = r"Software\Mozilla\NativeMessagingHosts\captions_companion";

/// Where the installer puts it too (packaging/windows), so both installs are the same.
#[cfg(windows)]
fn install_dir() -> Result<PathBuf, String> {
    Ok(var_path("LOCALAPPDATA")?.join("Programs").join("Captions Companion"))
}

#[cfg(windows)]
fn manifest_path() -> Result<PathBuf, String> {
    Ok(install_dir()?.join(format!("{HOST_NAME}.json")))
}

#[cfg(not(windows))]
fn install_dir() -> Result<PathBuf, String> {
    let data = var_path("XDG_DATA_HOME").or_else(|_| var_path("HOME").map(|home| home.join(".local/share")))?;
    Ok(data.join("captions-companion"))
}

/// Firefox reads native hosts from ~/.mozilla even when its profiles live in
/// ~/.config/mozilla (it only falls back to the old layout if ~/.mozilla/firefox exists).
#[cfg(not(windows))]
fn manifest_path() -> Result<PathBuf, String> {
    let dir = var_path("MOZ_NATIVE_HOSTS_DIR")
        .or_else(|_| var_path("HOME").map(|h| h.join(".mozilla/native-messaging-hosts")))?;
    Ok(dir.join(format!("{HOST_NAME}.json")))
}
