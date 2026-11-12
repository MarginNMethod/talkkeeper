//! Bounded, channel-aware speech recognition. Times are relative to the recording.
#[cfg(feature = "cloud")]
pub mod cloud;
#[cfg(feature = "whisper")]
pub mod local;
pub mod models;
pub mod vad;

use async_trait::async_trait;
use futures_util::Stream;
use std::pin::Pin;
use tokio::sync::mpsc;
#[cfg(any(feature = "whisper", feature = "cloud"))]
use tokio_stream::wrappers::ReceiverStream;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Channel {
    Mic,
    System,
}
impl Channel {
    pub fn speaker(self) -> &'static str {
        match self {
            Self::Mic => "Me",
            Self::System => "Them",
        }
    }
}
#[derive(Debug, Clone)]
pub struct AudioChunk {
    pub channel: Channel,
    pub sample_rate: u32,
    pub samples: Vec<f32>,
    pub start_ms: u64,
}
#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptEvent {
    pub channel: Channel,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub lang: Option<String>,
    pub is_final: bool,
}
#[derive(Debug, Clone, Default)]
pub enum Language {
    #[default]
    Auto,
    Code(String),
}
#[derive(Debug, Clone, Default)]
pub struct SttOptions {
    pub language: Language,
    pub vocabulary: Vec<String>,
}
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid audio: {0}")]
    Audio(String),
    #[error("session closed")]
    Closed,
    #[error("provider failed: {0}")]
    Provider(String),
    #[error("model verification failed")]
    Verification,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    // Do not expose HTTP errors: they can contain credential-bearing URLs.
    #[error("model or provider HTTP request failed")]
    Http,
}
pub type Result<T> = std::result::Result<T, Error>;
pub type EventStream = Pin<Box<dyn Stream<Item = Result<TranscriptEvent>> + Send>>;
#[async_trait]
pub trait SttEngine: Send + Sync {
    async fn start(&self, opts: SttOptions) -> Result<SttSession>;
}
#[cfg_attr(not(any(feature = "whisper", feature = "cloud")), allow(dead_code))]
pub(crate) enum Command {
    Audio(AudioChunk),
    Finish,
}
/// Input and output queues are bounded. Drain events concurrently with push/finish.
/// Dropping a session cancels its worker; finish flushes pending utterances.
pub struct SttSession {
    input: tokio::sync::Mutex<Option<mpsc::Sender<Command>>>,
    output: Option<EventStream>,
    worker: tokio::task::JoinHandle<()>,
}
impl SttSession {
    pub async fn push(&self, chunk: AudioChunk) -> Result<()> {
        if chunk.sample_rate == 0 || chunk.samples.iter().any(|x| !x.is_finite()) {
            return Err(Error::Audio(
                "rate must be positive and samples finite".into(),
            ));
        }
        if chunk.samples.len() > chunk.sample_rate as usize * 30 {
            return Err(Error::Audio("chunks must be at most 30 seconds".into()));
        }
        let input = self.input.lock().await;
        input
            .as_ref()
            .ok_or(Error::Closed)?
            .send(Command::Audio(chunk))
            .await
            .map_err(|_| Error::Closed)
    }
    pub fn events(&mut self) -> Option<EventStream> {
        self.output.take()
    }
    pub async fn finish(&self) -> Result<()> {
        let mut input = self.input.lock().await;
        let sender = input.take().ok_or(Error::Closed)?;
        sender
            .send(Command::Finish)
            .await
            .map_err(|_| Error::Closed)
    }
}
impl Drop for SttSession {
    fn drop(&mut self) {
        self.worker.abort();
    }
}

#[cfg(any(feature = "whisper", feature = "cloud"))]
#[async_trait]
pub(crate) trait SegmentDecoder: Send + Sync + 'static {
    async fn decode(&self, audio: AudioChunk, opts: &SttOptions) -> Result<Vec<TranscriptEvent>>;
}
#[cfg(any(feature = "whisper", feature = "cloud"))]
pub(crate) fn segmented_session<D: SegmentDecoder>(decoder: D, opts: SttOptions) -> SttSession {
    let (input, mut rx) = mpsc::channel(8);
    let (tx, output) = mpsc::channel(8);
    let worker = tokio::spawn(async move {
        let mut vad = vad::Segmenter::new(vad::VadConfig::default());
        while let Some(cmd) = rx.recv().await {
            let finishing = matches!(cmd, Command::Finish);
            let chunks = match cmd {
                Command::Audio(chunk) => vad.push(chunk),
                Command::Finish => Ok(vad.finish()),
            };
            match chunks {
                Ok(chunks) => {
                    for chunk in chunks {
                        match decoder.decode(chunk, &opts).await {
                            Ok(events) => {
                                for event in events {
                                    if tx.send(Ok(event)).await.is_err() {
                                        return;
                                    }
                                }
                            }
                            Err(e) => {
                                let _ = tx.send(Err(e)).await;
                                return;
                            }
                        }
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(e)).await;
                    return;
                }
            }
            if finishing {
                break;
            }
        }
    });
    SttSession {
        input: tokio::sync::Mutex::new(Some(input)),
        output: Some(Box::pin(ReceiverStream::new(output))),
        worker,
    }
}

/// Resample a complete utterance, compensating for filter delay.
pub fn resample(samples: &[f32], rate: u32) -> Result<Vec<f32>> {
    use rubato::{FftFixedInOut, Resampler};
    if rate == 0 {
        return Err(Error::Audio("zero sample rate".into()));
    }
    if rate == 16000 || samples.is_empty() {
        return Ok(samples.to_vec());
    }
    let mut r = FftFixedInOut::<f32>::new(rate as usize, 16000, 1024, 1)
        .map_err(|e| Error::Audio(e.to_string()))?;
    let delay = r.output_delay();
    let expected = (samples.len() as u64 * 16000 / u64::from(rate)) as usize;
    let size = r.input_frames_next();
    let mut output = Vec::new();
    for part in samples.chunks(size) {
        let mut padded = vec![0.0; size];
        padded[..part.len()].copy_from_slice(part);
        output.extend(
            r.process(&[padded], None)
                .map_err(|e| Error::Audio(e.to_string()))?
                .remove(0),
        );
    }
    while output.len() < delay + expected {
        output.extend(
            r.process(&[vec![0.0; size]], None)
                .map_err(|e| Error::Audio(e.to_string()))?
                .remove(0),
        );
    }
    Ok(output[delay..delay + expected].to_vec())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resampling_preserves_duration_and_tone() {
        for rate in [8000, 16000, 44100, 48000] {
            let input: Vec<_> = (0..rate)
                .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin())
                .collect();
            let out = resample(&input, rate).unwrap();
            assert_eq!(out.len(), 16000);
            let power = out[1000..15000].iter().map(|x| x * x).sum::<f32>() / 14000.0;
            assert!((power - 0.5).abs() < 0.02);
        }
        assert!(resample(&[], 0).is_err());
    }
}
