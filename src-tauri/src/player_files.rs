//! The player files on Windows: mpv, its Vulkan loader, yt-dlp and ffmpeg.
//!
//! The full installers ship them in a `deps` folder next to the app. The installers the
//! updater downloads don't, so an update is about 10 MB instead of about 100 MB. Instead,
//! LubaTV checks the copies it has against the checksums pinned in `player-files.json` and
//! gets only what's missing or different: copied from the installed `deps` folder when a
//! copy there matches, otherwise downloaded (gzip-compressed) from this repository's
//! `player-files-*` release. Those go in `%LOCALAPPDATA%\luisbadalo\lubatv\data\player`.
//!
//! mpv loads `vulkan-1.dll` and runs `yt-dlp.exe` from its own folder, so those three are
//! always used together from the same folder.

use crate::log;
use crate::utils::{deps_dir, project_dirs};
use anyhow::{Context, Result, bail};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

const DOWNLOAD_BASE: &str = "https://github.com/LuisBadal0/LubaTV/releases/download";
const PROGRESS_EVENT: &str = "player_files_progress";
/// Used from mpv's folder: the DLL is loaded by mpv, yt-dlp is started by mpv.
const MPV_GROUP: [&str; 3] = ["mpv.exe", "vulkan-1.dll", "yt-dlp.exe"];
const VERIFIED_CACHE: &str = "verified.json";

#[derive(Deserialize)]
struct Lock {
    files: BTreeMap<String, LockedFile>,
}

#[derive(Deserialize)]
struct LockedFile {
    /// The `player-files-*` release that has `<name>.gz`.
    release: String,
    sha256: String,
    size: u64,
    download_size: u64,
}

static LOCK: LazyLock<Lock> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../player-files.json")).expect("invalid player-files.json")
});

/// Where each player file is used from, once checked.
static RESOLVED: RwLock<Option<HashMap<String, PathBuf>>> = RwLock::new(None);
/// Only one sync at a time.
static SYNC: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// What a sync would do.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Status {
    /// Files to download.
    pub download: Vec<String>,
    /// Compressed size of those downloads, in bytes.
    pub download_size: u64,
    /// Files to copy from the installed `deps` folder (no download needed).
    pub copy: Vec<String>,
}

impl Status {
    pub fn up_to_date(&self) -> bool {
        self.download.is_empty() && self.copy.is_empty()
    }
}

#[derive(Serialize, Clone, Debug)]
struct Progress {
    downloaded: u64,
    total: u64,
}

#[derive(Debug, PartialEq)]
enum Action {
    Use(PathBuf),
    Copy(PathBuf),
    Download,
}

/// The folder for player files LubaTV copied or downloaded itself.
pub fn user_dir() -> Result<PathBuf> {
    Ok(project_dirs()?.data_local_dir().join("player"))
}

/// The path to use for a player file (for example "mpv.exe"). Checks the files first if
/// that hasn't happened yet. Falls back to any copy that exists, even an outdated one,
/// so playback works while a newer one downloads.
pub fn path(name: &str) -> PathBuf {
    if RESOLVED.read().unwrap().is_none()
        && let Err(e) = check()
    {
        log::log(format!("Could not check the player files: {:?}", e));
    }
    if let Some(path) = RESOLVED.read().unwrap().as_ref().and_then(|r| r.get(name)) {
        return path.clone();
    }
    let user = user_dir().map(|d| d.join(name)).ok();
    match user {
        Some(user) if user.exists() => user,
        _ => deps_dir().join(name),
    }
}

/// Checks the player files and returns what a sync would do. Reading 250 MB of files
/// takes a moment the first time; after that, unchanged files aren't read again.
pub fn check() -> Result<Status> {
    // Development builds use src-tauri/deps as they are (see utils::deps_dir).
    if cfg!(debug_assertions) {
        let resolved = LOCK
            .files
            .keys()
            .map(|name| (name.clone(), deps_dir().join(name)))
            .collect();
        *RESOLVED.write().unwrap() = Some(resolved);
        return Ok(Status::default());
    }
    let (status, resolved) = check_in(&deps_dir(), &user_dir()?);
    *RESOLVED.write().unwrap() = Some(resolved);
    Ok(status)
}

/// check() for a given installed folder and LubaTV folder.
fn check_in(bundled: &Path, user: &Path) -> (Status, HashMap<String, PathBuf>) {
    let mut cache = VerifiedCache::load(user);
    let plan = plan(bundled, user, &mut |path, locked| {
        cache.matches(path, locked)
    });
    cache.save(user);

    let mut status = Status::default();
    let mut resolved = HashMap::new();
    for (name, action) in plan {
        match action {
            Action::Use(path) => {
                resolved.insert(name, path);
            }
            Action::Copy(_) => status.copy.push(name),
            Action::Download => {
                status.download_size += LOCK.files[&name].download_size;
                status.download.push(name);
            }
        }
    }
    (status, resolved)
}

