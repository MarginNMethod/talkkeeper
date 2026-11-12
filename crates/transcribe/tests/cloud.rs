#![cfg(feature = "cloud")]
use futures_util::{SinkExt, StreamExt};
use talkkeeper_transcribe::{
    cloud::{Deepgram, OpenAiCompatible},
    *,
};
use wiremock::{
    matchers::{header, method, path},
    Mock, MockServer, ResponseTemplate,
};
fn audio(channel: Channel) -> AudioChunk {
    AudioChunk {
        channel,
        start_ms: 500,
        sample_rate: 16000,
        samples: (0..16000).map(|i| (i as f32 * 0.17).sin() * 0.2).collect(),
    }
}
#[tokio::test]
async fn batch_posts_wav_and_caller_model() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/audio/transcriptions"))
        .and(header("authorization", "Bearer test-key"))
        .and(|request: &wiremock::Request| {
            request
                .body
                .windows(b"caller-model".len())
                .any(|w| w == b"caller-model")
        })
        .and(|request: &wiremock::Request| {
            request.body.windows(b"WAVE".len()).any(|w| w == b"WAVE")
        })
        .and(|request: &wiremock::Request| {
            request
                .body
                .windows(b"special term".len())
                .any(|w| w == b"special term")
        })
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"text":"hello","language":"en"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let engine = OpenAiCompatible::new(
        format!("{}/v1/audio/transcriptions", server.uri()),
        "test-key".into(),
        "caller-model".into(),
    );
    let mut session = engine
        .start(SttOptions {
            vocabulary: vec!["special term".into()],
            ..Default::default()
        })
        .await
        .unwrap();
    let mut events = session.events().unwrap();
    session.push(audio(Channel::System)).await.unwrap();
    session.finish().await.unwrap();
    assert!(matches!(
        session.push(audio(Channel::Mic)).await,
        Err(Error::Closed)
    ));
    let event = events.next().await.unwrap().unwrap();
    assert_eq!(event.channel, Channel::System);
    assert_eq!((event.start_ms, event.end_ms), (500, 1500));
    assert_eq!(event.text, "hello");
    assert!(events.next().await.is_none());
}
#[tokio::test]
async fn batch_reports_provider_failure_without_secrets() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    let engine = OpenAiCompatible::new(server.uri(), "secret-value".into(), "selected".into());
    let mut session = engine.start(SttOptions::default()).await.unwrap();
    let mut events = session.events().unwrap();
    session.push(audio(Channel::Mic)).await.unwrap();
    session.finish().await.unwrap();
    let error = events.next().await.unwrap().unwrap_err().to_string();
    assert!(!error.contains("secret-value"));
}
#[tokio::test]
#[allow(clippy::result_large_err)] // The WebSocket handshake callback requires this error type.
async fn streaming_auth_keywords_channels_and_finalization() {
    use tokio_tungstenite::tungstenite::{
        handshake::server::{Request, Response},
        Message,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("ws://{}/listen", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let mut tasks = tokio::task::JoinSet::new();
        for _ in 0..2 {
            let (tcp, _) = listener.accept().await.unwrap();
            tasks.spawn(async move {
                let mut ws = tokio_tungstenite::accept_hdr_async(tcp, |req: &Request, response: Response| {
                    assert_eq!(req.headers()["authorization"], "Token test-key");
                    assert!(req.uri().query().unwrap().contains("keywords=special+term"));
                    Ok(response)
                }).await.unwrap();
                while let Some(message) = ws.next().await {
                    match message.unwrap() {
                        Message::Binary(bytes) => {
                            assert_eq!(bytes.len(), 32000);
                            for is_final in [false,true] {
                                ws.send(Message::Text(serde_json::json!({
                                    "type":"Results","start":0.0,"duration":1.0,"is_final":is_final,
                                    "channel":{"alternatives":[{"transcript":"streamed","languages":["en"]}]}
                                }).to_string().into())).await.unwrap();
                            }
                        },
                        Message::Text(text) => {
                            if text.contains("KeepAlive") { continue; }
                            assert!(text.contains("CloseStream"));
                            ws.close(None).await.unwrap();
                            break;
                        },
                        _ => {}
                    }
                }
            });
        }
        while let Some(result) = tasks.join_next().await {
            result.unwrap();
        }
    });
    let engine = Deepgram {
        endpoint,
        api_key: "test-key".into(),
        model: "nova-2".into(),
    };
    let mut session = engine
        .start(SttOptions {
            vocabulary: vec!["special term".into()],
            ..Default::default()
        })
        .await
        .unwrap();
    let mut events = session.events().unwrap();
    session.push(audio(Channel::Mic)).await.unwrap();
    session.push(audio(Channel::System)).await.unwrap();
    session.finish().await.unwrap();
    let collected = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut out = Vec::new();
        while let Some(event) = events.next().await {
            out.push(event.unwrap());
        }
        out
    })
    .await
    .unwrap();
    assert_eq!(collected.len(), 4);
    for channel in [Channel::Mic, Channel::System] {
        let events: Vec<_> = collected.iter().filter(|e| e.channel == channel).collect();
        assert_eq!(events.len(), 2);
        assert!(!events[0].is_final);
        assert!(events[1].is_final);
        assert_eq!(events[1].start_ms, 500);
    }
    server.await.unwrap();
}
