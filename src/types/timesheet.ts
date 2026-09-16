/**
 * Timesheet Period & Submission Workflow Definitions
 * Manages weekly aggregation, pre-submission audits, and approval state machine.
 */

import { TimeEntry, RoundingMode } from './time-entry';
import { Client, Project } from './client-project';

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
export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface TimesheetAuditIssue {
  type: 'error' | 'warning' | 'info';
  message: string;
  entryId?: string;
  field?: string;
}

export interface TimesheetPeriod {
  revision?: number;
  snapshots?: TimesheetSnapshot[];
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  clientId?: string; // Optional: when timesheet is submitted/billed for a specific client
  projectId?: string; // Optional: when timesheet is submitted/billed for a specific project
  status: TimesheetStatus;
  consultantName: string;
  consultantEmail: string;
  submittedAt?: string;
  approvedAt?: string;
  reviewerNotes?: string;
  submissionComment?: string;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  totalRevenue: number;
  entriesCount: number;
  auditIssues: TimesheetAuditIssue[];
}

export interface TimesheetValidationResult {
  isValid: boolean;
  errors: TimesheetAuditIssue[];
  warnings: TimesheetAuditIssue[];
}
