//! Plays channels in mpv windows.
//!
//! Each window is an mpv process that LubaTV can talk to through mpv's JSON IPC. When a
//! new channel would stop the one playing in a window (its source is at its stream
//! limit), LubaTV sends the new channel to that window instead of closing it and starting
//! another mpv. A window still lives exactly as long as it has something to play: it
//! closes when the user closes it or playback ends, and LubaTV closes the rest when it exits.

use crate::settings::get_default_record_path;
use crate::types::{AppState, ChannelHttpHeaders, Source};
use crate::utils::{bin_start_error, find_macos_bin, get_bin};
use crate::{log, sql};
use crate::{media_type, settings::get_settings, types::Channel};
use anyhow::{Context, Result, anyhow, bail};
use chrono::Local;
use serde_json::{Value, json};

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use std::{env::consts::OS, path::Path, process::Stdio};
use tauri::State;
use tokio::process::{Child, ChildStdout};
use tokio::sync::{Mutex, watch};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};
use tokio_util::sync::CancellationToken;

// Options for the whole mpv process. A window is only reused while these stay the same.
const ARG_MSG_LEVEL: &str = "--msg-level=all=error";
const ARG_YTDLP_PATH: &str = "--script-opts=ytdl_hook-ytdl_path=";
const ARG_VOLUME: &str = "--volume=";
const ARG_HWDEC: &str = "--hwdec=auto";
const ARG_GPU_NEXT: &str = "--vo=gpu-next";
const ARG_GPU_PROFILE_HIGH_QUALITY: &str = "--profile=high-quality";
const ARG_IPC_SERVER: &str = "--input-ipc-server=";
const ARG_FILES_START: &str = "--{";
const ARG_FILES_END: &str = "--}";

// Options for the files of one channel only, so they don't carry over to the next channel
// shown in the same window. Passed as `--name=value` inside `--{ ... --}`, or as loadfile options.
const OPT_SAVE_POSITION_ON_QUIT: &str = "save-position-on-quit";
const OPT_RESUME_PLAYBACK: &str = "resume-playback";
const OPT_CACHE: &str = "cache";
const OPT_RECORD: &str = "stream-record";
const OPT_TITLE: &str = "title";
const OPT_HTTP_HEADERS: &str = "http-header-fields";
const OPT_USER_AGENT: &str = "user-agent";
const OPT_YTDL_RAW_OPTIONS: &str = "ytdl-raw-options";
const IGNORE_SSL: &str = "no-check-certificates=True";
const YES: &str = "yes";
const NO: &str = "no";

// Playlist behaviour for live channels. These must apply to the whole process (as
// file-local options mpv resets them before it decides what to play next), so they are
// set again each time a window gets a new channel.
const PROP_LOOP_PLAYLIST: &str = "loop-playlist";
const PROP_PREFETCH_PLAYLIST: &str = "prefetch-playlist";

const MPV_BIN_NAME: &str = "mpv";
const YTDLP_BIN_NAME: &str = "yt-dlp";
const HTTP_ORIGIN: &str = "origin:";
const HTTP_REFERRER: &str = "referer:";
const UNKNOWN_ERROR: &str = "Mpv encountered an unknown error";
/// Error output kept per channel, so a chatty stream can't grow it without bound.
const MAX_OUTPUT: usize = 16 * 1024;
static MPV_PATH: LazyLock<String> = LazyLock::new(|| get_bin(MPV_BIN_NAME));
static YTDLP_PATH: LazyLock<String> = LazyLock::new(|| find_macos_bin(YTDLP_BIN_NAME));

