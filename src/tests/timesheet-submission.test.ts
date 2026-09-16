import { describe, it, expect } from 'vitest';
import { 
  createCustomPeriod, 
  periodEntries, 
  finalizePeriod, 
  reopenPeriod, 
  assertEditable, 
  assertEntriesEditable,
  exportTimesheet 
} from '../domain/workflow';
import { validateTimesheetForSubmission } from '../domain/timesheet-machine';
import { TimeEntry } from '../types/time-entry';
import { Client, Project } from '../types/client-project';

const mockClients: Client[] = [
  { id: 'c1', name: 'Acme Corp', code: 'ACM', color: '#3b82f6', createdAt: '' },
  { id: 'c2', name: 'Globex Inc', code: 'GBX', color: '#10b981', createdAt: '' }
];

const mockProjects: Project[] = [
  { 
    id: 'p1', 
    clientId: 'c1', 
    name: 'M&A Advisory', 
    code: 'MA', 
    color: '#3b82f6', 
    createdAt: '', 
    defaultHourlyRate: 300, 
    isBillableDefault: true 
  },
  { 
    id: 'p2', 
    clientId: 'c1', 
    name: 'ERP Migration', 
    code: 'ERP', 
    color: '#6366f1', 
    createdAt: '', 
    defaultHourlyRate: 200, 
    isBillableDefault: true 
  },
  { 
    id: 'p3', 
    clientId: 'c2', 
    name: 'Security Audit', 
    code: 'SEC', 
    color: '#10b981', 
    createdAt: '', 
    defaultHourlyRate: 250, 
    isBillableDefault: true 
  }
];

const createMockEntry = (
  id: string, 
  date: string, 
  start: string, 
  end: string, 
  hours: number, 
  clientId = 'c1', 
  projectId = 'p1', 
  rate = 200
): TimeEntry => ({
  id,
  date,
  startTime: start,
  endTime: end,
  durationMinutes: hours * 60,
  decimalHours: hours,
  clientId,
  projectId,
  taskName: `Task on ${date} for ${clientId}/${projectId}`,
  notes: '',
  isBillable: true,
  hourlyRate: rate,
  calculatedRevenue: hours * rate,
  createdAt: '',
  updatedAt: ''
});

describe('Flexible Timesheet Submission Flow (1 Day, 3 Days, Week, Custom)', () => {
  it('creates and validates a 1-day (daily) period cleanly', () => {
    const dailyPeriod = createCustomPeriod('2026-09-14', '2026-09-14', 'Alice Smith', 'alice@firm.com');
    expect(dailyPeriod.startDate).toBe('2026-09-14');
    expect(dailyPeriod.endDate).toBe('2026-09-14');
    expect(dailyPeriod.status).toBe('draft');

    const entryToday = createMockEntry('e1', '2026-09-14', '09:00', '17:00', 8);
    const entryYesterday = createMockEntry('e2', '2026-09-13', '09:00', '17:00', 8);

    const scoped = periodEntries([entryToday, entryYesterday], dailyPeriod);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].id).toBe('e1');

    const validation = validateTimesheetForSubmission(scoped, dailyPeriod);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('finalizes a 1-day period into an immutable snapshot without locking other days', () => {
    const dailyPeriod = createCustomPeriod('2026-09-14', '2026-09-14', 'Alice Smith', 'alice@firm.com');
    const entryToday = createMockEntry('e1', '2026-09-14', '09:00', '17:00', 8);
    const entryOtherDay = createMockEntry('e2', '2026-09-15', '09:00', '17:00', 8);

    const finalized = finalizePeriod(
      dailyPeriod,
      [entryToday, entryOtherDay],
      mockClients,
      mockProjects,
      'exact',
      'Alice Smith',
      'alice@firm.com'
    );

    expect(finalized.status).toBe('submitted');
    expect(finalized.snapshots).toHaveLength(1);
    expect(finalized.snapshots![0].entries).toHaveLength(1);
    expect(finalized.snapshots![0].entries[0].id).toBe('e1');

    // Editing 2026-09-14 should throw finalized error
    expect(() => assertEditable(['2026-09-14'], [finalized])).toThrow('finalized');
    // Editing 2026-09-15 should NOT throw because it is outside the 1-day period
    expect(() => assertEditable(['2026-09-15'], [finalized])).not.toThrow();
  });

  it('handles a 3-day milestone period and generates proper CSV/JSON export', () => {
    const period3Days = createCustomPeriod('2026-09-12', '2026-09-14', 'Alice Smith', 'alice@firm.com');
    const entries = [
      createMockEntry('e1', '2026-09-12', '09:00', '12:00', 3),
      createMockEntry('e2', '2026-09-13', '10:00', '14:00', 4),
      createMockEntry('e3', '2026-09-14', '09:00', '17:00', 8),
      createMockEntry('e4', '2026-09-11', '09:00', '17:00', 8), // outside 3 days
    ];

    const scoped = periodEntries(entries, period3Days);
    expect(scoped).toHaveLength(3);

    const finalized = finalizePeriod(
      period3Days,
      scoped,
      mockClients,
      mockProjects,
      'exact',
      'Alice Smith',
      'alice@firm.com'
    );

    const exportData = exportTimesheet(finalized, finalized.snapshots![0]);
    expect(exportData.csv).toContain('2026-09-12');
    expect(exportData.csv).toContain('2026-09-14');
    expect(exportData.csv).not.toContain('2026-09-11');

    const parsedJson = JSON.parse(exportData.json);
    expect(parsedJson.startDate).toBe('2026-09-12');
    expect(parsedJson.endDate).toBe('2026-09-14');
    expect(parsedJson.entries).toHaveLength(3);
    expect(parsedJson.metrics.billedHours).toBe(15);
  });

  it('allows reopening a custom period as a new draft revision', () => {
    const period = createCustomPeriod('2026-09-10', '2026-09-12', 'Bob', 'bob@firm.com');
    const entry = createMockEntry('e1', '2026-09-10', '09:00', '10:00', 1);
    const finalized = finalizePeriod(period, [entry], mockClients, mockProjects, 'exact', 'Bob', 'bob@firm.com');
    
    expect(finalized.status).toBe('submitted');
    expect(finalized.revision).toBe(1);

    const reopened = reopenPeriod(finalized);
    expect(reopened.status).toBe('draft');
    expect(reopened.revision).toBe(2);
    expect(reopened.submittedAt).toBeUndefined();

    // Now editable again
    expect(() => assertEditable(['2026-09-10'], [reopened])).not.toThrow();
  });
});

