fn main() {
    // The macOS system-audio crate links Apple's Swift runtime. Make sure the
    // app and its test binaries can find it at launch.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::build();
}
