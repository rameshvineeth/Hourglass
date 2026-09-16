/**
 * Billable Time Entry Definitions for Hourglass
 * Represents validated, client-facing billable work records.
 */

export type RoundingMode = 'tenth_hour' | 'quarter_hour' | 'exact';

export interface AllocationRange { activityId: string; startOffsetSeconds: number; endOffsetSeconds: number }

export interface TimeEntry {
  workIntervals?: [number, number][];
  allocations?: AllocationRange[];
  actualDurationSeconds?: number;
  roundingMode?: RoundingMode;
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
  durationMinutes: number;
  decimalHours: number; // e.g. 1.3h
  clientId: string;
  projectId: string;
  taskName: string;
  notes: string;
  isBillable: boolean;
  hourlyRate: number; // $ per hour
  calculatedRevenue: number; // Calculated billable amount ($)
  sourceActivityIds?: string[]; // IDs of raw activities converted into this entry
  sourceAppName?: string; // e.g. "Google Chrome", "Excel"
  sourceWindowTitle?: string; // e.g. "Financial Model.xlsx"
  aiSuggested?: boolean;
  confidenceScore?: number;
  needsReview?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntryDraft {
  allocations?: AllocationRange[];
  actualDurationSeconds?: number;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  clientId: string;
  projectId: string;
  taskName: string;
  notes: string;
  isBillable: boolean;
  hourlyRate: number;
  calculatedRevenue?: number;
  sourceActivityIds?: string[];
  sourceAppName?: string;
  sourceWindowTitle?: string;
  aiSuggested?: boolean;
  needsReview?: boolean;
}
