use futures_util::StreamExt;
use serde_json::json;
use talkkeeper_llm::*;
use wiremock::{
    matchers::{body_partial_json, header, method, path},
    Mock, MockServer, ResponseTemplate,
};

fn request() -> CompletionRequest {
    CompletionRequest {
        model: "caller-selected".into(),
        system: "Be precise".into(),
        messages: vec![Message {
            role: Role::User,
            content: "Hello".into(),
        }],
        max_tokens: Some(80),
        temperature: Some(0.2),
    }
}
#[tokio::test]
async fn provider_protocols() {
    for kind in 0..4 {
        let server = MockServer::start().await;
        let store = InMemorySecretStore::default();
        store.set("credential", "test-key").unwrap();
        let config = match kind {
            0 => ProviderConfig::Ollama {
                base_url: server.uri(),
            },
            1 => ProviderConfig::Anthropic {
                base_url: server.uri(),
                secret_name: "credential".into(),
            },
            2 => ProviderConfig::OpenAI {
                base_url: server.uri(),
                secret_name: "credential".into(),
            },
            _ => ProviderConfig::OpenAICompatible {
                base_url: server.uri(),
                secret_name: None,
            },
        };
        let provider = build_provider(config, &store).unwrap();
        let list_path = if kind == 0 { "/api/tags" } else { "/v1/models" };
        let list = if kind == 0 {
            json!({"models":[{"name":"caller-selected"}]})
        } else {
            json!({"data":[{"id":"caller-selected","display_name":"Selected"}]})
        };
        Mock::given(method("GET"))
            .and(path(list_path))
            .respond_with(ResponseTemplate::new(200).set_body_json(list))
            .expect(1)
            .mount(&server)
            .await;
        assert_eq!(
            provider.list_models().await.unwrap()[0].id,
            "caller-selected"
        );
        let chat_path = match kind {
            0 => "/api/chat",
            1 => "/v1/messages",
            _ => "/v1/chat/completions",
        };
        let completion = match kind {
            0 => json!({"message":{"content":"Hello!"},"prompt_eval_count":2,"eval_count":3}),
            1 => {
                json!({"content":[{"type":"text","text":"Hello!"}],"usage":{"input_tokens":2,"output_tokens":3}})
            }
            _ => {
                json!({"choices":[{"message":{"content":"Hello!"}}],"usage":{"prompt_tokens":2,"completion_tokens":3}})
            }
        };
        let mut mock = Mock::given(method("POST"))
            .and(path(chat_path))
            .and(body_partial_json(
                json!({"model":"caller-selected","stream":false}),
            ));
        if kind == 1 {
            mock = mock
                .and(header("x-api-key", "test-key"))
                .and(header("anthropic-version", "2023-06-01"));
        }
        if kind == 2 {
            mock = mock.and(header("authorization", "Bearer test-key"));
        }
        mock.respond_with(ResponseTemplate::new(200).set_body_json(completion))
            .expect(1)
            .mount(&server)
            .await;
        let response = provider.complete(request()).await.unwrap();
        assert_eq!(response.text, "Hello!");
        assert_eq!(
            response.usage.unwrap(),
            Usage {
                input_tokens: 2,
                output_tokens: 3
            }
        );
        let stream = match kind {
            0 => "{\"message\":{\"content\":\"hé\"}}\n{\"message\":{\"content\":\"llo\"},\"done\":true}",
            1 => "event: content_block_delta\r\ndata: {\"delta\":{\"text\":\"hé\"}}\r\n\r\ndata: {\"delta\":{\"text\":\"llo\"}}\n\n",
            _ => ": heartbeat\ndata: {\"choices\":[{\"delta\":{\"content\":\"hé\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"llo\"}}]}\n\ndata: [DONE]\n\n",
        };
        Mock::given(method("POST"))
            .and(path(chat_path))
            .and(body_partial_json(json!({"stream":true})))
            .respond_with(ResponseTemplate::new(200).set_body_string(stream))
            .expect(1)
            .mount(&server)
            .await;
        let values: Vec<_> = provider.stream(request()).await.unwrap().collect().await;
        assert_eq!(
            values
                .into_iter()
                .collect::<Result<Vec<_>>>()
                .unwrap()
                .concat(),
            "héllo"
        );
        Mock::given(method("GET"))
            .and(path(list_path))
            .respond_with(ResponseTemplate::new(401))
            .with_priority(1)
            .expect(1)
            .mount(&server)
            .await;
        assert!(matches!(
            provider.list_models().await,
            Err(Error::Unauthorized)
        ));
    }
}
#[tokio::test]
async fn errors_and_retry() {
    for status in [401, 429, 500] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(status))
            .expect(if status == 401 { 1 } else { 2 })
            .mount(&server)
            .await;
        let provider = build_provider(
            ProviderConfig::Ollama {
                base_url: server.uri(),
            },
            &InMemorySecretStore::default(),
        )
        .unwrap();
        let err = provider.list_models().await.unwrap_err();
        if status == 401 {
            assert!(matches!(err, Error::Unauthorized));
        } else {
            assert!(matches!(err, Error::Http(_)));
        }
    }
}
#[tokio::test]
async fn streaming_error_and_missing_model() {
    let server = MockServer::start().await;
    let provider = build_provider(
        ProviderConfig::Ollama {
            base_url: server.uri(),
        },
        &InMemorySecretStore::default(),
    )
    .unwrap();
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_string("{\"error\":\"failed\"}\n"))
        .mount(&server)
        .await;
    assert!(provider
        .stream(request())
        .await
        .unwrap()
        .next()
        .await
        .unwrap()
        .is_err());
    let mut req = request();
    req.model.clear();
    assert!(matches!(provider.complete(req).await, Err(Error::Data(_))));
}
#[test]
fn credential_lifecycle() {
    let store = InMemorySecretStore::default();
    assert_eq!(store.get("key").unwrap(), None);
    store.set("key", "value").unwrap();
    assert_eq!(store.get("key").unwrap().as_deref(), Some("value"));
    store.delete("key").unwrap();
    assert_eq!(store.get("key").unwrap(), None);
}

