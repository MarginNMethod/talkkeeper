#![cfg(target_os = "linux")]
use std::{
    error::Error,
    process::{Child, Command},
    time::Duration,
};
use talkkeeper_audio::{rms_dbfs, Capture, Source};

fn pactl(args: &[&str]) -> Result<String, Box<dyn Error>> {
    let output = Command::new("pactl").args(args).output()?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned().into());
    }
    Ok(String::from_utf8(output.stdout)?.trim().to_string())
}
struct Cleanup {
    default: String,
    module: String,
    tone: std::path::PathBuf,
    player: Option<Child>,
}
impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Some(child) = self.player.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = pactl(&["set-default-sink", &self.default]);
        let _ = pactl(&["unload-module", &self.module]);
        let _ = std::fs::remove_file(&self.tone);
    }
}

#[tokio::test]
#[ignore = "requires PulseAudio and TALKKEEPER_PULSE_TEST=1"]
async fn captures_default_monitor_tone() -> Result<(), Box<dyn Error>> {
    if std::env::var("TALKKEEPER_PULSE_TEST").as_deref() != Ok("1") {
        return Ok(());
    }
    if !Command::new("pulseaudio")
        .arg("--check")
        .status()?
        .success()
    {
        assert!(Command::new("pulseaudio")
            .args(["--start", "--exit-idle-time=-1"])
            .status()?
            .success());
    }
    let default = pactl(&["get-default-sink"])?;
    let module = pactl(&[
        "load-module",
        "module-null-sink",
        "sink_name=tk_test",
        "rate=48000",
    ])?;
    let tone = std::env::temp_dir().join(format!("talkkeeper-tone-{}.wav", std::process::id()));
    let mut cleanup = Cleanup {
        default,
        module,
        tone,
        player: None,
    };
    pactl(&["set-default-sink", "tk_test"])?;
    let mut writer = hound::WavWriter::create(
        &cleanup.tone,
        hound::WavSpec {
            channels: 1,
            sample_rate: 48000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )?;
    for i in 0..48000 * 6 {
        writer.write_sample(
            ((i as f32 * 440. * std::f32::consts::TAU / 48000.).sin() * 16000.) as i16,
        )?;
    }
    writer.finalize()?;
    cleanup.player = Some(
        Command::new("paplay")
            .arg("--device=tk_test")
            .arg("--latency-msec=20")
            .arg(&cleanup.tone)
            .spawn()?,
    );
    // A freshly created null sink can take two seconds to leave its initial idle cycle.
    tokio::time::sleep(Duration::from_secs(2)).await;
    let mut capture = Capture::start_system()?;
    let deadline = tokio::time::sleep(Duration::from_secs(2));
    tokio::pin!(deadline);
    let mut samples = Vec::new();
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            Some(error) = capture.errors.recv() => return Err(error.into()),
            frame = capture.frames.recv() => {
                let frame = frame.ok_or("capture ended early")?;
                assert_eq!(frame.source, Source::System); assert_eq!(frame.channels, 1); assert_eq!(frame.sample_rate, 48000);
                samples.extend(frame.samples);
            }
        }
    }
    capture.stop();
    // Ignore initial server silence; measure a continuous one-second tone window.
    let first = samples
        .iter()
        .position(|s| s.abs() > 0.01)
        .ok_or("no audible samples")?;
    eprintln!("received {} samples; tone starts at {first}", samples.len());
    let samples = samples
        .get(first..first + 48000)
        .ok_or("less than one second of tone")?;
    let db = rms_dbfs(samples);
    let crossings = samples
        .windows(2)
        .filter(|w| w[0] <= 0. && w[1] > 0.)
        .count();
    let hz = crossings as f32 * 48000. / samples.len() as f32;
    eprintln!(
        "PulseAudio monitor: {} samples, RMS {db:.2} dBFS, frequency {hz:.1} Hz",
        samples.len()
    );
    assert!(db > -25., "RMS {db} dBFS");
    assert!((hz - 440.).abs() < 5., "frequency {hz} Hz");
    Ok(())
}
