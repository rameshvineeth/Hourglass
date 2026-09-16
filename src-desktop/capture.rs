//! Deterministic capture: observations and time are inputs, never OS calls.
use chrono::{DateTime, Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq)]
pub struct Window {
    pub app: String,
    pub title: String,
    pub executable: String,
    pub category: String,
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub revision: u64,
    pub started_at: String,
    pub ended_at: String,
    pub timestamp: String,
    pub local_date: String,
    pub timezone_offset_minutes: i32,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: f64,
    pub app_name: String,
    pub window_title: String,
    pub executable: String,
    pub category: String,
    pub icon_id: Option<String>,
    pub is_idle: bool,
    pub is_assigned: bool,
    pub needs_review: bool,
    pub source: String,
    pub state: String,
    pub finalized: bool,
}

fn utc(ms: i64) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(ms).expect("valid clock")
}

impl Activity {
    fn new(now: i64, window: &Window, state: &str) -> Self {
        let local = utc(now).with_timezone(&Local);
        Self {
            id: Uuid::new_v4().to_string(),
            revision: 1,
            started_at: utc(now).to_rfc3339(),
            ended_at: utc(now).to_rfc3339(),
            timestamp: utc(now).to_rfc3339(),
            local_date: local.format("%Y-%m-%d").to_string(),
            timezone_offset_minutes: local.offset().local_minus_utc() / 60,
            start_time: local.format("%H:%M:%S").to_string(),
            end_time: local.format("%H:%M:%S").to_string(),
            duration_seconds: 0.0,
            app_name: window.app.clone(),
            window_title: window.title.clone(),
            executable: window.executable.clone(),
            category: window.category.clone(),
            icon_id: window.icon.as_ref().map(|_| window.executable.clone()),
            is_idle: state == "idle",
            is_assigned: false,
            needs_review: state != "active",
            source: "live".into(),
            state: state.into(),
            finalized: false,
        }
    }
    fn end(&mut self, now: i64, finalized: bool) {
        let start = DateTime::parse_from_rfc3339(&self.started_at)
            .unwrap()
            .timestamp_millis();
        let now = now.max(start);
        self.ended_at = utc(now).to_rfc3339();
        self.end_time = utc(now)
            .with_timezone(&Local)
            .format("%H:%M:%S")
            .to_string();
        self.duration_seconds = (now - start) as f64 / 1000.0;
        self.finalized = finalized;
        self.revision += 1;
    }
}

pub struct Engine {
    pub enabled: bool,
    pub state: String,
    pub current: Option<Activity>,
    window: Option<Window>,
    pub last_sample: Option<i64>,
    recent: Vec<Activity>,
}

