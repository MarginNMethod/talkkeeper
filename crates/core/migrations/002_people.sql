CREATE TABLE companies (id TEXT PRIMARY KEY, data TEXT NOT NULL, name TEXT GENERATED ALWAYS AS (json_extract(data, '$.name')) VIRTUAL, created_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.created_at')) VIRTUAL, updated_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.updated_at')) VIRTUAL, domain TEXT NOT NULL UNIQUE);
CREATE TABLE people (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    name TEXT GENERATED ALWAYS AS (json_extract(data, '$.name')) VIRTUAL,
    email TEXT GENERATED ALWAYS AS (json_extract(data, '$.email')) VIRTUAL,
    company_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.company_id')) VIRTUAL REFERENCES companies(id),
    created_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.created_at')) VIRTUAL,
    updated_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.updated_at')) VIRTUAL,
    manually_edited INTEGER GENERATED ALWAYS AS (json_extract(data, '$.manually_edited')) VIRTUAL
);
CREATE TABLE person_keys (identity TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id));
CREATE TABLE note_people (note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, person_id TEXT NOT NULL REFERENCES people(id), PRIMARY KEY(note_id,person_id));
CREATE TABLE people_undo (singleton INTEGER PRIMARY KEY CHECK(singleton=1), data TEXT NOT NULL);

CREATE INDEX note_people_person ON note_people(person_id, note_id);
CREATE INDEX people_company ON people(company_id);
