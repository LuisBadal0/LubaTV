//! Data left by the app LubaTV was forked from.
//!
//! On the first start, LubaTV copies that app's database so sources, favorites and settings
//! carry over. The user is then asked once whether to delete the old folders or keep them
//! (the old app needs them if it is still in use).

use crate::{sql, utils::project_dirs};
use anyhow::{Context, Result};
use directories::{BaseDirs, ProjectDirs};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Written to LubaTV's data folder once the user has chosen to keep or delete the old data.
const DECIDED_MARKER: &str = "legacy-data-decided";
/// Folder name every legacy path must contain; nothing else is ever deleted.
const LEGACY_NAME: &str = "open-tv";
const LEGACY_IDENTIFIER: &str = "dev.fredol.open-tv";

fn legacy_dirs() -> Option<ProjectDirs> {
    ProjectDirs::from("dev", "fredol", LEGACY_NAME)
}

/// Copies the old database into LubaTV's data folder on the first start.
pub fn migrate() -> Result<()> {
    let data_dir = project_dirs()?.data_dir().to_owned();
    let Some(legacy) = legacy_dirs() else {
        return Ok(());
    };
    copy_database(legacy.data_dir(), &data_dir)
}

/// Copies the database (and its WAL files) from `legacy_dir` into a new `data_dir`.
/// Does nothing when `data_dir` already exists, so "Delete everything" never brings the old
/// data back, or when there is no legacy database.
fn copy_database(legacy_dir: &Path, data_dir: &Path) -> Result<()> {
    if data_dir.exists() || !legacy_dir.join(sql::DB_NAME).exists() {
        return Ok(());
    }
    std::fs::create_dir_all(data_dir)?;
    let copied = (|| -> Result<()> {
        for suffix in ["", "-wal", "-shm"] {
            let name = format!("{}{}", sql::DB_NAME, suffix);
            let from = legacy_dir.join(&name);
            if from.exists() {
                std::fs::copy(&from, data_dir.join(&name))?;
            }
        }
        Ok(())
    })();
    if let Err(e) = copied {
        // Leave no half-copied database behind, so the next start tries again.
        _ = std::fs::remove_dir_all(data_dir);
        return Err(e);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct LegacyData {
    pub folders: Vec<String>,
    pub size_bytes: u64,
}

/// The old folders still on disk, if the user has not decided about them yet.
pub fn pending() -> Result<Option<LegacyData>> {
    if decided_marker()?.exists() {
        return Ok(None);
    }
    let folders = existing_folders();
    if folders.is_empty() {
        return Ok(None);
    }
    Ok(Some(LegacyData {
        size_bytes: folders.iter().map(|f| dir_size(f)).sum(),
        folders: folders
            .iter()
            .map(|f| f.to_string_lossy().to_string())
            .collect(),
    }))
}

/// Records the user's choice, deleting the old folders first when `delete` is true.
/// If deleting fails (for example because the old app is still running), nothing is
/// recorded, so the user is asked again on the next start.
pub fn resolve(delete: bool) -> Result<()> {
    if delete {
        for folder in existing_folders() {
            std::fs::remove_dir_all(&folder).with_context(|| {
                format!(
                    "Could not delete {}. Close the app that uses it, then try again.",
                    folder.display()
                )
            })?;
            remove_empty_legacy_parent(&folder);
        }
    }
    let marker = decided_marker()?;
    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(marker, if delete { "deleted" } else { "kept" })?;
    Ok(())
}

fn decided_marker() -> Result<PathBuf> {
    Ok(project_dirs()?.data_dir().join(DECIDED_MARKER))
}

/// The old app's folders that exist: its data/config/cache roots and its WebView storage.
fn existing_folders() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(legacy) = legacy_dirs() {
        for dir in [legacy.data_dir(), legacy.config_dir(), legacy.cache_dir()] {
            candidates.push(project_root(dir));
        }
    }
    if let Some(base) = BaseDirs::new() {
        candidates.push(base.data_local_dir().join(LEGACY_IDENTIFIER));
    }
    deletable_folders(candidates)
}

/// On Windows, data, config and cache are subfolders of one `...\open-tv` folder; use it.
fn project_root(dir: &Path) -> PathBuf {
    match dir.parent() {
        Some(parent) if parent.file_name().is_some_and(|n| n == LEGACY_NAME) => {
            parent.to_path_buf()
        }
        _ => dir.to_path_buf(),
    }
}

/// Existing, de-duplicated folders whose name contains the legacy name. Anything else is
/// dropped, so a surprising path can never be deleted.
fn deletable_folders(candidates: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut folders: Vec<PathBuf> = Vec::new();
    for dir in candidates {
        let named = dir
            .file_name()
            .is_some_and(|n| n.to_string_lossy().contains(LEGACY_NAME));
        if named && dir.is_dir() && !folders.iter().any(|f| dir.starts_with(f) || f.starts_with(&dir)) {
            folders.push(dir);
        }
    }
    folders
}

/// Removes the empty `fredol` folder left on Windows after deleting `fredol\open-tv`.
fn remove_empty_legacy_parent(folder: &Path) {
    if let Some(parent) = folder.parent() {
        if parent.file_name().is_some_and(|n| n == "fredol") {
            // remove_dir only succeeds on an empty folder.
            _ = std::fs::remove_dir(parent);
        }
    }
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => dir_size(&entry.path()),
            Ok(_) => entry.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

#[cfg(test)]
mod test_legacy {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("lubatv-{name}-{}", std::process::id()));
        _ = std::fs::remove_dir_all(&root);
        root
    }

    #[test]
    fn test_copy_database() {
        let root = temp_root("migrate");
        let legacy = root.join("legacy");
        let data = root.join("data");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join(sql::DB_NAME), b"db").unwrap();
        std::fs::write(legacy.join(format!("{}-wal", sql::DB_NAME)), b"wal").unwrap();

        copy_database(&legacy, &data).unwrap();
        assert_eq!(std::fs::read(data.join(sql::DB_NAME)).unwrap(), b"db");
        assert_eq!(std::fs::read(data.join(format!("{}-wal", sql::DB_NAME))).unwrap(), b"wal");
        assert!(!data.join(format!("{}-shm", sql::DB_NAME)).exists());

        // Once LubaTV has its own folder (e.g. after "Delete everything"), never copy again.
        std::fs::remove_file(data.join(sql::DB_NAME)).unwrap();
        copy_database(&legacy, &data).unwrap();
        assert!(!data.join(sql::DB_NAME).exists());

        // No legacy database: nothing is created.
        let fresh = root.join("fresh");
        copy_database(&root.join("missing"), &fresh).unwrap();
        assert!(!fresh.exists());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn test_deletable_folders() {
        let root = temp_root("folders");
        let windows_root = root.join("Roaming").join("fredol").join("open-tv");
        let webview = root.join("Local").join("dev.fredol.open-tv");
        let unrelated = root.join("Local").join("something-else");
        for dir in [&windows_root.join("data"), &webview, &unrelated] {
            std::fs::create_dir_all(dir).unwrap();
        }

        // data/config/cache subfolders map to their shared "open-tv" folder.
        assert_eq!(project_root(&windows_root.join("data")), windows_root);
        assert_eq!(project_root(&webview), webview);

        let folders = deletable_folders(vec![
            project_root(&windows_root.join("data")),
            project_root(&windows_root.join("config")),
            webview.clone(),
            unrelated.clone(),
            root.join("Local").join("missing-open-tv"),
        ]);
        assert_eq!(folders, vec![windows_root.clone(), webview.clone()]);

        std::fs::remove_dir_all(&root).unwrap();
    }
}
