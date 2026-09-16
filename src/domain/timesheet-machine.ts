/**
 * Domain Logic: Timesheet State Machine & Pre-Submission Audit
 * Manages the lifecycle of timesheet periods and enforces pre-submission validation.
 */

import { TimeEntry } from '../types/time-entry';
import { 
  TimesheetPeriod, 
  TimesheetStatus, 
  TimesheetValidationResult, 
  TimesheetAuditIssue 
} from '../types/timesheet';
import { periodEntries, entryIntervals, workIntervals } from './workflow';

/**
 * Validates whether a timesheet is ready for submission to management.
 */
export function validateTimesheetForSubmission(
  entries: TimeEntry[],
  period: TimesheetPeriod
): TimesheetValidationResult {
  entries = periodEntries(entries, period);
  const errors: TimesheetAuditIssue[] = [];
  const warnings: TimesheetAuditIssue[] = [];

  if (entries.length === 0) {
    errors.push({
      type: 'error',
      message: 'Timesheet contains no time entries. Add billable work before submitting.',
    });
    return { isValid: false, errors, warnings };
  }

  // 1. Check for missing clients or projects
  for (const entry of entries) {
    if (!entry.clientId || !entry.projectId) {
      errors.push({
        type: 'error',
        message: `Entry "${entry.taskName || 'Untitled'}" (${entry.startTime}-${entry.endTime}) is missing a client or project assignment.`,
        entryId: entry.id,
        field: 'projectId',
      });
    }

    if (!entry.taskName || entry.taskName.trim().length === 0) {
      errors.push({
        type: 'error',
        message: `Entry at ${entry.startTime} has no task description. Invoices require descriptive work summaries.`,
        entryId: entry.id,
        field: 'taskName',
      });
    }

    // Check for unreviewed AI items
    if (entry.needsReview) {
      errors.push({
        type: 'error',
        message: `Entry "${entry.taskName}" was flagged for review by AI and has not been confirmed.`,
        entryId: entry.id,
        field: 'needsReview',
      });
    }
  }

  for(const entry of entries){
    const [[start,end]]=entryIntervals(entry);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!Number.isFinite(entry.durationMinutes)||entry.durationMinutes<=0||!Number.isFinite(entry.hourlyRate)||entry.hourlyRate<0)errors.push({type:'error',message:'Invalid time interval or billing amount.',entryId:entry.id});
  }
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
    if(workIntervals(entries[i]).some(([a,b])=>workIntervals(entries[j]).some(([c,d])=>a<d&&c<b))){
      const sameProject = entries[i].clientId && entries[j].clientId && entries[i].clientId === entries[j].clientId && entries[i].projectId === entries[j].projectId;
      const message = sameProject
        ? 'Overlapping work within the same project. Consolidate entries to resolve before finalization.'
        : 'Overlapping work must be resolved before finalization.';
      errors.push({type:'error',message,entryId:entries[i].id});
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Transitions timesheet status according to state machine rules.
 */
export function transitionTimesheetStatus(
  current: TimesheetPeriod,
  nextStatus: TimesheetStatus,
  metadata?: {
    reviewerNotes?: string;
    submissionComment?: string;
  }
): TimesheetPeriod {
  const allowedTransitions: Record<TimesheetStatus, TimesheetStatus[]> = {
    draft: ['submitted'],
    submitted: ['approved', 'rejected', 'draft'],
    rejected: ['draft', 'submitted'],
    approved: ['draft'], // Unlocking approved timesheet requires explicit manager override
  };

  if (!allowedTransitions[current.status].includes(nextStatus)) {
    throw new Error(`Invalid status transition from ${current.status} to ${nextStatus}`);
  }

  const now = new Date().toISOString();

  return {
    ...current,
    status: nextStatus,
    submittedAt: nextStatus === 'submitted' ? now : current.submittedAt,
    approvedAt: nextStatus === 'approved' ? now : current.approvedAt,
    submissionComment: metadata?.submissionComment ?? current.submissionComment,
    reviewerNotes: metadata?.reviewerNotes ?? current.reviewerNotes,
  };
}

/**
 * Calculates aggregated summary metrics across all time entries in a period.
 */
export function aggregatePeriodMetrics(entries: TimeEntry[]) {
  let totalHours = 0;
  let billableHours = 0;
  let nonBillableHours = 0;
  let totalRevenue = 0;

  for (const entry of entries) {
    totalHours += entry.decimalHours;
    if (entry.isBillable) {
      billableHours += entry.decimalHours;
      totalRevenue += entry.calculatedRevenue;
    } else {
      nonBillableHours += entry.decimalHours;
    }
  }

  const billablePercent = totalHours > 0 
    ? Math.round((billableHours / totalHours) * 100) 
    : 0;

  return {
    totalHours: Number(totalHours.toFixed(2)),
    billableHours: Number(billableHours.toFixed(2)),
    nonBillableHours: Number(nonBillableHours.toFixed(2)),
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    billablePercent,
    entriesCount: entries.length,
  };
}
