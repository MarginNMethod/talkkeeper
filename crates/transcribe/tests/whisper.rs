#![cfg(feature = "whisper")]
use futures_util::StreamExt;
use talkkeeper_transcribe::{
    local::LocalEngine,
    models::{ModelManager, MODELS},
    *,
};
#[tokio::test]
#[ignore = "downloads a public model and audio sample; runs native inference"]
async fn transcribes_public_jfk_sample() {
    let target =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/transcribe-fixtures");
    tokio::fs::create_dir_all(&target).await.unwrap();
    let manager = ModelManager::new(&target);
    let model = MODELS.iter().find(|m| m.name == "tiny.en").unwrap();
    let path = manager.download(model, |_, _| {}).await.unwrap();
    let wav = target.join("jfk.wav");
    if !wav.exists() {
        let bytes = reqwest::get(
            "https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav",
        )
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .bytes()
        .await
        .unwrap();
        tokio::fs::write(&wav, bytes).await.unwrap();
    }
    let mut reader = hound::WavReader::open(wav).unwrap();
    let rate = reader.spec().sample_rate;
    let samples = reader
        .samples::<i16>()
        .map(|x| x.unwrap() as f32 / 32768.0)
        .collect();
    let engine = LocalEngine::load(path).await.unwrap();
    let mut session = engine
        .start(SttOptions {
            language: Language::Code("en".into()),
            vocabulary: vec![],
        })
        .await
        .unwrap();
    let mut events = session.events().unwrap();
    session
        .push(AudioChunk {
            channel: Channel::Mic,
            sample_rate: rate,
            start_ms: 0,
            samples,
        })
        .await
        .unwrap();
    session.finish().await.unwrap();
    let mut text = String::new();
    while let Some(event) = events.next().await {
        text.push_str(&event.unwrap().text.to_lowercase());
        text.push(' ');
    }
    assert!(text.contains("ask not what your country can do"), "{text}");
}
