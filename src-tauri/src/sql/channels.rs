//! Channels, seasons and groups from a source refresh, and per-channel state
//! (favorites, hidden, history, what was kept across a refresh).

use super::*;

pub fn insert_season(tx: &Transaction, season: Season) -> Result<i64> {
    tx.execute(
        r#"
        INSERT INTO seasons (name, image, series_id, season_number, source_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (series_id, season_number, source_id)
        DO UPDATE SET
          image = excluded.image,
          name = excluded.name
        "#,
        params![
            season.name,
            season.image,
            season.series_id,
            season.season_number,
            season.source_id,
        ],
    )?;
    Ok(tx.query_row(
        r#"
        SELECT id
        FROM seasons
        WHERE series_id = ?
        AND season_number = ?
        AND source_id = ?
      "#,
        params![season.series_id, season.season_number, season.source_id],
        |r| r.get(0),
    )?)
}

pub fn insert_channel(tx: &Transaction, channel: Channel) -> Result<()> {
    tx.execute(
        r#"
INSERT INTO channels (name, group_id, image, url, source_id, media_type, series_id, favorite, stream_id, tv_archive, season_id, episode_num)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (name, source_id, url, series_id, season_id)
DO UPDATE SET
    url = excluded.url,
    media_type = excluded.media_type,
    stream_id = excluded.stream_id,
    image = excluded.image,
    series_id = excluded.series_id,
    tv_archive = excluded.tv_archive,
    season_id = excluded.season_id;
"#,
        params![
            channel.name,
            channel.group_id,
            channel.image,
            channel.url,
            channel.source_id,
            channel.media_type,
            channel.series_id,
            channel.favorite,
            channel.stream_id,
            channel.tv_archive,
            channel.season_id,
            channel.episode_num
        ],
    )?;
    Ok(())
}

pub fn insert_channel_headers(tx: &Transaction, headers: ChannelHttpHeaders) -> Result<()> {
    tx.execute(
        r#"
INSERT OR IGNORE INTO channel_http_headers (channel_id, referrer, user_agent, http_origin, ignore_ssl)
VALUES (?, ?, ?, ?, ?);
"#,
        params![
            headers.channel_id,
            headers.referrer,
            headers.user_agent,
            headers.http_origin,
            headers.ignore_ssl
        ],
    )?;
    Ok(())
}

fn get_or_insert_group(
    tx: &Transaction,
    group: &str,
    image: &Option<String>,
    source_id: &i64,
    media_type: u8,
) -> Result<i64> {
    let rows_changed = tx.execute(
        r#"
        INSERT OR IGNORE INTO groups (name, image, source_id, media_type)
        VALUES (?, ?, ?, ?);
        "#,
        params![group, &image, source_id, media_type],
    )?;
    if rows_changed == 0 {
        return Ok(tx.query_row(
            "SELECT id FROM groups WHERE name = ? and source_id = ?",
            params![group, source_id],
            |row| row.get::<_, i64>("id"),
        )?);
    }
    Ok(tx.last_insert_rowid())
}

pub fn set_channel_group_id(
    groups: &mut HashMap<String, i64>,
    channel: &mut Channel,
    tx: &Transaction,
    source_id: &i64,
) -> Result<()> {
    let Some(group) = channel.group.as_ref() else {
        return Ok(());
    };
    let id = match groups.get(group) {
        Some(id) => *id,
        None => {
            let id = get_or_insert_group(tx, group, &channel.image, source_id, channel.media_type)?;
            groups.insert(group.clone(), id);
            id
        }
    };
    channel.group_id = Some(id);
    Ok(())
}

pub fn get_channel_headers_by_id(id: i64) -> Result<Option<ChannelHttpHeaders>> {
    let sql = get_conn()?;
    let headers = sql
        .query_row(
            "SELECT * FROM channel_http_headers WHERE channel_id = ?",
            params![id],
            row_to_channel_headers,
        )
        .optional()?;
    Ok(headers)
}

fn row_to_channel_headers(row: &Row) -> Result<ChannelHttpHeaders, rusqlite::Error> {
    Ok(ChannelHttpHeaders {
        id: row.get("id")?,
        channel_id: row.get("channel_id")?,
        http_origin: row.get("http_origin")?,
        referrer: row.get("referrer")?,
        user_agent: row.get("user_agent")?,
        ignore_ssl: row.get("ignore_ssl")?,
    })
}

pub fn series_has_episodes(series_id: u64, source_id: i64) -> Result<bool> {
    let sql = get_conn()?;
    let series_exists = sql
        .query_row(
            r#"
      SELECT 1
      FROM channels
      WHERE series_id = ? AND source_id = ?
      LIMIT 1
    "#,
            params![series_id, source_id],
            |row| row.get::<_, u8>(0),
        )
        .optional()?
        .is_some();
    Ok(series_exists)
}

pub(super) fn row_to_group(row: &Row) -> std::result::Result<Channel, rusqlite::Error> {
    let channel = Channel {
        id: row.get("id")?,
        name: row.get("name")?,
        group: None,
        image: row.get("image")?,
        media_type: media_type::GROUP,
        url: None,
        series_id: None,
        group_id: None,
        favorite: false,
        source_id: row.get("source_id")?,
        stream_id: None,
        tv_archive: None,
        season_id: None,
        episode_num: None,
        hidden: row.get("hidden")?,
    };
    Ok(channel)
}

pub(super) fn row_to_channel(row: &Row) -> std::result::Result<Channel, rusqlite::Error> {
    let channel = Channel {
        id: row.get("id")?,
        name: row.get("name")?,
        group_id: row.get("group_id")?,
        image: row.get("image")?,
        media_type: row.get("media_type")?,
        source_id: row.get("source_id")?,
        url: row.get("url")?,
        favorite: row.get("favorite")?,
        episode_num: row.get("episode_num")?,
        series_id: None,
        group: None,
        stream_id: row.get("stream_id")?,
        tv_archive: row.get("tv_archive")?,
        season_id: row.get("season_id")?,
        hidden: row.get("hidden")?,
    };
    Ok(channel)
}

pub fn delete_channels_by_source(tx: &Transaction, source_id: i64) -> Result<()> {
    tx.execute(
        r#"
        DELETE FROM channels
        WHERE source_id = ?
    "#,
        params![source_id.to_string()],
    )?;
    Ok(())
}

pub fn delete_seasons_by_source(tx: &Transaction, source_id: i64) -> Result<()> {
    tx.execute(
        r#"
        DELETE FROM seasons
        WHERE source_id = ?
    "#,
        params![source_id],
    )?;
    Ok(())
}

pub fn delete_groups_by_source(tx: &Transaction, source_id: i64) -> Result<()> {
    tx.execute(
        r#"
        DELETE FROM groups
        WHERE source_id = ?
    "#,
        params!(source_id),
    )?;
    Ok(())
}

pub fn favorite_channel(channel_id: i64, favorite: bool) -> Result<()> {
    let sql = get_conn()?;
    sql.execute(
        r#"
        UPDATE channels
        SET favorite = ?1
        WHERE id = ?2
    "#,
        params![favorite, channel_id],
    )?;
    Ok(())
}

pub fn hide_channel(channel_id: i64, hidden: bool) -> Result<()> {
    let sql = get_conn()?;
    sql.execute(
        r#"
        UPDATE channels
        SET hidden = ?1
        WHERE id = ?2
    "#,
        params![hidden, channel_id],
    )?;
    Ok(())
}

pub fn hide_group(group_id: i64, hidden: bool) -> Result<()> {
    let sql = get_conn()?;
    sql.execute(
        r#"
        UPDATE groups
        SET hidden = ?1
        WHERE id = ?2
    "#,
        params![hidden, group_id],
    )?;
    Ok(())
}

pub fn remove_last_watched(channel_id: i64) -> Result<()> {
    let sql = get_conn()?;
    sql.execute(
        r#"
        UPDATE channels
        SET last_watched = NULL
        WHERE id = ?1
    "#,
        params![channel_id],
    )?;
    Ok(())
}

pub fn get_preserve(tx: &Transaction, source_id: i64) -> Result<Vec<ChannelPreserve>> {
    let mut channels: Vec<ChannelPreserve> = tx
        .prepare(
            r#"
              SELECT name, favorite, last_watched, hidden
              FROM channels
              WHERE (favorite = 1 OR last_watched IS NOT NULL OR hidden = 1)
              AND series_id IS NULL
              AND source_id = ?
            "#,
        )?
        .query_map(params![source_id], row_to_channel_preserve)?
        .filter_map(Result::ok)
        .collect();

    let groups: Vec<ChannelPreserve> = tx
        .prepare(
            r#"
              SELECT name, hidden
              FROM groups
              WHERE hidden = 1
              AND source_id = ?
            "#,
        )?
        .query_map(params![source_id], row_to_group_preserve)?
        .filter_map(Result::ok)
        .collect();

    channels.extend(groups);
    Ok(channels)
}

fn row_to_channel_preserve(row: &Row) -> Result<ChannelPreserve, rusqlite::Error> {
    Ok(ChannelPreserve {
        name: row.get("name")?,
        favorite: row.get("favorite")?,
        last_watched: row.get("last_watched")?,
        hidden: row.get("hidden")?,
        is_group: false,
    })
}

fn row_to_group_preserve(row: &Row) -> Result<ChannelPreserve, rusqlite::Error> {
    Ok(ChannelPreserve {
        name: row.get("name")?,
        hidden: row.get("hidden")?,
        favorite: false,
        last_watched: None,
        is_group: true,
    })
}

pub fn restore_preserve(
    tx: &Transaction,
    source_id: i64,
    preserve: Vec<ChannelPreserve>,
) -> Result<()> {
    for item in preserve {
        if item.is_group {
            tx.execute(
                r#"
                  UPDATE groups
                  SET hidden = ?
                  WHERE name = ?
                  AND source_id = ?
                "#,
                params![item.hidden, item.name, source_id],
            )?;
        } else {
            tx.execute(
                r#"
                  UPDATE channels
                  SET favorite = ?, last_watched = ?, hidden = ?
                  WHERE name = ?
                  AND source_id = ?
                "#,
                params![
                    item.favorite,
                    item.last_watched,
                    item.hidden,
                    item.name,
                    source_id
                ],
            )?;
        }
    }
    Ok(())
}

/// Item counts and up to three logos for each category tile on screen.
pub fn group_previews(ids: Vec<i64>) -> Result<HashMap<i64, crate::types::GroupPreview>> {
    let sql = get_conn()?;
    let mut count_stmt =
        sql.prepare_cached("SELECT COUNT(*) FROM channels WHERE group_id = ? AND hidden = 0")?;
    let mut image_stmt = sql.prepare_cached(
        "SELECT image FROM channels WHERE group_id = ? AND hidden = 0 AND image IS NOT NULL AND image != '' LIMIT 3",
    )?;
    let mut previews = HashMap::with_capacity(ids.len());
    // A page holds 36 tiles; the cap only guards against misuse.
    for id in ids.into_iter().take(200) {
        let count: i64 = count_stmt.query_row([id], |row| row.get(0))?;
        let images = image_stmt
            .query_map([id], |row| row.get::<_, String>(0))?
            .filter_map(Result::ok)
            .collect();
        previews.insert(id, crate::types::GroupPreview { count, images });
    }
    Ok(previews)
}

/// When each channel was last watched (Unix seconds), for the Continue watching row.
pub fn last_watched_times(ids: Vec<i64>) -> Result<HashMap<i64, i64>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let sql = get_conn()?;
    let query = format!(
        "SELECT id, last_watched FROM channels WHERE id IN ({}) AND last_watched IS NOT NULL",
        generate_placeholders(ids.len())
    );
    let times = sql
        .prepare(&query)?
        .query_map(params_from_iter(ids.iter()), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })?
        .filter_map(Result::ok)
        .collect();
    Ok(times)
}

