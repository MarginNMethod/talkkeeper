//! cargo run -p talkkeeper-audio --example record -- 5
use std::{error::Error, time::Duration};
use talkkeeper_audio::{Capture, CaptureConfig, Source};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let seconds: u64 = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "5".into())
        .parse()?;
    eprintln!("Record only with participants' consent. Recording {seconds} seconds to mic.wav and system.wav.");
    let mut capture = Capture::start(CaptureConfig {
        capture_system: true,
        ..Default::default()
    })?;
    let mut mic = None;
    let mut system = None;
    let deadline = tokio::time::sleep(Duration::from_secs(seconds));
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            Some(error) = capture.errors.recv() => return Err(error.into()),
            frame = capture.frames.recv() => {
                let Some(frame) = frame else { break; };
                let (writer, path) = match frame.source { Source::Mic => (&mut mic, "mic.wav"), Source::System => (&mut system, "system.wav") };
                if writer.is_none() {
                    *writer = Some(hound::WavWriter::create(path, hound::WavSpec { channels: 1, sample_rate: frame.sample_rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float })?);
                }
                for sample in frame.samples { writer.as_mut().unwrap().write_sample(sample)?; }
            }
        }
    }
    capture.stop();
    if let Some(writer) = mic {
        writer.finalize()?;
    }
    if let Some(writer) = system {
        writer.finalize()?;
    }
    Ok(())
}
