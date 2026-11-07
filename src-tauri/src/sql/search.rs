//! Searching channels, series and groups, and the bulk actions that apply to a search.

use super::*;

pub fn search(filters: Filters) -> Result<Vec<Channel>> {
    if filters.view_type == view_type::CATEGORIES
        && filters.group_id.is_none()
        && filters.series_id.is_none()
    {
        return search_group(filters);
    }
    if filters.view_type == view_type::HIDDEN {
        return search_hidden(filters);
    }
    if filters.series_id.is_some() && filters.season.is_none() {
        return search_series(filters);
    }
    let sql = get_conn()?;
    let offset = page_offset(filters.page);
    let media_types = match filters.series_id.is_some() {
        true => vec![1],
        false => filters
            .media_types
            .clone()
            .context("No media types to search")?,
    };
    let query = filters.query.unwrap_or("".to_string());
    let keywords: Vec<String> = match filters.use_keywords {
        true => query
            .split(" ")
            .map(|f| format!("%{f}%").to_string())
            .collect(),
        false => vec![format!("%{query}%")],
    };
    let mut sql_query = format!(
        r#"
        SELECT * FROM CHANNELS
        WHERE ({})
        AND media_type IN ({})
        AND source_id IN ({})
        AND url IS NOT NULL
        AND hidden = 0"#,
        get_keywords_sql(keywords.len()),
        generate_placeholders(media_types.len()),
        generate_placeholders(filters.source_ids.len()),
    );
    let mut baked_params = 2;
    if filters.view_type == view_type::FAVORITES && filters.series_id.is_none() {
        sql_query += "\nAND favorite = 1";
    }

    if filters.series_id.is_some() {
        sql_query += "\nAND series_id = ?";
        baked_params += 1;
    } else if filters.group_id.is_some() {
        sql_query += "\nAND group_id = ?";
        baked_params += 1;
    }
    if filters.season.is_some() {
        sql_query += "\nAND season_id = ?";
        baked_params += 1;
    }
    let order = match filters.sort {
        sort_type::ALPHABETICAL_DESC => "DESC",
        _ => "ASC",
    };
    if filters.view_type == view_type::HISTORY {
        sql_query += "\nAND last_watched IS NOT NULL";
        sql_query += "\nORDER BY last_watched DESC";
    } else if filters.season.is_some() {
        sql_query += &format!("\nORDER BY episode_num {0}, name {0}", order)
    } else if filters.sort != sort_type::PROVIDER {
        sql_query += &format!("\nORDER BY name {}", order);
    }
    sql_query += "\nLIMIT ?, ?";
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(
        baked_params + media_types.len() + filters.source_ids.len() + keywords.len(),
    );
    params.extend(to_to_sql(&keywords));
    params.extend(to_to_sql(&media_types));
    params.extend(to_to_sql(&filters.source_ids));
    if let Some(ref series_id) = filters.series_id {
        params.push(series_id);
    } else if let Some(ref group) = filters.group_id {
        params.push(group);
    }
    if let Some(ref season) = filters.season {
        params.push(season);
    }
    params.push(&offset);
    params.push(&PAGE_SIZE);
    let channels: Vec<Channel> = sql
        .prepare(&sql_query)?
        .query_map(params_from_iter(params), row_to_channel)?
        .filter_map(Result::ok)
        .collect();
    Ok(channels)
}

