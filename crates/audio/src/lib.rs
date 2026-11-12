//! Bounded microphone and system capture. Frames use mono floating-point PCM.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::{
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tokio::sync::mpsc;

mod system;

/// Whether this build can capture system (computer) audio.
pub const SYSTEM_AUDIO_AVAILABLE: bool = cfg!(any(
    target_os = "linux",
    target_os = "windows",
    all(target_os = "macos", feature = "macos-screencapture")
));

#[derive(Clone, Debug, Default)]
pub struct CaptureConfig {
    /// CPAL device name; `None` selects the default microphone.
    pub mic_device: Option<String>,
    pub capture_system: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Mic,
    System,
}

#[derive(Clone, Debug)]
pub struct AudioFrame {
    pub source: Source,
    pub sample_rate: u32,
    /// Always one: interleaved input channels are averaged before delivery.
    pub channels: u16,
    pub samples: Vec<f32>,
    /// Monotonic milliseconds since capture started, including pauses.
    pub timestamp_ms: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("audio backend: {0}")]
    Backend(String),
    #[error("audio frame queue overflow; capture stopped")]
    Overflow,
}
pub type Result<T> = std::result::Result<T, CaptureError>;
fn backend(e: impl std::fmt::Display) -> CaptureError {
    CaptureError::Backend(e.to_string())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum CaptureState {
    Recording,
    Paused,
    Stopped,
}

#[derive(Clone)]
pub(crate) struct Emitter {
    frames: mpsc::Sender<AudioFrame>,
    errors: mpsc::Sender<CaptureError>,
    state: Arc<AtomicU8>,
    epoch: Instant,
}
impl Emitter {
    fn state(&self) -> CaptureState {
        match self.state.load(Ordering::Acquire) {
            0 => CaptureState::Recording,
            1 => CaptureState::Paused,
            _ => CaptureState::Stopped,
        }
    }
    pub(crate) fn fail(&self, error: CaptureError) {
        if self
            .state
            .swap(CaptureState::Stopped as u8, Ordering::AcqRel)
            != CaptureState::Stopped as u8
        {
            let _ = self.errors.try_send(error);
        }
    }
    pub(crate) fn send(&self, source: Source, rate: u32, channels: u16, samples: &[f32]) {
        if self.state() != CaptureState::Recording {
            return;
        }
        let frame = AudioFrame {
            source,
            sample_rate: rate,
            channels: 1,
            samples: downmix(samples, channels),
            timestamp_ms: self.epoch.elapsed().as_millis() as u64,
        };
        if let Err(e) = self.frames.try_send(frame) {
            match e {
                mpsc::error::TrySendError::Full(_) => self.fail(CaptureError::Overflow),
                mpsc::error::TrySendError::Closed(_) => {
                    self.state.store(2, Ordering::Release);
                }
            }
        }
    }
}

pub struct Capture;
pub struct CaptureHandle {
    pub frames: mpsc::Receiver<AudioFrame>,
    /// Runtime failures, including overflow. A failure stops both sources.
    pub errors: mpsc::Receiver<CaptureError>,
    emitter: Emitter,
    worker: Option<JoinHandle<()>>,
}
impl Capture {
    /// Starts both requested backends before returning; never requests consent implicitly.
    pub fn start(config: CaptureConfig) -> Result<CaptureHandle> {
        Self::start_inner(config, true)
    }
    /// Capture only system audio (also useful on machines without a microphone).
    pub fn start_system() -> Result<CaptureHandle> {
        Self::start_inner(
            CaptureConfig {
                capture_system: true,
                ..Default::default()
            },
            false,
        )
    }
    fn start_inner(config: CaptureConfig, mic: bool) -> Result<CaptureHandle> {
        let (tx, frames) = mpsc::channel(128);
        let (errors_tx, errors) = mpsc::channel(8);
        let emitter = Emitter {
            frames: tx,
            errors: errors_tx,
            state: Arc::new(AtomicU8::new(CaptureState::Paused as u8)),
            epoch: Instant::now(),
        };
        let output = emitter.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let worker = thread::Builder::new()
            .name("talkkeeper-capture".into())
            .spawn(move || {
                let setup = || -> Result<_> {
                    let mic = if mic {
                        Some(microphone(&config, output.clone())?)
                    } else {
                        None
                    };
                    let system = if config.capture_system {
                        Some(system::open(&output)?)
                    } else {
                        None
                    };
                    Ok((mic, system))
                };
                match setup() {
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                    }
                    Ok((_mic, mut system)) => {
                        // Suppress buffers until all requested sources are initialized.
                        if output
                            .state
                            .compare_exchange(
                                CaptureState::Paused as u8,
                                CaptureState::Recording as u8,
                                Ordering::AcqRel,
                                Ordering::Acquire,
                            )
                            .is_err()
                        {
                            let _ =
                                ready_tx.send(Err(backend("capture failed during initialization")));
                            return;
                        }
                        let _ = ready_tx.send(Ok(()));
                        while output.state() != CaptureState::Stopped {
                            if let Some(system) = system.as_mut() {
                                if let Err(e) = system.poll(&output) {
                                    output.fail(e);
                                }
                            }
                            if output.frames.is_closed() {
                                break;
                            }
                            thread::sleep(Duration::from_millis(5));
                        }
                    }
                }
            })
            .map_err(backend)?;
        if let Err(error) = ready_rx.recv().map_err(backend)? {
            let _ = worker.join();
            return Err(error);
        }
        Ok(CaptureHandle {
            frames,
            errors,
            emitter,
            worker: Some(worker),
        })
    }
}
impl CaptureHandle {
    pub fn state(&self) -> CaptureState {
        self.emitter.state()
    }
    pub fn pause(&self) {
        let _ = self
            .emitter
            .state
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire);
    }
    pub fn resume(&self) {
        let _ = self
            .emitter
            .state
            .compare_exchange(1, 0, Ordering::AcqRel, Ordering::Acquire);
    }
    /// Joins the capture worker and discards queued frames. Idempotent.
    pub fn stop(&mut self) {
        self.emitter.state.store(2, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        self.frames.close();
        while self.frames.try_recv().is_ok() {}
    }
}
impl Drop for CaptureHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn list_input_devices() -> Result<Vec<String>> {
    cpal::default_host()
        .input_devices()
        .map_err(backend)?
        .map(|d| d.name().map_err(backend))
        .collect()
}
fn microphone(config: &CaptureConfig, output: Emitter) -> Result<cpal::Stream> {
    let host = cpal::default_host();
    let device = if let Some(name) = &config.mic_device {
        host.input_devices()
            .map_err(backend)?
            .find(|d| d.name().ok().as_ref() == Some(name))
    } else {
        host.default_input_device()
    }
    .ok_or_else(|| backend("microphone not found"))?;
    let supported = device.default_input_config().map_err(backend)?;
    let config = supported.config();
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => mic_stream::<f32>(&device, &config, output),
        cpal::SampleFormat::I16 => mic_stream::<i16>(&device, &config, output),
        cpal::SampleFormat::U16 => mic_stream::<u16>(&device, &config, output),
        cpal::SampleFormat::I8 => mic_stream::<i8>(&device, &config, output),
        cpal::SampleFormat::U8 => mic_stream::<u8>(&device, &config, output),
        cpal::SampleFormat::I32 => mic_stream::<i32>(&device, &config, output),
        cpal::SampleFormat::U32 => mic_stream::<u32>(&device, &config, output),
        cpal::SampleFormat::I64 => mic_stream::<i64>(&device, &config, output),
        cpal::SampleFormat::U64 => mic_stream::<u64>(&device, &config, output),
        cpal::SampleFormat::F64 => mic_stream::<f64>(&device, &config, output),
        _ => Err(backend("unsupported microphone sample format")),
    }?;
    stream.play().map_err(backend)?;
    Ok(stream)
}
fn mic_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    output: Emitter,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let errors = output.clone();
    let (rate, channels) = (config.sample_rate.0, config.channels);
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let samples: Vec<f32> = data.iter().map(|s| s.to_sample::<f32>()).collect();
                output.send(Source::Mic, rate, channels, &samples);
            },
            move |error| errors.fail(backend(error)),
            None,
        )
        .map_err(backend)
}

