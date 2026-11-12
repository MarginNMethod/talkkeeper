fn main() {
    // The macOS system-audio binding (ScreenCaptureKit) links Apple's Swift runtime.
    // Tell the linker where to find it so this crate's own test programs can start.
    let macos = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos");
    if macos && std::env::var_os("CARGO_FEATURE_MACOS_SCREENCAPTURE").is_some() {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
}
