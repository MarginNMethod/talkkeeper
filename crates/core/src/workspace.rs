use crate::*;
use chrono::{DateTime, Datelike, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub note_ids: Option<Vec<Uuid>>,
    pub folder_id: Option<Uuid>,
    pub date_from: Option<DateTime<Utc>>,
    pub date_to: Option<DateTime<Utc>>,
}
impl Scope {
    pub fn includes(&self, n: &Note) -> bool {
        n.deleted_at.is_none()
            && self.note_ids.as_ref().is_none_or(|ids| ids.contains(&n.id))
            && self.folder_id.is_none_or(|id| n.folder_id == Some(id))
            && self.date_from.is_none_or(|d| n.created_at >= d)
            && self.date_to.is_none_or(|d| n.created_at <= d)
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Source {
    pub note_id: Uuid,
    pub title: String,
    pub seq: u64,
    pub start_ms: u64,
    pub text: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Retrieval {
    pub notes_searched: usize,
    pub segments_searched: usize,
    pub sources: Vec<Source>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub text: String,
    pub retrieval: Retrieval,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub name: String,
    pub text: String,
}
impl Attachment {
    pub fn validate(&self) -> Result<()> {
        if self.name.len() > 255
            || self.text.len() > 256 * 1024
            || self.text.contains('\0')
            || ![".txt", ".md", ".pdf.txt"]
                .iter()
                .any(|ext| self.name.to_lowercase().ends_with(ext))
        {
            return Err(Error::Invalid(
                "Attach UTF-8 text, Markdown, or PDF exported as .pdf.txt (maximum 256 KiB)",
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceChat {
    pub id: Uuid,
    pub name: String,
    pub scope: Scope,
    pub messages: Vec<ChatMessage>,
    pub attachments: Vec<Attachment>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recipe {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub default_scope: Scope,
}
impl Recipe {
    pub fn import(text: &str) -> Result<Self> {
        if text.len() > 32768 {
            return Err(Error::Invalid("Recipe exceeds 32 KiB"));
        }
        let mut recipe: Self = serde_json::from_str(text)?;
        recipe.validate()?;
        recipe.id = Uuid::new_v4();
        Ok(recipe)
    }
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty()
            || self.name.len() > 200
            || self.description.len() > 2000
            || self.prompt.trim().is_empty()
            || self.prompt.len() > 16000
            || serde_json::to_vec(self)?.len() > 32768
        {
            return Err(Error::Invalid(
                "Recipe needs a name and prompt within size limits",
            ));
        }
        Ok(())
    }
    pub fn render(&self, notes: &str, topic: &str) -> String {
        // Single pass: variable values are data and cannot introduce substitutions.
        self.prompt
            .split("{{")
            .enumerate()
            .map(|(i, part)| {
                if i == 0 {
                    return part.to_owned();
                }
                match part.split_once("}}") {
                    Some(("notes", tail)) => format!("{notes}{tail}"),
                    Some(("topic", tail)) => format!("{topic}{tail}"),
                    _ => format!("{{{{{part}"),
                }
            })
            .collect()
    }
}
pub fn built_in_recipes() -> Vec<Recipe> {
    [
        (
            "Draft a follow-up message",
            "Write a concise follow-up with agreed next steps. Mark unknown owners clearly.",
        ),
        (
            "Summarize this week's meetings",
            "Summarize progress, decisions, and unresolved questions in the chosen date range.",
        ),
        (
            "Extract decisions and owners",
            "List supported decisions, their stated owners, and missing ownership.",
        ),
        (
            "Prepare questions for next time",
            "Suggest questions grounded in unresolved issues about {{topic}}.",
        ),
        (
            "Turn notes into a status update",
            "Draft a status update with progress, risks, and next steps about {{topic}}.",
        ),
    ]
    .into_iter()
    .enumerate()
    .map(|(i, (name, prompt))| Recipe {
        id: Uuid::from_u128(i as u128 + 1),
        name: name.into(),
        description: "Uses only the selected note context; runs when requested.".into(),
        prompt: format!("{prompt}\n{{{{notes}}}}"),
        default_scope: if i == 1 {
            let now = Utc::now();
            let monday = now.date_naive()
                - chrono::Duration::days(i64::from(now.weekday().num_days_from_monday()));
            Scope {
                date_from: Some(monday.and_hms_opt(0, 0, 0).expect("midnight").and_utc()),
                date_to: Some(now),
                ..Default::default()
            }
        } else {
            Scope::default()
        },
    })
    .collect()
}
impl Store {
    pub fn save_workspace_chat(&mut self, chat: &WorkspaceChat) -> Result<()> {
        if chat.attachments.len() > 8 || serde_json::to_vec(chat)?.len() > 2 * 1024 * 1024 {
            return Err(Error::Invalid("Chat context exceeds local size limit"));
        }
        for attachment in &chat.attachments {
            attachment.validate()?;
        }
        self.conn.execute("INSERT INTO workspace_chats VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![chat.id.to_string(), serde_json::to_string(chat)?])?;
        Ok(())
    }
    pub fn list_workspace_chats(&self) -> Result<Vec<WorkspaceChat>> {
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM workspace_chats ORDER BY rowid DESC")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
    }
    pub fn delete_workspace_chat(&mut self, id: Uuid) -> Result<()> {
        self.conn
            .execute("DELETE FROM workspace_chats WHERE id=?", [id.to_string()])?;
        Ok(())
    }
    pub fn save_recipe(&mut self, recipe: &Recipe) -> Result<()> {
        recipe.validate()?;
        self.conn.execute(
            "INSERT INTO recipes VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            params![recipe.id.to_string(), serde_json::to_string(recipe)?],
        )?;
        Ok(())
    }
    pub fn list_recipes(&self) -> Result<Vec<Recipe>> {
        let mut stmt = self
            .conn
            .prepare("SELECT data FROM recipes ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
    }
    pub fn delete_recipe(&mut self, id: Uuid) -> Result<()> {
        self.conn
            .execute("DELETE FROM recipes WHERE id=?", [id.to_string()])?;
        Ok(())
    }
    pub fn retrieve(
        &self,
        scope: &Scope,
        question: &str,
        token_budget: usize,
    ) -> Result<Retrieval> {
        let notes: Vec<_> = self
            .list_notes()?
            .into_iter()
            .filter(|n| scope.includes(n))
            .collect();
        let mut result = Retrieval {
            notes_searched: notes.len(),
            ..Default::default()
        };
        for n in &notes {
            result.segments_searched += self.conn.query_row(
                "SELECT count(*) FROM workspace_search WHERE note_id=?",
                [n.id.to_string()],
                |r| r.get::<_, usize>(0),
            )?;
        }
        let query = question
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| {
                w.len() > 2
                    && ![
                        "the", "and", "for", "with", "what", "was", "were", "are", "this", "that",
                        "these", "those", "about", "from", "how", "who", "when", "where", "why",
                        "did", "does", "have", "has", "can", "you", "our", "notes",
                    ]
                    .contains(&w.to_ascii_lowercase().as_str())
            })
            .take(48)
            .map(|w| format!("\"{w}\""))
            .collect::<Vec<_>>()
            .join(" OR ");

        let sql = if question.trim().is_empty() {
            "SELECT note_id,seq,start_ms,title,body,-1.0 FROM workspace_search WHERE ? IS NOT NULL"
        } else {
            "SELECT note_id,seq,start_ms,title,body,bm25(workspace_search) FROM workspace_search WHERE workspace_search MATCH ?"
        };
        if query.is_empty() && !question.trim().is_empty() {
            return Ok(result);
        }
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([query], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, u64>(1)?,
                r.get::<_, u64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, f64>(5)?,
            ))
        })?;
        let mut ranked = Vec::new();
        for row in rows {
            let (id, seq, start_ms, title, text, rank) = row?;
            if let Some(n) = notes.iter().find(|n| n.id.to_string() == id) {
                let age = (Utc::now() - n.created_at).num_days().max(0) as f64;
                ranked.push((
                    rank * (1.0 + 0.1 / (1.0 + age)),
                    Source {
                        note_id: n.id,
                        title,
                        seq,
                        start_ms,
                        text,
                    },
                ));
            }
        }
        ranked.sort_by(|a, b| {
            a.0.total_cmp(&b.0)
                .then(a.1.note_id.cmp(&b.1.note_id))
                .then(a.1.seq.cmp(&b.1.seq))
        });
        // UTF-8 bytes are a conservative token upper bound, including source metadata.
        let mut remaining = token_budget.saturating_sub(2);
        for (_, mut source) in ranked {
            if serde_json::to_vec(&source)?.len() + 1 > remaining {
                let original = std::mem::take(&mut source.text);
                let overhead = serde_json::to_vec(&source)?.len() + 1;
                // Six bytes per character also covers JSON escaping.
                source.text = original
                    .chars()
                    .take(remaining.saturating_sub(overhead) / 6)
                    .collect();
                if source.text.is_empty() {
                    continue;
                }
            }
            let cost = serde_json::to_vec(&source)?.len() + 1;
            if cost <= remaining {
                remaining -= cost;
                result.sources.push(source);
            }
        }
        Ok(result)
    }
    pub fn get_workspace_chat(&self, id: Uuid) -> Result<Option<WorkspaceChat>> {
        let text: Option<String> = self
            .conn
            .query_row(
                "SELECT data FROM workspace_chats WHERE id=?",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        text.map(|s| Ok(serde_json::from_str(&s)?)).transpose()
    }
}
