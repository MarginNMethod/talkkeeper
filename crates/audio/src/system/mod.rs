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
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos::NativeSource;

pub fn open(_output: &Emitter) -> Result<Box<dyn SystemAudioSource>> {
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    {
        #[cfg(target_os = "macos")]
        let source = NativeSource::open(_output.clone())?;
        #[cfg(not(target_os = "macos"))]
        let source = NativeSource::open()?;
        Ok(Box::new(source))
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        Err(crate::backend(
            "system capture is unsupported on this platform",
        ))
    }
}