impl Engine {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            state: "unavailable".into(),
            current: None,
            window: None,
            last_sample: None,
            recent: vec![],
        }
    }
    fn close(&mut self, at: i64, changed: &mut Vec<Activity>) {
        if let Some(mut a) = self.current.take() {
            a.end(at, true);
            if a.duration_seconds > 0.0 {
                self.recent.push(a.clone());
                changed.push(a);
            }
        }
        self.window = None;
    }
    pub fn pause(&mut self, now: i64, enabled: bool) -> Vec<Activity> {
        let mut changed = vec![];
        self.close(
            now.min(self.last_sample.unwrap_or(now) + 1000),
            &mut changed,
        );
        self.enabled = enabled;
        self.state = if enabled { "unavailable" } else { "paused" }.into();
        self.last_sample = None;
        changed
    }
    pub fn sample(
        &mut self,
        now: i64,
        window: Option<Window>,
        idle_ms: u64,
        locked: bool,
    ) -> Vec<Activity> {
        let mut changed = vec![];
        if let Some(last) = self.last_sample {
            if now < last || now - last > 3000 {
                self.close(last, &mut changed);
                self.state = "suspended".into();
                self.last_sample = Some(now);
                return changed;
            }
        }
        self.last_sample = Some(now);
        let state = if !self.enabled {
            "paused"
        } else if locked {
            "locked"
        } else if window.is_none() {
            "unavailable"
        } else if idle_ms >= 300_000 {
            "idle"
        } else {
            "active"
        };
        if state == "idle" && self.state != "idle" {
            // Input inactivity is evidence requiring review, not proof of non-work.
            let last_input = now - idle_ms as i64;
            self.close(now, &mut changed);
            for a in &mut self.recent {
                let end = DateTime::parse_from_rfc3339(&a.ended_at)
                    .unwrap()
                    .timestamp_millis();
                let start = DateTime::parse_from_rfc3339(&a.started_at)
                    .unwrap()
                    .timestamp_millis();
                if end <= last_input {
                    continue;
                }
                if start < last_input {
                    let mut idle = a.clone();
                    a.end(last_input, true);
                    changed.push(a.clone());
                    idle.id = Uuid::new_v4().to_string();
                    idle.started_at = utc(last_input).to_rfc3339();
                    idle.timestamp = idle.started_at.clone();
                    idle.start_time = utc(last_input)
                        .with_timezone(&Local)
                        .format("%H:%M:%S")
                        .to_string();
                    idle.is_idle = true;
                    idle.needs_review = true;
                    idle.state = "idle".into();
                    idle.end(end, true);
                    changed.push(idle);
                } else {
                    a.is_idle = true;
                    a.needs_review = true;
                    a.state = "idle".into();
                    a.revision += 1;
                    changed.push(a.clone());
                }
            }
        }
        let date_changed = self.current.as_ref().is_some_and(|a| {
            a.local_date
                != utc(now)
                    .with_timezone(&Local)
                    .format("%Y-%m-%d")
                    .to_string()
        });
        if state != self.state || self.window != window || date_changed {
            let boundary = if date_changed {
                utc(now)
                    .with_timezone(&Local)
                    .date_naive()
                    .and_hms_opt(0, 0, 0)
                    .and_then(|d| Local.from_local_datetime(&d).earliest())
                    .map(|d| d.timestamp_millis())
                    .unwrap_or(now)
            } else {
                now
            };
            self.close(boundary, &mut changed);
            if date_changed && (state == "active" || state == "idle") {
                self.current = window.as_ref().map(|w| Activity::new(boundary, w, state));
                self.window = window.clone();
            }
        }
        self.state = state.into();
        if state == "active" || state == "idle" {
            if self.current.is_none() {
                self.current = window.as_ref().map(|w| Activity::new(now, w, state));
                self.window = window;
            }
            if let Some(a) = &mut self.current {
                a.end(now, false);
                changed.push(a.clone());
            }
        }
        self.recent.retain(|a| {
            DateTime::parse_from_rfc3339(&a.ended_at)
                .unwrap()
                .timestamp_millis()
                >= now - 360_000
        });
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn w(name: &str) -> Option<Window> {
        Some(Window {
            app: name.into(),
            title: name.into(),
            executable: name.into(),
            category: "other".into(),
            icon: None,
        })
    }
    #[test]
    fn rapid_switch_has_no_overlap() {
        let mut e = Engine::new(true);
        e.sample(1_700_000_000_000, w("Excel"), 0, false);
        let c = e.sample(1_700_000_001_000, w("Mail"), 0, false);
        assert_eq!(c[0].duration_seconds, 1.0);
        assert_eq!(c[0].ended_at, c[1].started_at);
        assert_ne!(c[0].id, c[1].id);
    }
    #[test]
    fn pause_does_not_bill_break() {
        let mut e = Engine::new(true);
        e.sample(1000, w("A"), 0, false);
        e.pause(2000, false);
        e.sample(3000, w("A"), 0, false);
        assert!(e.current.is_none());
        e.pause(600_000, true);
        e.sample(601_000, w("A"), 0, false);
        assert_eq!(e.current.unwrap().duration_seconds, 0.0);
    }
    #[test]
    fn sleep_and_clock_reversal_close_at_last_observation() {
        let mut e = Engine::new(true);
        e.sample(1000, w("A"), 0, false);
        e.sample(2000, w("A"), 0, false);
        let c = e.sample(600_000, w("A"), 0, false);
        assert_eq!(c[0].duration_seconds, 1.0);
        assert!(e.current.is_none());
        e.sample(601_000, w("A"), 0, false);
        e.sample(1000, w("A"), 0, false);
        assert!(e.current.is_none());
    }
    #[test]
    fn idle_revises_last_input_interval() {
        let mut e = Engine::new(true);
        for i in 0..=300 {
            e.sample(1000 + i * 1000, w("A"), (i * 1000) as u64, false);
        }
        assert_eq!(e.state, "idle");
        assert!(e.recent.iter().all(|a| a.is_idle));
    }
    #[test]
    fn unavailable_and_locked_never_extend_previous_work() {
        let mut e = Engine::new(true);
        e.sample(1000, w("A"), 0, false);
        e.sample(2000, None, 0, false);
        assert!(e.current.is_none());
        e.sample(3000, w("A"), 0, true);
        assert_eq!(e.state, "locked");
        assert!(e.current.is_none());
    }
    #[test]
    fn timestamps_are_real_dates_and_revisions_increase() {
        let mut e = Engine::new(true);
        e.sample(0, w("A"), 0, false);
        let a = e.current.clone().unwrap();
        e.sample(1000, w("A"), 0, false);
        assert!(a.started_at.starts_with("1970-01-01"));
        assert!(e.current.unwrap().revision > a.revision);
    }
}
