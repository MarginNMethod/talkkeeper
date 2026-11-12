use crate::{Attendee, Error, Note, Result, Store};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Person {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    pub company_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub manually_edited: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Company {
    pub id: Uuid,
    pub name: String,
    pub domain: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
fn read<T: serde::de::DeserializeOwned>(conn: &Connection, sql: &str) -> Result<Vec<T>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
}
fn key(a: &Attendee) -> String {
    if a.email.trim().is_empty() {
        format!("name:{}", a.name.trim().to_lowercase())
    } else {
        format!("email:{}", a.email.trim().to_lowercase())
    }
}
fn save(conn: &Connection, p: &Person) -> Result<()> {
    conn.execute(
        "INSERT INTO people VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        params![p.id.to_string(), serde_json::to_string(p)?],
    )?;
    Ok(())
}
pub(crate) fn sync_note(conn: &Connection, note: &Note) -> Result<()> {
    conn.execute("DELETE FROM people_undo", [])?;
    conn.execute(
        "DELETE FROM note_people WHERE note_id=?",
        [note.id.to_string()],
    )?;
    for a in &note.attendees {
        if a.name.trim().is_empty() && a.email.trim().is_empty() {
            continue;
        }
        let identity = key(a);
        let existing: Option<String> = conn.query_row("SELECT p.data FROM people p JOIN person_keys k ON p.id=k.person_id WHERE identity=?", [&identity], |r| r.get(0)).optional()?;
        let mut p = if let Some(data) = existing {
            serde_json::from_str::<Person>(&data)?
        } else {
            let now = Utc::now();
            Person {
                id: Uuid::new_v4(),
                name: a.name.trim().into(),
                email: a.email.trim().to_lowercase(),
                company_id: None,
                created_at: now,
                updated_at: now,
                manually_edited: false,
            }
        };
        if !p.manually_edited {
            if !a.name.trim().is_empty() {
                p.name = a.name.trim().into();
            }
            if let Some((_, domain)) = a.email.trim().rsplit_once('@') {
                let domain = domain.to_lowercase();
                if !domain.is_empty()
                    && !include_str!("../free-mail-domains.txt")
                        .lines()
                        .any(|d| d.trim() == domain)
                {
                    let data: Option<String> = conn
                        .query_row(
                            "SELECT data FROM companies WHERE domain=?",
                            [&domain],
                            |r| r.get(0),
                        )
                        .optional()?;
                    let company = if let Some(data) = data {
                        serde_json::from_str::<Company>(&data)?
                    } else {
                        let name = domain
                            .split('.')
                            .next()
                            .unwrap_or(&domain)
                            .split('-')
                            .map(|word| {
                                let mut chars = word.chars();
                                chars
                                    .next()
                                    .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
                                    .unwrap_or_default()
                            })
                            .collect::<Vec<_>>()
                            .join(" ");
                        let c = Company {
                            id: Uuid::new_v4(),
                            name,
                            domain: domain.clone(),
                            created_at: Utc::now(),
                            updated_at: Utc::now(),
                        };
                        conn.execute(
                            "INSERT INTO companies VALUES (?,?,?)",
                            params![c.id.to_string(), serde_json::to_string(&c)?, domain],
                        )?;
                        c
                    };
                    p.company_id = Some(company.id);
                }
            }
        }
        save(conn, &p)?;
        conn.execute(
            "INSERT OR IGNORE INTO person_keys VALUES (?,?)",
            params![identity, p.id.to_string()],
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO note_people VALUES (?,?)",
            params![note.id.to_string(), p.id.to_string()],
        )?;
    }
    Ok(())
}
impl Store {
    pub fn list_people(&self) -> Result<Vec<Person>> {
        read(
            &self.conn,
            "SELECT data FROM people ORDER BY json_extract(data,'$.name'),id",
        )
    }
    pub fn list_companies(&self) -> Result<Vec<Company>> {
        read(
            &self.conn,
            "SELECT data FROM companies ORDER BY json_extract(data,'$.name'),id",
        )
    }
    pub fn update_person(&mut self, person: &Person) -> Result<()> {
        let old = self
            .list_people()?
            .into_iter()
            .find(|p| p.id == person.id)
            .ok_or(Error::NotFound)?;
        if let Some(id) = person.company_id {
            if !self.list_companies()?.iter().any(|c| c.id == id) {
                return Err(Error::NotFound);
            }
        }
        let mut p = person.clone();
        p.created_at = old.created_at;
        p.updated_at = Utc::now();
        p.manually_edited = true;
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM people_undo", [])?;
        save(&tx, &p)?;
        tx.execute(
            "INSERT OR IGNORE INTO person_keys VALUES (?,?)",
            params![
                key(&Attendee {
                    name: p.name.clone(),
                    email: p.email.clone()
                }),
                p.id.to_string()
            ],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn person_meetings(&self, id: Uuid) -> Result<Vec<Note>> {
        let mut stmt = self.conn.prepare("SELECT n.data FROM notes n JOIN note_people np ON n.id=np.note_id WHERE np.person_id=? ORDER BY COALESCE(json_extract(n.data,'$.started_at'),json_extract(n.data,'$.created_at')) DESC,n.id")?;
        let rows = stmt.query_map([id.to_string()], |r| r.get::<_, String>(0))?;
        let notes: Result<Vec<Note>> = rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect();
        Ok(notes?
            .into_iter()
            .filter(|n| n.deleted_at.is_none())
            .collect())
    }
    pub fn company_meetings(&self, id: Uuid) -> Result<Vec<Note>> {
        let mut notes = Vec::new();
        for p in self
            .list_people()?
            .iter()
            .filter(|p| p.company_id == Some(id))
        {
            for n in self.person_meetings(p.id)? {
                if !notes.iter().any(|existing: &Note| existing.id == n.id) {
                    notes.push(n);
                }
            }
        }
        notes.sort_by_key(|n| std::cmp::Reverse(n.started_at.unwrap_or(n.created_at)));
        Ok(notes)
    }
    pub fn rebuild_people(&mut self) -> Result<()> {
        let notes = self
            .list_notes()?
            .into_iter()
            .chain(self.list_trash()?)
            .collect::<Vec<_>>();
        let tx = self.conn.transaction()?;
        for n in notes {
            sync_note(&tx, &n)?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn duplicate_people(&self) -> Result<Vec<(Person, Person)>> {
        let people = self.list_people()?;
        let mut pairs = Vec::new();
        for (i, a) in people.iter().enumerate() {
            for b in &people[i + 1..] {
                let normalize = |s: &str| {
                    s.chars()
                        .filter(|c| c.is_alphanumeric())
                        .flat_map(char::to_lowercase)
                        .collect::<String>()
                };
                let x = normalize(&a.name);
                let y = normalize(&b.name);
                let similar = x == y
                    || (x.chars().count().min(y.chars().count()) >= 5
                        && edit_distance(&x, &y) <= 1);
                if (!a.email.is_empty() && a.email.eq_ignore_ascii_case(&b.email))
                    || (!x.is_empty() && similar)
                {
                    pairs.push((a.clone(), b.clone()));
                }
            }
        }
        Ok(pairs)
    }
    pub fn merge_people(&mut self, keep: Uuid, remove: Uuid) -> Result<()> {
        let people = self.list_people()?;
        if keep == remove
            || ![keep, remove]
                .iter()
                .all(|id| people.iter().any(|p| p.id == *id))
        {
            return Err(Error::Invalid("choose two existing people"));
        }
        let tx = self.conn.transaction()?;
        let keys: Vec<(String, String)> = {
            let mut s = tx.prepare("SELECT identity,person_id FROM person_keys")?;
            let rows = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        let links: Vec<(String, String)> = {
            let mut s = tx.prepare("SELECT note_id,person_id FROM note_people")?;
            let rows = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        tx.execute(
            "INSERT OR REPLACE INTO people_undo VALUES (1,?)",
            [serde_json::to_string(&(people, keys, links))?],
        )?;
        let mut kept = people_for_merge(&tx, keep)?;
        kept.manually_edited = true;
        kept.updated_at = Utc::now();
        save(&tx, &kept)?;
        tx.execute(
            "INSERT OR IGNORE INTO note_people SELECT note_id,? FROM note_people WHERE person_id=?",
            params![keep.to_string(), remove.to_string()],
        )?;
        tx.execute(
            "DELETE FROM note_people WHERE person_id=?",
            [remove.to_string()],
        )?;
        tx.execute(
            "UPDATE person_keys SET person_id=? WHERE person_id=?",
            params![keep.to_string(), remove.to_string()],
        )?;
        tx.execute("DELETE FROM people WHERE id=?", [remove.to_string()])?;
        tx.commit()?;
        Ok(())
    }
    pub fn can_undo_people_merge(&self) -> Result<bool> {
        Ok(self
            .conn
            .query_row("SELECT EXISTS(SELECT 1 FROM people_undo)", [], |r| r.get(0))?)
    }
    /// Undo is valid until the next directory edit or note save; never discard later work.
    pub fn undo_people_merge(&mut self) -> Result<()> {
        type Snapshot = (Vec<Person>, Vec<(String, String)>, Vec<(String, String)>);
        let tx = self.conn.transaction()?;
        let data: String = tx
            .query_row("SELECT data FROM people_undo WHERE singleton=1", [], |r| {
                r.get(0)
            })
            .optional()?
            .ok_or(Error::NotFound)?;
        let (people, keys, links): Snapshot = serde_json::from_str(&data)?;
        tx.execute_batch("DELETE FROM note_people; DELETE FROM person_keys; DELETE FROM people;")?;
        for p in people {
            save(&tx, &p)?;
        }
        for (key, id) in keys {
            tx.execute("INSERT INTO person_keys VALUES (?,?)", params![key, id])?;
        }
        for (note, id) in links {
            tx.execute(
                "INSERT INTO note_people SELECT ?,? WHERE EXISTS(SELECT 1 FROM notes WHERE id=?)",
                params![note, id, note],
            )?;
        }
        tx.execute("DELETE FROM people_undo", [])?;
        tx.commit()?;
        Ok(())
    }
}

fn people_for_merge(conn: &Connection, id: Uuid) -> Result<Person> {
    let data: String = conn.query_row(
        "SELECT data FROM people WHERE id=?",
        [id.to_string()],
        |r| r.get(0),
    )?;
    Ok(serde_json::from_str(&data)?)
}
fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, c) in a.chars().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, other) in b.iter().enumerate() {
            let old = row[j + 1];
            row[j + 1] = (diagonal + usize::from(c != *other))
                .min(row[j] + 1)
                .min(old + 1);
            diagonal = old;
        }
    }
    row[b.len()]
}
