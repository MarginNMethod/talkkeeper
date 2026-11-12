//! Model adapters and credential storage. Model selection always belongs to the caller.
use async_trait::async_trait;
use futures_util::{Stream, StreamExt};
use reqwest::{Client, Method, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, pin::Pin, sync::Mutex, time::Duration};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Network request failed: {0}")]
    Network(#[from] reqwest::Error),
    #[error("Authentication failed (401): check the selected provider's credential")]
    Unauthorized,
    #[error("Provider returned HTTP {0}")]
    Http(StatusCode),
    #[error("Invalid provider data: {0}")]
    Data(String),
    #[error("Credential storage failed: {0}")]
    Secret(String),
}
pub type Result<T> = std::result::Result<T, Error>;
pub type TokenStream = Pin<Box<dyn Stream<Item = Result<String>> + Send>>;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<Message>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub text: String,
    pub usage: Option<Usage>,
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn id(&self) -> &str;
    /// Stable consent scope for image transfer. None means verified local inference.
    fn image_transfer_scope(&self) -> Option<String> {
        Some(self.id().to_owned())
    }
    async fn list_models(&self) -> Result<Vec<ModelInfo>>;
    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse>;
    async fn stream(&self, req: CompletionRequest) -> Result<TokenStream>;
    async fn supports_images(&self, _model: &str) -> Result<bool> {
        Ok(false)
    }
    async fn stream_images(
        &self,
        req: CompletionRequest,
        images: Vec<String>,
    ) -> Result<TokenStream> {
        if !images.is_empty() {
            return Err(Error::Data("This provider cannot read images".into()));
        }
        self.stream(req).await
    }
}
pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<String>>;
    fn set(&self, name: &str, secret: &str) -> Result<()>;
    fn delete(&self, name: &str) -> Result<()>;
}
#[derive(Default)]
pub struct InMemorySecretStore(Mutex<HashMap<String, String>>);
impl SecretStore for InMemorySecretStore {
    fn get(&self, name: &str) -> Result<Option<String>> {
        Ok(self
            .0
            .lock()
            .map_err(|_| Error::Secret("Store lock unavailable".into()))?
            .get(name)
            .cloned())
    }
    fn set(&self, name: &str, secret: &str) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| Error::Secret("Store lock unavailable".into()))?
            .insert(name.into(), secret.into());
        Ok(())
    }
    fn delete(&self, name: &str) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| Error::Secret("Store lock unavailable".into()))?
            .remove(name);
        Ok(())
    }
}
pub struct KeyringSecretStore;
impl KeyringSecretStore {
    fn entry(name: &str) -> Result<keyring::Entry> {
        keyring::Entry::new("org.talkkeeper.desktop", name)
            .map_err(|_| Error::Secret("Cannot open OS keychain".into()))
    }
}
impl SecretStore for KeyringSecretStore {
    fn get(&self, name: &str) -> Result<Option<String>> {
        match Self::entry(name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(Error::Secret("Cannot read OS keychain".into())),
        }
    }
    fn set(&self, name: &str, secret: &str) -> Result<()> {
        Self::entry(name)?
            .set_password(secret)
            .map_err(|_| Error::Secret("Cannot write OS keychain".into()))
    }
    fn delete(&self, name: &str) -> Result<()> {
        match Self::entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(Error::Secret("Cannot delete OS credential".into())),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub enum ProviderConfig {
    Ollama {
        base_url: String,
    },
    Anthropic {
        base_url: String,
        secret_name: String,
    },
    OpenAI {
        base_url: String,
        secret_name: String,
    },
    OpenAICompatible {
        base_url: String,
        secret_name: Option<String>,
    },
}
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Ollama,
    Anthropic,
    OpenAI,
    Compatible,
}
/// Base URLs designate the server root; versioned paths are appended by the adapter.
pub struct HttpProvider {
    client: Client,
    base: String,
    key: Option<String>,
    kind: Kind,
}
pub fn build_provider(
    config: ProviderConfig,
    secrets: &dyn SecretStore,
) -> Result<Box<dyn LlmProvider>> {
    let (kind, base, name) = match config {
        ProviderConfig::Ollama { base_url } => (Kind::Ollama, base_url, None),
        ProviderConfig::Anthropic {
            base_url,
            secret_name,
        } => (Kind::Anthropic, base_url, Some(secret_name)),
        ProviderConfig::OpenAI {
            base_url,
            secret_name,
        } => (Kind::OpenAI, base_url, Some(secret_name)),
        ProviderConfig::OpenAICompatible {
            base_url,
            secret_name,
        } => (Kind::Compatible, base_url, secret_name),
    };
    let key = name
        .map(|n| {
            secrets.get(&n).and_then(|k| {
                k.ok_or_else(|| Error::Secret("Selected credential is missing".into()))
            })
        })
        .transpose()?;
    Ok(Box::new(HttpProvider {
        client: Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()?,
        base: base.trim_end_matches('/').into(),
        key,
        kind,
    }))
}
impl HttpProvider {
    async fn send(&self, method: Method, path: &str, body: Option<&Value>) -> Result<Response> {
        for attempt in 0..2 {
            let mut request = self
                .client
                .request(method.clone(), format!("{}{path}", self.base));
            if let Some(key) = &self.key {
                request = if self.kind == Kind::Anthropic {
                    request.header("x-api-key", key)
                } else {
                    request.bearer_auth(key)
                };
            }
            if self.kind == Kind::Anthropic {
                request = request.header("anthropic-version", "2023-06-01");
            }
            if let Some(body) = body {
                request = request.json(body);
            }
            let response = request.send().await?;
            let status = response.status();
            if status == StatusCode::UNAUTHORIZED {
                return Err(Error::Unauthorized);
            }
            if attempt == 0 && (status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error())
            {
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
            return if status.is_success() {
                Ok(response)
            } else {
                Err(Error::Http(status))
            };
        }
        unreachable!()
    }
    fn body(&self, req: CompletionRequest, stream: bool) -> Result<Value> {
        if req.model.trim().is_empty() {
            return Err(Error::Data("A model must be selected".into()));
        }
        let mut messages =
            serde_json::to_value(req.messages).map_err(|e| Error::Data(e.to_string()))?;
        let mut body = json!({"model": req.model, "messages": messages, "stream": stream});
        if self.kind == Kind::Ollama {
            // Generated notes need the answer itself, within the requested token budget.
            body["think"] = json!(false);
        }
        if self.kind == Kind::Anthropic {
            body["system"] = json!(req.system);
            body["max_tokens"] = json!(req
                .max_tokens
                .ok_or_else(|| Error::Data("Anthropic requires max_tokens".into()))?);
        } else {
            messages
                .as_array_mut()
                .unwrap()
                .insert(0, json!({"role":"system","content":req.system}));
            body["messages"] = messages;
            if let Some(n) = req.max_tokens {
                if self.kind == Kind::Ollama {
                    body["options"]["num_predict"] = json!(n);
                } else {
                    body["max_tokens"] = json!(n);
                }
            }
        }
        if let Some(t) = req.temperature {
            if self.kind == Kind::Ollama {
                body["options"]["temperature"] = json!(t);
            } else {
                body["temperature"] = json!(t);
            }
        }
        Ok(body)
    }
    fn chat_path(&self) -> &str {
        match self.kind {
            Kind::Ollama => "/api/chat",
            Kind::Anthropic => "/v1/messages",
            _ => "/v1/chat/completions",
        }
    }
    fn delta(&self, value: &Value) -> Option<String> {
        let text = match self.kind {
            Kind::Ollama => value["message"]["content"].as_str(),
            Kind::Anthropic => value["delta"]["text"].as_str(),
            _ => value["choices"][0]["delta"]["content"].as_str(),
        };
        text.map(str::to_owned)
    }
}
#[async_trait]
impl LlmProvider for HttpProvider {
    fn id(&self) -> &str {
        match self.kind {
            Kind::Ollama => "ollama",
            Kind::Anthropic => "anthropic",
            Kind::OpenAI => "openai",
            Kind::Compatible => "openai-compatible",
        }
    }
    fn image_transfer_scope(&self) -> Option<String> {
        let local = reqwest::Url::parse(&self.base).ok().is_some_and(|url| {
            ["http", "https"].contains(&url.scheme())
                && url.host_str().is_some_and(|host| {
                    host == "localhost"
                        || host
                            .trim_matches(['[', ']'])
                            .parse::<std::net::IpAddr>()
                            .is_ok_and(|ip| ip.is_loopback())
                })
        });
        if self.kind == Kind::Ollama && local {
            None
        } else {
            Some(format!("{}:{}", self.id(), self.base))
        }
    }
    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        let path = if self.kind == Kind::Ollama {
            "/api/tags"
        } else {
            "/v1/models"
        };
        let value: Value = self.send(Method::GET, path, None).await?.json().await?;
        let entries = value[if self.kind == Kind::Ollama {
            "models"
        } else {
            "data"
        }]
        .as_array()
        .ok_or_else(|| Error::Data("Missing model list".into()))?;
        entries
            .iter()
            .map(|v| {
                let id = v[if self.kind == Kind::Ollama {
                    "name"
                } else {
                    "id"
                }]
                .as_str()
                .ok_or_else(|| Error::Data("Missing model identifier".into()))?;
                Ok(ModelInfo {
                    id: id.into(),
                    display_name: v["display_name"].as_str().unwrap_or(id).into(),
                })
            })
            .collect()
    }
    async fn complete(&self, req: CompletionRequest) -> Result<CompletionResponse> {
        let body = self.body(req, false)?;
        let v: Value = self
            .send(Method::POST, self.chat_path(), Some(&body))
            .await?
            .json()
            .await?;
        let text = match self.kind {
            Kind::Ollama => v["message"]["content"].as_str().map(str::to_owned),
            Kind::Anthropic => v["content"].as_array().map(|a| {
                a.iter()
                    .filter_map(|b| b["text"].as_str())
                    .collect::<String>()
            }),
            _ => v["choices"][0]["message"]["content"]
                .as_str()
                .map(str::to_owned),
        }
        .ok_or_else(|| Error::Data("Missing completion text".into()))?;
        let (input, output) = match self.kind {
            Kind::Ollama => (&v["prompt_eval_count"], &v["eval_count"]),
            Kind::Anthropic => (&v["usage"]["input_tokens"], &v["usage"]["output_tokens"]),
            _ => (
                &v["usage"]["prompt_tokens"],
                &v["usage"]["completion_tokens"],
            ),
        };
        let usage = input
            .as_u64()
            .zip(output.as_u64())
            .map(|(input_tokens, output_tokens)| Usage {
                input_tokens,
                output_tokens,
            });
        Ok(CompletionResponse { text, usage })
    }
    async fn supports_images(&self, model: &str) -> Result<bool> {
        let value: Value = if self.kind == Kind::Ollama {
            self.send(Method::POST, "/api/show", Some(&json!({"model":model})))
                .await?
                .json()
                .await?
        } else {
            let value: Value = self
                .send(Method::GET, "/v1/models", None)
                .await?
                .json()
                .await?;
            value["data"]
                .as_array()
                .and_then(|a| a.iter().find(|v| v["id"] == model))
                .cloned()
                .unwrap_or(Value::Null)
        };
        Ok(image_capability(&value))
    }
    async fn stream(&self, req: CompletionRequest) -> Result<TokenStream> {
        self.stream_images(req, vec![]).await
    }
    async fn stream_images(
        &self,
        req: CompletionRequest,
        images: Vec<String>,
    ) -> Result<TokenStream> {
        let mut body = self.body(req, true)?;
        if !images.is_empty() {
            let message = body["messages"]
                .as_array_mut()
                .and_then(|m| m.last_mut())
                .ok_or_else(|| Error::Data("Missing image message".into()))?;
            if self.kind == Kind::Ollama {
                message["images"] = json!(images);
            } else {
                let text = message["content"].as_str().unwrap_or("").to_owned();
                let mut content = vec![json!({"type":"text","text":text})];
                for data in images {
                    content.push(if self.kind==Kind::Anthropic {json!({"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":data}})} else {json!({"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{data}")}})});
                }
                message["content"] = json!(content);
            }
        }
        let response = self
            .send(Method::POST, self.chat_path(), Some(&body))
            .await?;
        let kind = self.kind;
        let parser = HttpProvider {
            client: self.client.clone(),
            base: String::new(),
            key: None,
            kind,
        };
        Ok(Box::pin(async_stream::try_stream! {
            let mut bytes = response.bytes_stream();
            let mut pending = Vec::new();
            while let Some(chunk) = bytes.next().await {
                pending.extend_from_slice(&chunk?);
                // Parse bytes only at complete line boundaries, preserving split UTF-8.
                while let Some(end) = pending.iter().position(|b| *b == b'\n') {
                    let line: Vec<_> = pending.drain(..=end).collect();
                    if let Some(delta) = parse_line(&parser, &line)? { yield delta; }
                }
                if pending.len() > 8 * 1024 * 1024 { Err(Error::Data("Streaming line exceeds limit".into()))?; }
            }
            if !pending.is_empty() {
                if let Some(delta) = parse_line(&parser, &pending)? { yield delta; }
            }
        }))
    }
}
fn parse_line(provider: &HttpProvider, bytes: &[u8]) -> Result<Option<String>> {
    let line = std::str::from_utf8(bytes)
        .map_err(|e| Error::Data(e.to_string()))?
        .trim();
    let data = if provider.kind == Kind::Ollama {
        line
    } else {
        match line.strip_prefix("data:") {
            Some(data) => data.trim(),
            None => return Ok(None),
        }
    };
    if data.is_empty() || data == "[DONE]" {
        return Ok(None);
    }
    let value: Value = serde_json::from_str(data).map_err(|e| Error::Data(e.to_string()))?;
    if value.get("error").is_some() || value["type"] == "error" {
        return Err(Error::Data("Provider reported a streaming error".into()));
    }
    Ok(provider.delta(&value))
}

/// Use advertised metadata only, never guesses based on a model name.
pub fn image_capability(value: &Value) -> bool {
    value["capabilities"]
        .as_array()
        .is_some_and(|a| a.iter().any(|c| c == "vision" || c == "image"))
        || value["capabilities"]["vision"] == true
        || value["input_modalities"]
            .as_array()
            .is_some_and(|a| a.iter().any(|c| c == "image"))
}
