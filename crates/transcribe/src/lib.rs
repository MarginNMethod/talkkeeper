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
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
#[cfg(any(feature = "whisper", feature = "cloud"))]
use tokio::sync::mpsc;
use tokio::sync::Notify;
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
#[cfg(any(feature = "whisper", feature = "cloud"))]
pub(crate) enum Command {
    Audio(AudioChunk),
    Finish,
}

/// Five minutes per source at 16 kHz mono (about 38 MB total).
const MAX_PENDING_SAMPLES: usize = 16000 * 60 * 5 * 2;
#[derive(Default)]
struct Pending {
    audio: VecDeque<AudioChunk>,
    samples: usize,
    finished: bool,
    overflow: bool,
    closed: bool,
}
#[derive(Default)]
struct Input {
    pending: Mutex<Pending>,
    ready: Notify,
}
#[cfg(any(feature = "whisper", feature = "cloud"))]
impl Input {
    async fn recv(&self) -> Option<Command> {
        loop {
            let notified = self.ready.notified();
            {
                let mut pending = self.pending.lock().unwrap();
                if let Some(chunk) = pending.audio.pop_front() {
                    pending.samples -= chunk.samples.len();
                    return Some(Command::Audio(chunk));
                }
                if pending.finished {
                    return Some(Command::Finish);
                }
                if pending.closed {
                    return None;
                }
            }
            notified.await;
        }
    }
}
/// Nonblocking speech input with a bounded audio backlog. Drain events concurrently.
/// On overload the oldest pending audio is discarded; capture can keep running.
pub struct SttSession {
    input: Arc<Input>,
    output: Option<EventStream>,
    worker: tokio::task::JoinHandle<()>,
}
impl SttSession {
    pub async fn push(&self, chunk: AudioChunk) -> Result<()> {
        self.enqueue(chunk)
    }
    /// Enqueues immediately; never waits for inference or queue space.
    pub fn enqueue(&self, chunk: AudioChunk) -> Result<()> {
        if chunk.sample_rate == 0 || chunk.samples.iter().any(|x| !x.is_finite()) {
            return Err(Error::Audio(
                "expected finite audio with a positive sample rate".into(),
            ));
        }
        if chunk.samples.len() > chunk.sample_rate as usize * 30 {
            return Err(Error::Audio("chunks must be at most 30 seconds".into()));
        }
        if chunk.samples.is_empty() {
            return Ok(());
        }
        let mut pending = self.input.pending.lock().unwrap();
        if pending.finished || pending.closed || self.worker.is_finished() {
            return Err(Error::Closed);
        }
        while pending.samples + chunk.samples.len() > MAX_PENDING_SAMPLES {
            if let Some(old) = pending.audio.pop_front() {
                pending.samples -= old.samples.len();
                pending.overflow = true;
            } else {
                break;
            }
        }
        pending.samples += chunk.samples.len();
        pending.audio.push_back(chunk);
        self.input.ready.notify_one();
        Ok(())
    }
    /// Seconds of queued audio, excluding the chunk currently being decoded.
    pub fn pending_seconds(&self) -> u64 {
        let pending = self.input.pending.lock().unwrap();
        let (mic, system) = pending
            .audio
            .iter()
            .fold((0_u64, 0_u64), |(mic, system), chunk| {
                let ms = chunk.samples.len() as u64 * 1000 / u64::from(chunk.sample_rate);
                match chunk.channel {
                    Channel::Mic => (mic + ms, system),
                    Channel::System => (mic, system + ms),
                }
            });
        mic.max(system) / 1000
    }
    pub fn take_overflow(&self) -> bool {
        std::mem::take(&mut self.input.pending.lock().unwrap().overflow)
    }
    pub fn events(&mut self) -> Option<EventStream> {
        self.output.take()
    }
    pub async fn finish(&self) -> Result<()> {
        self.input.pending.lock().unwrap().finished = true;
        self.input.ready.notify_one();
        Ok(())
    }
}
impl Drop for SttSession {
    fn drop(&mut self) {
        self.worker.abort();
    }
}