describe('Per-Client and Per-Project Timesheet Billing & Isolation', () => {
  it('scopes entries and generates period IDs per client and per project', () => {
    // Client-level period
    const clientPeriod = createCustomPeriod('2026-09-08', '2026-09-14', 'Alice', 'alice@firm.com', 'c1');
    expect(clientPeriod.clientId).toBe('c1');
    expect(clientPeriod.projectId).toBeUndefined();
    expect(clientPeriod.id).toBe('period_c1_2026-09-08_2026-09-14');

    // Project-level period
    const projectPeriod = createCustomPeriod('2026-09-08', '2026-09-14', 'Alice', 'alice@firm.com', 'c1', 'p2');
    expect(projectPeriod.clientId).toBe('c1');
    expect(projectPeriod.projectId).toBe('p2');
    expect(projectPeriod.id).toBe('period_c1_p2_2026-09-08_2026-09-14');

    const entries = [
      createMockEntry('e1', '2026-09-09', '09:00', '12:00', 3, 'c1', 'p1'), // Acme M&A
      createMockEntry('e2', '2026-09-10', '09:00', '13:00', 4, 'c1', 'p2'), // Acme ERP
      createMockEntry('e3', '2026-09-11', '10:00', '15:00', 5, 'c2', 'p3'), // Globex SEC
    ];

    // Client-level scoping should only include Acme entries (e1 and e2)
    const clientScoped = periodEntries(entries, clientPeriod);
    expect(clientScoped).toHaveLength(2);
    expect(clientScoped.map(e => e.id)).toEqual(['e1', 'e2']);

    // Project-level scoping should only include Acme ERP (e2)
    const projectScoped = periodEntries(entries, projectPeriod);
    expect(projectScoped).toHaveLength(1);
    expect(projectScoped[0].id).toBe('e2');
  });

  it('preserves client isolation in exports (omits other client data)', () => {
    const consolidatedPeriod = createCustomPeriod('2026-09-08', '2026-09-14', 'Alice', 'alice@firm.com');
    const entries = [
      createMockEntry('e1', '2026-09-09', '09:00', '12:00', 3, 'c1', 'p1', 300),
      createMockEntry('e2', '2026-09-10', '09:00', '14:00', 5, 'c2', 'p3', 250),
    ];

    const finalized = finalizePeriod(
      consolidatedPeriod,
      entries,
      mockClients,
      mockProjects,
      'exact',
      'Alice',
      'alice@firm.com'
    );

    // Export for Client 1 only
    const client1Export = exportTimesheet(finalized, finalized.snapshots![0], 'c1');
    expect(client1Export.csv).toContain('Acme Corp');
    expect(client1Export.csv).not.toContain('Globex Inc');
    expect(client1Export.csv).not.toContain('Security Audit');

    const parsedJson1 = JSON.parse(client1Export.json);
    expect(parsedJson1.clientId).toBe('c1');
    expect(parsedJson1.entries).toHaveLength(1);
    expect(parsedJson1.entries[0].client).toBe('Acme Corp');
    expect(parsedJson1.metrics.billedHours).toBe(3);
    expect(parsedJson1.metrics.amount).toBe(900);

    // Export for Client 2 only
    const client2Export = exportTimesheet(finalized, finalized.snapshots![0], 'c2');
    expect(client2Export.csv).toContain('Globex Inc');
    expect(client2Export.csv).not.toContain('Acme Corp');
    const parsedJson2 = JSON.parse(client2Export.json);
    expect(parsedJson2.entries).toHaveLength(1);
    expect(parsedJson2.metrics.billedHours).toBe(5);
  });

  it('isolates project locking: locking Project 1 does NOT lock Project 2 or Client 2', () => {
    const p1Period = createCustomPeriod('2026-09-08', '2026-09-14', 'Alice', 'alice@firm.com', 'c1', 'p1');
    const entryP1 = createMockEntry('e1', '2026-09-09', '09:00', '12:00', 3, 'c1', 'p1');
    const entryP2 = createMockEntry('e2', '2026-09-09', '13:00', '17:00', 4, 'c1', 'p2');
    const entryC2 = createMockEntry('e3', '2026-09-09', '09:00', '17:00', 8, 'c2', 'p3');

    const finalizedP1 = finalizePeriod(
      p1Period,
      [entryP1],
      mockClients,
      mockProjects,
      'exact',
      'Alice',
      'alice@firm.com'
    );

    // Entry for Client 1 / Project 1 is locked
    expect(() => assertEntriesEditable([entryP1], [finalizedP1])).toThrow('finalized');

    // Entry for Client 1 / Project 2 (same date, same client, different project) remains EDITABLE!
    expect(() => assertEntriesEditable([entryP2], [finalizedP1])).not.toThrow();

    // Entry for Client 2 (different client) remains EDITABLE!
    expect(() => assertEntriesEditable([entryC2], [finalizedP1])).not.toThrow();
  });
});
