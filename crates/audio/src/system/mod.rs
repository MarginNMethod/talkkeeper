use crate::{Emitter, Result};

/// Platform backends own native resources on the capture worker thread.
pub trait SystemAudioSource {
    /// Nonblocking read; shutdown is checked between calls.
    fn poll(&mut self, output: &Emitter) -> Result<()>;
}
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux::NativeSource;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows::NativeSource;
#[cfg(all(target_os = "macos", feature = "macos-screencapture"))]
mod macos;
#[cfg(all(target_os = "macos", feature = "macos-screencapture"))]
use macos::NativeSource;

pub fn open(_output: &Emitter) -> Result<Box<dyn SystemAudioSource>> {
    #[cfg(any(
        target_os = "linux",
        target_os = "windows",
        all(target_os = "macos", feature = "macos-screencapture")
    ))]
    {
        #[cfg(target_os = "macos")]
        let source = NativeSource::open(_output.clone())?;
        #[cfg(not(target_os = "macos"))]
        let source = NativeSource::open()?;
        Ok(Box::new(source))
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "windows",
        all(target_os = "macos", feature = "macos-screencapture")
    )))]
    {
        Err(crate::backend(
            "system audio capture is not available in this build",
        ))
    }
}
