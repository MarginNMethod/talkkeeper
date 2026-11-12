use crate::{archive, Error, Progress, Result, Stage};
use futures_util::StreamExt;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncWriteExt, process::Command};
use tokio_util::sync::CancellationToken;

pub fn allowed_url(url: &reqwest::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    matches!(
        url.host_str(),
        Some(
            "ollama.com"
                | "github.com"
                | "release-assets.githubusercontent.com"
                | "objects.githubusercontent.com"
                | "registry.ollama.ai"
        )
    )
}
pub fn download_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 || !allowed_url(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(crate::download_error)
}
#[derive(Clone)]
pub struct RuntimeSource {
    pub url: String,
    pub format: String,
    pub checksum: Option<String>,
}
impl RuntimeSource {
    pub async fn official(client: &reqwest::Client) -> Result<Self> {
        let stem: String = match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", _) => "ollama-darwin".into(),
            ("windows", "x86_64") => "ollama-windows-amd64".into(),
            ("linux", "x86_64") => "ollama-linux-amd64".into(),
            ("linux", "aarch64") => "ollama-linux-arm64".into(),
            _ => return Err(Error::Unsupported),
        };
        let formats: &[&str] = if cfg!(target_os = "windows") {
            &["zip"]
        } else if cfg!(target_os = "macos") {
            &["tgz"]
        } else {
            &["tar.zst", "tgz"]
        };
        for format in formats {
            let name = format!("{stem}.{format}");
            let url = format!("https://ollama.com/download/{name}");
            let response = client
                .head(&url)
                .send()
                .await
                .map_err(crate::download_error)?;
            if !response.status().is_success() {
                continue;
            }
            // GitHub's redirect preserves the version in the signed asset path's
            // preceding redirect. Resolve latest once to pin checksums and archive.
            let release_client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(crate::download_error)?;
            let release = release_client
                .get(format!(
                    "https://github.com/ollama/ollama/releases/latest/download/{name}"
                ))
                .send()
                .await
                .map_err(crate::download_error)?;
            let pinned = release
                .headers()
                .get("location")
                .and_then(|h| h.to_str().ok())
                .filter(|s| s.starts_with("https://github.com/ollama/ollama/releases/download/"))
                .map(str::to_owned)
                .unwrap_or(url);
            let sum_url = pinned
                .rsplit_once('/')
                .map(|(base, _)| format!("{base}/sha256sum.txt"))
                .ok_or(Error::Archive)?;
            let checksum = match client.get(sum_url).send().await {
                Ok(r) if r.status().is_success() => {
                    let text = r.text().await.map_err(crate::download_error)?;
                    let found = text.lines().find_map(|line| {
                        let mut words = line.split_whitespace();
                        let hash = words.next()?;
                        let file = words.next()?.trim_start_matches('*');
                        (file.trim_start_matches("./") == name
                            && hash.len() == 64
                            && hash.bytes().all(|c| c.is_ascii_hexdigit()))
                        .then(|| hash.to_lowercase())
                    });
                    Some(found.ok_or(Error::Checksum)?)
                }
                Ok(r) if r.status() == reqwest::StatusCode::NOT_FOUND => None,
                _ => return Err(Error::Offline),
            };
            return Ok(Self {
                url: pinned,
                format: format.to_string(),
                checksum,
            });
        }
        Err(Error::Offline)
    }
}
pub async fn install(
    directory: &Path,
    source: &RuntimeSource,
    client: &reqwest::Client,
    progress: &(impl Fn(Progress) + Send + Sync),
) -> Result<PathBuf> {
    std::fs::create_dir_all(directory)?;
    let staging = std::sync::Arc::new(tempfile::tempdir_in(directory)?);
    let archive_path = staging.path().join("download");
    let response = client
        .get(&source.url)
        .send()
        .await
        .map_err(crate::download_error)?
        .error_for_status()
        .map_err(crate::download_error)?;
    let total = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&archive_path).await?;
    let mut bytes = response.bytes_stream();
    let mut completed = 0;
    while let Some(part) = bytes.next().await {
        let part = part.map_err(crate::download_error)?;
        file.write_all(&part).await?;
        completed += part.len() as u64;
        progress(Progress::new(
            Stage::DownloadRuntime,
            completed,
            total,
            "Downloading the local AI engine",
        ));
    }
    file.flush().await?;
    drop(file);
    progress(Progress::new(
        Stage::DownloadRuntime,
        completed,
        total,
        "Checking and unpacking the local AI engine",
    ));
    let extracted = staging.path().join("unpacked");
    let worker_staging = staging.clone();
    let worker_extracted = extracted.clone();
    let format = source.format.clone();
    let checksum = source.checksum.clone();
    // Keep the temporary directory alive in the worker when cancellation drops
    // this future. It is removed after extraction stops, with no partial install.
    tokio::task::spawn_blocking(move || -> Result<()> {
        let _staging = worker_staging;
        if let Some(sum) = checksum {
            archive::verify_checksum(&archive_path, &sum)?;
        }
        archive::extract(&archive_path, &format, &worker_extracted)
    })
    .await
    .map_err(|_| Error::Archive)??;
    let binary = find_binary(&extracted).ok_or(Error::Archive)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755))?;
    }
    let mut version_command = Command::new(&binary);
    #[cfg(windows)]
    version_command.creation_flags(0x08000000);
    let output = version_command.arg("--version").kill_on_drop(true).output();
    if !tokio::time::timeout(Duration::from_secs(20), output)
        .await
        .map_err(|_| Error::Runtime)??
        .status
        .success()
    {
        return Err(Error::Runtime);
    }
    let final_dir = directory.join("runtime");
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir)?;
    }
    std::fs::rename(extracted, &final_dir)?;
    find_binary(&final_dir).ok_or(Error::Archive)
}
pub fn find_binary(root: &Path) -> Option<PathBuf> {
    [
        "ollama",
        "bin/ollama",
        "ollama.exe",
        "Ollama.app/Contents/Resources/ollama",
    ]
    .iter()
    .map(|p| root.join(p))
    .find(|p| p.is_file())
}
pub fn installed(directory: &Path) -> Option<PathBuf> {
    if let Some(binary) = find_binary(&directory.join("ollama/runtime")) {
        return Some(binary);
    }
    let name = if cfg!(windows) {
        "ollama.exe"
    } else {
        "ollama"
    };
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).map(|p| p.join(name)).collect())
        .unwrap_or_default();
    paths.extend(
        [
            "/Applications/Ollama.app/Contents/Resources/ollama",
            "/usr/local/bin/ollama",
            "/usr/bin/ollama",
        ]
        .map(PathBuf::from),
    );
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        paths.push(PathBuf::from(local).join("Programs/Ollama/ollama.exe"));
    }
    paths.into_iter().find(|p| p.is_file())
}
pub async fn is_running(client: &reqwest::Client, base: &str) -> bool {
    match client
        .get(format!("{base}/api/version"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .is_some_and(|v| v["version"].is_string()),
        _ => false,
    }
}
/// Dropping this owner stops only the child it created. External servers are
/// represented without a cancellation token and are never terminated.
pub struct OllamaRuntime {
    pub base_url: String,
    stop: Option<CancellationToken>,
}
impl Drop for OllamaRuntime {
    fn drop(&mut self) {
        if let Some(stop) = &self.stop {
            stop.cancel();
        }
    }
}
impl OllamaRuntime {
    pub fn external(base_url: String) -> Self {
        Self {
            base_url,
            stop: None,
        }
    }
    pub async fn start(binary: &Path, directory: &Path) -> Result<Self> {
        // Serialize launch until the new listener is ready, avoiding a race
        // between two children selecting the default private port in this process.
        static LAUNCH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
        let _launch = LAUNCH.lock().await;
        let listener = std::net::TcpListener::bind(("127.0.0.1", 11500))
            .or_else(|_| std::net::TcpListener::bind(("127.0.0.1", 0)))?;
        let port = listener.local_addr()?.port();
        drop(listener);
        let base_url = format!("http://127.0.0.1:{port}");
        let stop = CancellationToken::new();
        let worker_stop = stop.clone();
        let profile = directory.join("ollama/profile");
        let temporary = directory.join("ollama/tmp");
        std::fs::create_dir_all(&profile)?;
        std::fs::create_dir_all(&temporary)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&profile, std::fs::Permissions::from_mode(0o700))?;
        }
        let mut command = Command::new(binary);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        // Scope the engine's own profile to application data. Do not modify the
        // parent application's environment or the user's existing Ollama profile.
        #[cfg(unix)]
        command.env("HOME", &profile);
        #[cfg(windows)]
        command.env("USERPROFILE", &profile);
        command.env("OLLAMA_TMPDIR", &temporary);

        command
            .arg("serve")
            .env("OLLAMA_HOST", format!("127.0.0.1:{port}"))
            .env("OLLAMA_MODELS", directory.join("ollama/models"))
            .env("OLLAMA_NO_CLOUD", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|_| Error::Runtime)?;
        tokio::spawn(async move {
            for attempt in 0..=3 {
                tokio::select! {
                    _ = worker_stop.cancelled() => { let _ = child.kill().await; return; }
                    _ = child.wait() => {}
                }
                if attempt == 3 {
                    return;
                }
                tokio::select! { _ = worker_stop.cancelled() => return, _ = tokio::time::sleep(Duration::from_secs(1 << attempt)) => {} }
                match command.spawn() {
                    Ok(next) => child = next,
                    Err(_) => return,
                }
            }
        });
        let runtime = Self {
            base_url,
            stop: Some(stop),
        };
        let client = reqwest::Client::new();
        for _ in 0..120 {
            if is_running(&client, &runtime.base_url).await {
                return Ok(runtime);
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        Err(Error::Runtime)
    }
}
