import { describe, it, expect } from 'vitest';
import {
  parseIcsContent,
  calendarEventsToActivities,
  calendarEventsToTimeEntries,
  generateSampleCalendarEvents,
} from '../domain/calendar-import';

describe('Calendar Import Domain', () => {
  const sampleIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
DTSTART:20260912T093000Z
DTEND:20260912T103000Z
DTSTAMP:20260912T050000Z
UID:cal-uuid-12345@google.com
CREATED:20260901T120000Z
DESCRIPTION:Discuss financial projections\\, amortization\\nand M&A steps.
LAST-MODIFIED:20260910T120000Z
LOCATION:https://zoom.us/j/123456789
SUMMARY:Apex Capital Financial Review
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART:20260912T140000
DTEND:20260912T144500
UID:teams-event-67890
SUMMARY:Team Architecture Standup
LOCATION:Microsoft Teams Meeting
DESCRIPTION:Bi-weekly architecture sync
END:VEVENT
END:VCALENDAR`;

  it('correctly parses .ics content into structured calendar events', () => {
    const events = parseIcsContent(sampleIcs);
    expect(events.length).toBe(2);

    const first = events[0];
    expect(first.title).toBe('Apex Capital Financial Review');
    expect(first.date).toBe('2026-09-12');
    expect(first.startTime).toBe('09:30');
    expect(first.endTime).toBe('10:30');
    expect(first.durationMinutes).toBe(60);
    expect(first.location).toBe('https://zoom.us/j/123456789');
    expect(first.description).toContain('Discuss financial projections, amortization\nand M&A steps.');

    const second = events[1];
    expect(second.title).toBe('Team Architecture Standup');
    expect(second.startTime).toBe('14:00');
    expect(second.endTime).toBe('14:45');
    expect(second.durationMinutes).toBe(45);
  });

  it('converts calendar events to activities with correct app detection and persistence properties', () => {
    const events = parseIcsContent(sampleIcs);
    const activities = calendarEventsToActivities(events);

    expect(activities.length).toBe(2);
    expect(activities[0].category).toBe('meeting');
    expect(activities[0].appName).toBe('Zoom');
    expect(activities[0].durationSeconds).toBe(3600);
    expect(activities[0].isAssigned).toBe(false);
    expect(activities[0].source).toBe('simulation');
    expect(activities[0].localDate).toBe('2026-09-12');
    expect(activities[0].reviewed).toBe(true);
    expect(activities[0].needsReview).toBe(false);

    expect(activities[1].appName).toBe('Microsoft Teams');
    expect(activities[1].durationSeconds).toBe(2700);
    expect(activities[1].localDate).toBe('2026-09-12');
  });

  it('converts calendar events directly to billable time entries with clean task names and rounding', () => {
    const events = parseIcsContent(sampleIcs);
    const entries = calendarEventsToTimeEntries(events, 'c_apex', 'p_apex_ma', 300, 'exact');

    expect(entries.length).toBe(2);
    expect(entries[0].clientId).toBe('c_apex');
    expect(entries[0].projectId).toBe('p_apex_ma');
    expect(entries[0].durationMinutes).toBe(60);
    expect(entries[0].hourlyRate).toBe(300);
    expect(entries[0].calculatedRevenue).toBe(300);
    expect(entries[0].taskName).toBe('Apex Capital Financial Review');

    // 45 min meeting with 15-minute rounding
    const roundedEntries = calendarEventsToTimeEntries(events, 'c_apex', 'p_apex_ma', 300, 'quarter_hour');
    expect(roundedEntries[1].durationMinutes).toBe(45);
  });

  it('preserves calendar imported activities when native live capture polls', async () => {
    const { mergeActivities } = await import('../services/activity-tracker');
    const events = parseIcsContent(sampleIcs);
    const calActivities = calendarEventsToActivities(events);

    // Simulated native capture items from OS (contains only chrome)
    const nativeItems = [
      {
        id: 'real_os_1',
        timestamp: '2026-09-12T15:00:00',
        startTime: '15:00',
        endTime: '15:10',
        durationSeconds: 600,
        appName: 'Google Chrome',
        windowTitle: 'Google Search',
        category: 'browser' as const,
        isIdle: false,
        isAssigned: false,
        source: 'live' as const,
      }
    ];

    // Merge native items into existing list that contains calendar imported activities
    const merged = mergeActivities(calActivities, nativeItems);
    expect(merged.length).toBe(3);
    expect(merged.some(a => a.id === calActivities[0].id)).toBe(true);
    expect(merged.some(a => a.id === calActivities[1].id)).toBe(true);
    expect(merged.some(a => a.id === 'real_os_1')).toBe(true);
  });

  it('generates realistic sample events for any active date', () => {
    const sample = generateSampleCalendarEvents('2026-09-15');
    expect(sample.length).toBeGreaterThanOrEqual(2);
    expect(sample.every((e) => e.date === '2026-09-15')).toBe(true);
  });
});
