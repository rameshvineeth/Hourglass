import { describe, it, expect } from 'vitest';
import { getRecentDays, generateDateRange } from '../domain/calendar';
import { groupActivitiesByAppSession } from '../domain/timeline-layout';
import { workstreamsToSessionGroups, auditActivities } from '../domain/activity-audit';
import { ActivityItem } from '../types/activity';

describe('Multi-Day Smart Allocate Domain Helpers', () => {
  it('resolves recent days correctly for 3-day and 7-day scopes', () => {
    const days3 = getRecentDays('2026-09-14', 3);
    expect(days3).toEqual(['2026-09-12', '2026-09-13', '2026-09-14']);

    const days7 = getRecentDays('2026-09-14', 7);
    expect(days7.length).toBe(7);
    expect(days7[0]).toBe('2026-09-08');
    expect(days7[6]).toBe('2026-09-14');

    const single = getRecentDays('2026-09-14', 1);
    expect(single).toEqual(['2026-09-14']);
  });

  it('generates date ranges for custom start and end dates', () => {
    const range = generateDateRange('2026-09-10', '2026-09-13');
    expect(range).toEqual(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);

    // Inverted range handling
    const inverted = generateDateRange('2026-09-13', '2026-09-10');
    expect(inverted).toEqual(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);

    // Single day range
    const same = generateDateRange('2026-09-10', '2026-09-10');
    expect(same).toEqual(['2026-09-10']);
  });

  it('preserves calendar date on grouped app sessions', () => {
    const actMon: ActivityItem = {
      id: 'act-mon-1',
      appName: 'Excel',
      windowTitle: 'Apex Model.xlsx - Excel',
      category: 'spreadsheet',
      startTime: '09:00',
      endTime: '11:00',
      durationSeconds: 7200,
      timestamp: '2026-09-08T09:00:00Z',
      localDate: '2026-09-08',
      isAssigned: false,
      isIdle: false,
      source: 'live',
    };

    const sessions = groupActivitiesByAppSession([actMon]);
    expect(sessions.length).toBe(1);
    expect(sessions[0].date).toBe('2026-09-08');
    expect(sessions[0].appName).toBe('Excel');
  });

  it('preserves calendar date when converting audited workstreams to session groups', () => {
    const actWed: ActivityItem = {
      id: 'act-wed-1',
      appName: 'Word',
      windowTitle: 'Due Diligence Report.docx - Word',
      category: 'document',
      startTime: '13:00',
      endTime: '15:00',
      durationSeconds: 7200,
      timestamp: '2026-09-10T13:00:00Z',
      localDate: '2026-09-10',
      isAssigned: false,
      isIdle: false,
      source: 'live',
    };

    const report = auditActivities([actWed], [], [], {
      scope: 'today',
      roundingMode: 'quarter_hour',
    });

    const sessionGroups = workstreamsToSessionGroups(report.workstreams);
    expect(sessionGroups.length).toBe(1);
    expect(sessionGroups[0].date).toBe('2026-09-10');
    expect(sessionGroups[0].primaryTitle).toBe('Due Diligence Report');
  });
});
