//! The SQLite database: the connection pool, shared query helpers and transactions.
//! The queries themselves live in the submodules, re-exported here as `sql::*`.

use crate::log::log;
use crate::sort_type;
use crate::types::{
    ChannelPreserve, CustomChannel, CustomChannelExtraData, EPGNotify, ExportedGroup, Group,
    IdName, Season,
};
use crate::{
    media_type, source_type,
    types::{Channel, ChannelHttpHeaders, Filters, Source},
    view_type,
};
use anyhow::{Context, Result, anyhow};
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{OptionalExtension, Row, Transaction, params, params_from_iter};
use rusqlite_migration::{M, Migrations};
use std::time::Duration;
use std::vec;
use std::{collections::HashMap, sync::LazyLock};

mod channels;
mod custom;
mod epg;
mod schema;
mod search;
mod settings;
mod sources;

pub use channels::*;
pub use custom::*;
pub use epg::*;
pub use schema::*;
pub use search::*;
pub use settings::*;
pub use sources::*;

const PAGE_SIZE: u8 = 36;

pub const DB_NAME: &str = "db.sqlite";

static CONN: LazyLock<Pool<SqliteConnectionManager>> = LazyLock::new(create_connection_pool);

pub fn get_conn() -> Result<PooledConnection<SqliteConnectionManager>> {
    CONN.try_get().context("No sqlite conns available")
}

fn create_connection_pool() -> Pool<SqliteConnectionManager> {
    let manager = SqliteConnectionManager::file(get_and_create_sqlite_db_path())
        .with_init(configure_connection);
    r2d2::Pool::builder()
        .max_size(20)
        .build(manager)
        .expect("Couldn't open LubaTV's database")
}

/// WAL lets searches keep reading the last committed data while a source refresh
/// writes in a long transaction; without it readers get "database is locked".
/// NORMAL sync is crash-safe in WAL mode and avoids an fsync on every commit.
fn configure_connection(conn: &mut rusqlite::Connection) -> rusqlite::Result<()> {
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(())
}

/// Row offset for a 1-based page number.
fn page_offset(page: u32) -> u32 {
    page.saturating_sub(1) * PAGE_SIZE as u32
}

fn get_and_create_sqlite_db_path() -> String {
    // LubaTV can't run without its database, so failing here stops it with a clear message.
    let mut path = crate::utils::project_dirs()
        .expect("Couldn't find the folder for LubaTV's data")
        .data_dir()
        .to_owned();
    if !path.exists() {
        std::fs::create_dir_all(&path).expect("Couldn't create the folder for LubaTV's data");
    }
    path.push(DB_NAME);
    path.to_string_lossy().to_string()
}

fn to_to_sql<T: rusqlite::ToSql>(values: &[T]) -> Vec<&dyn rusqlite::ToSql> {
    values.iter().map(|x| x as &dyn rusqlite::ToSql).collect()
}

fn get_keywords_sql(size: usize) -> String {
    std::iter::repeat_n("name LIKE ?", size)
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn generate_placeholders(size: usize) -> String {
    std::iter::repeat_n("?", size).collect::<Vec<_>>().join(",")
}

fn to_sql_like(query: Option<String>) -> String {
    query.map(|x| format!("%{x}%")).unwrap_or("%".to_string())
}

pub fn do_tx<F, T>(f: F) -> Result<T>
where
    F: FnOnce(&Transaction) -> Result<T>,
{
    let mut sql = get_conn()?;
    let tx = sql.transaction()?;
    let result = f(&tx)?;
    tx.commit()?;
    Ok(result)
}

pub fn analyze(tx: &Transaction) -> Result<()> {
    tx.execute("ANALYZE;", params![])?;
    Ok(())
}

#[cfg(test)]
mod test_sql {
    use super::page_offset;

    #[test]
    fn test_page_offset() {
        assert_eq!(page_offset(0), 0);
        assert_eq!(page_offset(1), 0);
        assert_eq!(page_offset(2), 36);
        // Past the old u8 page / u16 offset limits
        assert_eq!(page_offset(256), 9180);
        assert_eq!(page_offset(2000), 71964);
    }
}
