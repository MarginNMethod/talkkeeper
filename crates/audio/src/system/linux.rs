use super::SystemAudioSource;
use crate::{backend, Emitter, Result, Source};
use libpulse_binding::{
    context::{Context, FlagSet as ContextFlags, State as ContextState},
    def::BufferAttr,
    mainloop::standard::{IterateResult, Mainloop},
    sample::{Format, Spec},
    stream::{FlagSet, PeekResult, State, Stream},
};
use std::time::{Duration, Instant};

pub struct NativeSource {
    stream: Stream,
    context: Context,
    mainloop: Mainloop,
}
impl NativeSource {
    pub fn open() -> Result<Self> {
        let mut mainloop =
            Mainloop::new().ok_or_else(|| backend("PulseAudio mainloop allocation failed"))?;
        let mut context = Context::new(&mainloop, "TalkKeeper")
            .ok_or_else(|| backend("PulseAudio context allocation failed"))?;
        context
            .connect(None, ContextFlags::NOAUTOSPAWN, None)
            .map_err(backend)?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while context.get_state() != ContextState::Ready {
            if matches!(
                context.get_state(),
                ContextState::Failed | ContextState::Terminated
            ) {
                return Err(backend("PulseAudio connection failed"));
            }
            step(&mut mainloop, deadline)?;
        }
        let spec = Spec {
            format: Format::FLOAT32NE,
            channels: 2,
            rate: 48000,
        };
        let mut stream = Stream::new(&mut context, "System audio", &spec, None)
            .ok_or_else(|| backend("PulseAudio stream allocation failed"))?;
        let attr = BufferAttr {
            maxlength: u32::MAX,
            tlength: u32::MAX,
            prebuf: u32::MAX,
            minreq: u32::MAX,
            fragsize: 480 * 8,
        };
        // PulseAudio resolves this alias to the current default sink's monitor.
        stream
            .connect_record(
                Some("@DEFAULT_MONITOR@"),
                Some(&attr),
                FlagSet::ADJUST_LATENCY,
            )
            .map_err(backend)?;
        while stream.get_state() != State::Ready {
            if matches!(stream.get_state(), State::Failed | State::Terminated) {
                return Err(backend("PulseAudio monitor unavailable"));
            }
            step(&mut mainloop, deadline)?;
        }
        Ok(Self {
            stream,
            context,
            mainloop,
        })
    }
}
fn step(mainloop: &mut Mainloop, deadline: Instant) -> Result<()> {
    if Instant::now() >= deadline {
        return Err(backend("PulseAudio initialization timed out"));
    }
    if !matches!(mainloop.iterate(false), IterateResult::Success(_)) {
        return Err(backend("PulseAudio mainloop failed"));
    }
    std::thread::sleep(Duration::from_millis(2));
    Ok(())
}
impl SystemAudioSource for NativeSource {
    fn poll(&mut self, output: &Emitter) -> Result<()> {
        if !matches!(self.mainloop.iterate(false), IterateResult::Success(_))
            || self.stream.get_state() != State::Ready
        {
            return Err(backend("PulseAudio capture disconnected"));
        }
        // Limit each poll so a busy server cannot starve cancellation.
        for _ in 0..32 {
            match self.stream.peek().map_err(backend)? {
                PeekResult::Empty => break,
                PeekResult::Hole(bytes) => {
                    output.send(Source::System, 48000, 2, &vec![0.; bytes / 4])
                }
                PeekResult::Data(bytes) => {
                    let (chunks, _) = bytes.as_chunks::<4>();
                    let samples: Vec<f32> = chunks.iter().map(|b| f32::from_ne_bytes(*b)).collect();
                    output.send(Source::System, 48000, 2, &samples);
                }
            }
            self.stream.discard().map_err(backend)?;
        }
        Ok(())
    }
}
impl Drop for NativeSource {
    fn drop(&mut self) {
        let _ = self.stream.disconnect();
        self.context.disconnect();
    }
}
