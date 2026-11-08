//! Programmes users asked to be notified about.

use super::*;

pub fn clean_epgs() -> Result<()> {
    let sql = get_conn()?;
    sql.execute_batch(
        r#"
          DELETE FROM epg
          WHERE start_timestamp < strftime('%s', 'now')
        "#,
    )?;
    Ok(())
}

pub fn add_epg(epg: EPGNotify) -> Result<()> {
    let sql = get_conn()?;
    sql.execute(
        "INSERT INTO epg (epg_id, channel_name, title, start_timestamp) VALUES (?,?,?,?)",
        params![epg.epg_id, epg.channel_name, epg.title, epg.start_timestamp],
    )?;
    Ok(())
}

pub fn remove_epg(epg_id: String) -> Result<()> {
    let sql = get_conn()?;
    sql.execute("DELETE FROM epg WHERE epg_id = ?", params![epg_id])?;
    Ok(())
}

pub fn get_epgs() -> Result<Vec<EPGNotify>> {
    let sql = get_conn()?;
    let epgs = sql
        .prepare("SELECT * FROM epg")?
        .query_map(params![], row_to_epg)?
        .filter_map(Result::ok)
        .collect();
    Ok(epgs)
}

pub fn get_epg_ids() -> Result<Vec<String>> {
    let sql = get_conn()?;
    let epgs = sql
        .prepare("SELECT epg_id FROM epg")?
        .query_map(params![], |row| row.get::<_, String>(0))?
        .filter_map(Result::ok)
        .collect();
    Ok(epgs)
}

fn row_to_epg(row: &Row) -> Result<EPGNotify, rusqlite::Error> {
    Ok(EPGNotify {
        epg_id: row.get("epg_id")?,
        channel_name: row.get("channel_name")?,
        start_timestamp: row.get("start_timestamp")?,
        title: row.get("title")?,
    })
}
