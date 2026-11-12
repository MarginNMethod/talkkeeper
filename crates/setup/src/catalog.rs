use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

const GB: u64 = 1_000_000_000;
/// Conservative allowance for the engine archive and its extracted libraries.
pub const RUNTIME_BYTES: u64 = 4 * GB;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Llm {
    pub ollama_tag: String,
    pub friendly_name: String,
    pub approx_download_gb: f64,
    pub license: String,
    pub notes: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Whisper {
    pub model: String,
    pub approx_download_mb: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tier {
    pub tier: String,
    pub min_ram_gb: u64,
    pub llm: Llm,
    pub whisper: Whisper,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Catalog(pub Vec<Tier>);
impl Catalog {
    pub fn bundled() -> Result<Self> {
        Self::parse(include_str!("../model-catalog.json"))
    }
    pub fn parse(json: &str) -> Result<Self> {
        let catalog: Self = serde_json::from_str(json).map_err(|_| Error::Catalog)?;
        if catalog.0.is_empty() || catalog.0[0].min_ram_gb != 0 {
            return Err(Error::Catalog);
        }
        for (i, t) in catalog.0.iter().enumerate() {
            if t.tier.trim().is_empty()
                || (i > 0 && t.min_ram_gb <= catalog.0[i - 1].min_ram_gb)
                || !t
                    .llm
                    .ollama_tag
                    .split_once(':')
                    .is_some_and(|(name, version)| {
                        let valid = |part: &str| {
                            !part.is_empty()
                                && part
                                    .bytes()
                                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
                        };
                        valid(name) && valid(version)
                    })
                || t.llm.friendly_name.trim().is_empty()
                || t.llm.license.trim().is_empty()
                || t.llm.notes.trim().is_empty()
                || !t.llm.approx_download_gb.is_finite()
                || !(0.01..=1000.).contains(&t.llm.approx_download_gb)
                || !t.whisper.approx_download_mb.is_finite()
                || t.whisper.approx_download_mb <= 0.
                || !talkkeeper_transcribe::models::MODELS.iter().any(|m| {
                    m.name == t.whisper.model
                        && (m.size as f64 / 1e6 - t.whisper.approx_download_mb).abs() < 2.
                })
            {
                return Err(Error::Catalog);
            }
        }
        Ok(catalog)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hardware {
    pub total_ram_bytes: u64,
    pub free_disk_bytes: u64,
    pub arch: String,
    pub os: String,
    pub apple_silicon: bool,
    pub nvidia: bool,
    pub amd: bool,
}
impl Hardware {
    pub fn detect(app_data: &Path) -> Result<Self> {
        let system = sysinfo::System::new_all();
        let canonical = app_data.canonicalize()?;
        let disks = sysinfo::Disks::new_with_refreshed_list();
        let free_disk_bytes = disks
            .iter()
            .filter(|d| {
                canonical.starts_with(
                    d.mount_point()
                        .canonicalize()
                        .unwrap_or_else(|_| d.mount_point().to_path_buf()),
                )
            })
            .max_by_key(|d| d.mount_point().components().count())
            .map(|d| d.available_space())
            .ok_or(Error::Disk)?;
        let devices = std::fs::read_dir("/sys/class/drm")
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter_map(|e| std::fs::read_to_string(e.path().join("device/vendor")).ok())
            .collect::<String>();
        let gpu = if cfg!(target_os = "windows") {
            std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-Command",
                    "(Get-CimInstance Win32_VideoController).Name",
                ])
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
                .unwrap_or_default()
        } else {
            devices
        };
        Ok(Self {
            total_ram_bytes: system.total_memory(),
            free_disk_bytes,
            arch: std::env::consts::ARCH.into(),
            os: std::env::consts::OS.into(),
            apple_silicon: cfg!(all(target_os = "macos", target_arch = "aarch64")),
            nvidia: gpu.contains("0x10de") || gpu.contains("nvidia"),
            amd: gpu.contains("0x1002") || gpu.contains("amd"),
        })
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub llm: Llm,
    pub whisper: Whisper,
    pub total_download_bytes: u64,
    pub hardware: Hardware,
    pub notice: Option<String>,
    pub can_install: bool,
}
pub fn recommend(hardware: &Hardware, catalog: &Catalog) -> Result<Plan> {
    // Physical RAM is rounded to the nearest GiB to account for hardware reservations.
    let ram = (hardware.total_ram_bytes + (1 << 29)) / (1 << 30);
    let preferred = catalog
        .0
        .iter()
        .rposition(|t| ram >= t.min_ram_gb)
        .ok_or(Error::Catalog)?;
    let size = |t: &Tier| {
        (t.llm.approx_download_gb * GB as f64) as u64
            + (t.whisper.approx_download_mb * 1e6) as u64
            + RUNTIME_BYTES
    };
    let chosen = (0..=preferred)
        .rev()
        .find(|&i| hardware.free_disk_bytes >= size(&catalog.0[i]).saturating_mul(13) / 10);
    let index = chosen.unwrap_or(0);
    let t = &catalog.0[index];
    Ok(Plan {
        llm: t.llm.clone(),
        whisper: t.whisper.clone(),
        total_download_bytes: size(t),
        hardware: hardware.clone(),
        can_install: chosen.is_some() && ram >= 4,
        notice: if ram < 4 {
            Some("This computer has too little memory for local AI. The smallest model is shown here; use your own AI provider instead.".into())
        } else if chosen.is_none() {
            Some(
                "Free more storage before setting up local AI, or use your own AI provider.".into(),
            )
        } else if index < preferred {
            Some("We chose a smaller AI model to fit your available storage.".into())
        } else {
            None
        },
    })
}
