//! Creating the database, its tables and indexes, and migrating older databases.

use super::*;

fn create_structure() -> Result<()> {
    let sql = get_conn()?;
    sql.execute_batch(
        r#"
CREATE TABLE "sources" (
  "id"          INTEGER PRIMARY KEY,
  "name"        varchar(100),
  "source_type" integer,
  "url"         varchar(500),
  "username"    varchar(100),
  "password"    varchar(100),
  "enabled"     integer DEFAULT 1
);

CREATE TABLE "channels" (
  "id" INTEGER PRIMARY KEY,
  "name" varchar(100),
  "image" varchar(500),
  "url" varchar(500),
  "media_type" integer,
  "source_id" integer,
  "favorite" integer,
  "series_id" integer,
  "group_id" integer,
  FOREIGN KEY (source_id) REFERENCES sources(id)
  FOREIGN KEY (group_id) REFERENCES groups(id)
);

CREATE TABLE "settings" (
  "key" VARCHAR(50) PRIMARY KEY,
  "value" VARCHAR(100)
);

CREATE TABLE "groups" (
  "id" INTEGER PRIMARY KEY,
  "name" varchar(100),
  "image" varchar(500),
  "source_id" integer,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX index_channel_name ON channels(name);
CREATE UNIQUE INDEX channels_unique ON channels(name, url);

CREATE UNIQUE INDEX index_source_name ON sources(name);
CREATE INDEX index_source_enabled ON sources(enabled);

CREATE UNIQUE INDEX index_group_unique ON groups(name, source_id);
CREATE INDEX index_group_name ON groups(name);

CREATE INDEX index_channel_source_id ON channels(source_id);
CREATE INDEX index_channel_favorite ON channels(favorite);
CREATE INDEX index_channel_series_id ON channels(series_id);
CREATE INDEX index_channel_group_id ON channels(group_id);
CREATE INDEX index_channel_media_type ON channels(media_type);

CREATE INDEX index_group_source_id ON groups(source_id);
"#,
    )?;
    Ok(())
}

fn structure_exists() -> Result<bool> {
    let sql = get_conn()?;
    let table_exists: bool = sql
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'channels' LIMIT 1",
            [],
            |row| row.get::<_, u8>(0),
        )
        .optional()?
        .is_some();
    Ok(table_exists)
}

pub fn create_or_initialize_db() -> Result<()> {
    if !structure_exists()? {
        create_structure()?;
    }
    apply_migrations()?;
    Ok(())
}

fn apply_migrations() -> Result<()> {
    let mut sql = get_conn()?;
    let migrations = Migrations::new(vec![
        M::up(
            r#"
                DROP INDEX IF EXISTS channels_unique;
                CREATE UNIQUE INDEX channels_unique ON channels(name, url, source_id);
                CREATE TABLE IF NOT EXISTS "channel_http_headers" (
                    "id" INTEGER PRIMARY KEY,
                    "channel_id" integer,
                    "referrer" varchar(500),
                    "user_agent" varchar(500),
                    "http_origin" varchar(500),
                    "ignore_ssl" integer DEFAULT 0,
                    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
                );
                CREATE UNIQUE INDEX IF NOT EXISTS index_channel_http_headers_channel_id ON channel_http_headers(channel_id);
                ALTER TABLE sources ADD COLUMN use_tvg_id integer;
                UPDATE sources SET use_tvg_id = 1 WHERE source_type in (0,1);
            "#,
        ),
        M::up(
            r#"
                ALTER TABLE channels ADD COLUMN stream_id integer;
                CREATE INDEX IF NOT EXISTS index_channels_stream_id on channels(stream_id);
                CREATE TABLE IF NOT EXISTS "epg" (
                  "id" INTEGER PRIMARY KEY,
                  "epg_id" varchar(25),
                  "channel_name" varchar(100),
                  "title" varchar(100),
                  "start_timestamp" INTEGER
                );
                CREATE UNIQUE INDEX IF NOT EXISTS index_epg_epg_id on epg(epg_id);
            "#,
        ),
        M::up(
            r#"
              ALTER TABLE channels ADD COLUMN last_watched integer;
              CREATE INDEX index_channels_last_watched on channels(last_watched);

              DROP INDEX IF EXISTS channels_unique;
              DELETE FROM channels
              WHERE ROWID NOT IN (
                  SELECT MIN(ROWID)
                  FROM channels
                  GROUP BY name, source_id
              );
              CREATE UNIQUE INDEX channels_unique ON channels(name, source_id);
            "#,
        ),
        M::up(
            r#"
              ALTER TABLE channels ADD COLUMN tv_archive integer;
              CREATE INDEX index_channels_tv_archive on channels(tv_archive);
            "#,
        ),
        M::up(
            r#"
              ALTER TABLE groups
              ADD COLUMN media_type INTEGER;
              CREATE INDEX index_groups_media_type ON groups(media_type);

              ALTER TABLE channels
              ADD COLUMN season_id INTEGER;
              CREATE INDEX index_channels_season_id ON channels(season_id);

              ALTER TABLE channels
              ADD COLUMN episode_num INTEGER;
              CREATE INDEX index_channels_episode_num on channels(episode_num);

              CREATE TABLE IF NOT EXISTS "seasons" (
                "id" INTEGER PRIMARY KEY,
                "name" VARCHAR(50),
                "season_number" INTEGER,
                "series_id" INTEGER,
                "source_id" INTEGER,
                "image" varchar(200),
                FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
              );
              CREATE INDEX index_seasons_name ON seasons(name);
              CREATE UNIQUE INDEX unique_seasons ON seasons(season_number, series_id, source_id);
            "#,
        ),
        M::up(
            r#"
              DROP INDEX IF EXISTS channels_unique;
              CREATE UNIQUE INDEX channels_unique ON channels(name, source_id, url, series_id, season_id);
        "#,
        ),
        M::up(
            r#"
              ALTER TABLE sources ADD COLUMN user_agent varchar(500);
              ALTER TABLE sources ADD COLUMN max_streams integer;
              ALTER TABLE sources ADD COLUMN stream_user_agent varchar(500);
              ALTER TABLE channels ADD COLUMN hidden integer DEFAULT 0;
              ALTER TABLE groups ADD COLUMN hidden integer DEFAULT 0;
              CREATE INDEX index_channels_hidden ON channels(hidden);
              CREATE INDEX index_groups_hidden ON groups(hidden);
              ANALYZE;
            "#,
        ),
        M::up(
            r#"
              ALTER TABLE sources ADD COLUMN last_updated integer;
              ANALYZE;
            "#,
        ),
    ]);
    migrations.to_latest(&mut sql)?;
    Ok(())
}

pub fn drop_db() -> Result<()> {
    let sql = get_conn()?;
    sql.execute_batch(
        "DROP TABLE channels; DROP TABLE groups; DROP TABLE sources; DROP TABLE settings;",
    )?;
    Ok(())
}