/// The open mpv windows.
static WINDOWS: LazyLock<std::sync::Mutex<Vec<Arc<Window>>>> = LazyLock::new(Default::default);
/// Numbers windows and play() calls.
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub async fn play(
    channel: Channel,
    record: bool,
    record_path: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<()> {
    eprintln!(
        "{} playing",
        channel.url.as_ref().context("no channel url")?
    );
    let source = channel
        .source_id
        .and_then(|id| {
            sql::get_source_from_id(id)
                .with_context(|| format!("failed to fetch source with id {}", id))
                .ok()
        })
        .or(None);
    let args = get_play_args(&channel, record, record_path, &source)?;
    eprintln!("with args: {:?}", args);

    let key = channel.id.context("no channel id")?.to_string();
    let source_id = source.as_ref().and_then(|s| s.id);
    let owner = Owner {
        session: NEXT_ID.fetch_add(1, Ordering::Relaxed),
        source_id,
        key: key.clone(),
        save_position: args.save_position,
    };
    let session = owner.session;

    // At the source's stream limit, the oldest stream makes way for this one. If it is
    // playing in a window, show this channel in that window instead of opening another.
    let mut window = None;
    if let Some(source) = source.as_ref() {
        match crate::utils::take_oldest_stream(source, &state).await {
            Ok(Some((old_key, old_token))) => {
                window = take_over(source_id, &old_key, owner.clone(), &args).await;
                // Stops the old stream. If its window was taken over, it is no longer that
                // stream's to close, so only its play() call returns.
                old_token.cancel();
            }
            Ok(None) => {}
            Err(e) => log::log(format!("{:?}", e)),
        }
    }
    let window = match window {
        Some(window) => window,
        None => Window::open(&args, owner)?,
    };

    let token = CancellationToken::new();
    if let Some(source_id) = source_id {
        _ = crate::utils::insert_play_token(source_id, key.clone(), token.clone(), &state)
            .await
            .map_err(|e| log::log(format!("{:?}", e)));
    }

    let result = window.wait(session, &token).await;

    // A cancelled token was already removed (by cancel_play, or by the stream that
    // replaced this one), and its key may now belong to a newer stream of the same channel.
    if let Some(source_id) = source_id {
        if !token.is_cancelled() {
            _ = crate::utils::remove_from_play_stop(state, &source_id, &key)
                .await
                .map_err(|e| log::log(format!("{:?}", e)));
        }
    }
    result
}

pub async fn cancel_play(
    source_id: i64,
    key: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<()> {
    log::log(format!("Cancelling play for channel: {}", key));
    let token = crate::utils::remove_from_play_stop(state, &source_id, &key).await?;
    let token = token.context("no channel found")?;
    token.cancel();
    Ok(())
}

/// Closes every mpv window LubaTV opened. Called when LubaTV exits.
pub fn close_all() {
    let windows: Vec<Arc<Window>> = WINDOWS.lock().unwrap().clone();
    if windows.is_empty() {
        return;
    }
    for window in &windows {
        window.close.cancel();
    }
    tauri::async_runtime::block_on(async {
        let all_exited = futures::future::join_all(windows.iter().map(|w| w.exited.cancelled()));
        _ = tokio::time::timeout(Duration::from_secs(3), all_exited).await;
    });
}

/// Shows the new channel in the window playing `key` of this source, if there is one that
/// was started with the same process-wide options. Returns the window on success.
async fn take_over(
    source_id: Option<i64>,
    key: &str,
    owner: Owner,
    args: &PlayArgs,
) -> Option<Arc<Window>> {
    let window = WINDOWS
        .lock()
        .unwrap()
        .iter()
        .find(|window| {
            let current = window.owner.borrow();
            !window.exited.is_cancelled()
                && window.global == args.global
                && current.source_id == source_id
                && current.key == key
        })
        .cloned()?;
    match window.load(owner, args).await {
        Ok(()) => Some(window),
        Err(e) => {
            log::log(format!(
                "Could not switch the mpv window to the new channel, opening a new one: {:?}",
                e
            ));
            // The old channel must stop either way, and it no longer owns the window.
            window.close.cancel();
            None
        }
    }
}

/// What is playing in a window: one play() call.
#[derive(Clone, Debug)]
struct Owner {
    session: u64,
    source_id: Option<i64>,
    key: String,
    save_position: bool,
}

/// An mpv process and its window.
struct Window {
    ipc_path: String,
    /// The process-wide options it was started with.
    global: Vec<String>,
    owner: watch::Sender<Owner>,
    /// Cancel to close the window.
    close: CancellationToken,
    /// Cancelled once mpv has exited.
    exited: CancellationToken,
    /// mpv's error output since the current channel started.
    output: std::sync::Mutex<String>,
    /// The error mpv exited with, if it failed.
    exit_error: std::sync::Mutex<Option<String>>,
}

impl Window {
    fn open(args: &PlayArgs, owner: Owner) -> Result<Arc<Window>> {
        let ipc_path = ipc::path(NEXT_ID.fetch_add(1, Ordering::Relaxed));
        let mut child = Command::new(MPV_PATH.clone())
            .args(args.command_line(&ipc_path))
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| bin_start_error(MPV_BIN_NAME, &MPV_PATH))?;
        let stdout = child.stdout.take();
        let window = Arc::new(Window {
            ipc_path,
            global: args.global.clone(),
            owner: watch::Sender::new(owner),
            close: CancellationToken::new(),
            exited: CancellationToken::new(),
            output: Default::default(),
            exit_error: Default::default(),
        });
        WINDOWS.lock().unwrap().push(window.clone());
        tauri::async_runtime::spawn(window.clone().run(child, stdout));
        Ok(window)
    }

    /// Watches the mpv process until it exits or the window is closed.
    async fn run(self: Arc<Self>, mut child: Child, stdout: Option<ChildStdout>) {
        let reader = tauri::async_runtime::spawn({
            let window = self.clone();
            async move {
                let Some(stdout) = stdout else { return };
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let mut output = window.output.lock().unwrap();
                    if output.len() < MAX_OUTPUT {
                        if !output.is_empty() {
                            output.push('\n');
                        }
                        output.push_str(&line);
                    }
                }
            }
        });
        let status = tokio::select! {
            status = child.wait() => Some(status),
            _ = self.close.cancelled() => {
                _ = child.kill().await;
                None
            }
        };
        // Helpers mpv started (yt-dlp) can keep the output open, so don't wait long for it.
        _ = tokio::time::timeout(Duration::from_secs(1), reader).await;
        let error = match status {
            // Closed by LubaTV.
            None => None,
            Some(Ok(status)) if status.success() => None,
            Some(Ok(_)) => {
                let output = std::mem::take(&mut *self.output.lock().unwrap());
                Some(if output.is_empty() {
                    UNKNOWN_ERROR.to_string()
                } else {
                    output
                })
            }
            Some(Err(e)) => Some(format!("{:?}", e)),
        };
        *self.exit_error.lock().unwrap() = error;
        WINDOWS
            .lock()
            .unwrap()
            .retain(|window| !Arc::ptr_eq(window, &self));
        if cfg!(unix) {
            _ = std::fs::remove_file(&self.ipc_path);
        }
        self.exited.cancel();
    }

    /// Replaces what the window plays with a new channel.
    async fn load(&self, owner: Owner, args: &PlayArgs) -> Result<()> {
        if self.exited.is_cancelled() {
            bail!("mpv has exited");
        }
        let previous = self.owner.send_replace(owner);
        self.output.lock().unwrap().clear();

        let mut commands = Vec::new();
        if previous.save_position {
            commands.push(json!(["write-watch-later-config"]));
        }
        commands.push(json!([
            "set_property",
            PROP_LOOP_PLAYLIST,
            if args.live { "inf" } else { NO }
        ]));
        commands.push(json!(["set_property", PROP_PREFETCH_PLAYLIST, args.live]));
        let first_load = commands.len();
        let options = args.loadfile_options();
        for (i, url) in args.urls.iter().enumerate() {
            commands.push(json!({
                "name": "loadfile",
                "url": url,
                "flags": if i == 0 { "replace" } else { "append" },
                "options": options,
            }));
        }
        commands.push(json!(["get_property", "ontop"]));

        let replies = ipc::send(&self.ipc_path, &commands).await?;
        if !ipc::succeeded(&replies[first_load]) {
            bail!("mpv did not load the channel: {}", replies[first_load]);
        }
        // The click came from LubaTV, so the window may be behind it. Pinning it on top
        // and unpinning it brings it to the front without changing its setting.
        let ontop = replies.last().and_then(|r| r.get("data")).and_then(Value::as_bool);
        if ontop == Some(false) {
            _ = ipc::send(
                &self.ipc_path,
                &[
                    json!(["set_property", "ontop", true]),
                    json!(["set_property", "ontop", false]),
                ],
            )
            .await
            .map_err(|e| log::log(format!("Could not raise the mpv window: {:?}", e)));
        }
        Ok(())
    }

    /// Waits until this play() call is over: mpv exits, another channel replaces it in
    /// the window, or it is cancelled. Returns mpv's error if it failed while playing it.
    async fn wait(&self, session: u64, token: &CancellationToken) -> Result<()> {
        let mut owner = self.owner.subscribe();
        tokio::select! {
            _ = self.exited.cancelled() => {
                if self.owner.borrow().session != session {
                    return Ok(());
                }
                let error = self.exit_error.lock().unwrap().take();
                match error {
                    Some(error) => Err(anyhow!(error)),
                    None => Ok(()),
                }
            }
            _ = replaced(&mut owner, session) => Ok(()),
            _ = token.cancelled() => {
                if self.owner.borrow().session == session {
                    self.close.cancel();
                    self.exited.cancelled().await;
                }
                Ok(())
            }
        }
    }
}