#[cfg(any(feature = "whisper", feature = "cloud"))]
#[async_trait]
pub trait SegmentDecoder: Send + Sync + 'static {
    async fn decode(&self, audio: AudioChunk, opts: &SttOptions) -> Result<Vec<TranscriptEvent>>;
}
#[cfg(any(feature = "whisper", feature = "cloud"))]
pub fn segmented_session<D: SegmentDecoder>(decoder: D, opts: SttOptions) -> SttSession {
    let input = Arc::new(Input::default());
    let incoming = input.clone();
    let (tx, output) = mpsc::channel(8);
    let worker = tokio::spawn(async move {
        let mut vad = vad::Segmenter::new(vad::VadConfig::default());
        loop {
            let notified = incoming.ready.notified();
            let (chunk, finishing) = {
                let mut pending = incoming.pending.lock().unwrap();
                let chunk = pending.audio.pop_front();
                if let Some(chunk) = &chunk {
                    pending.samples -= chunk.samples.len();
                }
                let finishing = chunk.is_none() && pending.finished;
                (chunk, finishing)
            };
            let chunks = match chunk {
                Some(chunk) => vad.push(chunk),
                None if finishing => Ok(vad.finish()),
                None => {
                    notified.await;
                    continue;
                }
            };
            let result = async {
                for chunk in chunks? {
                    for event in decoder.decode(chunk, &opts).await? {
                        tx.send(Ok(event)).await.map_err(|_| Error::Closed)?;
                    }
                }
                Ok::<_, Error>(())
            }
            .await;
            if let Err(error) = result {
                incoming.pending.lock().unwrap().closed = true;
                let _ = tx.send(Err(error)).await;
                break;
            }
            if finishing {
                break;
            }
        }
    });
    SttSession {
        input,
        output: Some(Box::pin(ReceiverStream::new(output))),
        worker,
    }
}

/// Persistent linear interpolation. The fractional position and boundary sample
/// survive frame boundaries, so callback sizes cannot introduce discontinuities.
#[derive(Default)]
pub struct StreamingResampler {
    rate: u32,
    samples: Vec<f32>,
    position: f64,
}
impl StreamingResampler {
    pub fn push(&mut self, samples: &[f32], rate: u32) -> Result<Vec<f32>> {
        if rate == 0 {
            return Err(Error::Audio("zero sample rate".into()));
        }
        if self.rate != rate {
            self.samples.clear();
            self.position = 0.;
            self.rate = rate;
        }
        if rate == 16000 {
            return Ok(samples.to_vec());
        }
        self.samples.extend_from_slice(samples);
        let mut output = Vec::new();
        let step = rate as f64 / 16000.;
        while self.position + 1. < self.samples.len() as f64 {
            let i = self.position as usize;
            let fraction = (self.position - i as f64) as f32;
            output.push(self.samples[i] * (1. - fraction) + self.samples[i + 1] * fraction);
            self.position += step;
        }
        let consumed = (self.position as usize).min(self.samples.len());
        self.samples.drain(..consumed);
        self.position -= consumed as f64;
        Ok(output)
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
    fn streaming_resampling_is_independent_of_callback_boundaries() {
        for rate in [8000, 44100, 48000] {
            let samples: Vec<_> = (0..rate)
                .map(|i| (i as f32 * std::f32::consts::TAU * 440. / rate as f32).sin())
                .collect();
            let expected = StreamingResampler::default().push(&samples, rate).unwrap();
            let mut stream = StreamingResampler::default();
            let output: Vec<_> = samples
                .chunks(137)
                .flat_map(|chunk| stream.push(chunk, rate).unwrap())
                .collect();
            assert_eq!(output.len(), expected.len());
            assert!(output
                .iter()
                .zip(expected.iter())
                .all(|(a, b)| (a - b).abs() < 0.0001));
            assert!(output.len().abs_diff(16000) <= 2);
        }
    }
    #[cfg(any(feature = "whisper", feature = "cloud"))]
    #[tokio::test]
    async fn backlog_drops_oldest_audio_and_reports_overload_without_closing() {
        struct Waiting;
        #[async_trait]
        impl SegmentDecoder for Waiting {
            async fn decode(&self, _: AudioChunk, _: &SttOptions) -> Result<Vec<TranscriptEvent>> {
                std::future::pending().await
            }
        }
        let session = segmented_session(Waiting, SttOptions::default());
        for start in 0..25 {
            session
                .enqueue(AudioChunk {
                    channel: Channel::Mic,
                    sample_rate: 16000,
                    samples: vec![0.1; 480000],
                    start_ms: start * 30000,
                })
                .unwrap();
        }
        {
            let pending = session.input.pending.lock().unwrap();
            assert_eq!(pending.samples, MAX_PENDING_SAMPLES);
            assert_eq!(pending.audio.front().unwrap().start_ms, 150000);
        }
        assert!(session.take_overflow());
        assert!(!session.take_overflow());
        session
            .enqueue(AudioChunk {
                channel: Channel::Mic,
                sample_rate: 16000,
                samples: vec![0.2; 160],
                start_ms: 750000,
            })
            .unwrap();
        session.finish().await.unwrap();
    }
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
