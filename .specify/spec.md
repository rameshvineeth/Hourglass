# Functional & Technical Specifications: Hourglass

This specification defines the functional capabilities, system architecture, data models, and interaction workflows for **Hourglass** — an automated, passive time-tracking and billing reconstruction platform designed for high-value consulting, legal, and advisory engagements.

---

## 1. Product Vision & Architecture

Hourglass replaces error-prone, manual stopwatches with passive Windows OS foreground capture, local-first intelligence, and consulting-grade billing reconstruction. It delivers:
- **Zero Stopwatch Burden**: Captures raw foreground window activity continuously at 1-second resolution.
- **Enterprise NDA Privacy**: Operates strictly local-first with SQLite WAL storage, hardware display affinity protection, and zero background cloud telemetry.
- **Dual-Timeline Canvas**: Visualizes raw application memory alongside confirmed billable timesheets on an interactive 24-hour canvas.
- **3-Tier Smart Allocate**: Categorizes raw activity into client project codes instantly using persistent caching, historical inverted index, and batch Groq LLM inference.
- **Tenth-Hour Consulting Math**: Automates standard 6-minute ceiling rounding ($\lceil \text{mins}/6 \rceil \times 0.1\text{h}$) and revenue computation.
- **Immutable Approvals Ledger**: Freezes timesheet periods with point-in-time snapshots to guarantee audit integrity and prevent post-approval tampering.

---

## 2. Core Functional Modules

### 2.1 Native Windows OS Capture Companion (`src-desktop/`)
- **Runtime**: High-performance Rust binary (`Hourglass.exe`) running locally as a desktop background daemon.
- **Foreground Polling**: Win32 `GetForegroundWindow` called at a 1,000ms heartbeat.
- **Executable & Metadata Resolution**:
  - Resolves process handles via `GetWindowThreadProcessId` and `QueryFullProcessImageNameW`.
  - Extracts clean, branded application names via Win32 `VerQueryValueW` PE version resource parsing (e.g., `EXCEL.EXE` $\rightarrow$ "Microsoft Excel").
  - Extracts high-resolution 32-bit DIB taskbar icons using `ExtractIconExW` and `GetDIBits`, serialized to base64 PNG data URIs.
- **Sleep & Screen-Lock Detection**: Monitors wall-clock jump deltas (`clock_skew > 5s`). Workstation locks, screen off, or system suspend cleanly terminate current activity intervals without ghost hour accumulation.
- **Display Affinity Guard**: Queries `GetWindowDisplayAffinity`. Windows protected by `WDA_EXCLUDEFROMCAPTURE` (`0x11`) or `WDA_MONITOR` (`0x01`) suppress title logging to comply with enterprise NDA/DRM constraints, maintaining timeline continuity via `LAST_LEGITIMATE_WINDOW`.
- **Local Embedded Server**: Exposes a local-only REST API over loopback (`127.0.0.1:3030`):
  - `GET /activities?date=YYYY-MM-DD`: Fetches captured day records.
  - `GET /status`: Verifies daemon health, SQLite path, and polling stats.
  - `POST /save`: Triggers atomic database flush to disk.

### 2.2 Dual-Timeline Workspace & Canvas
- **Left Lane — Memory Aid (Raw OS Activity Stream)**:
  - Aggregates consecutive raw window captures into logical application sessions.
  - Deduplicates browser tabs across revisit cycles and filters transient navigation noise (e.g., "New Tab", Cloudflare verification screens).
  - Arranges overlapping raw activities with a greedy collision-free sub-lane packing algorithm.
- **Center — 24-Hour Laser Scale**:
  - Synchronized ruler spanning `00:00` to `24:00` with hour and tenth-hour tick markers.
  - Highlighting current time with an active animated cyan laser line.
- **Right Lane — Confirmed Timesheet**:
  - Displays finalized, client-billable time blocks with color-coded client badges.
  - Supports interactive click-and-drag creation, edge-handle duration snapping (6-minute tenth-hour increments), and quick entry editing.

### 2.3 3-Tier Smart Allocation Engine
- **Instant Auto-Run**: Triggers automatically on day navigation or activity updates.
- **Tier 1 — Persistent Local Cache (0ms)**:
  - Exact O(1) hash table lookup matching normalized window titles, document tokens, and app names against past user-confirmed allocations.
- **Tier 2 — Historical Inverted Index (0ms)**:
  - Tokenizes raw window titles into n-grams and matches them against historical client codes, project definitions, and keywords.
- **Tier 3 — Deduplicated Groq LLM (<300ms)**:
  - Batches novel, unclassified window titles and prompts Groq (`llama-3.3-70b-versatile` / `llama3-8b-8192`).
  - Returns suggested client, project, task name, confidence score (0.0 – 1.0), and reasoning.
- **Batch Acceptance**: Allows 1-click confirmation of all high-confidence suggestions ($\ge 0.85$) while badging uncertain entries for review.

### 2.4 Gap & Overlap Audit Engine
- **Untracked Gap Detection**: Automatically detects and highlights unassigned intervals exceeding 15 minutes to eliminate unbilled time leakage.
- **Overlap Detection**: Identifies and flags conflicting time entries occupying identical time intervals on the billable timesheet.
- **Calendar Integration**: Parses RFC 5545 `.ics` files to reconcile scheduled calendar meetings with actual recorded window activity.

