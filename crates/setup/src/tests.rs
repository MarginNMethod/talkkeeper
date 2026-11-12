use super::*;
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, ResponseTemplate,
};

const STUB: &str = r#"#!/usr/bin/env python3
import os,sys,json
from http.server import HTTPServer,BaseHTTPRequestHandler
if '--version' in sys.argv:
 print('test engine'); sys.exit(0)
model_file = os.environ['OLLAMA_MODELS'] + '/test-installed'
os.makedirs(os.environ['OLLAMA_MODELS'], exist_ok=True)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  if self.path == '/api/version': obj={'version':'stub'}
  else: obj={'models':[{'name':open(model_file).read()}] if os.path.exists(model_file) else []}
  self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  self.send_response(200); self.end_headers()
  if self.path == '/api/pull':
   open(model_file,'w').write(body['model']); self.wfile.write(b'{"status":"success"}\n')
  else: self.wfile.write(b'{"message":{"content":"Ready"}}')
host,port=os.environ['OLLAMA_HOST'].split(':')
HTTPServer((host,int(port)),Handler).serve_forever()
"#;
async fn fixture(existing: Option<String>) -> (tempfile::TempDir, Setup, MockServer) {
    let dir = tempfile::tempdir().unwrap();
    let server = MockServer::start().await;
    let mut bytes = vec![];
    {
        let encoder = flate2::write::GzEncoder::new(&mut bytes, flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(STUB.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(&mut header, "bin/ollama", STUB.as_bytes())
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();
    }
    Mock::given(method("GET"))
        .and(path("/engine.tgz"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(bytes))
        .expect(if existing.is_some() { 0 } else { 1 })
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/speech"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"abc".to_vec()))
        .expect(1)
        .mount(&server)
        .await;
    let mut setup = Setup::new(dir.path());
    setup.test_source = Some(runtime::RuntimeSource {
        url: format!("{}/engine.tgz", server.uri()),
        format: "tgz".into(),
        checksum: None,
    });
    setup.test_existing = existing;
    setup.test_speech = Some(talkkeeper_transcribe::models::Model {
        name: "tiny",
        file: "speech.bin",
        size: 3,
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        url: Box::leak(format!("{}/speech", server.uri()).into_boxed_str()),
    });
    (dir, setup, server)
}
#[cfg(unix)]
#[tokio::test]
async fn archive_to_running_engine_to_speech_and_idempotent_retry() {
    let (_dir, setup, _server) = fixture(None).await;
    let mut plan = setup.plan().unwrap();
    plan.total_download_bytes = 100;
    let stages = std::sync::Mutex::new(vec![]);
    let runtime = setup
        .run_setup(
            &plan,
            |p| stages.lock().unwrap().push(p.stage),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert!(stages.lock().unwrap().contains(&Stage::Verify));
    let base = runtime.base_url.clone();
    drop(runtime);
    for _ in 0..40 {
        if !runtime::is_running(&reqwest::Client::new(), &base).await {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(!runtime::is_running(&reqwest::Client::new(), &base).await);
    let again = setup
        .run_setup(&plan, |_| {}, CancellationToken::new())
        .await
        .unwrap();
    assert!(setup.directory.join("models/speech.bin").exists());
    drop(again);
}
#[tokio::test]
async fn existing_engine_setup_never_installs_or_stops_engine() {
    let external = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/version"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"version":"stub"})))
        .mount(&external)
        .await;
    let (_dir, setup, _server) = fixture(Some(external.uri())).await;
    let mut plan = setup.plan().unwrap();
    plan.total_download_bytes = 100;
    Mock::given(method("GET"))
        .and(path("/api/tags"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"models":[{"name":plan.llm.ollama_tag}]})),
        )
        .mount(&external)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/chat"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"message":{"content":"Ready"}})),
        )
        .expect(2)
        .mount(&external)
        .await;
    for _ in 0..2 {
        drop(
            setup
                .run_setup(&plan, |_| {}, CancellationToken::new())
                .await
                .unwrap(),
        );
    }
    assert!(runtime::is_running(&reqwest::Client::new(), &external.uri()).await);
    assert!(!setup.directory.join("ollama/runtime").exists());
}
#[cfg(unix)]
#[tokio::test]
async fn blocked_download_reports_fix_and_can_retry() {
    let (_dir, mut setup, server) = fixture(None).await;
    setup.test_source.as_mut().unwrap().url = format!("{}/blocked", server.uri());
    let mut plan = setup.plan().unwrap();
    plan.total_download_bytes = 100;
    let result = setup
        .run_setup(&plan, |_| {}, CancellationToken::new())
        .await;
    assert!(matches!(result, Err(Error::Offline)));
    // The offline attempt leaves no partial runtime, so the same entrypoint retries.
    assert!(!setup.directory.join("ollama/runtime").exists());
    setup.test_source.as_mut().unwrap().url = format!("{}/engine.tgz", server.uri());
    drop(
        setup
            .run_setup(&plan, |_| {}, CancellationToken::new())
            .await
            .unwrap(),
    );
}
