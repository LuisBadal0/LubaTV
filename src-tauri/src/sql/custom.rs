//! Custom channels and groups that users create, edit, export and import.

use super::*;

pub fn add_custom_channel(tx: &Transaction, channel: CustomChannel) -> Result<()> {
    insert_channel(tx, channel.data)?;
    if let Some(mut headers) = channel.headers {
        if channel_headers_empty(&headers) {
            return Ok(());
        }
        headers.channel_id = Some(tx.last_insert_rowid());
        insert_channel_headers(tx, headers)?;
    }
    Ok(())
}

fn channel_headers_empty(headers: &ChannelHttpHeaders) -> bool {
    headers.ignore_ssl.is_none()
        && headers.http_origin.is_none()
        && headers.referrer.is_none()
        && headers.user_agent.is_none()
}

pub fn get_custom_source(name: String) -> Source {
    Source {
        id: None,
        name: name.to_string(),
        enabled: true,
        username: None,
        password: None,
        source_type: source_type::CUSTOM,
        url: None,
        url_origin: None,
        use_tvg_id: None,
        user_agent: None,
        max_streams: None,
        stream_user_agent: None,
        last_updated: None,
    }
}

pub fn edit_custom_channel(channel: CustomChannel) -> Result<()> {
    let mut sql = get_conn()?;
    let tx = sql.transaction()?;
    match edit_custom_channel_tx(channel, &tx) {
        Ok(_) => {
            tx.commit()?;
            Ok(())
        }
        Err(e) => {
            tx.rollback().unwrap_or_else(|e| log(format!("{:?}", e)));
            Err(e)
        }
    }
}

fn edit_custom_channel_tx(channel: CustomChannel, tx: &Transaction) -> Result<()> {
    tx.execute(
        r#"
        UPDATE channels
        SET name = ?, image = ?, url = ?, media_type = ?, group_id = ?
        WHERE id = ?
    "#,
        params![
            channel.data.name,
            channel.data.image,
            channel.data.url,
            channel.data.media_type,
            channel.data.group_id,
            channel.data.id
        ],
    )?;
    if let Some(mut headers) = channel.headers {
        headers.channel_id = channel.data.id;
        tx.execute(
            r#"
            INSERT INTO channel_http_headers (referrer, user_agent, http_origin, ignore_ssl, channel_id)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(channel_id) DO UPDATE SET
                referrer = ?1,
                user_agent = ?2,
                http_origin = ?3,
                ignore_ssl = ?4
        "#,
            params![
                headers.referrer,
                headers.user_agent,
                headers.http_origin,
                headers.ignore_ssl,
                headers.channel_id
            ],
        )?;
    } else {
        tx.execute(
            "DELETE FROM channel_http_headers WHERE channel_id = ?",
            params![channel.data.id],
        )?;
    }
    Ok(())
}

pub fn delete_custom_channel(id: i64) -> Result<()> {
    let sql = get_conn()?;
    sql.execute("DELETE FROM channels WHERE id = ?", params![id])?;
    Ok(())
}

pub fn group_exists(name: &str, source_id: i64) -> Result<bool> {
    let sql = get_conn()?;
    Ok(sql
        .query_row(
            r#"
            SELECT 1
            FROM groups
            WHERE name = ? AND source_id = ?
        "#,
            params![name, source_id],
            |row| row.get::<_, u8>(0),
        )
        .optional()?
        .is_some())
}

pub fn channel_exists(name: &str, url: &str, source_id: i64) -> Result<bool> {
    let sql = get_conn()?;
    Ok(sql
        .query_row(
            r#"
            SELECT 1
            FROM channels
            WHERE name = ? AND source_id = ? AND url = ?
        "#,
            params![name, source_id, url],
            |row| row.get::<_, u8>(0),
        )
        .optional()?
        .is_some())
}

pub fn add_custom_group(tx: &Transaction, group: Group) -> Result<i64> {
    tx.execute(
        r#"
        INSERT INTO groups (name, image, source_id)
        VALUES (?, ?, ?)
    "#,
        params!(group.name, group.image, group.source_id),
    )?;
    Ok(tx.last_insert_rowid())
}

pub fn group_auto_complete(query: Option<String>, source_id: i64) -> Result<Vec<IdName>> {
    let sql = get_conn()?;
    let groups = sql
        .prepare(
            r#"
        SELECT id, name
        FROM groups
        WHERE name LIKE ?
        AND source_id = ?
    "#,
        )?
        .query_map(params![to_sql_like(query), source_id], row_to_id_name)?
        .filter_map(Result::ok)
        .collect();
    Ok(groups)
}

fn row_to_id_name(row: &Row) -> Result<IdName, rusqlite::Error> {
    Ok(IdName {
        id: row.get("id")?,
        name: row.get("name")?,
    })
}