/// Resolves once the window shows something other than `session`.
async fn replaced(owner: &mut watch::Receiver<Owner>, session: u64) {
    loop {
        if owner.borrow_and_update().session != session {
            return;
        }
        if owner.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

#[derive(Debug)]
struct PlayArgs {
    /// The channel, followed by the next episodes for a series.
    urls: Vec<String>,
    file_options: Vec<(&'static str, String)>,
    global: Vec<String>,
    live: bool,
    save_position: bool,
}

impl PlayArgs {
    /// Arguments for a new mpv window.
    fn command_line(&self, ipc_path: &str) -> Vec<String> {
        let mut args = self.global.clone();
        if self.live {
            args.push(format!("--{PROP_LOOP_PLAYLIST}=inf"));
            args.push(format!("--{PROP_PREFETCH_PLAYLIST}={YES}"));
        }
        args.push(format!("{ARG_IPC_SERVER}{ipc_path}"));
        // Options inside --{ ... --} only apply to these files.
        args.push(ARG_FILES_START.to_string());
        for (name, value) in &self.file_options {
            args.push(format!("--{name}={value}"));
        }
        args.extend(self.urls.iter().cloned());
        args.push(ARG_FILES_END.to_string());
        args
    }

    /// The per-file options for loadfile, as an mpv key-value list. Each value is quoted
    /// with its length (`%N%value`), so it can contain commas and equals signs.
    fn loadfile_options(&self) -> String {
        self.file_options
            .iter()
            .map(|(name, value)| format!("{name}=%{}%{value}", value.len()))
            .collect::<Vec<_>>()
            .join(",")
    }
}

fn get_play_args(
    channel: &Channel,
    record: bool,
    record_path: Option<String>,
    source: &Option<Source>,
) -> Result<PlayArgs> {
    let settings = get_settings()?;
    let headers = sql::get_channel_headers_by_id(channel.id.context("no channel id?")?)?;
    let live = channel.media_type == media_type::LIVESTREAM;

    let mut urls = vec![channel.url.clone().context("no url")?];
    let mut file_options = Vec::new();
    if channel.episode_num.is_some() {
        urls.extend(sql::find_all_episodes_after(channel)?);
        file_options.push((OPT_RESUME_PLAYBACK, NO.to_string()));
    }
    let save_position = !live;
    if save_position {
        file_options.push((OPT_SAVE_POSITION_ON_QUIT, YES.to_string()));
    }
    if settings.use_stream_caching == Some(false) {
        file_options.push((OPT_CACHE, NO.to_string()));
    }
    if record {
        let path = if let Some(p) = record_path {
            p
        } else if let Some(p) = settings.recording_path.map(get_path) {
            p
        } else {
            get_path(get_default_record_path()?)
        };
        file_options.push((OPT_RECORD, path));
    }
    file_options.push((OPT_TITLE, channel.name.clone()));
    if headers.is_some() || source.is_some() {
        set_headers(headers, &mut file_options, source);
    }

    let mut global = Vec::new();
    if settings.enable_hwdec.unwrap_or(true) {
        global.push(ARG_HWDEC.to_string());
    }
    if settings.enable_gpu.unwrap_or(false) {
        global.push(ARG_GPU_NEXT.to_string());
        global.push(ARG_GPU_PROFILE_HIGH_QUALITY.to_string());
    }
    if OS == "macos" && *MPV_PATH != MPV_BIN_NAME {
        global.push(format!("{}{}", ARG_YTDLP_PATH, *YTDLP_PATH));
    }
    global.push(ARG_MSG_LEVEL.to_string());
    if let Some(volume) = settings.volume {
        global.push(format!("{ARG_VOLUME}{volume}"));
    }
    if let Some(mpv_params) = settings.mpv_params {
        #[cfg(not(target_os = "windows"))]
        let mut params = shell_words::split(&mpv_params)?;
        #[cfg(target_os = "windows")]
        let mut params = winsplit::split(&mpv_params);
        global.append(&mut params);
    }
    Ok(PlayArgs {
        urls,
        file_options,
        global,
        live,
        save_position,
    })
}

fn set_headers(
    headers: Option<ChannelHttpHeaders>,
    options: &mut Vec<(&'static str, String)>,
    source: &Option<Source>,
) {
    let headers = headers.unwrap_or_default();
    let mut headers_vec: Vec<String> = Vec::with_capacity(2);
    if let Some(origin) = headers.http_origin {
        headers_vec.push(format!("{HTTP_ORIGIN}{origin}"));
    }
    if let Some(referrer) = headers.referrer {
        headers_vec.push(format!("{HTTP_REFERRER}{referrer}"));
    }
    if let Some(user_agent) = headers
        .user_agent
        .or_else(|| source.as_ref().and_then(|f| f.stream_user_agent.clone()))
    {
        options.push((OPT_USER_AGENT, user_agent));
    }
    if headers.ignore_ssl == Some(true) {
        options.push((OPT_YTDL_RAW_OPTIONS, IGNORE_SSL.to_string()));
    }
    if !headers_vec.is_empty() {
        options.push((OPT_HTTP_HEADERS, headers_vec.join(",")));
    }
}

fn get_path(path_str: String) -> String {
    let path = Path::new(&path_str);
    let path = path.join(get_file_name());
    return path.to_string_lossy().to_string();
}

fn get_file_name() -> String {
    let current_time = Local::now();
    let formatted_time = current_time.format("%Y-%m-%d-%H-%M-%S").to_string();
    format!("{formatted_time}.mp4")
}

/// mpv's JSON IPC: a named pipe on Windows, a Unix socket elsewhere.
mod ipc {
    use anyhow::{Context, Result};
    use serde_json::{Value, json};
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

    /// mpv creates the pipe shortly after it starts, so a channel picked right after
    /// opening a window may have to wait for it.
    const CONNECT_ATTEMPTS: u32 = 20;
    const CONNECT_RETRY: Duration = Duration::from_millis(50);
    const TIMEOUT: Duration = Duration::from_secs(5);

    pub fn path(id: u64) -> String {
        let name = format!("lubatv-mpv-{}-{id}", std::process::id());
        if cfg!(windows) {
            format!(r"\\.\pipe\{name}")
        } else {
            std::env::temp_dir()
                .join(format!("{name}.sock"))
                .to_string_lossy()
                .to_string()
        }
    }

    #[cfg(windows)]
    async fn connect(path: &str) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
        let mut attempt = 1;
        loop {
            match tokio::net::windows::named_pipe::ClientOptions::new().open(path) {
                Err(_) if attempt < CONNECT_ATTEMPTS => {
                    attempt += 1;
                    tokio::time::sleep(CONNECT_RETRY).await;
                }
                result => return result,
            }
        }
    }

    #[cfg(unix)]
    async fn connect(path: &str) -> std::io::Result<tokio::net::UnixStream> {
        let mut attempt = 1;
        loop {
            match tokio::net::UnixStream::connect(path).await {
                Err(_) if attempt < CONNECT_ATTEMPTS => {
                    attempt += 1;
                    tokio::time::sleep(CONNECT_RETRY).await;
                }
                result => return result,
            }
        }
    }

    /// Sends the commands and returns mpv's reply to each, in the same order.
    pub async fn send(path: &str, commands: &[Value]) -> Result<Vec<Value>> {
        tokio::time::timeout(TIMEOUT, async {
            let stream = connect(path).await.context("could not connect to mpv")?;
            exchange(stream, commands).await
        })
        .await
        .context("mpv did not answer")?
    }

    async fn exchange<S: AsyncRead + AsyncWrite>(stream: S, commands: &[Value]) -> Result<Vec<Value>> {
        let (read, mut write) = tokio::io::split(stream);
        let mut request = String::new();
        for (id, command) in commands.iter().enumerate() {
            request.push_str(&json!({ "command": command, "request_id": id }).to_string());
            request.push('\n');
        }
        write.write_all(request.as_bytes()).await?;

        let mut replies = vec![Value::Null; commands.len()];
        let mut pending = commands.len();
        let mut lines = BufReader::new(read).lines();
        while pending > 0 {
            let line = lines
                .next_line()
                .await?
                .context("mpv closed the connection")?;
            let Ok(reply) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            // Lines without a request_id are events.
            let Some(id) = reply.get("request_id").and_then(Value::as_u64) else {
                continue;
            };
            if let Some(slot) = replies.get_mut(id as usize) {
                if slot.is_null() {
                    pending -= 1;
                }
                *slot = reply;
            }
        }
        Ok(replies)
    }

    pub fn succeeded(reply: &Value) -> bool {
        reply.get("error").and_then(Value::as_str) == Some("success")
    }
}

/// These start real mpv windows (without video or audio output), so they need mpv:
/// `cargo test mpv -- --ignored`. On Windows, run scripts/fetch-windows-deps.ps1 first.
#[cfg(test)]
mod tests {
    use super::*;

    /// The window list is shared and close_all closes every window, so these run one at a time.
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn serial() -> std::sync::MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn args(url: &str, title: &str, extra: &[(&'static str, &str)]) -> PlayArgs {
        let mut file_options = vec![(OPT_TITLE, title.to_string())];
        file_options.extend(extra.iter().map(|(k, v)| (*k, v.to_string())));
        PlayArgs {
            urls: vec![url.to_string()],
            file_options,
            global: ["--vo=null", "--ao=null", ARG_MSG_LEVEL].map(String::from).to_vec(),
            live: true,
            save_position: false,
        }
    }

    fn owner(key: &str) -> Owner {
        Owner {
            session: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            source_id: Some(1),
            key: key.to_string(),
            save_position: false,
        }
    }

    async fn property(window: &Window, name: &str) -> Value {
        let reply = ipc::send(&window.ipc_path, &[json!(["get_property", name])])
            .await
            .unwrap();
        reply[0]["data"].clone()
    }

    /// Per-file options apply once mpv starts the file, shortly after loadfile returns.
    async fn eventually(window: &Window, name: &str, expected: &str) {
        for _ in 0..100 {
            if property(window, name).await == expected {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(property(window, name).await, expected);
    }

    const TEST_VIDEO: &str = "av://lavfi:testsrc=duration=60";

    #[tokio::test]
    #[ignore = "needs mpv"]
    async fn switching_channels_reuses_the_window() {
        let _serial = serial();
        let first = owner("1");
        let window = Window::open(
            &args(TEST_VIDEO, "First, channel", &[(OPT_USER_AGENT, "Agent/1")]),
            first.clone(),
        )
        .unwrap();
        eventually(&window, "title", "First, channel").await;
        assert_eq!(property(&window, "user-agent").await, "Agent/1");
        let first_play = {
            let window = window.clone();
            tokio::spawn(async move {
                window.wait(first.session, &CancellationToken::new()).await
            })
        };

        // A title with commas, equals signs and non-ASCII text survives the quoting.
        let second = owner("2");
        let title = "Second = canal, ação";
        window
            .load(second.clone(), &args("av://lavfi:testsrc2=duration=60", title, &[]))
            .await
            .unwrap();
        // The first play() call ends without an error, and the window keeps running.
        first_play.await.unwrap().unwrap();
        assert!(!window.exited.is_cancelled());
        eventually(&window, "title", title).await;
        assert_eq!(property(&window, "path").await, "av://lavfi:testsrc2=duration=60");
        // Per-file options of the first channel don't carry over.
        assert_ne!(property(&window, "user-agent").await, "Agent/1");
        assert_eq!(property(&window, "loop-playlist").await, "inf");

        // A channel that fails closes the window and reports mpv's error to its play() call.
        let third = owner("3");
        window
            .load(third.clone(), &args("http://nonexistent.invalid/stream.ts", "Broken", &[]))
            .await
            .unwrap();
        let error = window
            .wait(third.session, &CancellationToken::new())
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Failed to open"), "{error}");
        assert!(window.exited.is_cancelled());
        assert!(!WINDOWS.lock().unwrap().iter().any(|w| Arc::ptr_eq(w, &window)));
    }

    #[tokio::test]
    #[ignore = "needs mpv"]
    async fn cancelling_closes_the_window() {
        let _serial = serial();
        let first = owner("1");
        let window = Window::open(&args(TEST_VIDEO, "Channel", &[]), first.clone()).unwrap();
        let token = CancellationToken::new();
        let play = {
            let (window, token) = (window.clone(), token.clone());
            tokio::spawn(async move { window.wait(first.session, &token).await })
        };
        eventually(&window, "title", "Channel").await;
        token.cancel();
        play.await.unwrap().unwrap();
        assert!(window.exited.is_cancelled());
    }

    #[tokio::test]
    #[ignore = "needs mpv"]
    async fn cancelling_a_replaced_channel_keeps_the_window() {
        let _serial = serial();
        let first = owner("1");
        let window = Window::open(&args(TEST_VIDEO, "First", &[]), first.clone()).unwrap();
        let token = CancellationToken::new();
        window.load(owner("2"), &args(TEST_VIDEO, "Second", &[])).await.unwrap();
        token.cancel();
        window.wait(first.session, &token).await.unwrap();
        assert!(!window.exited.is_cancelled());
        eventually(&window, "title", "Second").await;
        window.close.cancel();
        window.exited.cancelled().await;
    }

    #[test]
    #[ignore = "needs mpv"]
    fn close_all_closes_every_window() {
        let _serial = serial();
        let windows: Vec<Arc<Window>> = tauri::async_runtime::block_on(async {
            (0..2)
                .map(|i| Window::open(&args(TEST_VIDEO, "Channel", &[]), owner(&i.to_string())).unwrap())
                .collect()
        });
        close_all();
        assert!(windows.iter().all(|w| w.exited.is_cancelled()));
        assert!(WINDOWS.lock().unwrap().is_empty());
    }
}
