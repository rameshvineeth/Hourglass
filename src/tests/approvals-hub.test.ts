import { describe, it, expect } from 'vitest';
import { 
  createCustomPeriod, 
  finalizePeriod, 
  reopenPeriod, 
  exportTimesheet,
  assertEntriesEditable
} from '../domain/workflow';
import { TimesheetPeriod } from '../types/timesheet';
import { Client, Project } from '../types/client-project';
import { TimeEntry } from '../types/time-entry';

const mockClients: Client[] = [
  { id: 'c_apex', name: 'Apex Capital Partners', code: 'APEX', color: '#0ea5e9', createdAt: '' },
  { id: 'c_horizon', name: 'Horizon Healthcare Systems', code: 'HORIZON', color: '#10b981', createdAt: '' }
];

const mockProjects: Project[] = [
  { 
    id: 'p_apex_ma', 
    clientId: 'c_apex', 
    name: 'M&A Valuation', 
    code: 'APEX-MA', 
    color: '#0ea5e9', 
    createdAt: '', 
    defaultHourlyRate: 350, 
    isBillableDefault: true 
  },
  { 
    id: 'p_apex_it', 
    clientId: 'c_apex', 
    name: 'IT Integration', 
    code: 'APEX-IT', 
    color: '#38bdf8', 
    createdAt: '', 
    defaultHourlyRate: 300, 
    isBillableDefault: true 
  },
  { 
    id: 'p_horizon_sec', 
    clientId: 'c_horizon', 
    name: 'HIPAA Security', 
    code: 'HOR-SEC', 
    color: '#10b981', 
    createdAt: '', 
    defaultHourlyRate: 275, 
    isBillableDefault: true 
  }
];

const createEntry = (
  id: string, 
  date: string, 
  hours: number, 
  clientId: string, 
  projectId: string, 
  rate: number
): TimeEntry => ({
  id,
  date,
  startTime: '09:00',
  endTime: `${9 + Math.floor(hours)}:${Math.round((hours % 1) * 60).toString().padStart(2, '0')}`,
  durationMinutes: hours * 60,
  decimalHours: hours,
  clientId,
  projectId,
  taskName: `Analysis for ${projectId}`,
  notes: '',
  isBillable: true,
  hourlyRate: rate,
  calculatedRevenue: hours * rate,
  createdAt: '',
  updatedAt: ''
});

// Composite period matching rule implemented in App.tsx
const isSamePeriod = (a: TimesheetPeriod, b: TimesheetPeriod) =>
  a.id === b.id || (
    a.startDate === b.startDate &&
    a.endDate === b.endDate &&
    (a.clientId || '') === (b.clientId || '') &&
    (a.projectId || '') === (b.projectId || '')
  );

