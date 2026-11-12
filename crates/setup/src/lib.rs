//! Consent-driven local AI provisioning. Construction and planning never download.
pub mod archive;
mod catalog;
pub mod runtime;
pub use catalog::*;
use futures_util::StreamExt;
pub use runtime::OllamaRuntime;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};
pub use tokio_util::sync::CancellationToken;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Cannot download. Check your connection and allow TalkKeeper through your firewall, then retry.")]
    Offline,
    #[error("Downloads are blocked. Allow TalkKeeper through your firewall or network filter, then retry.")]
    Blocked,
    #[error("This computer has too little memory for local AI. Use your own AI provider in Advanced settings.")]
    Memory,
    #[error("Not enough storage. Free space on the application drive, then retry.")]
    Disk,
    #[error("The AI engine could not start. Close other AI apps, restart TalkKeeper, then retry.")]
    Runtime,
    #[error("The download did not pass its integrity check. Retry to download a fresh copy.")]
    Checksum,
    #[error("The engine archive is unsafe or incomplete. Retry the download.")]
    Archive,
    #[error("The model catalog is invalid. Restore the bundled catalog or update TalkKeeper.")]
    Catalog,
    #[error("Automatic setup is unavailable on this platform. Choose your own provider in Advanced settings.")]
    Unsupported,
    #[error("Setup cancelled. You can resume by choosing Set up automatically.")]
    Cancelled,
    #[error("The AI model did not answer. Free memory and retry, or choose a smaller model in Advanced settings.")]
    Verify,
    #[error("The speech model could not be downloaded. Check your connection and free storage, then retry.")]
    Speech,
    #[error(
        "Cannot write application files. Check free storage and folder permissions, then retry."
    )]
    Io(#[from] std::io::Error),
}
pub type Result<T> = std::result::Result<T, Error>;
pub(crate) fn download_error(error: reqwest::Error) -> Error {
    if matches!(
        error.status(),
        Some(reqwest::StatusCode::FORBIDDEN | reqwest::StatusCode::UNAUTHORIZED)
    ) {
        Error::Blocked
    } else {
        Error::Offline
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Stage {
    Check,
    DownloadRuntime,
    StartRuntime,
    PullModel,
    DownloadSpeechModel,
    Verify,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Progress {
    pub stage: Stage,
    pub completed: u64,
    pub total: u64,
    pub percent: Option<f64>,
    pub message: String,
}
impl Progress {
    pub fn new(stage: Stage, completed: u64, total: u64, message: &str) -> Self {
        Self {
            stage,
            completed,
            total,
            percent: (total > 0).then(|| (completed as f64 / total as f64 * 100.).min(100.)),
            message: message.into(),
        }
    }
}
#[derive(Debug, Deserialize)]
pub struct PullProgress {
    pub status: Option<String>,
    pub completed: Option<u64>,
    pub total: Option<u64>,
    pub error: Option<String>,
}
pub fn parse_pull(line: &str) -> Result<PullProgress> {
    let value: PullProgress = serde_json::from_str(line).map_err(|_| Error::Verify)?;
    if value.error.is_some() {
        return Err(Error::Verify);
    }
    Ok(value)
}
pub struct Setup {
    pub directory: PathBuf,
    #[cfg(test)]
    test_source: Option<runtime::RuntimeSource>,
    #[cfg(test)]
    test_existing: Option<String>,
    #[cfg(test)]
    test_speech: Option<talkkeeper_transcribe::models::Model>,
}
impl Setup {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
            #[cfg(test)]
            test_source: None,
            #[cfg(test)]
            test_existing: None,
            #[cfg(test)]
            test_speech: None,
        }
    }
    fn binary(&self) -> Option<PathBuf> {
        #[cfg(test)]
        if self.test_source.is_some() {
            return runtime::find_binary(&self.directory.join("ollama/runtime"));
        }
        runtime::installed(&self.directory)
    }
    pub fn plan(&self) -> Result<Plan> {
        recommend(&Hardware::detect(&self.directory)?, &Catalog::bundled()?)
    }
    /// Attach/start only. Used after completed setup on later launches; never downloads.
    pub async fn resume_runtime(&self) -> Result<OllamaRuntime> {
        let client = reqwest::Client::new();
        let base = "http://127.0.0.1:11434";
        if runtime::is_running(&client, base).await {
            return Ok(OllamaRuntime::external(base.into()));
        }
        OllamaRuntime::start(
            &runtime::installed(&self.directory).ok_or(Error::Runtime)?,
            &self.directory,
        )
        .await
    }
    pub async fn run_setup(
        &self,
        plan: &Plan,
        on_progress: impl Fn(Progress) + Send + Sync,
        cancel_token: CancellationToken,
    ) -> Result<OllamaRuntime> {
        tokio::select! {
            biased;
            _ = cancel_token.cancelled() => Err(Error::Cancelled),
            result = self.run(plan, &on_progress) => result,
        }
    }
    async fn run(
        &self,
        plan: &Plan,
        progress: &(impl Fn(Progress) + Send + Sync),
    ) -> Result<OllamaRuntime> {
        progress(Progress::new(Stage::Check, 0, 1, "Checking your computer"));
        let client = runtime::download_client()?;
        let external = "http://127.0.0.1:11434";
        #[cfg(test)]
        let external = self.test_existing.as_deref().unwrap_or(external);
        let speech = talkkeeper_transcribe::models::MODELS
            .iter()
            .find(|m| m.name == plan.whisper.model)
            .ok_or(Error::Catalog)?;
        #[cfg(test)]
        let speech = self.test_speech.as_ref().unwrap_or(speech);
        let hardware = Hardware::detect(&self.directory)?;
        if (hardware.total_ram_bytes + (1 << 29)) / (1 << 30) < 4 {
            return Err(Error::Memory);
        }
        let mut needed = plan.total_download_bytes;
        if self.binary().is_some() || runtime::is_running(&client, external).await {
            needed = needed.saturating_sub(RUNTIME_BYTES);
        }
        if talkkeeper_transcribe::models::ModelManager::new(&self.directory)
            .is_present(speech)
            .await
            .map_err(|_| Error::Speech)?
        {
            needed = needed.saturating_sub((plan.whisper.approx_download_mb * 1e6) as u64);
        }
        if runtime::is_running(&client, external).await {
            if let Ok(response) = client.get(format!("{external}/api/tags")).send().await {
                if let Ok(tags) = response.json::<Value>().await {
                    if tags["models"].as_array().is_some_and(|models| {
                        models.iter().any(|m| m["name"] == plan.llm.ollama_tag)
                    }) {
                        needed = needed.saturating_sub((plan.llm.approx_download_gb * 1e9) as u64);
                    }
                }
            }
        }
        if hardware.free_disk_bytes < needed.saturating_mul(13) / 10 {
            return Err(Error::Disk);
        }
        progress(Progress::new(
            Stage::Check,
            1,
            1,
            "Your computer is ready for setup",
        ));
        let runtime = if runtime::is_running(&client, external).await {
            progress(Progress::new(
                Stage::DownloadRuntime,
                1,
                1,
                "Using your installed AI engine",
            ));
            progress(Progress::new(
                Stage::StartRuntime,
                1,
                1,
                "Your AI engine is running",
            ));
            OllamaRuntime::external(external.into())
        } else {
            let binary = if let Some(binary) = self.binary() {
                progress(Progress::new(
                    Stage::DownloadRuntime,
                    1,
                    1,
                    "Using your installed AI engine",
                ));
                binary
            } else {
                progress(Progress::new(
                    Stage::DownloadRuntime,
                    0,
                    0,
                    "Finding the local AI engine",
                ));
                #[cfg(not(test))]
                let source = runtime::RuntimeSource::official(&client).await?;
                #[cfg(test)]
                let source = match &self.test_source {
                    Some(source) => source.clone(),
                    None => runtime::RuntimeSource::official(&client).await?,
                };
                runtime::install(&self.directory.join("ollama"), &source, &client, progress).await?
            };
            progress(Progress::new(
                Stage::StartRuntime,
                0,
                1,
                "Starting your local AI engine",
            ));
            let runtime = OllamaRuntime::start(&binary, &self.directory).await?;
            progress(Progress::new(
                Stage::StartRuntime,
                1,
                1,
                "Your AI engine is running",
            ));
            runtime
        };
        provision(&runtime, &client, plan, &self.directory, speech, progress).await?;
        Ok(runtime)
    }
}
pub async fn pull_model(
    base: &str,
    client: &reqwest::Client,
    model: &str,
    progress: &(impl Fn(Progress) + Send + Sync),
) -> Result<()> {
    let tags: Value = client
        .get(format!("{base}/api/tags"))
        .send()
        .await
        .map_err(|_| Error::Runtime)?
        .error_for_status()
        .map_err(|_| Error::Runtime)?
        .json()
        .await
        .map_err(|_| Error::Runtime)?;
    if tags["models"].as_array().is_some_and(|models| {
        models
            .iter()
            .any(|m| m["name"] == model || m["model"] == model)
    }) {
        progress(Progress::new(
            Stage::PullModel,
            1,
            1,
            "Your AI model is already downloaded",
        ));
        return Ok(());
    }
    progress(Progress::new(
        Stage::PullModel,
        0,
        0,
        "Downloading your AI model",
    ));
    let response = client
        .post(format!("{base}/api/pull"))
        .json(&json!({"model":model,"stream":true}))
        .send()
        .await
        .map_err(|_| Error::Offline)?
        .error_for_status()
        .map_err(|_| Error::Offline)?;
    let mut stream = response.bytes_stream();
    let mut pending = Vec::new();
    let mut success = false;
    while let Some(bytes) = stream.next().await {
        pending.extend_from_slice(&bytes.map_err(|_| Error::Offline)?);
        if pending.len() > 1_048_576 {
            return Err(Error::Verify);
        }
        while let Some(end) = pending.iter().position(|b| *b == b'\n') {
            let line: Vec<_> = pending.drain(..=end).collect();
            if line.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            let p = parse_pull(std::str::from_utf8(&line).map_err(|_| Error::Verify)?)?;
            success |= p.status.as_deref() == Some("success");
            progress(Progress::new(
                Stage::PullModel,
                p.completed.unwrap_or(0),
                p.total.unwrap_or(0),
                "Downloading and checking your AI model",
            ));
        }
    }
    if !pending.is_empty() {
        success |= parse_pull(std::str::from_utf8(&pending).map_err(|_| Error::Verify)?)?
            .status
            .as_deref()
            == Some("success");
    }
    if !success {
        return Err(Error::Verify);
    }
    progress(Progress::new(
        Stage::PullModel,
        1,
        1,
        "Your AI model is downloaded",
    ));
    Ok(())
}
pub async fn verify_model(base: &str, model: &str) -> Result<()> {
    let provider = talkkeeper_llm::build_provider(
        talkkeeper_llm::ProviderConfig::Ollama {
            base_url: base.into(),
        },
        &talkkeeper_llm::InMemorySecretStore::default(),
    )
    .map_err(|_| Error::Verify)?;
    let response = tokio::time::timeout(
        Duration::from_secs(600),
        provider.complete(talkkeeper_llm::CompletionRequest {
            model: model.into(),
            system: "Answer briefly.".into(),
            messages: vec![talkkeeper_llm::Message {
                role: talkkeeper_llm::Role::User,
                content: "Say ready.".into(),
            }],
            max_tokens: Some(64),
            temperature: Some(0.),
        }),
    )
    .await
    .map_err(|_| Error::Verify)?
    .map_err(|_| Error::Verify)?;
    if response.text.trim().is_empty() {
        return Err(Error::Verify);
    }
    Ok(())
}
async fn provision(
    runtime: &OllamaRuntime,
    client: &reqwest::Client,
    plan: &Plan,
    directory: &std::path::Path,
    model: &talkkeeper_transcribe::models::Model,
    progress: &(impl Fn(Progress) + Send + Sync),
) -> Result<()> {
    pull_model(&runtime.base_url, client, &plan.llm.ollama_tag, progress).await?;
    progress(Progress::new(
        Stage::DownloadSpeechModel,
        0,
        0,
        "Downloading your speech model",
    ));
    talkkeeper_transcribe::models::ModelManager::new(directory)
        .download(model, |done, total| {
            progress(Progress::new(
                Stage::DownloadSpeechModel,
                done,
                total,
                "Downloading and checking your speech model",
            ))
        })
        .await
        .map_err(|_| Error::Speech)?;
    progress(Progress::new(
        Stage::Verify,
        0,
        1,
        "Checking that your AI can answer",
    ));
    verify_model(&runtime.base_url, &plan.llm.ollama_tag).await?;
    progress(Progress::new(Stage::Verify, 1, 1, "You're ready"));
    Ok(())
}

#[cfg(test)]
mod tests;
