use crate::log;
use crate::media_type;
use crate::source_type;
use crate::sql;
use crate::sql::insert_season;
use crate::types::Channel;
use crate::types::ChannelPreserve;
use crate::types::EPG;
use crate::types::Season;
use crate::types::Source;
use crate::types::XtreamStatus;
use crate::utils::get_local_time;
use crate::utils::get_user_agent_from_source;
use anyhow::anyhow;
use anyhow::{Context, Result, bail};
use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use chrono::DateTime;
use chrono::Local;
use chrono::NaiveDateTime;
use futures::future::join_all;
use reqwest::{Client, StatusCode};
use rusqlite::Transaction;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use tokio::join;
use url::Url;

const GET_LIVE_STREAMS: &str = "get_live_streams";
const GET_VODS: &str = "get_vod_streams";
const GET_SERIES: &str = "get_series";
const GET_SERIES_INFO: &str = "get_series_info";
const GET_SERIES_CATEGORIES: &str = "get_series_categories";
const GET_LIVE_STREAM_CATEGORIES: &str = "get_live_categories";
const GET_VOD_CATEGORIES: &str = "get_vod_categories";
const GET_EPG: &str = "get_simple_data_table";
const LIVE_STREAM_EXTENSION: &str = "ts";
const NO_SEASON_NUMBER: i64 = -9999;

