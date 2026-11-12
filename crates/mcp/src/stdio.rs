//! Bounded stdio framing with content-free protocol errors. MCP lifecycle and
//! routing belong to rmcp. One writer serializes SDK messages and framing errors.
use crate::MAX_INPUT;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
async fn frame(reader: &mut (impl AsyncBufRead + Unpin)) -> std::io::Result<Option<Vec<u8>>> {
    let mut bytes = Vec::new();
    let mut oversized = false;
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(None);
        }
        let end = available.iter().position(|&b| b == b'\n').map(|i| i + 1);
        let take = end.unwrap_or(available.len());
        if bytes.len() + take > MAX_INPUT {
            oversized = true;
            bytes.clear();
        }
        if !oversized {
            bytes.extend_from_slice(&available[..take]);
        }
        reader.consume(take);
        if end.is_some() {
            return Ok(Some(bytes));
        }
    }
}
pub fn transport() -> DuplexStream {
    let (server, bridge) = tokio::io::duplex(64 * 1024);
    let (outgoing, mut incoming) = tokio::io::split(bridge);
    let (errors, mut error_rx) = tokio::sync::mpsc::channel::<String>(8);
    tokio::spawn(async move {
        let mut stdin = BufReader::new(tokio::io::stdin());
        while let Ok(Some(line)) = frame(&mut stdin).await {
            let error = if line.is_empty() {
                Some((-32600, "Input exceeds 16 KiB"))
            } else if serde_json::from_slice::<serde_json::Value>(&line).is_err() {
                Some((-32700, "Malformed JSON"))
            } else {
                None
            };
            if let Some((code, message)) = error {
                let response = serde_json::json!({"jsonrpc":"2.0","id":null,"error":{"code":code,"message":message}}).to_string();
                if errors.send(response).await.is_err() {
                    break;
                }
            } else if incoming.write_all(&line).await.is_err() {
                break;
            }
        }
        // Tell the protocol engine the client is gone so the process can exit.
        let _ = incoming.shutdown().await;
    });
    tokio::spawn(async move {
        let mut lines = BufReader::new(outgoing).lines();
        let mut stdout = tokio::io::stdout();
        let mut errors_open = true;
        loop {
            let line = tokio::select! {
                line = lines.next_line() => match line { Ok(Some(line)) => line, _ => break },
                error = error_rx.recv(), if errors_open => match error { Some(line) => line, None => { errors_open=false; continue; } },
            };
            if stdout.write_all(line.as_bytes()).await.is_err()
                || stdout.write_all(b"\n").await.is_err()
                || stdout.flush().await.is_err()
            {
                break;
            }
        }
    });
    server
}
