use crate::{Error, Result};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Component, Path},
};

pub fn verify_checksum(path: &Path, expected: &str) -> Result<()> {
    let mut input = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = input.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    if format!("{:x}", hash.finalize()) != expected {
        return Err(Error::Checksum);
    }
    Ok(())
}
fn safe(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
        && !path.to_string_lossy().contains('\\')
        && !path.to_string_lossy().contains(':')
}
/// Extract only files/directories. Links are resolved to regular files after all
/// entries are checked, so an archive can never write through a symlink.
pub fn extract(path: &Path, format: &str, destination: &Path) -> Result<()> {
    std::fs::create_dir_all(destination)?;
    if format.ends_with("zip") {
        let mut archive = zip::ZipArchive::new(File::open(path)?).map_err(|_| Error::Archive)?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|_| Error::Archive)?;
            let relative = Path::new(entry.name());
            if !safe(relative) || entry.is_symlink() {
                return Err(Error::Archive);
            }
            let output = destination.join(relative);
            if entry.is_dir() {
                std::fs::create_dir_all(output)?;
            } else {
                std::fs::create_dir_all(output.parent().ok_or(Error::Archive)?)?;
                let mut file = File::create(&output)?;
                std::io::copy(&mut entry, &mut file)?;
                file.flush()?;
            }
        }
    } else {
        let reader: Box<dyn Read> = if format.ends_with("tar.zst") {
            Box::new(zstd::Decoder::new(File::open(path)?)?)
        } else if format.ends_with("tgz") || format.ends_with("tar.gz") {
            Box::new(flate2::read::GzDecoder::new(File::open(path)?))
        } else {
            return Err(Error::Archive);
        };
        let mut archive = tar::Archive::new(reader);
        let mut links = vec![];
        for entry in archive.entries()? {
            let mut entry = entry?;
            let relative = entry.path()?.into_owned();
            if !safe(&relative) {
                return Err(Error::Archive);
            }
            let kind = entry.header().entry_type();
            if kind.is_symlink() || kind.is_hard_link() {
                let target = entry.link_name()?.ok_or(Error::Archive)?.into_owned();
                if !safe(&target) {
                    return Err(Error::Archive);
                }
                let target = if kind.is_symlink() {
                    relative.parent().ok_or(Error::Archive)?.join(target)
                } else {
                    target
                };
                links.push((relative, target));
            } else if kind.is_file() || kind.is_dir() {
                if !entry.unpack_in(destination)? {
                    return Err(Error::Archive);
                }
            } else {
                return Err(Error::Archive);
            }
        }
        // Some published libraries have chains of aliases. Resolve in rounds,
        // accepting only targets materialized inside this fresh directory.
        while !links.is_empty() {
            let before = links.len();
            let mut pending = Vec::new();
            for (relative, target) in links {
                let target = destination.join(&target);
                if !target.is_file() {
                    pending.push((
                        relative,
                        target
                            .strip_prefix(destination)
                            .map_err(|_| Error::Archive)?
                            .to_owned(),
                    ));
                    continue;
                }
                let output = destination.join(relative);
                if output.exists() {
                    return Err(Error::Archive);
                }
                std::fs::create_dir_all(output.parent().ok_or(Error::Archive)?)?;
                // A hard link avoids duplicating multi-GB shared libraries. It
                // cannot redirect later writes to a path outside this directory.
                if std::fs::hard_link(&target, &output).is_err() {
                    std::fs::copy(&target, &output)?;
                }
            }
            if pending.len() == before {
                return Err(Error::Archive);
            }
            links = pending;
        }
    }
    Ok(())
}