fn search_series(filters: Filters) -> Result<Vec<Channel>> {
    let sql = get_conn()?;
    let offset = page_offset(filters.page);
    let query = filters.query.unwrap_or("".to_string());
    let keywords: Vec<String> = match filters.use_keywords {
        true => query
            .split(" ")
            .map(|f| format!("%{f}%").to_string())
            .collect(),
        false => vec![format!("%{query}%")],
    };
    let mut sql_query = format!(
        r#"
      SELECT *
      FROM seasons
      WHERE ({})
      AND source_id = ?
      AND series_id = ?
      "#,
        get_keywords_sql(keywords.len()),
    );
    let order = match filters.sort {
        sort_type::ALPHABETICAL_DESC => "DESC",
        _ => "ASC",
    };
    sql_query += &format!("\nORDER BY season_number {}", order);
    sql_query += "\nLIMIT ?, ?";
    let mut params: Vec<&dyn rusqlite::ToSql> =
        Vec::with_capacity(2 + filters.source_ids.len() + keywords.len());
    params.extend(to_to_sql(&keywords));
    params.push(filters.source_ids.first().context("no source ids")?);
    params.push(filters.series_id.as_ref().context("no series id")?);
    params.push(&offset);
    params.push(&PAGE_SIZE);
    let channels: Vec<Channel> = sql
        .prepare(&sql_query)?
        .query_map(params_from_iter(params), season_row_to_channel)?
        .filter_map(Result::ok)
        .collect();
    Ok(channels)
}

fn season_row_to_channel(row: &Row) -> std::result::Result<Channel, rusqlite::Error> {
    Ok(Channel {
        id: row.get("id")?,
        image: row.get("image")?,
        favorite: false,
        group: None,
        group_id: None,
        media_type: media_type::SEASON,
        name: row.get("name")?,
        series_id: row.get("series_id")?,
        season_id: None,
        source_id: None,
        stream_id: None,
        tv_archive: None,
        url: None,
        episode_num: None,
        hidden: Some(false),
    })
}

use crate::bulk_action_type;

fn get_action_params(action: u8) -> Result<(&'static str, u8)> {
    match action {
        bulk_action_type::HIDE => Ok((bulk_action_type::FIELD_HIDDEN, 1)),
        bulk_action_type::UNHIDE => Ok((bulk_action_type::FIELD_HIDDEN, 0)),
        bulk_action_type::FAVORITE => Ok((bulk_action_type::FIELD_FAVORITE, 1)),
        bulk_action_type::UNFAVORITE => Ok((bulk_action_type::FIELD_FAVORITE, 0)),
        _ => Err(anyhow!("Invalid action")),
    }
}

pub fn bulk_update(filters: Filters, action: u8) -> Result<()> {
    if filters.series_id.is_some() && filters.season.is_none() {
        return Ok(());
    }

    let (field, value) = get_action_params(action)?;

    let query = filters.query.as_deref().unwrap_or("");
    let keywords: Vec<String> = match filters.use_keywords {
        true => query
            .split(" ")
            .map(|f| format!("%{f}%").to_string())
            .collect(),
        false => vec![format!("%{query}%")],
    };

    if filters.view_type == view_type::CATEGORIES
        && filters.group_id.is_none()
        && filters.series_id.is_none()
    {
        return apply_bulk_categories(&filters, field, value, &keywords);
    }

    if filters.view_type == view_type::HIDDEN {
        return apply_bulk_hidden(&filters, field, value, &keywords);
    }

    apply_bulk_channels(&filters, field, value, &keywords)
}

fn apply_bulk_categories(
    filters: &Filters,
    field: &str,
    value: u8,
    keywords: &[String],
) -> Result<()> {
    if field == bulk_action_type::FIELD_FAVORITE {
        return Ok(());
    }

    let sql = get_conn()?;
    let media_types = filters
        .media_types
        .as_ref()
        .context("media types not found")?;

    let mut sql_query = format!(
        r#"
        UPDATE groups
        SET {} = {}
        WHERE ({})
        AND source_id in ({})
        AND (media_type IS NULL OR media_type in ({}))
        "#,
        field,
        value,
        get_keywords_sql(keywords.len()),
        generate_placeholders(filters.source_ids.len()),
        generate_placeholders(media_types.len())
    );

    sql_query += "\nAND hidden = 0";

    let mut params: Vec<&dyn rusqlite::ToSql> =
        Vec::with_capacity(keywords.len() + filters.source_ids.len() + media_types.len());
    params.extend(to_to_sql(keywords));
    params.extend(to_to_sql(&filters.source_ids));
    params.extend(to_to_sql(media_types));

    sql.execute(&sql_query, params_from_iter(params))?;
    Ok(())
}