describe('Approvals Hub & Multi-Timesheet Ledger', () => {
  it('allows concurrent timesheets for different clients in the exact same date range without overwriting', () => {
    const dateRange = { start: '2026-09-08', end: '2026-09-14' };
    
    // Period 1: Apex Capital
    const periodApex = createCustomPeriod(
      dateRange.start, 
      dateRange.end, 
      'Consultant A', 
      'consultant@firm.com', 
      'c_apex'
    );
    // Period 2: Horizon Healthcare (same dates, different client)
    const periodHorizon = createCustomPeriod(
      dateRange.start, 
      dateRange.end, 
      'Consultant A', 
      'consultant@firm.com', 
      'c_horizon'
    );

    // Entries for both clients
    const entriesApex = [
      createEntry('e_apex_1', '2026-09-09', 5, 'c_apex', 'p_apex_ma', 350),
      createEntry('e_apex_2', '2026-09-10', 4, 'c_apex', 'p_apex_it', 300)
    ];
    const entriesHorizon = [
      createEntry('e_hor_1', '2026-09-09', 6, 'c_horizon', 'p_horizon_sec', 275)
    ];
    const allEntries = [...entriesApex, ...entriesHorizon];

    // Finalize Apex
    const finalizedApex = finalizePeriod(
      periodApex, 
      allEntries, 
      mockClients, 
      mockProjects, 
      'exact', 
      'Consultant A', 
      'consultant@firm.com'
    );
    expect(finalizedApex.status).toBe('submitted');
    expect(finalizedApex.clientId).toBe('c_apex');

    let periodsLedger = [finalizedApex];

    // Finalize Horizon
    const finalizedHorizon = finalizePeriod(
      periodHorizon, 
      allEntries, 
      mockClients, 
      mockProjects, 
      'exact', 
      'Consultant A', 
      'consultant@firm.com'
    );
    expect(finalizedHorizon.status).toBe('submitted');
    expect(finalizedHorizon.clientId).toBe('c_horizon');

    // Add Horizon to ledger using isSamePeriod replacement rule
    periodsLedger = [
      ...periodsLedger.filter(p => !isSamePeriod(p, finalizedHorizon)),
      finalizedHorizon
    ];

    // Verify both periods exist side-by-side in ledger
    expect(periodsLedger).toHaveLength(2);
    expect(periodsLedger.some(p => p.clientId === 'c_apex')).toBe(true);
    expect(periodsLedger.some(p => p.clientId === 'c_horizon')).toBe(true);
  });

  it('allows submitting multiple projects under the same client independently', () => {
    const periodProject1 = createCustomPeriod(
      '2026-09-14', 
      '2026-09-14', 
      'Consultant A', 
      'consultant@firm.com', 
      'c_apex', 
      'p_apex_ma'
    );
    const periodProject2 = createCustomPeriod(
      '2026-09-14', 
      '2026-09-14', 
      'Consultant A', 
      'consultant@firm.com', 
      'c_apex', 
      'p_apex_it'
    );

    expect(isSamePeriod(periodProject1, periodProject2)).toBe(false);

    const entryP1 = createEntry('e_p1', '2026-09-14', 4, 'c_apex', 'p_apex_ma', 350);
    const entryP2 = createEntry('e_p2', '2026-09-14', 3, 'c_apex', 'p_apex_it', 300);

    const finalP1 = finalizePeriod(periodProject1, [entryP1, entryP2], mockClients, mockProjects, 'exact', 'A', 'a@a.com');
    const finalP2 = finalizePeriod(periodProject2, [entryP1, entryP2], mockClients, mockProjects, 'exact', 'A', 'a@a.com');

    const ledger = [finalP1, finalP2];
    expect(ledger).toHaveLength(2);
    expect(finalP1.projectId).toBe('p_apex_ma');
    expect(finalP2.projectId).toBe('p_apex_it');
  });

  it('transitions submitted period to approved with timestamp', () => {
    const period = createCustomPeriod('2026-09-14', '2026-09-14', 'Consultant A', 'consultant@firm.com', 'c_apex');
    const entry = createEntry('e1', '2026-09-14', 4, 'c_apex', 'p_apex_ma', 350);
    const submitted = finalizePeriod(period, [entry], mockClients, mockProjects, 'exact', 'A', 'a@a.com');

    expect(submitted.status).toBe('submitted');
    expect(submitted.approvedAt).toBeUndefined();

    // Approve action
    const approvedAt = new Date().toISOString();
    const approved = {
      ...submitted,
      status: 'approved',
      approvedAt
    };

    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBe(approvedAt);
    expect(approved.snapshots).toHaveLength(1);
  });

  it('reopens a submitted or approved period as a new draft revision while retaining snapshot history', () => {
    const period = createCustomPeriod('2026-09-14', '2026-09-14', 'Consultant A', 'consultant@firm.com', 'c_apex');
    const entry = createEntry('e1', '2026-09-14', 4, 'c_apex', 'p_apex_ma', 350);
    const submitted = finalizePeriod(period, [entry], mockClients, mockProjects, 'exact', 'A', 'a@a.com');

    const reopened = reopenPeriod(submitted);
    expect(reopened.status).toBe('draft');
    expect(reopened.revision).toBe(2);
    expect(reopened.submittedAt).toBeUndefined();
    expect(reopened.snapshots).toHaveLength(1);
    expect(reopened.snapshots?.[0]?.revision).toBe(1);
  });

  it('exports isolated client CSV and JSON downloads correctly from the approvals ledger', () => {
    const periodApex = createCustomPeriod('2026-09-08', '2026-09-14', 'Consultant A', 'consultant@firm.com', 'c_apex');
    const entries = [
      createEntry('e_apex', '2026-09-09', 4, 'c_apex', 'p_apex_ma', 350),
      createEntry('e_hor', '2026-09-09', 5, 'c_horizon', 'p_horizon_sec', 275)
    ];

    const finalized = finalizePeriod(periodApex, entries, mockClients, mockProjects, 'exact', 'Consultant A', 'consultant@firm.com');
    const snapshot = finalized.snapshots![0];

    const exportData = exportTimesheet(finalized, snapshot, finalized.clientId);
    
    // CSV validation
    expect(exportData.csv).toContain('Apex Capital Partners');
    expect(exportData.csv).not.toContain('Horizon Healthcare Systems');

    // JSON validation
    const parsed = JSON.parse(exportData.json);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].client).toBe('Apex Capital Partners');
    expect(parsed.metrics.amount).toBe(1400); // 4 hrs * 350
  });

  it('keeps submitted timesheets locked against editing and cleanly approves them in the ledger', () => {
    const period = createCustomPeriod('2026-09-14', '2026-09-20', 'Consultant A', 'consultant@firm.com', 'c_apex');
    const entry = createEntry('e_locked', '2026-09-15', 3, 'c_apex', 'p_apex_ma', 350);
    const submitted = finalizePeriod(period, [entry], mockClients, mockProjects, 'exact', 'Consultant A', 'consultant@firm.com');

    // Attempting to edit or validate entries for this period throws locked error
    expect(() => assertEntriesEditable([entry], [submitted])).toThrow(/locked and cannot be edited/i);

    // Approve the period in the ledger
    const ledger = [submitted];
    const approvedAt = new Date().toISOString();
    const approved = { ...submitted, status: 'approved' as const, approvedAt };
    const updatedLedger = ledger.map(p => isSamePeriod(p, approved) ? approved : p);

    expect(updatedLedger[0].status).toBe('approved');
    expect(updatedLedger[0].approvedAt).toBe(approvedAt);
    expect(updatedLedger[0].snapshots).toHaveLength(1);
    expect(updatedLedger[0].snapshots![0].revision).toBe(1);

    // Even when approved, editing remains blocked
    expect(() => assertEntriesEditable([entry], updatedLedger)).toThrow(/locked and cannot be edited/i);
  });
});