### 2.5 Approvals Hub, Immutability & Export
- **Approval Workflow**: Strict state machine lifecycle: `draft` $\rightarrow$ `submitted` $\rightarrow$ `approved` (or `rejected`).
- **Immutable Snapshots**: Captures a frozen `TimesheetSnapshot` containing exact finalized entries, clients, projects, rates, consultant identity, and timestamp.
- **Approved Period Lockout**: Blocks modifications or deletions to entries belonging to approved periods.
- **Billing Export**: Generates validated **CSV** and **JSON** exports formatted for enterprise ERP and client invoicing systems.

---

## 3. Data Schemas & Relationships

### 3.1 Entity Relationship Diagram

```text
┌─────────────────────────┐             ┌─────────────────────────┐
│         Client          │             │         Project         │
├─────────────────────────┤             ├─────────────────────────┤
│ id: string (UUID)       │1           *│ id: string (UUID)       │
│ name: string            │────────────►│ clientId: string (FK)   │
│ code: string            │             │ name: string            │
│ color: string           │             │ defaultHourlyRate: num  │
│ archived: boolean       │             │ isBillableDefault: bool │
└─────────────────────────┘             │ color: string           │
                                        └─────────────────────────┘
                                                     ▲
                                                     │ 1
                                                     │
                                                     │ *
┌─────────────────────────┐             ┌─────────────────────────┐
│      ActivityItem       │             │        TimeEntry        │
├─────────────────────────┤             ├─────────────────────────┤
│ id: string (UUID)       │             │ id: string (UUID)       │
│ timestamp: ISO8601      │             │ date: YYYY-MM-DD        │
│ startTime / endTime     │             │ startTime / endTime     │
│ durationSeconds: number │0..1     0..*│ durationMinutes: number │
│ appName / windowTitle   │────────────►│ decimalHours: number    │
│ category: AppCategory   │             │ clientId / projectId    │
│ appIcon: string (base64)│             │ taskName: string        │
│ isAssigned: boolean     │             │ isBillable: boolean     │
│ isIdle: boolean         │             │ hourlyRate: number      │
└─────────────────────────┘             │ calculatedRevenue: num  │
                                        │ roundingMode: Enum      │
                                        └─────────────────────────┘
                                                     │ *
                                                     │
                                                     │ 1
                                        ┌─────────────────────────┐
                                        │     TimesheetPeriod     │
                                        ├─────────────────────────┤
                                        │ id: string (UUID)       │
                                        │ startDate / endDate     │
                                        │ status: draft|sub|appr  │
                                        │ consultantName / email  │
                                        │ totalHours / revenue    │
                                        │ snapshots: Snapshot[]   │
                                        └─────────────────────────┘
```

### 3.2 Core TypeScript Type Definitions

```typescript
export type RoundingMode = 'tenth_hour' | 'quarter_hour' | 'exact';

export interface ActivityItem {
  id: string;
  timestamp: string;       // ISO 8601
  startTime: string;       // HH:mm
  endTime: string;         // HH:mm
  durationSeconds: number;
  appName: string;         // e.g. "Microsoft Excel"
  windowTitle: string;     // e.g. "Acme_Q3_Valuation_Model.xlsx"
  category: AppCategory;
  isIdle: boolean;
  isAssigned: boolean;
  assignedEntryId?: string;
  source: 'live' | 'simulation' | 'extension';
  appIcon?: string;        // Base64 data URI of native 32-bit OS icon
}

export interface TimeEntry {
  id: string;
  date: string;            // YYYY-MM-DD
  startTime: string;       // HH:mm
  endTime: string;         // HH:mm
  durationMinutes: number;
  decimalHours: number;    // e.g. 1.3h (tenth-hour ceiling)
  clientId: string;
  projectId: string;
  taskName: string;
  notes: string;
  isBillable: boolean;
  hourlyRate: number;      // e.g. $350/hr
  calculatedRevenue: number;
  roundingMode?: RoundingMode;
  sourceActivityIds?: string[];
  aiSuggested?: boolean;
  confidenceScore?: number;
}

export interface TimesheetPeriod {
  id: string;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  consultantName: string;
  consultantEmail: string;
  submittedAt?: string;
  approvedAt?: string;
  totalHours: number;
  billableHours: number;
  totalRevenue: number;
  entriesCount: number;
  snapshots?: TimesheetSnapshot[];
}

export interface TimesheetSnapshot {
  revision: number;
  finalizedAt: string;
  consultantName: string;
  consultantEmail: string;
  roundingMode: RoundingMode;
  entries: TimeEntry[];
  clients: Client[];
  projects: Project[];
}
```

### 3.3 SQLite Persistence Schema (Rust Daemon)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    app_name TEXT NOT NULL,
    window_title TEXT NOT NULL,
    category TEXT NOT NULL,
    is_idle INTEGER NOT NULL DEFAULT 0,
    is_assigned INTEGER NOT NULL DEFAULT 0,
    assigned_entry_id TEXT,
    source TEXT NOT NULL DEFAULT 'live',
    app_icon TEXT,
    local_date TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activities_date ON activities (local_date);
CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities (timestamp);
```

---

## 4. Non-Functional Specifications

- **Rendering Latency**: 60fps canvas scrolling; full day layout resolution in $< 16\text{ms}$.
- **Local Resource Usage**: Rust companion daemon consumes $< 15\text{MB}$ RAM and $< 0.1\%$ CPU.
- **Data Durability**: SQLite Write-Ahead Logging protects against sudden power loss or process kill; zero data corruption.
- **Verification Guarantee**: 88 automated unit and integration tests passing; zero TypeScript compiler errors (`tsc --noEmit`).
- **Privacy Compliance**: Strict compliance with NDA confidentiality rules: zero remote telemetry, hardware display affinity masking, and local loopback API isolation.
