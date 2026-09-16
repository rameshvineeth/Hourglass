mod capture;
mod server;
mod store;
mod windows;
use capture::Engine;
use chrono::Utc;
use server::Shared;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

#[repr(C)]
struct LastInput {
    size: u32,
    tick: u32,
}
#[link(name = "user32")]
extern "system" {
    fn GetLastInputInfo(info: *mut LastInput) -> i32;
    fn OpenInputDesktop(flags: u32, inherit: i32, access: u32) -> isize;
    fn GetUserObjectInformationW(
        handle: isize,
        index: i32,
        info: *mut u16,
        len: u32,
        needed: *mut u32,
    ) -> i32;
    fn CloseDesktop(handle: isize) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
    fn GetTickCount() -> u32;
}
fn input_state() -> (u64, bool) {
    unsafe {
        let mut input = LastInput {
            size: std::mem::size_of::<LastInput>() as u32,
            tick: 0,
        };
        let idle = if GetLastInputInfo(&mut input) != 0 {
            GetTickCount().wrapping_sub(input.tick) as u64
        } else {
            0
        };
        let desktop = OpenInputDesktop(0, 0, 1);
        if desktop == 0 {
            return (idle, true);
        }
        let mut name = [0u16; 256];
        let mut needed = 0;
        let ok = GetUserObjectInformationW(desktop, 2, name.as_mut_ptr(), 512, &mut needed);
        CloseDesktop(desktop);
        let len = name.iter().position(|c| *c == 0).unwrap_or(name.len());
        (
            idle,
            ok == 0 || String::from_utf16_lossy(&name[..len]) != "Default",
        )
    }
}
fn main() {
    if let Err(e) = run() {
        eprintln!("Hourglass could not start: {e}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let dist = [
        cwd.join("dist"),
        exe.parent().unwrap().join("dist"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist"),
    ]
    .into_iter()
    .find(|p| p.join("index.html").exists())
    .ok_or("Run npm run build first")?
    .canonicalize()
    .map_err(|e| e.to_string())?;
    let dir = std::env::var_os("HOURGLASS_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("LOCALAPPDATA").expect("LOCALAPPDATA")).join("Hourglass")
        });
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // One well-known port prevents two collectors billing the same desktop session.
    let http = tiny_http::Server::http("127.0.0.1:47831")
        .map_err(|e| format!("Port 47831 unavailable; Hourglass may already be running: {e}"))?;
    let db = store::Store::open(&dir.join("hourglass.sqlite"))?;
    let enabled = db
        .document("capture")?
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let shared = Arc::new(Mutex::new(Shared {
        engine: Engine::new(enabled),
        store: db,
        error: None,
    }));
    let worker = shared.clone();
    thread::spawn(move || {
        let mut checkpoint = 0;
        loop {
            thread::sleep(Duration::from_secs(1));
            let now = Utc::now().timestamp_millis();
            let (idle, locked) = input_state();
            let mut s = worker.lock().unwrap();
            let window = if s.engine.enabled && !locked {
                windows::query_os_active_window()
            } else {
                None
            };
            if let Some(w) = &window {
                if let Some(icon) = &w.icon {
                    if let Err(e) = s.store.icon(&w.executable, Some(icon)) {
                        s.error = Some(e);
                    }
                }
            }
            let changed = s.engine.sample(now, window, idle, locked);
            let checkpoint_due = now - checkpoint >= 5000;
            for a in changed {
                if a.finalized || checkpoint_due {
                    if let Err(e) = s.store.activity(&a) {
                        s.error = Some(e);
                        s.engine.enabled = false;
                    }
                }
            }
            if checkpoint_due {
                checkpoint = now;
            }
        }
    });
    let origin = "http://127.0.0.1:47831".to_string();
    println!("Hourglass: {origin} | data: {}", dir.display());
    if !std::env::args().any(|a| a == "--headless") {
        for browser in [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ] {
            if std::path::Path::new(browser).exists() {
                let _ = std::process::Command::new(browser)
                    .arg(format!("--app={origin}"))
                    .arg("--window-size=1440,900")
                    .spawn();
                break;
            }
        }
    }
    server::serve(http, shared, dist, origin, uuid::Uuid::new_v4().to_string());
    Ok(())
}
