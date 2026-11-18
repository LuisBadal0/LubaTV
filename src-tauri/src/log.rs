use chrono::Local;
use regex::Regex;
use std::{fs, sync::LazyLock};

static USE_LOGGER: LazyLock<bool> = LazyLock::new(init_logger);

/// Shown in place of a username, password or token.
const HIDDEN: &str = "***";

/// `username=...`, `password=...` and the like, in a query string or anywhere else.
static SECRET_PARAM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\b(username|user|password|pass|pwd|token|auth)=[^&\s"'#)\]]*"#).unwrap()
});
/// `scheme://user:password@host`.
static USER_INFO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"://[^/\s:@"']+:[^/\s@"']*@"#).unwrap());
/// Xtream stream links: `/live/<user>/<password>/`, also for movies, series and catch-up.
static XTREAM_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)/(live|movie|series|timeshift)/[^/\s"'?]+/[^/\s"'?]+/"#).unwrap()
});
/// Xtream links without a type, as many M3U playlists list them: `host/<user>/<password>/<id>`.
static XTREAM_SHORT_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(://[^/\s"']+)/[^/\s"'?]+/[^/\s"'?]+/(\d+(?:\.\w+)?)\b"#).unwrap()
});

/// Removes credentials from text that may contain provider links: logs and error messages.
/// IPTV links usually carry the account's username and password, so they must never be
/// written to the log or shown in the window as they are.
pub fn redact(text: &str) -> String {
    let text = SECRET_PARAM.replace_all(text, format!("${{1}}={HIDDEN}"));
    let text = USER_INFO.replace_all(&text, format!("://{HIDDEN}:{HIDDEN}@"));
    let text = XTREAM_PATH.replace_all(&text, format!("/${{1}}/{HIDDEN}/{HIDDEN}/"));
    XTREAM_SHORT_PATH
        .replace_all(&text, format!("${{1}}/{HIDDEN}/{HIDDEN}/${{2}}"))
        .into_owned()
}

pub fn log(message: String) {
    let message = redact(&message);
    if *USE_LOGGER {
        log::error!("{message}");
    } else {
        eprintln!("{message}");
    }
}

fn init_logger() -> bool {
    let file = match get_and_create_log_path().and_then(|path| Ok(fs::File::create(path)?)) {
        Ok(val) => val,
        Err(e) => {
            eprint!("Failed to create file for logger, {:?}", e);
            return false;
        }
    };
    match simplelog::WriteLogger::init(
        simplelog::LevelFilter::Error,
        simplelog::Config::default(),
        file,
    ) {
        Ok(_) => true,
        Err(e) => {
            eprint!("Failed to init logger, {:?}", e);
            false
        }
    }
}

fn get_and_create_log_path() -> anyhow::Result<String> {
    let mut path = crate::utils::project_dirs()?.cache_dir().to_owned();
    path.push("logs");
    if !path.exists() {
        std::fs::create_dir_all(&path)?;
    }
    path.push(get_log_name());
    Ok(path.to_string_lossy().to_string())
}

fn get_log_name() -> String {
    let current_time = Local::now();
    let formatted_time = current_time.format("%Y-%m-%d-%H-%M-%S").to_string();
    format!("{formatted_time}.log")
}

#[cfg(test)]
mod test_log {
    use super::redact;

    const USER: &str = "jdoe42";
    const PASS: &str = "s3cr3tPass";

    fn assert_hidden(text: &str) {
        let redacted = redact(text);
        assert!(
            !redacted.contains(USER) && !redacted.contains(PASS),
            "credentials left in: {redacted}"
        );
    }

    #[test]
    fn test_redact_api_queries() {
        assert_eq!(
            redact(
                "http://iptv.example:8080/player_api.php?username=jdoe42&password=s3cr3tPass&action=get_live_streams"
            ),
            "http://iptv.example:8080/player_api.php?username=***&password=***&action=get_live_streams"
        );
        assert_hidden("get.php?user=jdoe42&pass=s3cr3tPass&type=m3u_plus");
        assert_hidden(r#"Url { query: Some("password=s3cr3tPass&username=jdoe42") }"#);
        assert_hidden("timeshift.php?username=jdoe42&password=s3cr3tPass&stream=1");
        assert_hidden("token=s3cr3tPass auth=jdoe42");
    }

    #[test]
    fn test_redact_stream_paths() {
        assert_eq!(
            redact("Failed to play http://iptv.example:8080/live/jdoe42/s3cr3tPass/1234.ts"),
            "Failed to play http://iptv.example:8080/live/***/***/1234.ts"
        );
        assert_hidden("http://iptv.example/movie/jdoe42/s3cr3tPass/55.mkv");
        assert_hidden("http://iptv.example/series/jdoe42/s3cr3tPass/7.mp4");
        assert_hidden("http://iptv.example/timeshift/jdoe42/s3cr3tPass/60/2026-11-18:20-00/9.ts");
        assert_eq!(
            redact("mpv: http://iptv.example:8080/jdoe42/s3cr3tPass/1234"),
            "mpv: http://iptv.example:8080/***/***/1234"
        );
        assert_eq!(
            redact("https://jdoe42:s3cr3tPass@iptv.example/list.m3u"),
            "https://***:***@iptv.example/list.m3u"
        );
    }

    #[test]
    fn test_redact_leaves_other_text() {
        for text in [
            "Failed to set group id for channel: Test News One, Error: no group",
            "Could not raise the mpv window: pipe closed",
            "https://github.com/LuisBadal0/LubaTV/releases/latest/download/latest.json",
            "http://127.0.0.1:8765/playlist.m3u",
        ] {
            assert_eq!(redact(text), text);
        }
    }

    #[tokio::test]
    async fn test_redact_reqwest_error() {
        // A failed Xtream request, as the log and the window would get it.
        let error = reqwest::Client::new()
            .get(format!(
                "http://127.0.0.1:9/player_api.php?username={USER}&password={PASS}"
            ))
            .send()
            .await
            .unwrap_err();
        let text = format!("{:?}", anyhow::Error::from(error));
        assert!(text.contains(PASS), "the raw error should hold the link");
        assert_hidden(&text);
    }
}
