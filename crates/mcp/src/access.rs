//! Content-free, cross-process serialized access history.
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::Path,
};
pub const LOG_BYTES: u64 = 256 * 1024;
#[derive(Clone, Serialize, Deserialize)]
pub struct Access {
    pub timestamp: String,
    pub tool: String,
    pub results: usize,
}
fn locked<T>(directory: &Path, f: impl FnOnce() -> std::io::Result<T>) -> std::io::Result<T> {
    // The app creates the directory. Never create an alternate database location.
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(directory.join("mcp-access.lock"))?;
    lock.lock_exclusive()?;
    f()
}
pub fn append(directory: &Path, tool: &str, results: usize) -> std::io::Result<()> {
    locked(directory, || {
        let path = directory.join("mcp-access.log");
        let line = serde_json::to_string(&Access {
            timestamp: chrono::Utc::now().to_rfc3339(),
            tool: tool.into(),
            results,
        })? + "\n";
        if path.metadata().map(|m| m.len()).unwrap_or(0) + line.len() as u64 > LOG_BYTES {
            let old = directory.join("mcp-access.1.log");
            if old.exists() {
                std::fs::remove_file(&old)?;
            }
            if path.exists() {
                std::fs::rename(&path, old)?;
            }
        }
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path)?.write_all(line.as_bytes())
    })
}
pub fn recent(directory: &Path) -> std::io::Result<Vec<Access>> {
    locked(directory, || {
        let mut records = std::collections::VecDeque::with_capacity(20);
        for name in ["mcp-access.1.log", "mcp-access.log"] {
            let file = match std::fs::File::open(directory.join(name)) {
                Ok(f) => f,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e),
            };
            use std::io::Read;
            for line in BufReader::new(file.take(LOG_BYTES + 1024)).lines() {
                if let Ok(record) = serde_json::from_str::<Access>(&line?) {
                    if crate::TOOLS.contains(&record.tool.as_str()) {
                        if records.len() == 20 {
                            records.pop_front();
                        }
                        records.push_back(record);
                    }
                }
            }
        }
        Ok(records.into_iter().rev().collect())
    })
}
pub fn clear(directory: &Path) -> std::io::Result<()> {
    locked(directory, || {
        for name in ["mcp-access.log", "mcp-access.1.log"] {
            match std::fs::remove_file(directory.join(name)) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e),
            }
        }
        Ok(())
    })
}
