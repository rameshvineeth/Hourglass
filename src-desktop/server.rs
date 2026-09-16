use crate::{capture::Engine, store::Store};
use serde_json::{json, Value};
use std::io::Read;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tiny_http::{Header, Response, Server, StatusCode};

pub struct Shared {
    pub engine: Engine,
    pub store: Store,
    pub error: Option<String>,
}
fn reply(r: tiny_http::Request, code: u16, body: String, kind: &str) {
    let _ = r.respond(
        Response::from_string(body)
            .with_status_code(StatusCode(code))
            .with_header(Header::from_bytes("Content-Type", kind).unwrap())
            .with_header(Header::from_bytes("Cache-Control", "no-store").unwrap())
            .with_header(Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap()),
    );
}
pub fn serve(
    server: Server,
    shared: Arc<Mutex<Shared>>,
    dist: PathBuf,
    origin: String,
    token: String,
) {
    for mut req in server.incoming_requests() {
        let url = req.url().split('?').next().unwrap_or("/").to_string();
        let host = req
            .headers()
            .iter()
            .find(|h| h.field.equiv("Host"))
            .map(|h| h.value.as_str());
        let request_origin = req
            .headers()
            .iter()
            .find(|h| h.field.equiv("Origin"))
            .map(|h| h.value.as_str());
        if host != Some(origin.trim_start_matches("http://"))
            || request_origin.is_some_and(|o| o != origin)
        {
            reply(req, 403, "Forbidden origin".into(), "text/plain");
            continue;
        }
        if url.starts_with("/api/") {
            let authorized = req
                .headers()
                .iter()
                .any(|h| h.field.equiv("X-Hourglass-Session") && h.value.as_str() == token);
            if !authorized {
                reply(req, 403, "Forbidden session".into(), "text/plain");
                continue;
            }
            let method = req.method().as_str().to_string();
            let mut s = shared.lock().unwrap();
            let result: Result<Value, String> = (|| match (method.as_str(), url.as_str()) {
                ("GET", "/api/capture-status") => Ok(
                    json!({"isCapturing":s.engine.enabled,"state":s.engine.state,"error":s.error}),
                ),
                ("GET", "/api/real-activities") => {
                    let mut records = s.store.activities()?;
                    if let Some(current) = &s.engine.current {
                        records.retain(|a| a.id != current.id);
                        records.push(current.clone());
                    }
                    Ok(json!(records))
                }
                ("GET", "/api/state") => Ok(s.store.document("app")?.unwrap_or(Value::Null)),
                ("GET", "/api/icons") => {
                    let mut icons = serde_json::Map::new();
                    for a in s.store.activities()? {
                        if let Some(id) = a.icon_id {
                            if !icons.contains_key(&id) {
                                if let Some(v) = s.store.icon(&id, None)? {
                                    icons.insert(id, json!(v));
                                }
                            }
                        }
                    }
                    if let Some(a) = &s.engine.current {
                        if let Some(id) = &a.icon_id {
                            if let Some(v) = s.store.icon(id, None)? {
                                icons.insert(id.clone(), json!(v));
                            }
                        }
                    }
                    Ok(Value::Object(icons))
                }
                ("POST", "/api/restore") | ("POST", "/api/state") | ("POST", "/api/set-capture") => {
                    let mut body = String::new();
                    std::io::Read::take(req.as_reader(), 16 * 1024 * 1024 + 1)
                        .read_to_string(&mut body)
                        .map_err(|e| e.to_string())?;
                    if body.len() > 16 * 1024 * 1024 {
                        return Err("Request too large".into());
                    }
                    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
                    if url == "/api/state" || url == "/api/restore" {
                        if v["version"] != 2
                            || !v["clients"].is_array()
                            || !v["entries"].is_array()
                            || !v["periods"].is_array()
                        {
                            return Err("Invalid application document".into());
                        }
                        let current = s.store.document("app")?;
                        let revision = current
                            .as_ref()
                            .and_then(|d| d["revision"].as_u64())
                            .unwrap_or(0);
                        if v["revision"].as_u64() != Some(revision + 1) {
                            return Err(
                                "Another window changed the data. Reload before saving.".into()
                            );
                        }
                        if url=="/api/restore" {
                            if s.engine.enabled {return Err("Pause capture before restoring a backup.".into());}
                            s.store.restore(&v)?;
                        } else {
                            if let Some(old)=&current { preserve_snapshots(old,&v)?; }
                            s.store.save_document("app", &v)?;
                        }
                        Ok(json!({"saved":true}))
                    } else {
                        let enabled = v["enabled"].as_bool().ok_or("enabled must be boolean")?;
                        for a in s
                            .engine
                            .pause(chrono::Utc::now().timestamp_millis(), enabled)
                        {
                            s.store.activity(&a)?;
                        }
                        s.store.save_document("capture", &json!(enabled))?;
                        Ok(json!({"isCapturing":enabled,"state":s.engine.state}))
                    }
                }
                _ => Err("Unknown endpoint or method".into()),
            })();
            drop(s);
            match result {
                Ok(v) => reply(req, 200, v.to_string(), "application/json"),
                Err(e) => reply(req, 409, json!({"error":e}).to_string(), "application/json"),
            }
        } else {
            if req.method().as_str() != "GET" {
                reply(req, 405, "Method not allowed".into(), "text/plain");
                continue;
            }
            let rel = if url == "/" {
                "index.html"
            } else {
                url.trim_start_matches('/')
            };
            let path = dist.join(rel).canonicalize();
            match path {
                Ok(path) if path.starts_with(&dist) && path.is_file() => {
                    if path.extension().is_some_and(|e| e == "html") {
                        match std::fs::read_to_string(path){Ok(html)=>reply(req,200,html.replace("</head>",&format!("<meta name=\"hourglass-session\" content=\"{token}\"></head>")),"text/html; charset=utf-8"),Err(_)=>reply(req,500,"Read failed".into(),"text/plain")}
                    } else {
                        let kind = match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
                            "js" => "application/javascript",
                            "css" => "text/css",
                            "svg" => "image/svg+xml",
                            _ => "application/octet-stream",
                        };
                        match std::fs::read(path) {
                            Ok(bytes) => {
                                let _ = req.respond(Response::from_data(bytes).with_header(
                                    Header::from_bytes("Content-Type", kind).unwrap(),
                                ));
                            }
                            Err(_) => reply(req, 500, "Read failed".into(), "text/plain"),
                        }
                    }
                }
                _ => reply(req, 404, "Not found".into(), "text/plain"),
            }
        }
    }
}

fn preserve_snapshots(old:&Value,new:&Value)->Result<(),String>{
    if let Some(periods)=old["periods"].as_array(){for p in periods {if let Some(snapshots)=p["snapshots"].as_array(){for snapshot in snapshots {
        let found=new["periods"].as_array().is_some_and(|ps|ps.iter().any(|n|n["snapshots"].as_array().is_some_and(|ss|
            ss.iter().any(|s|
                s == snapshot || (
                    s["revision"] == snapshot["revision"] &&
                    s["finalizedAt"] == snapshot["finalizedAt"]
                )
            )
        )));
        if !found {return Err("Saved revisions cannot be changed or deleted by an ordinary save. Use explicit backup restoration.".into());}
    }}}} Ok(())
}
#[cfg(test)] mod tests { use super::*;
 #[test] fn immutable_snapshot_is_preserved(){let old=json!({"periods":[{"startDate":"2026-09-07","snapshots":[{"revision":1,"entries":[]}]}]});assert!(preserve_snapshots(&old,&old).is_ok());assert!(preserve_snapshots(&old,&json!({"periods":[]})).is_err());}
}
