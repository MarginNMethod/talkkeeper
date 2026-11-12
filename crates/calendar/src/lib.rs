//! Bounded ICS expansion and private subscription fetching.
use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, TimeZone, Utc};
use ical::property::Property;
use rrule::{RRule, RRuleSet, Tz};
use std::{collections::BTreeMap, io::Cursor, path::Path};
use talkkeeper_core::Attendee;
pub use talkkeeper_core::CalendarEvent;
pub const MAX_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_INSTANCES: u16 = 4096;
mod timezones;
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct Error(pub &'static str);
type Result<T> = std::result::Result<T, Error>;
fn value(p: &[Property], name: &str) -> String {
    p.iter()
        .find(|p| p.name == name)
        .and_then(|p| p.value.clone())
        .unwrap_or_default()
}
fn parameter(p: &Property, name: &str) -> Option<String> {
    p.params
        .as_ref()?
        .iter()
        .find(|(n, _)| n == name)?
        .1
        .first()
        .cloned()
}
fn unescape(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(c) = chars.next() {
                out.push(if c == 'n' || c == 'N' { '\n' } else { c });
            }
        } else {
            out.push(c);
        }
    }
    out
}
fn zone(name: &str) -> Result<Tz> {
    let name = include_str!("windows-zones.txt")
        .lines()
        .filter_map(|l| l.split_once('='))
        .find(|(w, _)| *w == name)
        .map(|(_, i)| i)
        .unwrap_or(name);
    name.parse::<chrono_tz::Tz>()
        .map(Into::into)
        .map_err(|_| Error("This calendar uses an unsupported time zone"))
}
fn date(p: &Property, floating: Tz) -> Result<DateTime<Tz>> {
    let s = p
        .value
        .as_deref()
        .ok_or(Error("Calendar time is missing"))?;
    let tz = if s.ends_with('Z') {
        Tz::UTC
    } else if let Some(z) = parameter(p, "TZID") {
        zone(&z)?
    } else {
        floating
    };
    let naive = if s.len() == 8 {
        NaiveDate::parse_from_str(s, "%Y%m%d")
            .ok()
            .and_then(|d| d.and_hms_opt(0, 0, 0))
    } else {
        NaiveDateTime::parse_from_str(s.trim_end_matches('Z'), "%Y%m%dT%H%M%S").ok()
    }
    .ok_or(Error("Calendar time is invalid"))?;
    tz.from_local_datetime(&naive)
        .earliest()
        .ok_or(Error("Calendar time falls in a daylight-saving gap"))
}
fn prop<'a>(p: &'a [Property], name: &str) -> Result<&'a Property> {
    p.iter()
        .find(|p| p.name == name)
        .ok_or(Error("Calendar event has no start time"))
}
fn next_local_day(start: DateTime<Tz>, days: i64) -> Result<DateTime<Tz>> {
    start
        .timezone()
        .from_local_datetime(&(start.naive_local() + Duration::days(days)))
        .earliest()
        .ok_or(Error("Calendar day falls in a time-zone gap"))
}
fn default_end(start: DateTime<Tz>, all_day: bool) -> Result<DateTime<Tz>> {
    if all_day {
        next_local_day(start, 1)
    } else {
        Ok(start + Duration::hours(1))
    }
}
fn attendee(p: &Property) -> Attendee {
    Attendee {
        name: unescape(&parameter(p, "CN").unwrap_or_default()),
        email: p
            .value
            .as_deref()
            .unwrap_or("")
            .trim_start_matches("mailto:")
            .trim_start_matches("MAILTO:")
            .to_string(),
    }
}
pub fn meeting_link(properties: &[Property]) -> Option<String> {
    for p in properties
        .iter()
        .filter(|p| p.name == "LOCATION")
        .chain(properties.iter().filter(|p| p.name != "LOCATION"))
    {
        let name = p.name.as_str();
        for word in p
            .value
            .as_deref()
            .unwrap_or("")
            .split(|c: char| c.is_whitespace() || ['<', '>', '"'].contains(&c))
        {
            let word = word.trim_end_matches(['.', ',', ';', ')']);
            if let Ok(url) = url::Url::parse(word) {
                if url.scheme() == "https"
                    && url.username().is_empty()
                    && url.password().is_none()
                    && (name == "LOCATION"
                        || include_str!("domains.txt").lines().any(|d| {
                            url.host_str()
                                .is_some_and(|h| h == d || h.ends_with(&format!(".{d}")))
                        }))
                {
                    return Some(url.into());
                }
            }
        }
    }
    None
}
/// Floating values use the caller's local zone; embedded VTIMEZONE observances
/// supply transitions for custom identifiers.
pub fn events_between(
    text: &str,
    source: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    floating: Tz,
) -> Result<Vec<CalendarEvent>> {
    events_between_for_user(text, source, from, to, floating, None)
}
/// An optional local identity lets callers hide invitations declined by this user.
pub fn events_between_for_user(
    text: &str,
    source: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    floating: Tz,
    self_email: Option<&str>,
) -> Result<Vec<CalendarEvent>> {
    if text.len() > MAX_BYTES {
        return Err(Error("Calendar is larger than 5 MB"));
    }
    let mut components = vec![];
    let mut zones = BTreeMap::new();
    for calendar in ical::IcalParser::new(Cursor::new(text)) {
        let calendar = calendar.map_err(|_| Error("This is not a valid calendar"))?;
        for tz in calendar.timezones {
            let name = value(&tz.properties, "TZID");
            if zone(&name).is_err() {
                zones.insert(name, timezones::Transitions::parse(tz, to)?);
            }
        }
        components.extend(calendar.events.into_iter().map(|e| e.properties));
    }
    if !text.contains("BEGIN:VCALENDAR") {
        return Err(Error("This is not a calendar"));
    }
    for p in &mut components {
        let attendees: Vec<_> = p.iter().filter(|p| p.name == "ATTENDEE").collect();
        let declined = (!attendees.is_empty()
            && attendees
                .iter()
                .all(|p| parameter(p, "PARTSTAT").as_deref() == Some("DECLINED")))
            || self_email.is_some_and(|email| {
                !email.is_empty()
                    && attendees.iter().any(|p| {
                        attendee(p).email.eq_ignore_ascii_case(email)
                            && parameter(p, "PARTSTAT").as_deref() == Some("DECLINED")
                    })
            });
        if declined {
            p.retain(|p| p.name != "STATUS");
            p.push(Property {
                name: "STATUS".into(),
                params: None,
                value: Some("CANCELLED".into()),
            });
        }
    }
    timezones::expand(components, zones, source, from, to, floating)
}
fn expand_components(
    components: Vec<Vec<Property>>,
    source: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    floating: Tz,
) -> Result<Vec<CalendarEvent>> {
    // Highest SEQUENCE wins, including exception cancellation records.
    let mut latest: BTreeMap<(String, String), (u32, Vec<Property>)> = BTreeMap::new();
    for p in components {
        let key = (value(&p, "UID"), value(&p, "RECURRENCE-ID"));
        if key.0.is_empty() {
            continue;
        }
        let seq = value(&p, "SEQUENCE").parse().unwrap_or(0);
        if latest.get(&key).is_none_or(|(old, _)| seq >= *old) {
            latest.insert(key, (seq, p));
        }
    }
    let mut result = BTreeMap::new();
    for ((uid, rid), (_, p)) in &latest {
        let attendees: Vec<_> = p.iter().filter(|p| p.name == "ATTENDEE").collect();
        let all_declined = !attendees.is_empty()
            && attendees
                .iter()
                .all(|p| parameter(p, "PARTSTAT").as_deref() == Some("DECLINED"));
        if !rid.is_empty() || value(p, "STATUS") == "CANCELLED" || all_declined {
            continue;
        }
        let start_prop = prop(p, "DTSTART")?;
        let start = date(start_prop, floating)?;
        let all_day = start_prop.value.as_ref().is_some_and(|s| s.len() == 8);
        let end = p
            .iter()
            .find(|p| p.name == "DTEND")
            .map(|p| date(p, floating))
            .transpose()?
            .unwrap_or(default_end(start, all_day)?);
        let day_span = (end.date_naive() - start.date_naive()).num_days();
        let duration = end.signed_duration_since(start);
        if duration < Duration::zero() {
            return Err(Error("Calendar event ends before it starts"));
        }
        let mut set = RRuleSet::new(start);
        for rule in p.iter().filter(|p| p.name == "RRULE") {
            let rule = rule
                .value
                .as_deref()
                .unwrap_or("")
                .parse::<RRule<rrule::Unvalidated>>()
                .map_err(|_| Error("Calendar recurrence is invalid"))?
                .validate(start)
                .map_err(|_| Error("Calendar recurrence is invalid"))?;
            set = set.rrule(rule);
        }
        set = set.rdate(start);
        for d in p.iter().filter(|p| p.name == "RDATE" || p.name == "EXDATE") {
            for v in d.value.as_deref().unwrap_or("").split(',') {
                let mut d = d.clone();
                d.value = Some(v.into());
                let dt = date(&d, floating)?;
                set = if d.name == "EXDATE" {
                    set.exdate(dt)
                } else {
                    set.rdate(dt)
                };
            }
        }
        let dates = set
            .after((from - duration).with_timezone(&Tz::UTC))
            .before(to.with_timezone(&Tz::UTC))
            .all(MAX_INSTANCES)
            .dates;
        for dt in dates {
            let original = dt.with_timezone(&Utc);
            let overridden = latest.iter().any(|((u, r), (_, p))| {
                u == uid
                    && !r.is_empty()
                    && prop(p, "RECURRENCE-ID")
                        .and_then(|p| date(p, floating))
                        .is_ok_and(|d| d.with_timezone(&Utc) == original)
            });
            if overridden {
                continue;
            }
            let e = event(
                p,
                source,
                original,
                if all_day {
                    next_local_day(dt, day_span)?.with_timezone(&Utc)
                } else {
                    (dt + duration).with_timezone(&Utc)
                },
                all_day,
            );
            if e.instance_end > from && e.instance_start < to {
                result.insert((uid.clone(), original), e);
            }
        }
    }
    for ((uid, rid), (_, p)) in &latest {
        if rid.is_empty() || value(p, "STATUS") == "CANCELLED" {
            continue;
        }
        let sp = prop(p, "DTSTART")?;
        let start_local = date(sp, floating)?;
        let all_day = sp.value.as_ref().is_some_and(|s| s.len() == 8);
        let start = start_local.with_timezone(&Utc);
        let end = p
            .iter()
            .find(|p| p.name == "DTEND")
            .map(|p| date(p, floating))
            .transpose()?
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or(default_end(start_local, all_day)?.with_timezone(&Utc));
        if end > from && start < to {
            result.insert(
                (uid.clone(), start),
                event(
                    p,
                    source,
                    start,
                    end,
                    sp.value.as_ref().is_some_and(|s| s.len() == 8),
                ),
            );
        }
    }
    let mut result: Vec<_> = result.into_values().collect();
    result.sort_by_key(|e| e.instance_start);
    Ok(result)
}
fn event(
    p: &[Property],
    source: &str,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    all_day: bool,
) -> CalendarEvent {
    CalendarEvent {
        source_id: source.into(),
        uid: value(p, "UID"),
        instance_start: start,
        instance_end: end,
        all_day,
        title: unescape(&value(p, "SUMMARY")),
        location: unescape(&value(p, "LOCATION")),
        description: unescape(&value(p, "DESCRIPTION")),
        organizer: value(p, "ORGANIZER").trim_start_matches("mailto:").into(),
        attendees: p
            .iter()
            .filter(|p| {
                p.name == "ATTENDEE" && parameter(p, "PARTSTAT").as_deref() != Some("DECLINED")
            })
            .map(attendee)
            .collect(),
        meeting_url: meeting_link(p),
        status: value(p, "STATUS"),
    }
}
pub fn normalize_url(raw: &str) -> Result<url::Url> {
    let raw = if let Some(rest) = raw.strip_prefix("webcal://") {
        format!("https://{rest}")
    } else {
        raw.into()
    };
    let url = url::Url::parse(&raw).map_err(|_| Error("Enter a valid calendar link"))?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error("Use an HTTP or HTTPS calendar link"));
    }
    Ok(url)
}
pub struct FetchResult {
    pub text: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}
