use super::SystemAudioSource;
use crate::{backend, Emitter, Result, Source};
use screencapturekit::prelude::*;

struct AudioOutput(Emitter);
impl SCStreamOutputTrait for AudioOutput {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, kind: SCStreamOutputType) {
        if kind != SCStreamOutputType::Audio {
            return;
        }
        match sample.audio_buffer_list() {
            Ok(list) => {
                for buffer in &list {
                    let (chunks, _) = buffer.data().as_chunks::<4>();
                    let samples: Vec<f32> = chunks.iter().map(|b| f32::from_ne_bytes(*b)).collect();
                    self.0.send(Source::System, 48000, 1, &samples);
                }
            }
            Err(code) => self.0.fail(backend(format!(
                "ScreenCaptureKit audio buffer error {code}"
            ))),
        }
    }
}
impl SCStreamDelegateTrait for AudioOutput {
    fn did_stop_with_error(&self, error: SCError) {
        self.0.fail(backend(error));
    }
}

pub struct NativeSource {
    stream: SCStream,
}
impl NativeSource {
    pub fn open(output: Emitter) -> Result<Self> {
        let content = SCShareableContent::get().map_err(backend)?;
        let display = content
            .displays()
            .into_iter()
            .next()
            .ok_or_else(|| backend("no display available for system audio capture"))?;
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build()
            .map_err(backend)?;
        let config = SCStreamConfiguration::new()
            .with_width(2)
            .with_height(2)
            .with_captures_audio(true)
            .with_sample_rate(48000)
            .with_channel_count(1)
            .with_excludes_current_process_audio(true);
        let mut stream = SCStream::new_with_delegate(&filter, &config, AudioOutput(output.clone()))
            .map_err(backend)?;
        // Only register audio output: no video buffers are delivered or stored.
        stream
            .add_output_handler(AudioOutput(output), SCStreamOutputType::Audio)
            .map_err(backend)?;
        stream.start_capture().map_err(backend)?;
        Ok(Self { stream })
    }
}
impl SystemAudioSource for NativeSource {
    fn poll(&mut self, _output: &Emitter) -> Result<()> {
        Ok(())
    }
}
impl Drop for NativeSource {
    fn drop(&mut self) {
        let _ = self.stream.stop_capture();
    }
}