#[tokio::test]
async fn vision_capability_uses_provider_metadata() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/show"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"capabilities":["completion","vision"]})),
        )
        .mount(&server)
        .await;
    let provider = build_provider(
        ProviderConfig::Ollama {
            base_url: server.uri(),
        },
        &InMemorySecretStore::default(),
    )
    .unwrap();
    assert!(provider.supports_images("user-selected").await.unwrap());
    assert!(!talkkeeper_llm::image_capability(&json!({"id":"unknown"})));
    assert!(talkkeeper_llm::image_capability(
        &json!({"input_modalities":["text","image"]})
    ));
}

#[tokio::test]
async fn jpeg_payloads_follow_each_provider_protocol_and_scope() {
    for kind in 0..3 {
        let server = MockServer::start().await;
        let secrets = InMemorySecretStore::default();
        secrets.set("test", "key").unwrap();
        let (config, path, expected, response) = match kind {
            0 => (
                ProviderConfig::Ollama {
                    base_url: server.uri(),
                },
                "/api/chat",
                json!({"messages":[{"role":"system","content":"Be precise"},{"role":"user","content":"Hello","images":["jpeg-data"]}]}),
                "{\"message\":{\"content\":\"Seen\"}}\n",
            ),
            1 => (
                ProviderConfig::OpenAI {
                    base_url: server.uri(),
                    secret_name: "test".into(),
                },
                "/v1/chat/completions",
                json!({"messages":[{"role":"system","content":"Be precise"},{"role":"user","content":[{"type":"text","text":"Hello"},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,jpeg-data"}}]}]}),
                "data: {\"choices\":[{\"delta\":{\"content\":\"Seen\"}}]}\n\n",
            ),
            _ => (
                ProviderConfig::Anthropic {
                    base_url: server.uri(),
                    secret_name: "test".into(),
                },
                "/v1/messages",
                json!({"messages":[{"role":"user","content":[{"type":"text","text":"Hello"},{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"jpeg-data"}}]}]}),
                "data: {\"delta\":{\"text\":\"Seen\"}}\n\n",
            ),
        };
        Mock::given(method("POST"))
            .and(wiremock::matchers::path(path))
            .and(body_partial_json(expected))
            .respond_with(ResponseTemplate::new(200).set_body_string(response))
            .expect(1)
            .mount(&server)
            .await;
        let provider = build_provider(config, &secrets).unwrap();
        assert_eq!(provider.image_transfer_scope().is_none(), kind == 0);
        let mut stream = provider
            .stream_images(request(), vec!["jpeg-data".into()])
            .await
            .unwrap();
        assert_eq!(stream.next().await.unwrap().unwrap(), "Seen");
    }
    let remote = build_provider(
        ProviderConfig::Ollama {
            base_url: "https://example.org".into(),
        },
        &InMemorySecretStore::default(),
    )
    .unwrap();
    assert!(remote.image_transfer_scope().is_some());
    let deceptive = build_provider(
        ProviderConfig::Ollama {
            base_url: "http://localhost:11434@example.org".into(),
        },
        &InMemorySecretStore::default(),
    )
    .unwrap();
    assert!(deceptive.image_transfer_scope().is_some());
}