/// Decides, for each pinned file, whether to use, copy or download it.
fn plan(
    bundled: &Path,
    user: &Path,
    matches: &mut dyn FnMut(&Path, &LockedFile) -> bool,
) -> Vec<(String, Action)> {
    let mut plan = Vec::new();
    let group: Vec<&String> = LOCK
        .files
        .keys()
        .filter(|name| MPV_GROUP.contains(&name.as_str()))
        .collect();
    let all_match = |dir: &Path, matches: &mut dyn FnMut(&Path, &LockedFile) -> bool| {
        group
            .iter()
            .all(|name| matches(&dir.join(name), &LOCK.files[*name]))
    };
    // mpv and its companions come from one folder: the installed one if it's all
    // current, otherwise LubaTV's own folder, filled from the installed one where possible.
    if all_match(bundled, matches) {
        plan.extend(
            group
                .iter()
                .map(|name| ((*name).clone(), Action::Use(bundled.join(name)))),
        );
    } else {
        for name in &group {
            plan.push(((*name).clone(), place(name, bundled, user, matches)));
        }
    }
    for (name, locked) in &LOCK.files {
        if group.contains(&name) {
            continue;
        }
        let action = if matches(&bundled.join(name), locked) {
            Action::Use(bundled.join(name))
        } else {
            place(name, bundled, user, matches)
        };
        plan.push((name.clone(), action));
    }
    plan
}

/// How to get a file into LubaTV's own folder.
fn place(
    name: &str,
    bundled: &Path,
    user: &Path,
    matches: &mut dyn FnMut(&Path, &LockedFile) -> bool,
) -> Action {
    let locked = &LOCK.files[name];
    if matches(&user.join(name), locked) {
        Action::Use(user.join(name))
    } else if matches(&bundled.join(name), locked) {
        Action::Copy(bundled.join(name))
    } else {
        Action::Download
    }
}

/// Copies and downloads what check() found missing, reporting download progress to the
/// frontend, then checks again.
pub async fn sync(app: AppHandle) -> Result<Status> {
    let _guard = SYNC.lock().await;
    if tauri::async_runtime::spawn_blocking(check)
        .await??
        .up_to_date()
    {
        return Ok(Status::default());
    }
    let report = |progress: Progress| _ = app.emit(PROGRESS_EVENT, progress);
    sync_in(deps_dir(), user_dir()?, &report).await?;
    tauri::async_runtime::spawn_blocking(check).await?
}

/// sync() for a given installed folder and LubaTV folder. Returns what's still missing.
async fn sync_in(
    bundled: PathBuf,
    user: PathBuf,
    report: &(dyn Fn(Progress) + Sync),
) -> Result<Status> {
    let status = {
        let (bundled, user) = (bundled.clone(), user.clone());
        tauri::async_runtime::spawn_blocking(move || check_in(&bundled, &user).0).await?
    };
    if status.up_to_date() {
        return Ok(status);
    }
    fs::create_dir_all(&user).with_context(|| format!("could not create {}", user.display()))?;

    for name in &status.copy {
        let (from, to) = (bundled.join(name), user.join(name));
        tauri::async_runtime::spawn_blocking(move || copy_verified(&from, &to)).await??;
    }

    let total = status.download_size;
    let mut downloaded = 0;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()?;
    for name in &status.download {
        let url = format!("{DOWNLOAD_BASE}/{}/{name}.gz", LOCK.files[name].release);
        let gz = user.join(format!("{name}.gz.part"));
        let mut response = client
            .get(&url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .with_context(|| format!("could not download {url}"))?;
        let mut file = tokio::fs::File::create(&gz).await?;
        let mut last_report = Instant::now();
        while let Some(chunk) = response
            .chunk()
            .await
            .with_context(|| format!("the download of {name} was interrupted"))?
        {
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;
            if last_report.elapsed() > Duration::from_millis(250) {
                last_report = Instant::now();
                report(Progress { downloaded, total });
            }
        }
        file.flush().await?;
        drop(file);
        let (name, user) = (name.clone(), user.clone());
        tauri::async_runtime::spawn_blocking(move || unpack_verified(&name, &user)).await??;
    }
    report(Progress {
        downloaded: total,
        total,
    });
    Ok(tauri::async_runtime::spawn_blocking(move || check_in(&bundled, &user).0).await?)
}

/// Copies a file and checks that the copy matches its pinned checksum.
fn copy_verified(from: &Path, to: &Path) -> Result<()> {
    let name = to.file_name().unwrap().to_string_lossy().to_string();
    let part = to.with_extension("part");
    let mut input =
        File::open(from).with_context(|| format!("could not read {}", from.display()))?;
    let mut output = File::create(&part)?;
    let hash = copy_hashing(&mut input, &mut output)?;
    finish(&name, &hash, &part, to)
}

/// Unpacks `<name>.gz.part` into `<name>` and checks its checksum.
fn unpack_verified(name: &str, dir: &Path) -> Result<()> {
    let gz = dir.join(format!("{name}.gz.part"));
    let part = dir.join(format!("{name}.part"));
    let mut input = GzDecoder::new(io::BufReader::new(File::open(&gz)?));
    let mut output = File::create(&part)?;
    let hash =
        copy_hashing(&mut input, &mut output).with_context(|| format!("{name} is damaged"))?;
    _ = fs::remove_file(&gz);
    finish(name, &hash, &part, &dir.join(name))
}

fn finish(name: &str, hash: &str, part: &Path, to: &Path) -> Result<()> {
    if hash != LOCK.files[name].sha256 {
        _ = fs::remove_file(part);
        bail!("{name} doesn't match its checksum, so it wasn't used");
    }
    if let Err(e) = fs::rename(part, to) {
        _ = fs::remove_file(part);
        return Err(e).with_context(|| {
            format!(
                "could not replace {}. If the player is open, close it and try again",
                to.display()
            )
        });
    }
    Ok(())
}

fn copy_hashing(input: &mut dyn Read, output: &mut dyn Write) -> Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let n = input.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        output.write_all(&buffer[..n])?;
    }
    output.flush()?;
    Ok(hex::encode(hasher.finalize()))
}

