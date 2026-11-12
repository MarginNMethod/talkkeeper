use super::SystemAudioSource;
use crate::{backend, Emitter, Result, Source};
use wasapi::{
    AudioCaptureClient, AudioClient, DeviceEnumerator, Direction, SampleType, StreamMode,
    WaveFormat,
};

struct Com;
impl Drop for Com {
    fn drop(&mut self) {
        wasapi::deinitialize();
    }
}
pub struct NativeSource {
    capture: AudioCaptureClient,
    client: AudioClient,
    _com: Com,
}
impl NativeSource {
    pub fn open() -> Result<Self> {
        wasapi::initialize_mta().ok().map_err(backend)?;
        let com = Com;
        let device = DeviceEnumerator::new()
            .map_err(backend)?
            .get_default_device(Direction::Render)
            .map_err(backend)?;
        let mut client = device.get_iaudioclient().map_err(backend)?;
        let format = WaveFormat::new(32, 32, SampleType::Float, 48000, 2, None);
        let mode = StreamMode::PollingShared {
            autoconvert: true,
            buffer_duration_hns: 200_000,
        };
        // Capture direction on a render endpoint requests WASAPI loopback.
        client
            .initialize_client(&format, Direction::Capture, mode, None)
            .map_err(backend)?;
        let capture = client.get_audiocaptureclient().map_err(backend)?;
        client.start_stream().map_err(backend)?;
        Ok(Self {
            capture,
            client,
            _com: com,
        })
    }
}
impl SystemAudioSource for NativeSource {
    fn poll(&mut self, output: &Emitter) -> Result<()> {
        for _ in 0..32 {
            let frames = self
                .capture
                .get_next_packet_size()
                .map_err(backend)?
                .unwrap_or(0);
            if frames == 0 {
                break;
            }
            let mut bytes = vec![0; frames as usize * 8];
            let (read, _) = self.capture.read_from_device(&mut bytes).map_err(backend)?;
            let (chunks, _) = bytes[..read as usize * 8].as_chunks::<4>();
            let samples: Vec<f32> = chunks.iter().map(|b| f32::from_le_bytes(*b)).collect();
            output.send(Source::System, 48000, 2, &samples);
        }
        Ok(())
    }
}
impl Drop for NativeSource {
    fn drop(&mut self) {
        let _ = self.client.stop_stream();
    }
}
