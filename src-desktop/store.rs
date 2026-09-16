use crate::capture::Activity;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;

pub struct Store(pub Connection);
impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let c = Connection::open(path).map_err(|e| e.to_string())?;
        c.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS icons(id TEXT PRIMARY KEY, body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, body TEXT NOT NULL);
          PRAGMA user_version=1;",
        )
        .map_err(|e| e.to_string())?;
        let s = Self(c);
        // A checkpoint is the last observed time, never extend it to restart time.
        for mut a in s.activities()? {
            if !a.finalized {
                a.finalized = true;
                a.revision += 1;
                a.needs_review = true;
                s.activity(&a)?;
            }
        }
        Ok(s)
    }
    pub fn activity(&self, a: &Activity) -> Result<(), String> {
        self.0.execute("INSERT INTO activities VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![a.id,serde_json::to_string(a).unwrap()]).map(|_|()).map_err(|e|e.to_string())
    }
    pub fn activities(&self) -> Result<Vec<Activity>, String> {
        let mut q = self
            .0
            .prepare("SELECT body FROM activities ORDER BY rowid")
            .map_err(|e| e.to_string())?;
        let rows = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            r.map_err(|e| e.to_string())
                .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        })
        .collect()
    }
    pub fn document(&self, id: &str) -> Result<Option<Value>, String> {
        let raw: Option<String> = self
            .0
            .query_row("SELECT body FROM documents WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        raw.map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            .transpose()
    }
    pub fn save_document(&mut self, id: &str, v: &Value) -> Result<(), String> {
        let tx = self.0.transaction().map_err(|e| e.to_string())?;
        // Keep the previous committed application state for recovery.
        tx.execute("INSERT INTO documents SELECT ?1,body FROM documents WHERE id=?2 ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![format!("backup:{id}"),id]).map_err(|e|e.to_string())?;
        tx.execute(
            "INSERT INTO documents VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
            params![id, v.to_string()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn restore(&mut self, v: &Value) -> Result<(), String> {
        let rows=v["activities"].as_array().ok_or("Missing activity history")?;
        let mut restored=Vec::new();
        for row in rows { if row.get("startedAt").is_some() && row["source"]=="live" {
            let mut a:Activity=serde_json::from_value(row.clone()).map_err(|e|e.to_string())?;
            a.finalized=true; a.revision+=1;
            restored.push(a);
        }}
        let old=serde_json::to_string(&self.activities()?).map_err(|e|e.to_string())?;
        let tx=self.0.transaction().map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO documents VALUES ('backup:capture',?1) ON CONFLICT(id) DO UPDATE SET body=excluded.body",[old]).map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO documents SELECT 'backup:app',body FROM documents WHERE id='app' ON CONFLICT(id) DO UPDATE SET body=excluded.body",[]).map_err(|e|e.to_string())?;
        tx.execute("DELETE FROM activities",[]).map_err(|e|e.to_string())?;
        for a in restored {tx.execute("INSERT INTO activities VALUES (?1,?2)",params![a.id,serde_json::to_string(&a).unwrap()]).map_err(|e|e.to_string())?;}
        tx.execute("INSERT INTO documents VALUES ('app',?1) ON CONFLICT(id) DO UPDATE SET body=excluded.body",[v.to_string()]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())
    }
    pub fn icon(&self, id: &str, body: Option<&str>) -> Result<Option<String>, String> {
        if let Some(body) = body {
            self.0
                .execute(
                    "INSERT OR IGNORE INTO icons VALUES (?1,?2)",
                    params![id, body],
                )
                .map_err(|e| e.to_string())?;
        }
        self.0
            .query_row("SELECT body FROM icons WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restart_recovers_only_checkpoint() {
        use crate::capture::{Engine, Window};
        let path =
            std::env::temp_dir().join(format!("hourglass-test-{}.sqlite", uuid::Uuid::new_v4()));
        let mut e = Engine::new(true);
        e.sample(
            1000,
            Some(Window {
                app: "A".into(),
                title: "A".into(),
                executable: "a.exe".into(),
                category: "other".into(),
                icon: None,
            }),
            0,
            false,
        );
        let a = e
            .sample(
                2000,
                Some(Window {
                    app: "A".into(),
                    title: "A".into(),
                    executable: "a.exe".into(),
                    category: "other".into(),
                    icon: None,
                }),
                0,
                false,
            )
            .pop()
            .unwrap();
        {
            let s = Store::open(&path).unwrap();
            s.activity(&a).unwrap();
        }
        {
            let s = Store::open(&path).unwrap();
            let restored = s.activities().unwrap();
            assert_eq!(restored[0].ended_at, a.ended_at);
            assert!(restored[0].finalized);
            assert!(restored[0].needs_review);
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn documents_are_atomic_and_backed_up() {
        let mut s = Store::open(Path::new(":memory:")).unwrap();
        s.save_document("app", &serde_json::json!({"revision":1}))
            .unwrap();
        s.save_document("app", &serde_json::json!({"revision":2}))
            .unwrap();
        assert_eq!(s.document("backup:app").unwrap().unwrap()["revision"], 1);
        assert_eq!(s.document("app").unwrap().unwrap()["revision"], 2);
    }
}
