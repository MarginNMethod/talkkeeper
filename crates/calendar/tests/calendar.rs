use chrono::{TimeZone, Utc};
use talkkeeper_calendar::*;
fn parse(body: &str) -> Vec<CalendarEvent> {
    events_between(
        &format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{body}\r\nEND:VCALENDAR\r\n"),
        "source",
        Utc.with_ymd_and_hms(2026, 3, 1, 0, 0, 0).unwrap(),
        Utc.with_ymd_and_hms(2026, 5, 1, 0, 0, 0).unwrap(),
        local_zone(),
    )
    .unwrap()
}
#[test]
fn weekly_dst_exdate_and_overrides() {
    let e=parse("BEGIN:VEVENT\r\nUID:weekly\r\nDTSTART;TZID=Eastern Standard Time:20260301T090000\r\nDTEND;TZID=Eastern Standard Time:20260301T100000\r\nRRULE:FREQ=WEEKLY;COUNT=5;BYDAY=SU\r\nEXDATE;TZID=America/New_York:20260315T090000\r\nSUMMARY:Planning\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:weekly\r\nRECURRENCE-ID;TZID=America/New_York:20260322T090000\r\nDTSTART;TZID=America/New_York:20260323T110000\r\nDTEND;TZID=America/New_York:20260323T120000\r\nSUMMARY:Moved planning\r\nSEQUENCE:2\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:weekly\r\nRECURRENCE-ID;TZID=America/New_York:20260329T090000\r\nSTATUS:CANCELLED\r\nEND:VEVENT");
    assert_eq!(e.len(), 3);
    assert_eq!(e[0].instance_start.hour(), 14);
    assert_eq!(e[1].instance_start.hour(), 13);
    assert_eq!(e[2].title, "Moved planning");
}
use chrono::Timelike;
#[test]
fn all_day_folding_escaping_and_attendees() {
    let e=parse("BEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:20260302\r\nDTEND;VALUE=DATE:20260303\r\nSUMMARY:Design\\, review and\r\n  planning\r\nATTENDEE;CN=Alex:mailto:alex@example.test\r\nATTENDEE:MAILTO:sam@example.test\r\nLOCATION:https://conference.example.test/room\r\nEND:VEVENT");
    assert!(e[0].all_day);
    assert_eq!(e[0].title, "Design, review and planning");
    assert_eq!(e[0].attendees[0].name, "Alex");
    assert_eq!(e[0].attendees[1].email, "sam@example.test");
    assert!(e[0].meeting_url.is_some());
}
#[test]
fn floating_utc_rdate_and_cap() {
    let e=parse("BEGIN:VEVENT\r\nUID:utc\r\nDTSTART:20260302T090000Z\r\nRRULE:FREQ=SECONDLY;COUNT=99999999\r\nEND:VEVENT");
    assert!(!e.is_empty());
    assert!(e.len() <= MAX_INSTANCES as usize);
    let e=parse("BEGIN:VEVENT\r\nUID:floating\r\nDTSTART:20260302T090000\r\nRDATE:20260304T090000\r\nEND:VEVENT");
    assert_eq!(e.len(), 2);
}
#[test]
fn url_validation_does_not_echo_secrets() {
    assert_eq!(
        normalize_url("webcal://example.test/private")
            .unwrap()
            .scheme(),
        "https"
    );
    assert!(!normalize_url("file:///private-secret")
        .unwrap_err()
        .to_string()
        .contains("private-secret"));
}
#[tokio::test]
async fn fetch_status_size_and_conditional() {
    use wiremock::{
        matchers::{header, method, path},
        Mock, MockServer, ResponseTemplate,
    };
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/calendar"))
        .and(header("user-agent", "TalkKeeper"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("etag", "version-one")
                .set_body_string("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"),
        )
        .mount(&server)
        .await;
    let first = fetch(&format!("{}/calendar", server.uri()), None, None)
        .await
        .unwrap();
    assert_eq!(first.etag.as_deref(), Some("version-one"));
    Mock::given(path("/cached"))
        .and(header("if-none-match", "version-one"))
        .respond_with(ResponseTemplate::new(304))
        .mount(&server)
        .await;
    assert!(fetch(
        &format!("{}/cached", server.uri()),
        first.etag.as_deref(),
        None
    )
    .await
    .unwrap()
    .text
    .is_none());
    for (route, status, body, expected) in [
        ("missing", 404, "", "not found"),
        ("private", 401, "", "sign-in"),
        ("html", 200, "<html>Sign in</html>", "calendar"),
    ] {
        Mock::given(path(format!("/{route}")))
            .respond_with(ResponseTemplate::new(status).set_body_string(body))
            .mount(&server)
            .await;
        assert!(fetch(&format!("{}/{route}", server.uri()), None, None)
            .await
            .err()
            .unwrap()
            .to_string()
            .contains(expected));
    }
    Mock::given(path("/big"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![b'x'; MAX_BYTES + 1]))
        .mount(&server)
        .await;
    assert!(fetch(&format!("{}/big", server.uri()), None, None)
        .await
        .err()
        .unwrap()
        .to_string()
        .contains("5 MB"));
    Mock::given(path("/loop"))
        .respond_with(
            ResponseTemplate::new(302).insert_header("location", format!("{}/loop", server.uri())),
        )
        .mount(&server)
        .await;
    assert!(fetch(&format!("{}/loop", server.uri()), None, None)
        .await
        .is_err());
}
#[tokio::test]
async fn fetch_timeout_is_plain_and_private() {
    use wiremock::{matchers::path, Mock, MockServer, ResponseTemplate};
    let server = MockServer::start().await;
    Mock::given(path("/private-timeout-token"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(std::time::Duration::from_secs(21))
                .set_body_string("BEGIN:VCALENDAR\nEND:VCALENDAR"),
        )
        .mount(&server)
        .await;
    let error = fetch(
        &format!("{}/private-timeout-token", server.uri()),
        None,
        None,
    )
    .await
    .err()
    .unwrap()
    .to_string();
    assert!(error.contains("connection"));
    assert!(!error.contains("private-timeout-token"));
}
#[test]
fn sync_schedule_uses_explicit_clock_and_startup_refresh() {
    let clock = Utc.with_ymd_and_hms(2026, 3, 1, 9, 0, 0).unwrap();
    let mut source = talkkeeper_core::CalendarSource {
        id: "s".into(),
        name: "Local".into(),
        color: "#537cad".into(),
        enabled: true,
        sync_minutes: 15,
        last_synced_at: Some(clock.to_rfc3339()),
        last_error: None,
        etag: None,
        last_modified: None,
    };
    assert!(!refresh_due(
        &source,
        clock + chrono::Duration::minutes(14),
        false
    ));
    assert!(refresh_due(
        &source,
        clock + chrono::Duration::minutes(15),
        false
    ));
    assert!(refresh_due(&source, clock, true));
    source.enabled = false;
    assert!(!refresh_due(&source, clock, true));
}
#[test]
fn monthly_positions_and_until() {
    let e=parse("BEGIN:VEVENT\r\nUID:monthly\r\nDTSTART:20260302T090000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1;UNTIL=20260430T235959Z\r\nEND:VEVENT");
    assert_eq!(e.len(), 2);
    assert_eq!(e[1].instance_start.date_naive().to_string(), "2026-04-01");
}
#[test]
fn embedded_custom_vtimezone_observes_daylight_changes() {
    let events=parse("BEGIN:VTIMEZONE\r\nTZID:Local/Workshop\r\nBEGIN:STANDARD\r\nDTSTART:20251102T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nEND:STANDARD\r\nBEGIN:DAYLIGHT\r\nDTSTART:20250309T020000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:custom\r\nDTSTART;TZID=Local/Workshop:20260301T090000\r\nDTEND;TZID=Local/Workshop:20260301T100000\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nSUMMARY:Workshop\r\nEND:VEVENT");
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].instance_start.hour(), 14);
    assert_eq!(events[1].instance_start.hour(), 13);
}
#[test]
fn declined_by_local_identity_is_hidden_even_with_other_attendees() {
    let text="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:declined\r\nDTSTART:20260302T090000Z\r\nATTENDEE;PARTSTAT=DECLINED:mailto:alex@example.test\r\nATTENDEE;PARTSTAT=ACCEPTED:mailto:sam@example.test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let events = events_between_for_user(
        text,
        "s",
        Utc.with_ymd_and_hms(2026, 3, 1, 0, 0, 0).unwrap(),
        Utc.with_ymd_and_hms(2026, 4, 1, 0, 0, 0).unwrap(),
        local_zone(),
        Some("ALEX@example.test"),
    )
    .unwrap();
    assert!(events.is_empty());
}
#[test]
fn all_day_recurrence_keeps_midnight_across_dst() {
    let text="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:days\r\nDTSTART;VALUE=DATE:20260307\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let e = events_between(
        text,
        "s",
        Utc.with_ymd_and_hms(2026, 3, 1, 0, 0, 0).unwrap(),
        Utc.with_ymd_and_hms(2026, 4, 1, 0, 0, 0).unwrap(),
        rrule::Tz::America__New_York,
    )
    .unwrap();
    assert_eq!(e.len(), 3);
    assert_eq!((e[1].instance_end - e[1].instance_start).num_hours(), 23);
    assert_eq!(e[2].instance_end.hour(), 4);
}
