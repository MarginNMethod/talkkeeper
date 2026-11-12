//! Custom VTIMEZONE observances use the same bounded recurrence engine as events.
use super::*;
use ical::parser::ical::component::IcalTimeZone;
pub(super) struct Transitions(Vec<(NaiveDateTime, i32, i32)>);
fn offset(s: &str) -> Result<i32> {
    if ![5, 7].contains(&s.len()) || !s.is_ascii() {
        return Err(Error("Calendar time-zone offset is invalid"));
    }
    let sign = match &s[..1] {
        "+" => 1,
        "-" => -1,
        _ => return Err(Error("Calendar time-zone offset is invalid")),
    };
    let h = s[1..3]
        .parse::<i32>()
        .map_err(|_| Error("Calendar time-zone offset is invalid"))?;
    let m = s[3..5]
        .parse::<i32>()
        .map_err(|_| Error("Calendar time-zone offset is invalid"))?;
    let sec = if s.len() == 7 {
        s[5..7]
            .parse::<i32>()
            .map_err(|_| Error("Calendar time-zone offset is invalid"))?
    } else {
        0
    };
    if h > 23 || m > 59 || sec > 59 {
        return Err(Error("Calendar time-zone offset is invalid"));
    }
    Ok(sign * (h * 3600 + m * 60 + sec))
}
impl Transitions {
    pub(super) fn parse(zone: IcalTimeZone, to: DateTime<Utc>) -> Result<Self> {
        let mut result = vec![];
        for transition in zone.transitions {
            let p = transition.properties;
            let start = date(prop(&p, "DTSTART")?, Tz::UTC)?;
            let from = offset(&value(&p, "TZOFFSETFROM"))?;
            let to_offset = offset(&value(&p, "TZOFFSETTO"))?;
            let mut set = RRuleSet::new(start).rdate(start);
            for rule in p.iter().filter(|p| p.name == "RRULE") {
                let rule = rule
                    .value
                    .as_deref()
                    .unwrap_or("")
                    .parse::<RRule<rrule::Unvalidated>>()
                    .map_err(|_| Error("Calendar time-zone recurrence is invalid"))?
                    .validate(start)
                    .map_err(|_| Error("Calendar time-zone recurrence is invalid"))?;
                set = set.rrule(rule);
            }
            for rdate in p.iter().filter(|p| p.name == "RDATE") {
                for v in rdate.value.as_deref().unwrap_or("").split(',') {
                    let mut p = rdate.clone();
                    p.value = Some(v.into());
                    set = set.rdate(date(&p, Tz::UTC)?);
                }
            }
            for dt in set
                .before((to + Duration::days(370)).with_timezone(&Tz::UTC))
                .all(MAX_INSTANCES)
                .dates
            {
                result.push((dt.naive_local(), from, to_offset));
            }
        }
        result.sort_by_key(|t| t.0);
        result.dedup();
        if result.is_empty() {
            return Err(Error("Calendar time zone has no usable transitions"));
        }
        Ok(Self(result))
    }
    fn utc(&self, wall: DateTime<Utc>) -> DateTime<Utc> {
        let mut offset = self.0[0].1;
        for (date, before, after) in &self.0 {
            // In a spring gap use the offset before the transition; on a repeated
            // hour choose the first occurrence, as for named IANA time zones.
            let threshold = *date + Duration::seconds(i64::from((after - before).max(0)));
            if wall.naive_utc() >= threshold {
                offset = *after;
            } else {
                break;
            }
        }
        wall - Duration::seconds(i64::from(offset))
    }
}
type Zones = (Option<String>, Option<String>);
pub(super) fn expand(
    mut components: Vec<Vec<Property>>,
    zones: BTreeMap<String, Transitions>,
    source: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    floating: Tz,
) -> Result<Vec<CalendarEvent>> {
    if zones.is_empty() {
        return expand_components(components, source, from, to, floating);
    }
    let mut masters: BTreeMap<String, (u32, Zones)> = BTreeMap::new();
    let mut exceptions: BTreeMap<(String, DateTime<Utc>), (u32, Zones)> = BTreeMap::new();
    for p in &mut components {
        let custom = |name| {
            p.iter()
                .find(|p| p.name == name)
                .and_then(|p| parameter(p, "TZID"))
                .filter(|name| zones.contains_key(name))
        };
        let start_zone = custom("DTSTART");
        let end_zone = if p.iter().any(|p| p.name == "DTEND") {
            custom("DTEND")
        } else {
            start_zone.clone()
        };
        let pair = (start_zone, end_zone);
        for property in p.iter_mut() {
            if let Some(params) = &mut property.params {
                for (name, values) in params {
                    if name == "TZID" && values.first().is_some_and(|v| zones.contains_key(v)) {
                        *values = vec!["UTC".into()];
                    }
                }
            }
        }
        let uid = value(p, "UID");
        let sequence = value(p, "SEQUENCE").parse().unwrap_or(0);
        if value(p, "RECURRENCE-ID").is_empty() {
            if masters.get(&uid).is_none_or(|(s, _)| sequence >= *s) {
                masters.insert(uid, (sequence, pair));
            }
        } else if let Ok(start) = prop(p, "DTSTART").and_then(|p| date(p, floating)) {
            let key = (uid, start.with_timezone(&Utc));
            if exceptions.get(&key).is_none_or(|(s, _)| sequence >= *s) {
                exceptions.insert(key, (sequence, pair));
            }
        }
    }
    let mut events = expand_components(
        components,
        source,
        from - Duration::days(2),
        to + Duration::days(2),
        floating,
    )?;
    for e in &mut events {
        if let Some((_, (start, end))) = exceptions
            .get(&(e.uid.clone(), e.instance_start))
            .or_else(|| masters.get(&e.uid))
        {
            if let Some(zone) = start.as_ref().and_then(|z| zones.get(z)) {
                e.instance_start = zone.utc(e.instance_start);
            }
            if let Some(zone) = end.as_ref().and_then(|z| zones.get(z)) {
                e.instance_end = zone.utc(e.instance_end);
            }
        }
    }
    events.retain(|e| e.instance_start < to && e.instance_end > from);
    events.sort_by_key(|e| e.instance_start);
    Ok(events)
}
