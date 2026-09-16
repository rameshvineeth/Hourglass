// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { 
  createSessionFingerprint,
  buildHistoryAllocationIndex,
  matchSessionFromCacheOrHistory,
  getAllocationCache,
  updateAllocationCacheItem,
  SMART_ALLOCATE_CACHE_KEY
} from '../domain/smart-allocate-matcher';
import { Client, Project } from '../types/client-project';
import { TimeEntry } from '../types/time-entry';
import { ActivityItem } from '../types/activity';
import { AppSessionGroup } from '../domain/timeline-layout';

describe('Domain: Smart Allocate Matcher (Cache & History Pre-fill)', () => {
  const clients: Client[] = [
    { id: 'c1', name: 'Apex Capital', code: 'APEX', color: '#0ea5e9', createdAt: '' },
    { id: 'c2', name: 'Cumen Corp', code: 'CUMEN', color: '#10b981', createdAt: '' },
  ];

  const projects: Project[] = [
    { id: 'p1', clientId: 'c1', name: 'Financial Valuation', code: 'APEX-VAL', defaultHourlyRate: 300, isBillableDefault: true, color: '#0ea5e9', createdAt: '' },
    { id: 'p2', clientId: 'c2', name: 'UI Overhaul', code: 'CUMEN-UI', defaultHourlyRate: 250, isBillableDefault: true, color: '#10b981', createdAt: '' },
  ];

  beforeEach(() => {
    localStorage.removeItem(SMART_ALLOCATE_CACHE_KEY);
  });

  it('normalizes window titles and strips browser suffixes into clean fingerprints', () => {
    expect(createSessionFingerprint('Google Chrome', 'Cumen Admin - Google Chrome'))
      .toBe('google chrome:::cumen admin');
    expect(createSessionFingerprint('Brave', 'Apex Financial Model - Brave'))
      .toBe('brave:::apex financial model');
    expect(createSessionFingerprint('Visual Studio Code', 'App.tsx - Hourglass'))
      .toBe('visual studio code:::app.tsx - hourglass');
  });

  it('pre-fills allocation with high confidence from previous time entries history', () => {
    const pastActivity: ActivityItem = {
      id: 'act-hist-1',
      appName: 'Figma',
      windowTitle: 'Cumen Mobile Design System',
      category: 'design',
      startTime: '10:00',
      endTime: '11:00',
      durationSeconds: 3600,
      timestamp: '2026-09-10T10:00:00Z',
      isAssigned: true,
      isIdle: false,
      source: 'live',
    };

    const pastEntry: TimeEntry = {
      id: 'entry-hist-1',
      clientId: 'c2',
      projectId: 'p2',
      date: '2026-09-10',
      startTime: '10:00',
      endTime: '11:00',
      durationMinutes: 60,
      decimalHours: 1.0,
      isBillable: true,
      hourlyRate: 250,
      calculatedRevenue: 250,
      taskName: 'Design System Iterations',
      notes: '',
      createdAt: '2026-09-10T11:00:00Z',
      updatedAt: '2026-09-10T11:00:00Z',
      sourceActivityIds: ['act-hist-1'],
      actualDurationSeconds: 3600,
    };

    const historyIndex = buildHistoryAllocationIndex([pastEntry], [pastActivity], clients, projects);

    const todaySession: AppSessionGroup = {
      id: 'sess-today-1',
      appName: 'Figma',
      category: 'design',
      primaryTitle: 'Cumen Mobile Design System',
      startTime: '14:00',
      endTime: '15:30',
      durationSeconds: 5400,
      activities: [],
      tabs: [],
      tabCount: 1,
      tabNoun: 'tabs',
      isAssigned: false,
    };

    const match = matchSessionFromCacheOrHistory(todaySession, {}, historyIndex, clients, projects);

    expect(match).not.toBeNull();
    expect(match?.clientId).toBe('c2');
    expect(match?.projectId).toBe('p2');
    expect(match?.clientName).toBe('Cumen Corp');
    expect(match?.projectName).toBe('UI Overhaul');
    expect(match?.confidence).toBeGreaterThanOrEqual(0.85);
    expect(match?.needsReview).toBe(false);
  });

  it('pre-fills from persistent cache when previous user confirmations were stored', () => {
    const fp = createSessionFingerprint('Google Chrome', 'Horizon Patient Portal');
    updateAllocationCacheItem(fp, {
      clientId: 'c1',
      projectId: 'p1',
      clientName: 'Apex Capital',
      projectName: 'Financial Valuation',
      taskName: 'Patient Portal Audit',
      isBillable: true,
      hourlyRate: 300,
      confidence: 1.0,
    });

    const session: AppSessionGroup = {
      id: 'sess-cached-1',
      appName: 'Google Chrome',
      category: 'browser',
      primaryTitle: 'Horizon Patient Portal - Google Chrome',
      startTime: '09:00',
      endTime: '10:00',
      durationSeconds: 3600,
      activities: [],
      tabs: [],
      tabCount: 1,
      tabNoun: 'tabs',
      isAssigned: false,
    };

    const cache = getAllocationCache();
    const historyIndex = buildHistoryAllocationIndex([], [], clients, projects);

    const match = matchSessionFromCacheOrHistory(session, cache, historyIndex, clients, projects);

    expect(match).not.toBeNull();
    expect(match?.clientId).toBe('c1');
    expect(match?.projectId).toBe('p1');
    expect(match?.confidence).toBe(1.0);
    expect(match?.needsReview).toBe(false);
  });

  it('returns null for novel sessions not in cache or history', () => {
    const session: AppSessionGroup = {
      id: 'sess-novel-1',
      appName: 'Spotify',
      category: 'other',
      primaryTitle: 'Chill Beats',
      startTime: '12:00',
      endTime: '13:00',
      durationSeconds: 3600,
      activities: [],
      tabs: [],
      tabCount: 1,
      tabNoun: 'tabs',
      isAssigned: false,
    };

    const cache = getAllocationCache();
    const historyIndex = buildHistoryAllocationIndex([], [], clients, projects);

    const match = matchSessionFromCacheOrHistory(session, cache, historyIndex, clients, projects);
    expect(match).toBeNull();
  });
});
