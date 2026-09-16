/**
 * Activity Tracking Definitions for Hourglass
 * Represents raw, passive background captures (Activity Stream)
 */

export type AppCategory = 
  | 'spreadsheet' 
  | 'document' 
  | 'communication' 
  | 'browser' 
  | 'development' 
  | 'presentation' 
  | 'design' 
  | 'meeting' 
  | 'other';

export interface ActivityItem {
  revision?: number;
  startedAt?: string;
  endedAt?: string;
  localDate?: string;
  timezoneOffsetMinutes?: number;
  executable?: string;
  iconId?: string;
  finalized?: boolean;
  state?: string;
  needsReview?: boolean;
  legacyDateUncertain?: boolean;
  ignored?: boolean;
  reviewed?: boolean;
  id: string;
  timestamp: string; // ISO 8601 string
  startTime: string; // HH:mm format for timeline display
  endTime: string;   // HH:mm format
  durationSeconds: number; // Duration of active foreground focus
  appName: string;   // e.g. "Microsoft Excel", "Google Chrome", "Zoom"
  windowTitle: string; // e.g. "Acme_Q3_Valuation_Model.xlsx"
  category: AppCategory;
  isIdle: boolean;
  isAssigned: boolean; // True if already converted into a billable TimeEntry
  assignedEntryId?: string;
  source: 'live' | 'simulation' | 'extension';
  appIcon?: string; // Base64 data URI of the native OS taskbar icon
}

export interface ActivityCluster {
  id: string;
  primaryApp: string;
  suggestedClientName?: string;
  suggestedProjectId?: string;
  suggestedProjectName?: string;
  confidenceScore: number; // 0.0 - 1.0
  totalDurationSeconds: number;
  items: ActivityItem[];
  commonKeywords: string[];
}