fn apply_bulk_hidden(filters: &Filters, field: &str, value: u8, keywords: &[String]) -> Result<()> {
    let sql = get_conn()?;
    let media_types = match filters.series_id.is_some() {
        true => vec![1],
        false => filters
            .media_types
            .clone()
            .context("media types not found")?,
    };

    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();

    let sql_query_channels = format!(
        r#"
        UPDATE channels
        SET {} = {}
        WHERE ({})
        AND media_type IN ({})
        AND source_id IN ({})
        AND url IS NOT NULL
        AND hidden = 1
        "#,
        field,
        value,
        get_keywords_sql(keywords.len()),
        generate_placeholders(media_types.len()),
        generate_placeholders(filters.source_ids.len())
    );
    params.extend(to_to_sql(keywords));
    params.extend(to_to_sql(&media_types));
    params.extend(to_to_sql(&filters.source_ids));

    sql.execute(&sql_query_channels, params_from_iter(params))?;

    if field != bulk_action_type::FIELD_FAVORITE {
        let mut params_groups: Vec<&dyn rusqlite::ToSql> = Vec::new();
        let sql_query_groups = format!(
            r#"
            UPDATE groups
            SET {} = {}
            WHERE ({})
            AND source_id IN ({})
            AND (media_type IS NULL OR media_type IN ({}))
            AND hidden = 1
            "#,
            field,
            value,
            get_keywords_sql(keywords.len()),
            generate_placeholders(filters.source_ids.len()),
            generate_placeholders(media_types.len())
        );
        params_groups.extend(to_to_sql(keywords));
        params_groups.extend(to_to_sql(&filters.source_ids));
        params_groups.extend(to_to_sql(&media_types));
        sql.execute(&sql_query_groups, params_from_iter(params_groups))?;
    }
    Ok(())
}

fn apply_bulk_channels(
    filters: &Filters,
    field: &str,
    value: u8,
    keywords: &[String],
) -> Result<()> {
    let sql = get_conn()?;
    let media_types = match filters.series_id.is_some() {
        true => vec![1],
        false => filters
            .media_types
            .clone()
            .context("media types not found")?,
    };

    let mut sql_query = format!(
        r#"
        UPDATE channels
        SET {} = {}
        WHERE ({})
        AND media_type IN ({})
        AND source_id IN ({})
        AND url IS NOT NULL
        AND hidden = 0"#,
        field,
        value,
        get_keywords_sql(keywords.len()),
        generate_placeholders(media_types.len()),
        generate_placeholders(filters.source_ids.len()),
    );

    if filters.view_type == view_type::FAVORITES && filters.series_id.is_none() {
        sql_query += "\nAND favorite = 1";
    }

    if filters.series_id.is_some() {
        sql_query += "\nAND series_id = ?";
    } else if filters.group_id.is_some() {
        sql_query += "\nAND group_id = ?";
    }
    if filters.season.is_some() {
        sql_query += "\nAND season_id = ?";
    }

    if filters.view_type == view_type::HISTORY {
        sql_query += "\nAND last_watched IS NOT NULL";
    }

    let mut params: Vec<&dyn rusqlite::ToSql> =
        Vec::with_capacity(media_types.len() + filters.source_ids.len() + keywords.len() + 3);
    params.extend(to_to_sql(keywords));
    params.extend(to_to_sql(&media_types));
    params.extend(to_to_sql(&filters.source_ids));
    if let Some(ref series_id) = filters.series_id {
        params.push(series_id);
    } else if let Some(ref group) = filters.group_id {
        params.push(group);
    }
    if let Some(ref season) = filters.season {
        params.push(season);
    }

    sql.execute(&sql_query, params_from_iter(params))?;
    Ok(())
}

