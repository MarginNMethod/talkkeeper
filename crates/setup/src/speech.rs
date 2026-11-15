//! A restartable speech download. Only a verified file becomes a recording preference.
use crate::{archive, Error, Progress, Result, Stage};
use futures_util::StreamExt;
use std::path::Path;
use talkkeeper_transcribe::models::{Model, ModelManager};
use tokio::io::AsyncWriteExt;

pub async fn download(
    directory: &Path,
    model: &Model,
    progress: &(impl Fn(Progress) + Send + Sync),
) -> Result<()> {
    let manager = ModelManager::new(directory);
    let destination = manager.path(model);
    if manager.is_present(model).await.map_err(|_| Error::Speech)? {
        progress(Progress::new(
            Stage::DownloadSpeechModel,
            model.size,
            model.size,
            "Your speech model is downloaded",
        ));
        return Ok(());
    }
    tokio::fs::create_dir_all(directory.join("models")).await?;
    let partial = destination.with_extension("download");
    let mut saved = tokio::fs::metadata(&partial)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    if saved > model.size {
        tokio::fs::remove_file(&partial).await?;
        saved = 0;
    }
    progress(Progress::new(
        Stage::DownloadSpeechModel,
        saved,
        model.size,
        "Downloading your speech model",
    ));
    if saved < model.size {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(20))
            .read_timeout(std::time::Duration::from_secs(120))
            .https_only(!cfg!(test))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(crate::download_error)?;
        let mut request = client.get(model.url);
        if saved > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={saved}-"));
        }
        let response = request
            .send()
            .await
            .map_err(crate::download_error)?
            .error_for_status()
            .map_err(crate::download_error)?;
        let offset = if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            saved
        } else {
            0
        };
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(offset > 0)
            .truncate(offset == 0)
            .open(&partial)
            .await?;
        let mut stream = response.bytes_stream();
        let mut done = offset;
        while let Some(bytes) = stream.next().await {
            let bytes = bytes.map_err(crate::download_error)?;
            done += bytes.len() as u64;
            if done > model.size {
                drop(file);
                tokio::fs::remove_file(&partial).await?;
                return Err(Error::Checksum);
            }
            file.write_all(&bytes).await?;
            progress(Progress::new(
                Stage::DownloadSpeechModel,
                done,
                model.size,
                "Downloading and checking your speech model",
            ));
        }
        file.flush().await?;
        file.sync_all().await?;
        if done != model.size {
            return Err(Error::Offline);
        }
    }
    let check_path = partial.clone();
    let checksum = model.sha256.to_owned();
    if let Err(error) =
        tokio::task::spawn_blocking(move || archive::verify_checksum(&check_path, &checksum))
            .await
            .map_err(|_| Error::Speech)?
    {
        tokio::fs::remove_file(&partial).await?;
        return Err(error);
    }
    // Windows cannot replace a file that is open; all download and checksum handles are closed.
    tokio::fs::rename(&partial, &destination).await?;
    if !manager.is_present(model).await.map_err(|_| Error::Speech)? {
        return Err(Error::Checksum);
    }
    Ok(())
}