/// Averages complete interleaved frames. Zero channels and incomplete tails yield no samples.
pub fn downmix(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels == 0 {
        return Vec::new();
    }
    samples
        .chunks_exact(channels as usize)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}
/// RMS relative to full scale; silence (including empty input) is negative infinity.
pub fn rms_dbfs(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return f32::NEG_INFINITY;
    }
    let power = samples.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / samples.len() as f64;
    (10.0 * power.log10()) as f32
}

#[derive(Clone, Debug)]
pub struct PermissionsStatus {
    /// Guidance, not a claim that permission has been granted. Opening capture is authoritative.
    pub microphone: String,
    pub system: String,
}
pub fn permissions_status() -> PermissionsStatus {
    PermissionsStatus {
        microphone: if cfg!(target_os = "macos") { "Enable Microphone in System Settings > Privacy & Security; the app needs NSMicrophoneUsageDescription." }
            else if cfg!(target_os = "windows") { "Enable microphone access for desktop apps in Windows Privacy settings." }
            else { "Allow microphone access in your audio server and sandbox settings." }.into(),
        system: if cfg!(all(target_os = "macos", not(feature = "macos-screencapture"))) { "System audio is not included in this macOS build (it needs Xcode 26 or newer to compile). Microphone capture still works. See the README to enable it." }
            else if cfg!(target_os = "macos") { "macOS 14+: enable Screen Recording in System Settings > Privacy & Security, then restart the app." }
            else if cfg!(target_os = "windows") { "WASAPI loopback captures the default render endpoint; no separate permission prompt is available." }
            else { "A running PulseAudio or PipeWire-pulse server with a default sink monitor is required." }.into(),
    }
}
/// Permission prompts are managed by the OS when capture opens; this call does not start recording.
pub fn request_permissions() -> PermissionsStatus {
    permissions_status()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixes_channels() {
        assert_eq!(downmix(&[1., -1., 0.5, 0.25, 9.], 2), vec![0., 0.375]);
        assert_eq!(downmix(&[0.5], 1), vec![0.5]);
        assert!(downmix(&[1.], 0).is_empty());
    }
    #[test]
    fn meters() {
        assert_eq!(rms_dbfs(&[0.; 10]), f32::NEG_INFINITY);
        assert_eq!(rms_dbfs(&[]), f32::NEG_INFINITY);
        assert_eq!(rms_dbfs(&[1., -1.]), 0.);
        assert!((rms_dbfs(&[0.5; 10]) + 6.0206).abs() < 0.001);
    }
    fn handle(capacity: usize) -> CaptureHandle {
        let (tx, frames) = mpsc::channel(capacity);
        let (errors_tx, errors) = mpsc::channel(8);
        CaptureHandle {
            frames,
            errors,
            worker: None,
            emitter: Emitter {
                frames: tx,
                errors: errors_tx,
                state: Arc::new(AtomicU8::new(0)),
                epoch: Instant::now(),
            },
        }
    }
    #[test]
    fn transitions_and_delivery() {
        let mut h = handle(4);
        h.pause();
        h.pause();
        h.emitter.send(Source::Mic, 48000, 2, &[1., 0.]);
        assert!(h.frames.try_recv().is_err());
        assert_eq!(h.state(), CaptureState::Paused);
        h.resume();
        h.resume();
        h.emitter.send(Source::System, 48000, 2, &[1., 0.]);
        let f = h.frames.try_recv().unwrap();
        assert_eq!(f.samples, [0.5]);
        assert_eq!(f.channels, 1);
        assert_eq!(f.source, Source::System);
        h.stop();
        h.resume();
        h.pause();
        h.stop();
        assert_eq!(h.state(), CaptureState::Stopped);
    }
    #[test]
    fn overflow_is_explicit() {
        let mut h = handle(1);
        for _ in 0..2 {
            h.emitter.send(Source::Mic, 48000, 1, &[1.]);
        }
        assert_eq!(h.state(), CaptureState::Stopped);
        assert!(matches!(h.errors.try_recv(), Ok(CaptureError::Overflow)));
    }
}
