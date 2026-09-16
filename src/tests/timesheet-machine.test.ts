import { describe, it, expect } from 'vitest';
import { 
  validateTimesheetForSubmission, 
  transitionTimesheetStatus,
  aggregatePeriodMetrics 
} from '../domain/timesheet-machine';
import { TimeEntry } from '../types/time-entry';
import { TimesheetPeriod } from '../types/timesheet';

describe('Domain: Timesheet State Machine & Workflow', () => {
  const mockPeriod: TimesheetPeriod = {
    id: 'ts_01',
    startDate: '2026-09-08',
    endDate: '2026-09-14',
    status: 'draft',
    consultantName: 'Elena Vance',
    consultantEmail: 'elena@example.com',
    totalHours: 0,
    billableHours: 0,
    nonBillableHours: 0,
    totalRevenue: 0,
    entriesCount: 0,
    auditIssues: [],
  };

  const validEntries: TimeEntry[] = [
    {
      id: 'e1',
      date: '2026-09-08',
      startTime: '09:00',
      endTime: '13:00',
      durationMinutes: 240,
      decimalHours: 4.0,
      clientId: 'c1',
      projectId: 'p1',
      taskName: 'M&A Valuation DCF Model',
      notes: 'Completed base-case projections',
      isBillable: true,
      hourlyRate: 300,
      calculatedRevenue: 1200,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'e2',
      date: '2026-09-08',
      startTime: '14:00',
      endTime: '18:00',
      durationMinutes: 240,
      decimalHours: 4.0,
      clientId: 'c1',
      projectId: 'p1',
      taskName: 'Executive Steering Deck',
      notes: 'Slide drafting and diligence review',
      isBillable: true,
      hourlyRate: 300,
      calculatedRevenue: 1200,
      createdAt: '',
      updatedAt: '',
    },
  ];

  it('validates a correct timesheet for submission', () => {
    const result = validateTimesheetForSubmission(validEntries, mockPeriod);
    expect(result.isValid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('rejects submission if time entry has no project assignment', () => {
    const invalidEntries: TimeEntry[] = [
      {
        ...validEntries[0],
        projectId: '',
      },
    ];

    const result = validateTimesheetForSubmission(invalidEntries, mockPeriod);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0].message).toContain('missing a client or project assignment');
  });

  it('rejects submission if timesheet is empty', () => {
    const result = validateTimesheetForSubmission([], mockPeriod);
    expect(result.isValid).toBe(false);
    expect(result.errors[0].message).toContain('Timesheet contains no time entries');
  });

  it('transitions from draft to submitted', () => {
    const submitted = transitionTimesheetStatus(mockPeriod, 'submitted', {
      submissionComment: 'Ready for partner review.',
    });
    expect(submitted.status).toBe('submitted');
    expect(submitted.submittedAt).toBeDefined();
    expect(submitted.submissionComment).toBe('Ready for partner review.');
  });

  it('transitions from submitted to approved', () => {
    const submitted = transitionTimesheetStatus(mockPeriod, 'submitted');
    const approved = transitionTimesheetStatus(submitted, 'approved', {
      reviewerNotes: 'Approved by Managing Director.',
    });
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeDefined();
  });

  it('calculates aggregate metrics accurately', () => {
    const metrics = aggregatePeriodMetrics(validEntries);
    expect(metrics.totalHours).toBe(8.0);
    expect(metrics.billableHours).toBe(8.0);
    expect(metrics.nonBillableHours).toBe(0);
    expect(metrics.totalRevenue).toBe(2400);
    expect(metrics.billablePercent).toBe(100);
    expect(metrics.entriesCount).toBe(2);
  });
});
