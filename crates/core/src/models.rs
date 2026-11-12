use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Attendee {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Note {
    pub id: Uuid,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub notes_doc: serde_json::Value,
    pub notes_markdown: String,
    pub summary_markdown: Option<String>,
    pub template_id: Option<String>,
    pub folder_id: Option<Uuid>,
    pub attendees: Vec<Attendee>,
    pub language: Option<String>,
    pub deleted_at: Option<DateTime<Utc>>,
}

impl Note {
    pub fn new(title: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            title: title.into(),
            created_at: now,
            updated_at: now,
            started_at: None,
            ended_at: None,
            notes_doc: serde_json::Value::Null,
            notes_markdown: String::new(),
            summary_markdown: None,
            template_id: None,
            folder_id: None,
            attendees: Vec::new(),
            language: None,
            deleted_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Speaker {
    Me,
    Them,
    Named(String),
}
impl std::fmt::Display for Speaker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Me => f.write_str("Me"),
            Self::Them => f.write_str("Them"),
            Self::Named(name) => f.write_str(name),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: Uuid,
    pub note_id: Uuid,
    pub seq: u64,
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker: Speaker,
    pub text: String,
    pub lang: Option<String>,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Folder {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VocabularyTerm {
    pub id: Uuid,
    pub term: String,
}
/// Non-secret preferences only. Credentials belong in the OS keychain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    pub key: String,
    pub value: serde_json::Value,
}
#[derive(Debug, Clone, Default)]
pub struct SearchFilters {
    pub folder_id: Option<Uuid>,
    pub attendee: Option<String>,
    /// Inclusive bounds on the note's creation time.
    pub date_from: Option<DateTime<Utc>>,
    pub date_to: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone)]
pub struct SearchHit {
    pub note: Note,
    pub snippet: String,
    pub rank: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: Uuid,
    pub note_id: Uuid,
    pub role: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub proposed_edit_id: Option<Uuid>,
    pub revision: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryVersion {
    pub id: Uuid,
    pub note_id: Uuid,
    pub content: Option<String>,
    pub created_at: DateTime<Utc>,
}
