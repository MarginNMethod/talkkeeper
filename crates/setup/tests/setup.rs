use talkkeeper_setup::runtime::{self, RuntimeSource};
use talkkeeper_setup::*;
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, ResponseTemplate,
};
fn hardware(ram: u64, disk: u64) -> Hardware {
    Hardware {
        total_ram_bytes: ram << 30,
        free_disk_bytes: disk * 1_000_000_000,
        arch: "x86_64".into(),
        os: "linux".into(),
        apple_silicon: false,
        nvidia: false,
        amd: false,
    }
}
#[test]
fn tier_boundaries_and_disk_fallback() {
    let c = Catalog::bundled().unwrap();
    for (ram, index) in [
        (2, 0),
        (7, 0),
        (8, 1),
        (15, 1),
        (16, 2),
        (31, 2),
        (32, 3),
        (63, 3),
        (64, 4),
        (128, 4),
    ] {
        assert_eq!(
            recommend(&hardware(ram, 1000), &c).unwrap().llm.ollama_tag,
            c.0[index].llm.ollama_tag
        );
    }
    let p = recommend(&hardware(64, 12), &c).unwrap();
    assert!(p.can_install);
    assert_eq!(p.llm.ollama_tag, c.0[1].llm.ollama_tag);
    assert!(p.notice.is_some());
    assert!(!recommend(&hardware(64, 1), &c).unwrap().can_install);
    assert!(!recommend(&hardware(2, 100), &c).unwrap().can_install);
}
#[test]
fn catalog_schema_validation() {
    assert!(Catalog::parse("[]").is_err());
    let original = include_str!("../model-catalog.json");
    for invalid in [
        original.replace("\"min_ram_gb\": 0", "\"min_ram_gb\": 1"),
        original.replace("\"model\": \"tiny\"", "\"model\": \"missing\""),
        original.replace("\"approx_download_gb\": 2.7", "\"approx_download_gb\": -1"),
        original.replace(
            "\"tier\": \"compact\"",
            "\"unknown\": true, \"tier\": \"compact\"",
        ),
    ] {
        assert!(Catalog::parse(&invalid).is_err());
    }
}
#[test]
fn checksum_mismatch_and_progress_errors() {
    let temp = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(temp.path(), b"abc").unwrap();
    assert!(archive::verify_checksum(temp.path(), "bad").is_err());
    archive::verify_checksum(
        temp.path(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
    .unwrap();
    let p = parse_pull(r#"{"status":"downloading","completed":2,"total":4}"#).unwrap();
    assert_eq!(p.completed, Some(2));
    assert!(parse_pull(r#"{"error":"failed"}"#).is_err());
    assert!(parse_pull("broken").is_err());
}
#[test]
fn zip_and_tar_traversal_rejected() {
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    for name in ["../escaped", "/absolute", "C:\\escaped", "ok/../../escaped"] {
        let zip = dir.path().join("bad.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&zip).unwrap());
        writer
            .start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"bad").unwrap();
        writer.finish().unwrap();
        assert!(archive::extract(&zip, "zip", &dir.path().join("out")).is_err());
    }
    // Construct a raw tar header because tar::Builder itself rejects traversal.
    let mut header = tar::Header::new_gnu();
    header.set_size(3);
    header.set_mode(0o644);
    header.set_entry_type(tar::EntryType::Regular);
    header.as_mut_bytes()[..10].copy_from_slice(b"../escaped");
    header.set_cksum();
    let tgz = dir.path().join("bad.tgz");
    let mut encoder = flate2::write::GzEncoder::new(
        std::fs::File::create(&tgz).unwrap(),
        flate2::Compression::default(),
    );
    encoder.write_all(header.as_bytes()).unwrap();
    encoder.write_all(b"bad").unwrap();
    encoder.write_all(&[0; 509 + 1024]).unwrap();
    encoder.finish().unwrap();
    assert!(archive::extract(&tgz, "tgz", &dir.path().join("tar")).is_err());
    assert!(!dir.path().join("escaped").exists());
}
#[tokio::test]
async fn pull_resumes_then_skips_and_verifies_through_llm() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/version"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"version":"test"})),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/tags"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"models":[]})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/pull"))
        .respond_with(ResponseTemplate::new(200).set_body_string(
            "{\"status\":\"downloading\",\"completed\":1,\"total\":2}\n{\"status\":\"success\"}\n",
        ))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/chat"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"message":{"content":"Ready"}})),
        )
        .mount(&server)
        .await;
    let model = &Catalog::bundled().unwrap().0[0].llm.ollama_tag;
    let client = reqwest::Client::new();
    assert!(runtime::is_running(&client, &server.uri()).await);
    let external = OllamaRuntime::external(server.uri());
    pull_model(&external.base_url, &client, model, &|_| {})
        .await
        .unwrap();
    verify_model(&external.base_url, model).await.unwrap();
    Mock::given(method("GET"))
        .and(path("/api/tags"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({"models":[{"name":model}]})),
        )
        .with_priority(1)
        .mount(&server)
        .await;
    pull_model(&external.base_url, &client, model, &|_| {})
        .await
        .unwrap();
    drop(external);
    assert!(runtime::is_running(&client, &server.uri()).await);
}
#[tokio::test]
async fn offline_and_pre_cancelled_setup_have_actionable_errors() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let source = RuntimeSource {
        url: server.uri(),
        format: "tgz".into(),
        checksum: None,
    };
    let error = runtime::install(dir.path(), &source, &reqwest::Client::new(), &|_| {})
        .await
        .unwrap_err();
    assert!(matches!(error, Error::Blocked));
    assert!(error.to_string().contains("firewall"));
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    let cancel = CancellationToken::new();
    cancel.cancel();
    let result = Setup::new(dir.path())
        .run_setup(
            &recommend(&hardware(8, 100), &Catalog::bundled().unwrap()).unwrap(),
            |_| {},
            cancel,
        )
        .await;
    assert!(matches!(result, Err(Error::Cancelled)));
}
#[cfg(target_os = "linux")]
#[tokio::test]
#[ignore = "Downloads the official runtime and a real AI model; requires network and several GB"]
async fn real_linux_ollama_chat() {
    let directory = tempfile::tempdir().unwrap();
    let client = runtime::download_client().unwrap();
    let source = RuntimeSource::official(&client).await.unwrap();
    eprintln!("Downloading {}", source.url);
    let binary = runtime::install(&directory.path().join("ollama"), &source, &client, &|p| {
        if p.completed % 100_000_000 < 65536 {
            eprintln!("{} / {}", p.completed, p.total);
        }
    })
    .await
    .unwrap();
    let runtime = OllamaRuntime::start(&binary, directory.path())
        .await
        .unwrap();
    let model = "qwen3.5:0.8b";
    pull_model(&runtime.base_url, &client, model, &|_| {})
        .await
        .unwrap();
    verify_model(&runtime.base_url, model).await.unwrap();
    drop(runtime);
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    // TempDir removes both runtime and model even if a preceding assertion fails.
}

