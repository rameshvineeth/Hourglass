import { describe, it, expect } from 'vitest';
import { detectTimelineGaps, detectOverlaps } from '../domain/gap-detector';
import { TimeEntry } from '../types/time-entry';

describe('Domain: Gap & Overlap Detector', () => {
  const mockEntries: TimeEntry[] = [
    {
      id: 'e1',
      date: '2026-09-11',
      startTime: '09:00',
      endTime: '11:00',
      durationMinutes: 120,
      decimalHours: 2.0,
      clientId: 'c1',
      projectId: 'p1',
      taskName: 'Client Strategy Model',
      notes: '',
      isBillable: true,
      hourlyRate: 300,
      calculatedRevenue: 600,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'e2',
      date: '2026-09-11',
      startTime: '13:00',
      endTime: '17:00',
      durationMinutes: 240,
      decimalHours: 4.0,
      clientId: 'c1',
      projectId: 'p1',
      taskName: 'Executive Presentation',
      notes: '',
      isBillable: true,
      hourlyRate: 300,
      calculatedRevenue: 1200,
      createdAt: '',
      updatedAt: '',
    },
  ];

  it('detects untracked gap between 11:00 and 13:00 (120 minutes)', () => {
    const gaps = detectTimelineGaps(mockEntries, '09:00', '18:00', 15);
    expect(gaps.length).toBe(2);
    
    // Gap 1: 11:00 to 13:00 (120 min lunch/untracked)
    expect(gaps[0].startTime).toBe('11:00');
    expect(gaps[0].endTime).toBe('13:00');
    expect(gaps[0].durationMinutes).toBe(120);

    // Gap 2: 17:00 to 18:00 (60 min tail)
    expect(gaps[1].startTime).toBe('17:00');
    expect(gaps[1].endTime).toBe('18:00');
    expect(gaps[1].durationMinutes).toBe(60);
  });

  it('detects overlapping time entries', () => {
    const overlappingEntries: TimeEntry[] = [
      {
        id: 'e1',
        date: '2026-09-11',
        startTime: '10:00',
        endTime: '11:30',
        durationMinutes: 90,
        decimalHours: 1.5,
        clientId: 'c1',
        projectId: 'p1',
        taskName: 'Task A',
        notes: '',
        isBillable: true,
        hourlyRate: 200,
        calculatedRevenue: 300,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'e2',
        date: '2026-09-11',
        startTime: '11:00',
        endTime: '12:00',
        durationMinutes: 60,
        decimalHours: 1.0,
        clientId: 'c1',
        projectId: 'p1',
        taskName: 'Task B',
        notes: '',
        isBillable: true,
        hourlyRate: 200,
        calculatedRevenue: 200,
        createdAt: '',
        updatedAt: '',
      },
    ];

    const overlaps = detectOverlaps(overlappingEntries);
    expect(overlaps.length).toBe(1);
    expect(overlaps[0].overlapMinutes).toBe(30); // 11:00 to 11:30
  });
});