fn search_hidden(filters: Filters) -> Result<Vec<Channel>> {
    let sql = get_conn()?;
    let offset = page_offset(filters.page);

    let media_types = match filters.series_id.is_some() {
        true => vec![1],
        false => filters
            .media_types
            .clone()
            .context("No media types to search")?,
    };

    let query = filters.query.unwrap_or("".to_string());
    let keywords: Vec<String> = match filters.use_keywords {
        true => query
            .split(" ")
            .map(|f| format!("%{f}%").to_string())
            .collect(),
        false => vec![format!("%{query}%")],
    };

    let keywords_sql = get_keywords_sql(keywords.len());
    let media_placeholders = generate_placeholders(media_types.len());
    let source_placeholders = generate_placeholders(filters.source_ids.len());

    let sql_query = format!(
        r#"
        SELECT id, image, name, series_id, source_id, stream_id, tv_archive, url, episode_num, hidden, media_type, NULL as group_id, NULL as season_id, favorite
        FROM channels
        WHERE ({})
        AND media_type IN ({})
        AND source_id IN ({})
        AND hidden = 1
        UNION ALL
        SELECT id, image, name, NULL as series_id, source_id, NULL as stream_id, NULL as tv_archive, NULL as url, NULL as episode_num, hidden, 3 as media_type, NULL as group_id, NULL as season_id, 0 as favorite
        FROM groups
        WHERE ({})
        AND source_id IN ({})
        AND (media_type IS NULL OR media_type IN ({}))
        AND hidden = 1
        ORDER BY name ASC
        LIMIT ?, ?
        "#,
        keywords_sql,
        media_placeholders,
        source_placeholders,
        keywords_sql,
        source_placeholders,
        media_placeholders
    );

    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::new();

    // Channels params
    params.extend(to_to_sql(&keywords));
    params.extend(to_to_sql(&media_types));
    params.extend(to_to_sql(&filters.source_ids));

    // Groups params
    params.extend(to_to_sql(&keywords));
    params.extend(to_to_sql(&filters.source_ids));
    params.extend(to_to_sql(&media_types));

    params.push(&offset);
    params.push(&PAGE_SIZE);

    let channels: Vec<Channel> = sql
        .prepare(&sql_query)?
        .query_map(params_from_iter(params), row_to_channel)?
        .filter_map(Result::ok)
        .collect();

    Ok(channels)
}

pub fn search_group(filters: Filters) -> Result<Vec<Channel>> {
    let sql = get_conn()?;
    let offset = page_offset(filters.page);
    let query = filters.query.unwrap_or("".to_string());
    let media_types = filters.media_types.context("no media types")?;
    let keywords: Vec<String> = match filters.use_keywords {
        true => query
            .split(" ")
            .map(|f| format!("%{f}%").to_string())
            .collect(),
        false => vec![format!("%{query}%")],
    };
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(2 + filters.source_ids.len());
    let mut sql_query = format!(
        r#"
        SELECT *
        FROM groups
        WHERE ({})
        AND source_id in ({})
        AND (media_type IS NULL OR media_type in ({}))
    "#,
        get_keywords_sql(keywords.len()),
        generate_placeholders(filters.source_ids.len()),
        generate_placeholders(media_types.len())
    );
    sql_query += "\nAND hidden = 0";
    if filters.sort != sort_type::PROVIDER {
        let order = match filters.sort {
            sort_type::ALPHABETICAL_ASC => "ASC",
            sort_type::ALPHABETICAL_DESC => "DESC",
            _ => "ASC",
        };
        sql_query += &format!("\nORDER BY name {}", order);
    }
    sql_query += "\nLIMIT ?, ?";
    params.extend(to_to_sql(&keywords));
    params.extend(to_to_sql(&filters.source_ids));
    params.extend(to_to_sql(&media_types));
    params.push(&offset);
    params.push(&PAGE_SIZE);
    let channels: Vec<Channel> = sql
        .prepare(&sql_query)?
        .query_map(params_from_iter(params), row_to_group)?
        .filter_map(Result::ok)
        .collect();
    Ok(channels)
}
