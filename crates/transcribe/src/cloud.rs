//! Opt-in cloud providers. Callers supply credentials and explicitly select endpoints/models.
use crate::*;
use futures_util::{SinkExt, StreamExt};
use reqwest::multipart::{Form, Part};
use serde_json::Value;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

pub struct OpenAiCompatible {
    endpoint: String,
    api_key: String,
    model: String,
    client: reqwest::Client,
}
impl OpenAiCompatible {
    /// endpoint is the full /v1/audio/transcriptions URL.
    pub fn new(endpoint: String, api_key: String, model: String) -> Self {
        Self {
            endpoint,
            api_key,
            model,
            client: reqwest::Client::new(),
        }
    }
}
#[async_trait]
impl SttEngine for OpenAiCompatible {
    async fn start(&self, opts: SttOptions) -> Result<SttSession> {
        if self.model.trim().is_empty() {
            return Err(Error::Provider("model is required".into()));
        }
        Ok(segmented_session(
            Self {
                endpoint: self.endpoint.clone(),
                api_key: self.api_key.clone(),
                model: self.model.clone(),
                client: self.client.clone(),
            },
            opts,
        ))
    }
}
#[async_trait]
impl SegmentDecoder for OpenAiCompatible {
    async fn decode(&self, audio: AudioChunk, opts: &SttOptions) -> Result<Vec<TranscriptEvent>> {
        let mut form = Form::new()
            .text("model", self.model.clone())
            .text("response_format", "json")
            .text("prompt", opts.vocabulary.join(", "))
            .part(
                "file",
                Part::bytes(wav(&audio.samples))
                    .file_name("segment.wav")
                    .mime_str("audio/wav")
                    .map_err(|_| Error::Http)?,
            );
        if let Language::Code(code) = &opts.language {
            form = form.text("language", code.clone());
        }
        let value: Value = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|_| Error::Http)?
            .error_for_status()
            .map_err(|_| Error::Http)?
            .json()
            .await
            .map_err(|_| Error::Http)?;
        let text = value["text"]
            .as_str()
            .ok_or_else(|| Error::Provider("missing transcript".into()))?;
        Ok(vec![TranscriptEvent {
            channel: audio.channel,
            start_ms: audio.start_ms,
            end_ms: audio.start_ms + audio.samples.len() as u64 / 16,
            text: text.into(),
            lang: value["language"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| match &opts.language {
                    Language::Code(code) => Some(code.clone()),
                    _ => None,
                }),
            is_final: true,
        }])
    }
}
fn pcm(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|x| ((x.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes())
        .collect()
}
fn wav(samples: &[f32]) -> Vec<u8> {
    let data = pcm(samples);
    let mut out = Vec::new();
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&16000u32.to_le_bytes());
    out.extend_from_slice(&32000u32.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend(data);
    out
}
pub struct Deepgram {
    pub endpoint: String,
    pub api_key: String,
    /// Explicit provider model selection; Nova-3 uses keyterm prompting.
    pub model: String,
}
#[async_trait]
impl SttEngine for Deepgram {
    async fn start(&self, opts: SttOptions) -> Result<SttSession> {
        if self.model.trim().is_empty() {
            return Err(Error::Provider("model is required".into()));
        }
        let mut url = url::Url::parse(&self.endpoint)
            .map_err(|_| Error::Provider("invalid endpoint".into()))?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("model", &self.model);
            query
                .append_pair("encoding", "linear16")
                .append_pair("sample_rate", "16000")
                .append_pair("channels", "1")
                .append_pair("interim_results", "true");
            match &opts.language {
                Language::Auto => {
                    query.append_pair("language", "multi");
                }
                Language::Code(code) => {
                    query.append_pair("language", code);
                }
            }
            for term in &opts.vocabulary {
                query.append_pair(
                    if self.model.starts_with("nova-3") {
                        "keyterm"
                    } else {
                        "keywords"
                    },
                    term,
                );
            }
        }
        let mut connections = Vec::new();
        for channel in [Channel::Mic, Channel::System] {
            let mut request = url
                .as_str()
                .into_client_request()
                .map_err(|_| Error::Http)?;
            request.headers_mut().insert(
                "Authorization",
                format!("Token {}", self.api_key)
                    .parse()
                    .map_err(|_| Error::Provider("invalid credential".into()))?,
            );
            let (socket, _) = connect_async(request)
                .await
                .map_err(|_| Error::Provider("stream connection failed".into()))?;
            connections.push((channel, socket));
        }
        let (input, mut rx) = mpsc::channel(8);
        let (tx, output) = mpsc::channel(8);
        let worker = tokio::spawn(async move {
            // Child tasks are owned by JoinSet and aborted when the session is dropped.
            let mut tasks = tokio::task::JoinSet::new();
            let mut senders = Vec::new();
            for (channel, mut socket) in connections {
                let (sender, mut commands) = mpsc::channel(8);
                senders.push(sender);
                let tx = tx.clone();
                tasks.spawn(async move {
                    let result: Result<()> = async {
                        let mut origin = None;
                        let mut finishing = false;
                        let mut keepalive = tokio::time::interval(std::time::Duration::from_secs(5));
                        let deadline = tokio::time::sleep(std::time::Duration::from_secs(30));
                        tokio::pin!(deadline);
                        loop {
                            tokio::select! {
                                cmd = commands.recv(), if !finishing => match cmd {
                                    Some(Command::Audio(chunk)) => {
                                        origin.get_or_insert(chunk.start_ms);
                                        let samples = resample(&chunk.samples, chunk.sample_rate)?;
                                        socket.send(Message::Binary(pcm(&samples).into())).await.map_err(|_| Error::Provider("stream send failed".into()))?;
                                    },
                                    _ => {
                                        socket.send(Message::Text(r#"{"type":"CloseStream"}"#.into())).await.map_err(|_| Error::Provider("stream finish failed".into()))?;
                                        finishing = true;
                                        deadline.as_mut().reset(tokio::time::Instant::now() + std::time::Duration::from_secs(30));
                                    }
                                },
                                _ = keepalive.tick(), if !finishing => {
                                    socket.send(Message::Text(r#"{"type":"KeepAlive"}"#.into())).await.map_err(|_| Error::Closed)?;
                                },
                                _ = &mut deadline, if finishing => return Err(Error::Provider("stream finalization timeout".into())),
                                message = socket.next() => {
                                    let Some(message) = message else {
                                        if finishing { break; }
                                        return Err(Error::Provider("stream closed unexpectedly".into()));
                                    };
                                    let message = message.map_err(|_| Error::Provider("stream receive failed".into()))?;
                                    match message {
                                        Message::Text(text) => {
                                            let value: Value = serde_json::from_str(&text).map_err(|_| Error::Provider("invalid streaming response".into()))?;
                                            if value["type"] == "Error" { return Err(Error::Provider("stream provider error".into())); }
                                            if value["type"] != "Results" { continue; }
                                            let alt = &value["channel"]["alternatives"][0];
                                            let text = alt["transcript"].as_str().unwrap_or("");
                                            if text.is_empty() { continue; }
                                            let start = value["start"].as_f64().unwrap_or(0.0);
                                            let duration = value["duration"].as_f64().unwrap_or(0.0);
                                            let event = TranscriptEvent {
                                                channel, start_ms: origin.unwrap_or(0) + (start * 1000.0) as u64,
                                                end_ms: origin.unwrap_or(0) + ((start+duration)*1000.0) as u64,
                                                text: text.into(), lang: alt["languages"][0].as_str().or_else(|| alt["words"][0]["language"].as_str()).map(str::to_owned),
                                                is_final: value["is_final"].as_bool().unwrap_or(false),
                                            };
                                            tx.send(Ok(event)).await.map_err(|_| Error::Closed)?;
                                        },
                                        Message::Close(_) => {
                                            if finishing { break; }
                                            return Err(Error::Provider("stream closed unexpectedly".into()));
                                        },
                                        Message::Ping(data) => { socket.send(Message::Pong(data)).await.map_err(|_| Error::Closed)?; },
                                        _ => {}
                                    }
                                }
                            }
                        }
                        Ok(())
                    }.await;
                    if let Err(e) = result { let _ = tx.send(Err(e)).await; }
                });
            }
            drop(tx);
            while let Some(cmd) = rx.recv().await {
                match cmd {
                    Command::Audio(chunk) => {
                        let index = usize::from(chunk.channel == Channel::System);
                        if senders[index].send(Command::Audio(chunk)).await.is_err() {
                            break;
                        }
                    }
                    Command::Finish => break,
                }
            }
            for sender in senders {
                let _ = sender.send(Command::Finish).await;
            }
            while tasks.join_next().await.is_some() {}
        });
        Ok(SttSession {
            input: tokio::sync::Mutex::new(Some(input)),
            output: Some(Box::pin(ReceiverStream::new(output))),
            worker,
        })
    }
}