#[test]
fn tar_alias_chains_are_materialized_without_symlinks() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("engine.tgz");
    let encoder = flate2::write::GzEncoder::new(
        std::fs::File::create(&path).unwrap(),
        flate2::Compression::default(),
    );
    let mut builder = tar::Builder::new(encoder);
    for (name, target) in [("lib/alias", "version"), ("lib/version", "weights")] {
        let mut h = tar::Header::new_gnu();
        h.set_entry_type(tar::EntryType::Symlink);
        h.set_size(0);
        h.set_mode(0o644);
        h.set_link_name(target).unwrap();
        h.set_cksum();
        builder.append_data(&mut h, name, &[][..]).unwrap();
    }
    let mut h = tar::Header::new_gnu();
    h.set_size(3);
    h.set_mode(0o644);
    h.set_cksum();
    builder
        .append_data(&mut h, "lib/weights", &b"abc"[..])
        .unwrap();
    builder.into_inner().unwrap().finish().unwrap();
    let output = dir.path().join("out");
    archive::extract(&path, "tgz", &output).unwrap();
    assert_eq!(std::fs::read(output.join("lib/alias")).unwrap(), b"abc");
    assert!(!std::fs::symlink_metadata(output.join("lib/alias"))
        .unwrap()
        .file_type()
        .is_symlink());
}
