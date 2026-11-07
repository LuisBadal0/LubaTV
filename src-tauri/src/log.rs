use chrono::Local;
use std::{fs, sync::LazyLock};

static USE_LOGGER: LazyLock<bool> = LazyLock::new(init_logger);

pub fn log(message: String) {
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