fn hash_file(path: &Path) -> Result<String> {
    copy_hashing(&mut File::open(path)?, &mut io::sink())
}

/// Checksums of files already read, by path, size and modification time, so starting
/// LubaTV doesn't read 250 MB of player files every time.
#[derive(Serialize, Deserialize, Default)]
struct VerifiedCache {
    files: HashMap<String, Verified>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
struct Verified {
    size: u64,
    modified: u64,
    sha256: String,
}

impl VerifiedCache {
    fn load(dir: &Path) -> Self {
        fs::read_to_string(dir.join(VERIFIED_CACHE))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(&self, dir: &Path) {
        if fs::create_dir_all(dir).is_ok()
            && let Ok(json) = serde_json::to_string(self)
        {
            _ = fs::write(dir.join(VERIFIED_CACHE), json);
        }
    }

    fn matches(&mut self, path: &Path, locked: &LockedFile) -> bool {
        let Ok(meta) = fs::metadata(path) else {
            return false;
        };
        if meta.len() != locked.size {
            return false;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs());
        let key = path.to_string_lossy().to_string();
        if let Some(seen) = self.files.get(&key)
            && seen.size == meta.len()
            && seen.modified == modified
        {
            return seen.sha256 == locked.sha256;
        }
        match hash_file(path) {
            Ok(sha256) => {
                let matches = sha256 == locked.sha256;
                self.files.insert(
                    key,
                    Verified {
                        size: meta.len(),
                        modified,
                        sha256,
                    },
                );
                matches
            }
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pretends the files named in `present` match their checksums in that folder.
    fn plan_with(present: &[(&str, &str)]) -> Vec<(String, Action)> {
        let (bundled, user) = (Path::new("B"), Path::new("U"));
        let mut matches = |path: &Path, _: &LockedFile| {
            let dir = path.parent().unwrap().to_string_lossy().to_string();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            present.iter().any(|(d, n)| *d == dir && *n == name)
        };
        plan(bundled, user, &mut matches)
    }

    fn action<'a>(plan: &'a [(String, Action)], name: &str) -> &'a Action {
        &plan.iter().find(|(n, _)| n == name).unwrap().1
    }

    const ALL: [&str; 4] = ["ffmpeg.exe", "mpv.exe", "vulkan-1.dll", "yt-dlp.exe"];

    #[test]
    fn lock_lists_the_player_files() {
        let names: Vec<&str> = LOCK.files.keys().map(String::as_str).collect();
        assert_eq!(names, ALL);
        assert!(
            LOCK.files
                .values()
                .all(|f| f.release.starts_with("player-files-")
                    && f.sha256.len() == 64
                    && f.size > 0
                    && f.download_size > 0)
        );
    }

    #[test]
    fn current_installed_files_are_used_as_they_are() {
        let present: Vec<_> = ALL.iter().map(|n| ("B", *n)).collect();
        let plan = plan_with(&present);
        for name in ALL {
            assert_eq!(action(&plan, name), &Action::Use(Path::new("B").join(name)));
        }
    }

    #[test]
    fn only_changed_files_are_downloaded() {
        // A new mpv: the rest of its group is copied next to it, not downloaded.
        let plan = plan_with(&[
            ("B", "ffmpeg.exe"),
            ("B", "vulkan-1.dll"),
            ("B", "yt-dlp.exe"),
        ]);
        assert_eq!(action(&plan, "mpv.exe"), &Action::Download);
        assert_eq!(
            action(&plan, "vulkan-1.dll"),
            &Action::Copy(Path::new("B").join("vulkan-1.dll"))
        );
        assert_eq!(
            action(&plan, "yt-dlp.exe"),
            &Action::Copy(Path::new("B").join("yt-dlp.exe"))
        );
        assert_eq!(
            action(&plan, "ffmpeg.exe"),
            &Action::Use(Path::new("B").join("ffmpeg.exe"))
        );
    }

    #[test]
    fn files_already_downloaded_are_kept() {
        // After an update removed the installed copies (MSI), everything is in LubaTV's folder.
        let present: Vec<_> = ALL.iter().map(|n| ("U", *n)).collect();
        let plan = plan_with(&present);
        for name in ALL {
            assert_eq!(action(&plan, name), &Action::Use(Path::new("U").join(name)));
        }
        // Nothing anywhere: everything downloads.
        let plan = plan_with(&[]);
        assert!(plan.iter().all(|(_, a)| *a == Action::Download));
    }

    /// Downloads from the real player-files release. Needs the files shipped in v1.3.1
    /// (`msiexec /a` the v1.3.1 MSI): LUBATV_TEST_BUNDLED=<folder with them>.
    #[tokio::test]
    #[ignore = "downloads about 28 MB"]
    async fn only_a_changed_file_is_downloaded() {
        let source =
            PathBuf::from(std::env::var("LUBATV_TEST_BUNDLED").expect("set LUBATV_TEST_BUNDLED"));
        let root = std::env::temp_dir().join(format!("lubatv-player-sync-{}", std::process::id()));
        let (bundled, user) = (root.join("deps"), root.join("player"));
        fs::create_dir_all(&bundled).unwrap();
        for name in ALL {
            fs::copy(source.join(name), bundled.join(name)).unwrap();
        }
        // As if this release pinned a different mpv than the one installed.
        fs::write(bundled.join("mpv.exe"), b"an older mpv").unwrap();

        let (status, _) = check_in(&bundled, &user);
        assert_eq!(status.download, ["mpv.exe"]);
        assert_eq!(status.copy, ["vulkan-1.dll", "yt-dlp.exe"]);
        assert_eq!(status.download_size, LOCK.files["mpv.exe"].download_size);

        let reports = std::sync::Mutex::new(Vec::new());
        let report = |p: Progress| reports.lock().unwrap().push(p);
        let left = sync_in(bundled.clone(), user.clone(), &report)
            .await
            .unwrap();
        assert!(left.up_to_date(), "{left:?}");
        let last = reports.lock().unwrap().last().cloned().unwrap();
        assert_eq!(
            (last.downloaded, last.total),
            (status.download_size, status.download_size)
        );

        let (status, resolved) = check_in(&bundled, &user);
        assert!(status.up_to_date());
        for name in ["mpv.exe", "vulkan-1.dll", "yt-dlp.exe"] {
            assert_eq!(
                resolved[name],
                user.join(name),
                "{name} is used from LubaTV's folder"
            );
        }
        assert_eq!(
            resolved["ffmpeg.exe"],
            bundled.join("ffmpeg.exe"),
            "ffmpeg wasn't touched"
        );
        assert!(!user.join("ffmpeg.exe").exists());
        let leftovers: Vec<_> = fs::read_dir(&user)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(
            leftovers.len(),
            4,
            "3 player files and the checksum cache: {leftovers:?}"
        );
        _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unpacks_and_verifies_a_download() {
        let dir = std::env::temp_dir().join(format!("lubatv-player-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        // vulkan-1.dll is small enough to fake: a wrong file must be rejected.
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(b"not the real file").unwrap();
        fs::write(dir.join("vulkan-1.dll.gz.part"), gz.finish().unwrap()).unwrap();
        let error = unpack_verified("vulkan-1.dll", &dir)
            .unwrap_err()
            .to_string();
        assert!(error.contains("doesn't match its checksum"), "{error}");
        assert!(!dir.join("vulkan-1.dll").exists());
        assert!(!dir.join("vulkan-1.dll.part").exists());
        _ = fs::remove_dir_all(&dir);
    }
}