pub fn add_last_watched(id: i64) -> Result<()> {
    let sql = get_conn()?;
    sql.execute(
        r#"
          UPDATE channels
          SET last_watched = strftime('%s', 'now')
          WHERE id = ?
        "#,
        params![id],
    )?;
    sql.execute(
        r#"
		  UPDATE channels
          SET last_watched = NULL
          WHERE last_watched IS NOT NULL
		  AND id NOT IN (
				SELECT id
				FROM channels
				WHERE last_watched IS NOT NULL
				ORDER BY last_watched DESC
				LIMIT 36
		  )
        "#,
        params![],
    )?;
    Ok(())
}

pub fn clear_history() -> Result<()> {
    let sql = get_conn()?;
    sql.execute(
        r#"
          UPDATE channels
          SET last_watched = NULL
          WHERE last_watched IS NOT NULL
        "#,
        params![],
    )?;
    Ok(())
}

pub fn find_all_episodes_after(channel: &Channel) -> Result<Vec<String>> {
    let sql = get_conn()?;
    Ok(sql
        .prepare(
            r#"
        SELECT url FROM channels
        WHERE season_id = ?
        AND episode_num > ?
        ORDER BY episode_num
      "#,
        )?
        .query_map(params![channel.season_id, channel.episode_num], |row| {
            row.get::<_, String>(0)
        })?
        .filter_map(Result::ok)
        .collect())
}
