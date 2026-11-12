//! Verified model downloads into a caller-supplied application data directory.
use crate::{Error, Result};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[derive(Debug)]
pub struct Model {
    pub name: &'static str,
    pub file: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub url: &'static str,
}
include!("model_catalog.rs");
pub struct ModelManager {
    directory: PathBuf,
    client: reqwest::Client,
}
impl ModelManager {
    pub fn new(app_data: impl AsRef<Path>) -> Self {
        Self {
            directory: app_data.as_ref().join("models"),
            client: reqwest::Client::new(),
        }
    }
    pub fn path(&self, model: &Model) -> PathBuf {
        self.directory.join(model.file)
    }
    pub async fn is_present(&self, model: &Model) -> Result<bool> {
        let path = self.path(model);
        match tokio::fs::metadata(&path).await {
            Ok(meta) if meta.len() == model.size => Ok(hash_file(&path).await? == model.sha256),
            Ok(_) => Ok(false),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e.into()),
        }
    }
    pub async fn download(
        &self,
        model: &Model,
        mut progress: impl FnMut(u64, u64) + Send,
    ) -> Result<PathBuf> {
        if self.is_present(model).await? {
            progress(model.size, model.size);
            return Ok(self.path(model));
        }
        tokio::fs::create_dir_all(&self.directory).await?;
        // A unique temporary path cleans itself up if the download is cancelled.
        let (file, temp) = tempfile::NamedTempFile::new_in(&self.directory)?.into_parts();
        let mut file = tokio::fs::File::from_std(file);
        let result = async {
            let response = self
                .client
                .get(model.url)
                .send()
                .await
                .map_err(|_| Error::Http)?
                .error_for_status()
                .map_err(|_| Error::Http)?;
            let mut stream = response.bytes_stream();
            let mut hasher = Sha256::new();
            let mut received = 0;
            while let Some(bytes) = stream.next().await {
                let bytes = bytes.map_err(|_| Error::Http)?;
                received += bytes.len() as u64;
                if received > model.size {
                    return Err(Error::Verification);
                }
                hasher.update(&bytes);
                file.write_all(&bytes).await?;
                progress(received, model.size);
            }
            if received != model.size || format!("{:x}", hasher.finalize()) != model.sha256 {
                return Err(Error::Verification);
            }
            file.flush().await?;
            file.sync_all().await?;
            drop(file);
            tokio::fs::rename(&*temp, self.path(model)).await?;
            Ok(self.path(model))
        }
        .await;
        result
    }
}
async fn hash_file(path: &Path) -> Result<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut buffer = vec![0; 65536];
    let mut hash = Sha256::new();
    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{matchers::method, Mock, MockServer, ResponseTemplate};
    #[tokio::test]
    async fn download_checks_hash_size_progress_and_existing_files() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"abc".to_vec()))
            .expect(2)
            .mount(&server)
            .await;
        let model = Model {
            name: "test",
            file: "model.bin",
            size: 3,
            sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            url: Box::leak(server.uri().into_boxed_str()),
        };
        let directory = tempfile::tempdir().unwrap();
        let manager = ModelManager::new(directory.path());
        assert!(!manager.is_present(&model).await.unwrap());
        let mut progress = Vec::new();
        let path = manager
            .download(&model, |done, total| progress.push((done, total)))
            .await
            .unwrap();
        assert_eq!(progress.last(), Some(&(3, 3)));
        assert!(manager.is_present(&model).await.unwrap());
        manager.download(&model, |_, _| {}).await.unwrap();
        tokio::fs::write(&path, b"bad").await.unwrap();
        assert!(!manager.is_present(&model).await.unwrap());
        let wrong = Model {
            sha256: "wrong",
            ..model
        };
        assert!(matches!(
            manager.download(&wrong, |_, _| {}).await,
            Err(Error::Verification)
        ));
        assert_eq!(
            std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1
        );
    }
}
