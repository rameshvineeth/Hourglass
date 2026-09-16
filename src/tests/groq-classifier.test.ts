import { describe, it, expect } from 'vitest';
import { classifyActivityHeuristic } from '../domain/groq-classifier';
import { ActivityItem } from '../types/activity';
import { Client, Project } from '../types/client-project';

describe('Domain: Groq & Heuristic Activity Classifier', () => {
  const mockClients: Client[] = [
    { id: 'c1', name: 'Apex Capital', code: 'APEX', color: '#0ea5e9', createdAt: '' },
    { id: 'c2', name: 'Horizon Healthcare', code: 'HORIZON', color: '#10b981', createdAt: '' },
  ];

  const mockProjects: Project[] = [
    { id: 'p1', clientId: 'c1', name: 'M&A Valuation', code: 'APEX-MA', defaultHourlyRate: 350, isBillableDefault: true, color: '#0ea5e9', createdAt: '' },
    { id: 'p2', clientId: 'c2', name: 'HIPAA Assessment', code: 'HOR-SEC', defaultHourlyRate: 275, isBillableDefault: true, color: '#10b981', createdAt: '' },
  ];

  it('accurately identifies client from document name and assigns project with high confidence', () => {
    const activity: ActivityItem = {
      id: 'a1',
      timestamp: '2026-09-11T09:00:00Z',
      startTime: '09:00',
      endTime: '10:15',
      durationSeconds: 4500,
      appName: 'Microsoft Excel',
      windowTitle: 'APEX_Q3_Valuation_DCF_Model_v2.xlsx',
      category: 'spreadsheet',
      isIdle: false,
      isAssigned: false,
      source: 'simulation',
    };

    const result = classifyActivityHeuristic(activity, mockClients, mockProjects);

    expect(result.clientId).toBe('c1');
    expect(result.projectId).toBe('p1');
    expect(result.clientName).toBe('Apex Capital');
    expect(result.isBillable).toBe(true);
    expect(result.hourlyRate).toBe(350);
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.needsReview).toBe(false);
  });

  it('flags low-confidence or ambiguous activity for user review', () => {
    const activity: ActivityItem = {
      id: 'a2',
      timestamp: '2026-09-11T14:00:00Z',
      startTime: '14:00',
      endTime: '14:30',
      durationSeconds: 1800,
      appName: 'Google Chrome',
      windowTitle: 'Random Industry Whitepaper - Energy Sector',
      category: 'browser',
      isIdle: false,
      isAssigned: false,
      source: 'live',
    };

    const result = classifyActivityHeuristic(activity, mockClients, mockProjects);

    // Should flag for review because neither client nor project is explicitly in title
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBeLessThan(0.85);
  });

  it('identifies internal non-billable keywords', () => {
    const activity: ActivityItem = {
      id: 'a3',
      timestamp: '2026-09-11T16:00:00Z',
      startTime: '16:00',
      endTime: '16:45',
      durationSeconds: 2700,
      appName: 'Zoom Meetings',
      windowTitle: 'Firm All-Hands & Internal Ops Sync',
      category: 'meeting',
      isIdle: false,
      isAssigned: false,
      source: 'simulation',
    };

    const result = classifyActivityHeuristic(activity, mockClients, mockProjects);

    expect(result.isBillable).toBe(false);
    expect(result.reasoning).toContain('internal firm');
  });

  it('classifies session groups containing multiple sub-activities', async () => {
    const { AiService } = await import('../services/ai-service');
    const act1: ActivityItem = { id: 'act-1', appName: 'Microsoft Excel', windowTitle: 'APEX_Valuation_Model_Q3.xlsx', category: 'spreadsheet', durationSeconds: 3000, startTime: '09:00', endTime: '09:50', timestamp: '2026-09-11T09:00:00Z', isIdle: false, isAssigned: false, source: 'live' as const };
    const act2: ActivityItem = { id: 'act-2', appName: 'Microsoft Excel', windowTitle: 'Debt_Schedule_APEX.xlsx', category: 'spreadsheet', durationSeconds: 2400, startTime: '09:50', endTime: '10:30', timestamp: '2026-09-11T09:50:00Z', isIdle: false, isAssigned: false, source: 'live' as const };
    const session = {
      id: 'session-apex-1',
      appName: 'Microsoft Excel',
      category: 'spreadsheet' as const,
      startTime: '09:00',
      endTime: '10:30',
      durationSeconds: 5400,
      primaryTitle: 'APEX_Valuation_Model_Q3.xlsx',
      tabCount: 3,
      tabNoun: 'documents' as const,
      tabs: [
        { id: 'act-1', windowTitle: 'APEX_Valuation_Model_Q3.xlsx', durationSeconds: 3000, startTime: '09:00', isAssigned: false, activity: act1 },
        { id: 'act-2', windowTitle: 'Debt_Schedule_APEX.xlsx', durationSeconds: 2400, startTime: '09:50', isAssigned: false, activity: act2 },
      ],
      isAssigned: false,
      activities: [act1, act2],
    };

    const results = await AiService.classifySessions([session], mockClients, mockProjects);
    expect(results.length).toBe(1);
    expect(results[0].activityId).toBe('session-apex-1');
    expect(results[0].clientId).toBe('c1');
    expect(results[0].projectId).toBe('p1');
    expect(results[0].clientName).toBe('Apex Capital');
    expect(results[0].confidence).toBeGreaterThanOrEqual(0.85);
  });
});