pub fn edit_custom_group(group: Group) -> Result<()> {
    let sql = get_conn()?;
    sql.execute(
        r#"
        UPDATE groups
        SET name = ?, image = ?
        WHERE id = ?
    "#,
        params![group.name, group.image, group.id],
    )?;
    Ok(())
}

fn get_group_by_id(id: i64) -> Result<Option<Group>> {
    let sql = get_conn()?;
    let group: Option<Group> = sql
        .query_row(
            "SELECT * FROM groups WHERE id = ?",
            params![id],
            row_to_custom_group,
        )
        .optional()?;
    Ok(group)
}

fn row_to_custom_group(row: &Row) -> Result<Group, rusqlite::Error> {
    Ok(Group {
        id: row.get("id")?,
        name: row.get("name")?,
        image: row.get("image")?,
        source_id: row.get("source_id")?,
        hidden: row.get("hidden")?,
    })
}

pub fn get_custom_channel_extra_data(
    id: i64,
    group_id: Option<i64>,
) -> Result<CustomChannelExtraData> {
    Ok(CustomChannelExtraData {
        headers: get_channel_headers_by_id(id)?,
        group: match group_id {
            None => None,
            Some(group) => get_group_by_id(group)?,
        },
    })
}

pub fn delete_custom_group(id: i64, new_id: Option<i64>, do_channels_update: bool) -> Result<()> {
    let sql = get_conn()?;
    if do_channels_update {
        sql.execute(
            r#"
        UPDATE channels
        SET group_id = ?
        WHERE group_id = ?
    "#,
            params![new_id, id],
        )?;
    }
    sql.execute(
        r#"
        DELETE FROM groups
        WHERE id = ?
    "#,
        params![id],
    )?;
    Ok(())
}

pub fn group_not_empty(id: i64) -> Result<bool> {
    let sql = get_conn()?;
    Ok(sql
        .query_row(
            r#"
                SELECT 1
                FROM channels
                WHERE group_id = ?
            "#,
            params![id],
            |row| row.get::<_, u8>(0),
        )
        .optional()?
        .is_some())
}

pub fn get_custom_channels(group_id: Option<i64>, source_id: i64) -> Result<Vec<CustomChannel>> {
    let sql = get_conn()?;
    let mut sql_query = r#"
        SELECT c.name, c.image, c.url, c.media_type, ch.referrer, ch.user_agent, ch.http_origin, ch.ignore_ssl
        FROM channels c
        LEFT JOIN channel_http_headers ch on ch.channel_id = c.id
        WHERE source_id = ?
    "#.to_string();
    let mut params: Vec<i64> = Vec::with_capacity(2);
    params.push(source_id);
    if let Some(id) = group_id {
        sql_query.push_str("\nAND group_id = ?");
        params.push(id);
    } else {
        sql_query.push_str("\nAND group_id IS NULL");
    }
    let result = sql
        .prepare(&sql_query)?
        .query_map(params_from_iter(params), row_to_custom_channel)?
        .filter_map(Result::ok)
        .collect();
    Ok(result)
}

fn row_to_custom_channel(row: &Row) -> Result<CustomChannel, rusqlite::Error> {
    Ok(CustomChannel {
        data: Channel {
            name: row.get("name")?,
            image: row.get("image")?,
            url: row.get("url")?,
            media_type: row.get("media_type")?,
            favorite: false,
            group_id: None,
            group: None,
            id: None,
            series_id: None,
            source_id: None,
            stream_id: None,
            tv_archive: None,
            season_id: None,
            episode_num: None,
            hidden: Some(false),
        },
        headers: Some(ChannelHttpHeaders {
            http_origin: row.get("http_origin")?,
            ignore_ssl: row.get("ignore_ssl")?,
            referrer: row.get("referrer")?,
            user_agent: row.get("user_agent")?,
            channel_id: None,
            id: None,
        }),
    })
}

fn get_groups_by_source_id(id: i64) -> Result<Vec<Group>> {
    let sql = get_conn()?;
    let result = sql
        .prepare(
            r#"
        SELECT *
        FROM groups
        WHERE source_id = ?
    "#,
        )?
        .query_map(params![id], row_to_custom_group)?
        .filter_map(Result::ok)
        .collect();
    Ok(result)
}

pub fn get_custom_groups(source_id: i64) -> Result<Vec<ExportedGroup>> {
    let groups = get_groups_by_source_id(source_id)?;
    let mut export: Vec<ExportedGroup> = Vec::new();
    for group in groups {
        export.push(ExportedGroup {
            group: Group {
                name: group.name,
                image: group.image,
                source_id: None,
                id: None,
                hidden: Some(false),
            },
            channels: get_custom_channels(group.id, source_id)?,
        });
    }
    Ok(export)
}