#[derive(Serialize, Deserialize, Clone, Debug)]
struct XtreamStream {
    #[serde(default)]
    stream_id: serde_json::Value,
    name: Option<String>,
    #[serde(default)]
    category_id: serde_json::Value,
    stream_icon: Option<String>,
    #[serde(default)]
    series_id: serde_json::Value,
    cover: Option<String>,
    container_extension: Option<String>,
    #[serde(default)]
    tv_archive: serde_json::Value,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
struct XtreamSeries {
    seasons: Vec<XtreamSeason>,
    episodes: HashMap<String, Vec<XtreamEpisode>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct XtreamSeason {
    #[serde(default)]
    season_number: serde_json::Value,
    #[serde(default)]
    overview: Option<String>,
    #[serde(default)]
    cover: Option<String>,
    #[serde(default)]
    cover_tmdb: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct XtreamEpisode {
    id: serde_json::Value,
    title: String,
    container_extension: String,
    #[serde(default)]
    episode_num: serde_json::Value,
    #[serde(default)]
    season: serde_json::Value,
    #[serde(default)]
    info: serde_json::Value,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
struct XtreamEpisodeInfo {
    movie_image: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
struct XtreamCategory {
    #[serde(default)]
    category_id: serde_json::Value,
    category_name: String,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
struct XtreamEPG {
    epg_listings: Vec<XtreamEPGItem>,
}

/// One programme in a provider's guide. Providers leave out different fields (some send
/// `stop` instead of `end`, or no archive flags), so only the start time is required.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct XtreamEPGItem {
    #[serde(default)]
    id: serde_json::Value,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    start_timestamp: serde_json::Value,
    #[serde(default)]
    stop_timestamp: serde_json::Value,
    #[serde(default)]
    now_playing: serde_json::Value,
    #[serde(default)]
    has_archive: serde_json::Value,
    #[serde(default)]
    start: Option<String>,
    #[serde(default, alias = "stop")]
    end: Option<String>,
}

fn build_xtream_url(source: &mut Source) -> Result<Url> {
    let mut url = Url::parse(&source.url.clone().context("Missing URL")?)?;
    source.url_origin = Some(url.origin().ascii_serialization());
    url.query_pairs_mut()
        .append_pair(
            "username",
            &source.username.clone().context("Missing username")?,
        )
        .append_pair(
            "password",
            &source.password.clone().context("Missing password")?,
        );
    Ok(url)
}

pub async fn get_xtream(mut source: Source, wipe: bool) -> Result<()> {
    let url = build_xtream_url(&mut source)?;
    let user_agent = get_user_agent_from_source(&source)?;
    let (live, live_cats, vods, vods_cats, series, series_cats) = join!(
        get_xtream_http_data::<Vec<XtreamStream>>(url.clone(), GET_LIVE_STREAMS, &user_agent),
        get_xtream_http_data::<Vec<XtreamCategory>>(
            url.clone(),
            GET_LIVE_STREAM_CATEGORIES,
            &user_agent
        ),
        get_xtream_http_data::<Vec<XtreamStream>>(url.clone(), GET_VODS, &user_agent),
        get_xtream_http_data::<Vec<XtreamCategory>>(url.clone(), GET_VOD_CATEGORIES, &user_agent),
        get_xtream_http_data::<Vec<XtreamStream>>(url.clone(), GET_SERIES, &user_agent),
        get_xtream_http_data::<Vec<XtreamCategory>>(
            url.clone(),
            GET_SERIES_CATEGORIES,
            &user_agent
        ),
    );
    let mut sql = sql::get_conn()?;
    let tx = sql.transaction()?;
    let mut channel_preserve: Vec<ChannelPreserve> = Vec::new();
    if wipe {
        channel_preserve =
            sql::get_preserve(&tx, source.id.context("no source id")?).unwrap_or_default();
        sql::wipe(&tx, source.id.context("Source should have id")?)?;
    } else {
        source.id = Some(sql::create_or_find_source_by_name(&tx, &source)?);
    }
    let mut failures = Vec::new();
    live.and_then(|live| process_xtream(&tx, live, live_cats?, &source, media_type::LIVESTREAM))
        .unwrap_or_else(|e| failures.push(e.context("Failed to load live TV")));
    vods.and_then(|vods: Vec<XtreamStream>| {
        process_xtream(&tx, vods, vods_cats?, &source, media_type::MOVIE)
    })
    .unwrap_or_else(|e| failures.push(e.context("Failed to load movies")));
    series
        .and_then(|series: Vec<XtreamStream>| {
            process_xtream(&tx, series, series_cats?, &source, media_type::SERIE)
        })
        .unwrap_or_else(|e| failures.push(e.context("Failed to load series")));
    for failure in &failures {
        log::log(format!("{:?}", failure));
    }
    if failures.len() == 3 {
        match tx.rollback() {
            Ok(_) => {}
            Err(e) => log::log(format!("Failed to rollback tx: {:?}", e)),
        }
        // All three failed, most often for the same reason, so the first one says why.
        let first = failures.swap_remove(0);
        return Err(first.context(
            "Too many Xtream requests failed: live TV, movies and series all failed to load",
        ));
    }
    if wipe {
        sql::restore_preserve(&tx, source.id.context("no source id")?, channel_preserve)?;
    }
    sql::analyze(&tx)?;
    tx.commit()?;
    Ok(())
}

async fn get_xtream_http_data<T>(mut url: Url, action: &str, user_agent: &String) -> Result<T>
where
    T: serde::de::DeserializeOwned,
{
    let client = Client::builder().user_agent(user_agent).build()?;
    url.query_pairs_mut().append_pair("action", action);
    let response = client.get(url).send().await?;
    let status = response.status();
    let body = response.bytes().await?;
    parse_xtream_answer(status, &body, action)
}

/// How much of a provider's answer an error shows.
const ANSWER_EXCERPT_CHARS: usize = 120;

/// Reads a provider's answer to `action`. When it isn't the data asked for, the error says
/// what came back instead (an HTTP error, an empty answer, a web page, a refused login), so
/// people can tell a wrong address or a blocked user agent from a broken account.
fn parse_xtream_answer<T>(status: StatusCode, body: &[u8], action: &str) -> Result<T>
where
    T: serde::de::DeserializeOwned,
{
    if !status.is_success() {
        // Some panels send an error status with valid data, such as `[]` for an empty list.
        if let Ok(data) = serde_json::from_slice(body) {
            return Ok(data);
        }
        bail!(
            "The provider answered {action} with HTTP {status}. {}",
            answer_excerpt(body)
        );
    }
    serde_json::from_slice(body).map_err(|e| {
        let reason = if body.iter().all(u8::is_ascii_whitespace) {
            "The provider sent an empty answer".to_string()
        } else if refused_login(body) {
            "The provider refused the username or password".to_string()
        } else if serde_json::from_slice::<serde_json::Value>(body).is_err() {
            format!(
                "The provider's answer isn't Xtream data, so the address may be wrong or the \
                 provider may block this user agent. {}",
                answer_excerpt(body)
            )
        } else {
            "The provider's answer isn't in the form LubaTV expects".to_string()
        };
        anyhow!(e).context(format!("{reason} (asked for {action})"))
    })
}

/// Xtream panels answer `{"user_info":{"auth":0}}` when the login is wrong.
fn refused_login(body: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("user_info")?.get("auth").cloned())
        .is_some_and(|auth| auth == 0 || auth == "0")
}

fn answer_excerpt(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    // Hidden before it is cut: a link cut in the middle no longer looks like one to redact.
    let text = log::redact(&text.split_whitespace().collect::<Vec<_>>().join(" "));
    if text.is_empty() {
        return "The answer was empty.".to_string();
    }
    let mut excerpt: String = text.chars().take(ANSWER_EXCERPT_CHARS).collect();
    if excerpt.len() < text.len() {
        excerpt.push('\u{2026}');
    }
    format!("It starts with: {excerpt}")
}

fn process_xtream(
    tx: &Transaction,
    streams: Vec<XtreamStream>,
    cats: Vec<XtreamCategory>,
    source: &Source,
    stream_type: u8,
) -> Result<()> {
    let cats: HashMap<String, String> = cats
        .into_iter()
        .filter_map(|f| {
            let category_id = get_serde_json_string(&f.category_id);
            category_id.map(|cid| (cid, f.category_name))
        })
        .collect();
    let source_id = source.id.context("Source has no id")?;
    let mut groups: HashMap<String, i64> = HashMap::new();
    for live in streams {
        let category_name = get_cat_name(&cats, get_serde_json_string(&live.category_id));
        convert_xtream_live_to_channel(live, source, stream_type, category_name)
            .and_then(|mut channel| {
                sql::set_channel_group_id(&mut groups, &mut channel, tx, &source_id)
                    .unwrap_or_else(|e| log::log(format!("{:?}", e)));
                sql::insert_channel(tx, channel)?;
                Ok(())
            })
            .unwrap_or_else(|e| log::log(format!("{:?}", e)));
    }
    Ok(())
}

fn get_cat_name(cats: &HashMap<String, String>, category_id: Option<String>) -> Option<String> {
    cats.get(&category_id?).map(|t| t.to_string())
}

fn convert_xtream_live_to_channel(
    stream: XtreamStream,
    source: &Source,
    stream_type: u8,
    category_name: Option<String>,
) -> Result<Channel> {
    let stream_id = get_serde_json_u64(&stream.stream_id);
    Ok(Channel {
        id: None,
        group: category_name.map(|x| x.trim().to_string()),
        image: stream
            .stream_icon
            .or(stream.cover)
            .map(|x| x.trim().to_string()),
        media_type: stream_type,
        name: stream.name.context("No name")?.trim().to_string(),
        source_id: source.id,
        url: if stream_type == media_type::SERIE {
            get_serde_json_string(&stream.series_id)
        } else {
            Some(get_url(
                stream_id.context("missing stream id")?.to_string(),
                source,
                stream_type,
                stream.container_extension,
            )?)
        },
        stream_id,
        favorite: false,
        group_id: None,
        series_id: None,
        tv_archive: get_serde_json_u64(&stream.tv_archive).map(|x| x == 1),
        season_id: None,
        episode_num: None,
        hidden: Some(false),
    })
}

fn get_url(
    stream_id: String,
    source: &Source,
    stream_type: u8,
    extension: Option<String>,
) -> Result<String> {
    Ok(format!(
        "{}/{}/{}/{}/{}.{}",
        source.url_origin.as_deref().context("Missing URL")?,
        get_media_type_string(stream_type)?,
        source.username.as_deref().context("Missing username")?,
        source.password.as_deref().context("Missing password")?,
        stream_id,
        extension.unwrap_or(LIVE_STREAM_EXTENSION.to_string())
    ))
}

fn get_media_type_string(stream_type: u8) -> Result<String> {
    match stream_type {
        media_type::LIVESTREAM => Ok("live".to_string()),
        media_type::MOVIE => Ok("movie".to_string()),
        media_type::SERIE => Ok("series".to_string()),
        _ => Err(anyhow!("Invalid stream_type")),
    }
}

pub async fn get_episodes(channel: Channel) -> Result<()> {
    let series_id = channel.url.context("no url")?.parse()?;
    if sql::series_has_episodes(series_id, channel.source_id.context("no source id")?)
        .unwrap_or_else(|e| {
            log::log(format!("{:?}", e));
            false
        })
    {
        return Ok(());
    }
    let mut source = sql::get_source_from_id(channel.source_id.context("no source id")?)?;
    let mut url = build_xtream_url(&mut source)?;
    let user_agent = get_user_agent_from_source(&source)?;
    url.query_pairs_mut()
        .append_pair("series_id", &series_id.to_string());
    let mut series =
        get_xtream_http_data::<XtreamSeries>(url, GET_SERIES_INFO, &user_agent).await?;
    let mut episodes: Vec<XtreamEpisode> = series.episodes.into_values().flatten().collect();
    series
        .seasons
        .sort_by_key(|f| get_serde_json_i64(&f.season_number));
    let seasons: HashMap<i64, XtreamSeason> = series
        .seasons
        .iter()
        .filter_map(|x| get_serde_json_i64(&x.season_number).map(|y| (y, x.clone())))
        .collect();
    episodes.sort_by(|a, b| {
        get_serde_json_u64(&a.season)
            .cmp(&get_serde_json_u64(&b.season))
            .then_with(|| {
                get_serde_json_u64(&a.episode_num).cmp(&get_serde_json_u64(&b.episode_num))
            })
    });
    insert_episodes(&source, seasons, episodes, series_id, channel.image)?;
    Ok(())
}

fn insert_episodes(
    source: &Source,
    seasons: HashMap<i64, XtreamSeason>,
    episodes: Vec<XtreamEpisode>,
    series_id: u64,
    default_season_image: Option<String>,
) -> Result<()> {
    let mut seasons_db: HashMap<i64, i64> = HashMap::new();
    sql::do_tx(|tx| {
        for episode in episodes {
            match insert_episode(
                episode.clone(),
                source,
                tx,
                &mut seasons_db,
                &seasons,
                series_id,
                default_season_image.clone(),
            )
            .with_context(|| format!("Failed to insert episode {:?}", episode))
            {
                Ok(_) => (),
                Err(e) => {
                    log::log(format!("{:?}", e));
                    continue;
                }
            }
        }
        Ok(())
    })
}

fn insert_episode(
    episode: XtreamEpisode,
    source: &Source,
    tx: &Transaction,
    seasons_db: &mut HashMap<i64, i64>,
    seasons: &HashMap<i64, XtreamSeason>,
    series_id: u64,
    default_season_image: Option<String>,
) -> Result<()> {
    let source_id = source.id.context("Source has no id")?;
    let season_number = get_serde_json_i64(&episode.season).unwrap_or(NO_SEASON_NUMBER);
    let season_id = seasons_db.get(&season_number);
    let season_id: i64 = match season_id {
        Some(s) => *s,
        None => {
            let season = seasons
                .get(&season_number)
                .and_then(|f| {
                    xtream_season_to_season(f.clone(), source_id, series_id)
                        .with_context(|| "Failed to convert XtreamSeason to Season")
                        .inspect_err(|e| log::log(format!("{}", e)))
                        .ok()
                })
                .unwrap_or_else(|| {
                    create_makeshift_season(
                        season_number,
                        series_id,
                        source_id,
                        default_season_image,
                    )
                });
            let id = insert_season(tx, season)?;
            seasons_db.insert(season_number, id);
            id
        }
    };
    let episode = episode_to_channel(episode, source, series_id, season_id)?;
    sql::insert_channel(tx, episode)?;
    Ok(())
}

fn create_makeshift_season(
    number: i64,
    series_id: u64,
    source_id: i64,
    image: Option<String>,
) -> Season {
    Season {
        name: match number == NO_SEASON_NUMBER {
            true => "Uncategorized".to_string(),
            false => format!("Season {number}"),
        },
        series_id,
        season_number: number,
        source_id,
        image,
        ..Default::default()
    }
}

fn get_serde_json_string(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .map(|cid| cid.to_string())
        .or_else(|| value.as_u64().map(|cid| cid.to_string()))
        .map(|cid| cid.trim().to_string())
}

fn get_serde_json_u64(value: &serde_json::Value) -> Option<u64> {
    value
        .as_str()
        .and_then(|val| val.trim().parse::<u64>().ok())
        .or_else(|| value.as_u64())
}

fn get_serde_json_i64(value: &serde_json::Value) -> Option<i64> {
    value
        .as_str()
        .and_then(|val| val.trim().parse::<i64>().ok())
        .or_else(|| value.as_i64())
}

fn xtream_season_to_season(season: XtreamSeason, source_id: i64, series_id: u64) -> Result<Season> {
    let season_number = get_serde_json_i64(&season.season_number).context("no season number")?;
    Ok(Season {
        season_number,
        series_id,
        source_id,
        image: season.cover_tmdb.or(season.cover).or(season.overview),
        name: format!("Season {season_number}"),
        ..Default::default()
    })
}

fn episode_to_channel(
    episode: XtreamEpisode,
    source: &Source,
    series_id: u64,
    season_id: i64,
) -> Result<Channel> {
    Ok(Channel {
        id: None,
        group: None,
        image: serde_json::from_value::<XtreamEpisodeInfo>(episode.info)
            .map(|e| e.movie_image)
            .unwrap_or_default(),
        media_type: media_type::MOVIE,
        name: episode.title.trim().to_string(),
        source_id: source.id,
        url: Some(get_url(
            get_serde_json_string(&episode.id).context("no id")?,
            source,
            media_type::SERIE,
            Some(episode.container_extension),
        )?),
        series_id: Some(series_id),
        episode_num: get_serde_json_i64(&episode.episode_num),
        season_id: Some(season_id),
        stream_id: None,
        group_id: None,
        favorite: false,
        tv_archive: None,
        hidden: Some(false),
    })
}

pub async fn get_epg(channel: Channel) -> Result<Vec<EPG>> {
    let mut source = sql::get_source_from_id(channel.source_id.context("no source id")?)?;
    let mut url = build_xtream_url(&mut source)?;
    let user_agent = get_user_agent_from_source(&source)?;
    let stream_id = channel.stream_id.context("No stream id")?.to_string();
    url.query_pairs_mut().append_pair("stream_id", &stream_id);
    let epg: XtreamEPG = get_xtream_http_data(url, GET_EPG, &user_agent).await?;
    let url = get_timeshift_url_base(&source)?;
    let current_time = Local::now();
    let mut otv_epgs = Vec::new();
    for item in epg.epg_listings {
        // One programme the provider sent incomplete shouldn't hide the rest of the guide.
        let item = match xtream_epg_to_epg(item, &url, &stream_id) {
            Ok(item) => item,
            Err(e) => {
                log::log(format!(
                    "{:?}",
                    e.context("Skipped a programme in the guide")
                ));
                continue;
            }
        };
        if is_valid_epg(&item, &current_time)? {
            otv_epgs.push(item);
        }
    }
    Ok(otv_epgs)
}

/// A programme is listed while it is on, still to come, or can be watched from the archive.
fn is_valid_epg(epg: &EPG, now: &DateTime<Local>) -> Result<bool> {
    let epg_start_local = crate::utils::get_local_time(epg.start_timestamp)?;
    Ok(epg_start_local >= *now || epg.has_archive || epg.now_playing)
}

fn xtream_epg_to_epg(epg: XtreamEPGItem, url: &Url, stream_id: &str) -> Result<EPG> {
    let start_timestamp =
        get_serde_json_i64(&epg.start_timestamp).context("no valid start timestamp")?;
    let stop_timestamp =
        get_serde_json_i64(&epg.stop_timestamp).context("no valid end timestamp")?;
    // Catch-up needs the start in the provider's own clock, which only `start` gives.
    let timeshift_url = match (is_set(&epg.has_archive), epg.start) {
        (true, Some(start)) => {
            let minutes = match epg.end {
                Some(end) => minutes_between(&start, &end)?,
                None => (stop_timestamp - start_timestamp) / 60,
            };
            Some(get_timeshift_url(url.clone(), &start, minutes, stream_id)?)
        }
        _ => None,
    };
    Ok(EPG {
        epg_id: get_serde_json_string(&epg.id)
            .filter(|id| !id.is_empty())
            .unwrap_or_else(|| format!("{stream_id}-{start_timestamp}")),
        title: decode_epg_text(&epg.title),
        description: decode_epg_text(&epg.description),
        start_time: get_local_time(start_timestamp)?
            .format("%B %d, %H:%M")
            .to_string(),
        end_time: get_local_time(stop_timestamp)?
            .format("%B %d, %H:%M")
            .to_string(),
        start_timestamp,
        has_archive: timeshift_url.is_some(),
        timeshift_url,
        now_playing: is_set(&epg.now_playing),
    })
}

/// An Xtream flag: `1`, `"1"` or `true`.
fn is_set(value: &serde_json::Value) -> bool {
    value.as_u64() == Some(1) || value.as_str().map(str::trim) == Some("1") || value == true
}

/// Xtream guides send titles and descriptions in base64; a few send them as plain text.
fn decode_epg_text(text: &str) -> String {
    BASE64_STANDARD
        .decode(text.trim())
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_else(|| text.to_string())
}

const XTREAM_TIME_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

fn minutes_between(start: &str, end: &str) -> Result<i64> {
    let start = NaiveDateTime::parse_from_str(start, XTREAM_TIME_FORMAT)?;
    let end = NaiveDateTime::parse_from_str(end, XTREAM_TIME_FORMAT)?;
    Ok(end.signed_duration_since(start).num_minutes())
}

fn get_timeshift_url_base(source: &Source) -> Result<Url> {
    let mut url = Url::parse(source.url_origin.as_ref().context("no origin")?)?;
    url.path_segments_mut()
        .map_err(|_| anyhow::anyhow!("Can't mutate url"))?
        .extend(&["streaming", "timeshift.php"]);
    url.query_pairs_mut()
        .append_pair("username", source.username.as_ref().context("no username")?)
        .append_pair("password", source.password.as_ref().context("no password")?);
    Ok(url)
}

fn get_timeshift_url(mut url: Url, start: &str, minutes: i64, stream_id: &str) -> Result<String> {
    let start = NaiveDateTime::parse_from_str(start, XTREAM_TIME_FORMAT)?
        .format("%Y-%m-%d:%H-%M")
        .to_string();
    url.query_pairs_mut()
        .append_pair("stream", stream_id)
        .append_pair("start", &start)
        .append_pair("duration", &minutes.to_string());
    Ok(url.to_string())
}

async fn get_status(source: &mut Source) -> Result<(i64, XtreamStatus)> {
    let url = build_xtream_url(source)?;
    let user_agent = get_user_agent_from_source(source)?;
    let client = Client::builder().user_agent(user_agent).build()?;
    let data = client.get(url).send().await?.json::<XtreamStatus>().await?;
    Ok((source.id.context("no id")?, data))
}

pub async fn get_all_expiries() -> Result<HashMap<i64, i64>> {
    let mut sources = sql::get_sources_by_type(source_type::XTREAM)?;
    let to_await = sources.iter_mut().map(get_status);
    let results: Vec<std::result::Result<(i64, XtreamStatus), anyhow::Error>> =
        join_all(to_await).await;
    let statuses: HashMap<i64, i64> = results
        .into_iter()
        .flatten()
        .filter_map(|(id, status)| {
            let exp_date = get_serde_json_i64(&status.user_info.exp_date)?;
            Some((id, exp_date))
        })
        .collect();
    Ok(statuses)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn error(status: u16, body: &str) -> String {
        let status = StatusCode::from_u16(status).unwrap();
        format!(
            "{:#}",
            parse_xtream_answer::<Vec<XtreamCategory>>(status, body.as_bytes(), GET_VODS)
                .unwrap_err()
        )
    }

    #[test]
    fn reads_the_data_asked_for() {
        let cats: Vec<XtreamCategory> = parse_xtream_answer(
            StatusCode::OK,
            br#"[{"category_id":"1","category_name":"News"}]"#,
            GET_LIVE_STREAM_CATEGORIES,
        )
        .unwrap();
        assert_eq!(cats.len(), 1);
    }

    #[test]
    fn says_what_came_back_instead() {
        let e = error(403, "<html><body>Forbidden</body></html>");
        assert!(e.contains("HTTP 403 Forbidden"), "{e}");
        assert!(e.contains("It starts with: <html><body>Forbidden"), "{e}");

        let e = error(200, "  ");
        assert!(
            e.starts_with("The provider sent an empty answer (asked for get_vod_streams)"),
            "{e}"
        );

        let e = error(200, r#"{"user_info":{"auth":0}}"#);
        assert!(
            e.starts_with("The provider refused the username or password"),
            "{e}"
        );

        let e = error(200, "<!DOCTYPE html><title>Suspended</title>");
        assert!(e.contains("isn't Xtream data"), "{e}");
        assert!(e.contains("<!DOCTYPE html><title>Suspended</title>"), "{e}");

        let e = error(200, r#"{"unexpected":true}"#);
        assert!(e.contains("isn't in the form LubaTV expects"), "{e}");
    }

    #[test]
    fn excerpt_is_short_and_hides_credentials() {
        let body = format!(
            "http://host.example/get.php?username=secret-user&password=secret-pass {}",
            "x".repeat(500)
        );
        let excerpt = answer_excerpt(body.as_bytes());
        assert!(!excerpt.contains("secret"), "{excerpt}");
        assert!(
            excerpt.chars().count() < ANSWER_EXCERPT_CHARS + 40,
            "{excerpt}"
        );
        assert!(excerpt.ends_with('\u{2026}'), "{excerpt}");
    }

    #[test]
    fn a_link_cut_off_by_the_excerpt_still_hides_credentials() {
        // The cut falls inside the password, after which the link no longer looks like one.
        let link = "http://host.example/live/secret-user/secret-password/123.ts";
        let body = format!("{}{link}", "x".repeat(ANSWER_EXCERPT_CHARS - 45));
        let excerpt = answer_excerpt(body.as_bytes());
        assert!(!excerpt.contains("secret"), "{excerpt}");
    }

    #[test]
    fn uses_valid_data_sent_with_an_error_status() {
        let cats: Vec<XtreamCategory> =
            parse_xtream_answer(StatusCode::NOT_FOUND, b"[]", GET_SERIES_CATEGORIES).unwrap();
        assert!(cats.is_empty());
    }

    fn item(json: &str) -> XtreamEPGItem {
        serde_json::from_str(json).unwrap()
    }

    fn base_url() -> Url {
        Url::parse("http://host.example/streaming/timeshift.php?username=u&password=p").unwrap()
    }

    #[test]
    fn reads_a_full_programme() {
        let epg = xtream_epg_to_epg(
            item(
                r#"{"id":"7","title":"TmV3cw==","description":"VG9kYXk=","start":"2026-11-27 20:00:00","end":"2026-11-27 20:30:00","start_timestamp":"1795809600","stop_timestamp":"1795811400","now_playing":0,"has_archive":1}"#,
            ),
            &base_url(),
            "42",
        )
        .unwrap();
        assert_eq!(epg.epg_id, "7");
        assert_eq!(epg.title, "News");
        assert_eq!(epg.description, "Today");
        assert!(epg.has_archive);
        assert!(!epg.now_playing);
        let url = epg.timeshift_url.unwrap();
        assert!(url.contains("start=2026-11-27%3A20-00"), "{url}");
        assert!(url.contains("duration=30"), "{url}");
    }

    #[test]
    fn reads_a_programme_with_fields_left_out() {
        // As in upstream issue #281: no `end`, no description, flags as strings.
        let epg = xtream_epg_to_epg(
            item(
                r#"{"title":"TmV3cw==","start":"2026-11-27 20:00:00","start_timestamp":1795809600,"stop_timestamp":1795813200,"now_playing":"1","has_archive":"1"}"#,
            ),
            &base_url(),
            "42",
        )
        .unwrap();
        assert_eq!(epg.epg_id, "42-1795809600");
        assert_eq!(epg.description, "");
        assert!(epg.now_playing);
        let url = epg.timeshift_url.unwrap();
        assert!(url.contains("duration=60"), "{url}");
    }

    #[test]
    fn accepts_stop_for_end_and_plain_text_titles() {
        let epg = xtream_epg_to_epg(
            item(
                r#"{"id":1,"title":"Late Film","start":"2026-11-27 22:00:00","stop":"2026-11-27 23:45:00","start_timestamp":1795816800,"stop_timestamp":1795823100,"has_archive":1}"#,
            ),
            &base_url(),
            "42",
        )
        .unwrap();
        assert_eq!(epg.title, "Late Film");
        assert!(epg.timeshift_url.unwrap().contains("duration=105"));
    }

    #[test]
    fn no_catch_up_without_the_providers_start_time() {
        let epg = xtream_epg_to_epg(
            item(r#"{"title":"","start_timestamp":1795809600,"stop_timestamp":1795811400,"has_archive":1}"#),
            &base_url(),
            "42",
        )
        .unwrap();
        assert!(!epg.has_archive);
        assert!(epg.timeshift_url.is_none());
    }

    #[test]
    fn a_programme_without_times_is_refused() {
        assert!(xtream_epg_to_epg(item(r#"{"start_timestamp":null}"#), &base_url(), "42").is_err());
    }
}