pub async fn fetch(raw: &str, etag: Option<&str>, modified: Option<&str>) -> Result<FetchResult> {
    let url = normalize_url(raw)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("TalkKeeper")
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|_| Error("Cannot open calendar connection"))?;
    let mut request = client.get(url);
    if let Some(e) = etag {
        request = request.header("If-None-Match", e);
    }
    if let Some(m) = modified {
        request = request.header("If-Modified-Since", m);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| Error("Calendar is unavailable. Check your connection or link"))?;
    let header = |name| {
        response
            .headers()
            .get(name)
            .and_then(|h| h.to_str().ok())
            .map(str::to_owned)
    };
    let etag = header("etag");
    let last_modified = header("last-modified");
    match response.status().as_u16() {
        304 => {
            return Ok(FetchResult {
                text: None,
                etag,
                last_modified,
            })
        }
        401 | 403 => return Err(Error("Calendar needs sign-in. Use a private ICS link")),
        404 => return Err(Error("Calendar was not found")),
        200 => {}
        _ => return Err(Error("Calendar server could not provide the calendar")),
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BYTES as u64)
    {
        return Err(Error("Calendar is larger than 5 MB"));
    }
    let mut bytes = vec![];
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Error("Calendar download was interrupted"))?
    {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err(Error("Calendar is larger than 5 MB"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let text = String::from_utf8(bytes).map_err(|_| Error("Calendar is not UTF-8 text"))?;
    if !text.trim_start().starts_with("BEGIN:VCALENDAR") {
        return Err(Error("This link does not contain a calendar"));
    }
    Ok(FetchResult {
        text: Some(text),
        etag,
        last_modified,
    })
}
pub fn import_file(path: &Path) -> Result<String> {
    use std::io::Read;
    let f = std::fs::File::open(path).map_err(|_| Error("Cannot read calendar file"))?;
    let mut text = String::new();
    f.take((MAX_BYTES + 1) as u64)
        .read_to_string(&mut text)
        .map_err(|_| Error("Cannot read calendar text"))?;
    if text.len() > MAX_BYTES {
        return Err(Error("Calendar is larger than 5 MB"));
    }
    Ok(text)
}
pub type LocalZone = Tz;
pub fn local_zone() -> LocalZone {
    Tz::LOCAL
}

/// The scheduler takes an explicit clock value so polling does not depend on wall-clock sleeps.
pub fn refresh_due(
    source: &talkkeeper_core::CalendarSource,
    now: DateTime<Utc>,
    startup: bool,
) -> bool {
    source.enabled
        && (startup
            || source
                .last_synced_at
                .as_ref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .is_none_or(|last| {
                    now.signed_duration_since(last).num_minutes() >= i64::from(source.sync_minutes)
                }))
}
