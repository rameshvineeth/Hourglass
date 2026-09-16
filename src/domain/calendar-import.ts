import { ActivityItem } from '../types/activity';
import { TimeEntry, RoundingMode } from '../types/time-entry';
import { roundDurationMinutes } from './time-calculations';
import { cleanTaskDescription } from './timeline-layout';

export interface ParsedCalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  durationMinutes: number;
  location?: string;
  description?: string;
  organizer?: string;
  source: 'ics' | 'sample';
}

/**
 * Unfold RFC 5545 lines (lines beginning with space or tab continue previous line)
 */
function unfoldIcs(text: string): string {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

/**
 * Unescape text in iCalendar values (\,, \;, \\, \n, \N)
 */
function unescapeIcsText(text: string): string {
  return text
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Parse date time string from DTSTART / DTEND
 * Supports:
 * - 20260912T093000Z
 * - 20260912T093000
 * - 20260912
 */
function parseIcsDateTime(val: string): { date: string; time: string; fullDate: Date } | null {
  const clean = val.trim().replace(/^.*:/, ''); // strip any parameter prefix like TZID=...:
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?/);
  if (!match) return null;

  const year = match[1];
  const month = match[2];
  const day = match[3];
  const hours = match[4] || '09';
  const minutes = match[5] || '00';
  const seconds = match[6] || '00';

  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  const fullDate = new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hours, 10),
    parseInt(minutes, 10),
    parseInt(seconds, 10)
  );

  return { date: dateStr, time: timeStr, fullDate };
}

/**
 * Parse ISO 8601 duration string like PT1H, PT30M, PT1H30M
 */
function parseDurationMinutes(durStr: string): number {
  let minutes = 0;
  const hourMatch = durStr.match(/(\d+)H/i);
  if (hourMatch) minutes += parseInt(hourMatch[1], 10) * 60;
  const minMatch = durStr.match(/(\d+)M/i);
  if (minMatch) minutes += parseInt(minMatch[1], 10);
  return minutes > 0 ? minutes : 30;
}

/**
 * Parse an iCalendar (.ics) string content into ParsedCalendarEvent array
 */
export function parseIcsContent(icsContent: string): ParsedCalendarEvent[] {
  if (!icsContent || typeof icsContent !== 'string') return [];

  const unfolded = unfoldIcs(icsContent);
  const eventBlocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const events: ParsedCalendarEvent[] = [];

  for (const block of eventBlocks) {
    const lines = block.split(/\r?\n/);
    let title = 'Untitled Meeting';
    let startInfo: { date: string; time: string; fullDate: Date } | null = null;
    let endInfo: { date: string; time: string; fullDate: Date } | null = null;
    let durationMinutes = 0;
    let location = '';
    let description = '';
    let organizer = '';
    let uid = '';

    for (const line of lines) {
      if (line.startsWith('END:VEVENT')) break;

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const propHead = line.slice(0, colonIdx).toUpperCase();
      const propVal = line.slice(colonIdx + 1);

      if (propHead.startsWith('SUMMARY')) {
        title = unescapeIcsText(propVal).trim();
      } else if (propHead.startsWith('DTSTART')) {
        startInfo = parseIcsDateTime(line);
      } else if (propHead.startsWith('DTEND')) {
        endInfo = parseIcsDateTime(line);
      } else if (propHead.startsWith('DURATION')) {
        durationMinutes = parseDurationMinutes(propVal);
      } else if (propHead.startsWith('LOCATION')) {
        location = unescapeIcsText(propVal).trim();
      } else if (propHead.startsWith('DESCRIPTION')) {
        description = unescapeIcsText(propVal).trim();
      } else if (propHead.startsWith('ORGANIZER')) {
        organizer = propVal.replace(/^mailto:/i, '').trim();
      } else if (propHead === 'UID') {
        uid = propVal.trim();
      }
    }

    if (!startInfo) continue;

    if (endInfo && endInfo.fullDate > startInfo.fullDate) {
      const diffMs = endInfo.fullDate.getTime() - startInfo.fullDate.getTime();
      durationMinutes = Math.round(diffMs / 60000);
    } else if (durationMinutes <= 0) {
      durationMinutes = 30; // Default 30 min meeting
    }

    // Format end time if not explicitly provided
    let endTimeStr = endInfo?.time || '';
    if (!endTimeStr) {
      const computedEnd = new Date(startInfo.fullDate.getTime() + durationMinutes * 60000);
      endTimeStr = `${String(computedEnd.getHours()).padStart(2, '0')}:${String(computedEnd.getMinutes()).padStart(2, '0')}`;
    }

    events.push({
      id: uid || `cal_${Math.random().toString(36).slice(2, 10)}`,
      title: title || 'Meeting',
      date: startInfo.date,
      startTime: startInfo.time,
      endTime: endTimeStr,
      durationMinutes,
      location: location || undefined,
      description: description || undefined,
      organizer: organizer || undefined,
      source: 'ics',
    });
  }

  return events;
}

/**
 * Detect app name from meeting title or location
 */
function inferMeetingApp(title: string, location?: string): string {
  const combined = `${title} ${location || ''}`.toLowerCase();
  if (combined.includes('zoom')) return 'Zoom';
  if (combined.includes('teams')) return 'Microsoft Teams';
  if (combined.includes('meet.google') || combined.includes('google meet')) return 'Google Meet';
  if (combined.includes('webex')) return 'Cisco Webex';
  if (combined.includes('slack')) return 'Slack Huddle';
  return 'Calendar';
}

/**
 * Convert parsed calendar events into ActivityItem[] (passive background activity stream)
 */
export function calendarEventsToActivities(events: ParsedCalendarEvent[]): ActivityItem[] {
  return events.map((evt) => {
    const appName = inferMeetingApp(evt.title, evt.location);
    const windowTitle = evt.location ? `${evt.title} (${evt.location})` : evt.title;
    const durationSeconds = evt.durationMinutes * 60;
    const timestamp = `${evt.date}T${evt.startTime}:00`;

    return {
      id: `act_${evt.id}`,
      timestamp,
      localDate: evt.date,
      startedAt: `${evt.date}T${evt.startTime}:00`,
      endedAt: `${evt.date}T${evt.endTime}:00`,
      startTime: evt.startTime,
      endTime: evt.endTime,
      durationSeconds,
      appName,
      windowTitle,
      category: 'meeting',
      isIdle: false,
      isAssigned: false,
      source: 'simulation',
      finalized: true,
      reviewed: true,
      needsReview: false,
    };
  });
}

/**
 * Convert parsed calendar events into TimeEntry[] (ready billable records)
 */
export function calendarEventsToTimeEntries(
  events: ParsedCalendarEvent[],
  clientId: string,
  projectId: string,
  hourlyRate: number = 250,
  roundingMode: RoundingMode = 'exact'
): TimeEntry[] {
  const now = new Date().toISOString();

  return events.map((evt) => {
    const rawMinutes = evt.durationMinutes;
    const rawSeconds = rawMinutes * 60;
    const rounded = roundDurationMinutes(rawMinutes, roundingMode);
    const decimalHours = rounded.decimalHours;
    const durationMinutes = rounded.roundedMinutes;
    const calculatedRevenue = Math.round((durationMinutes / 60) * hourlyRate * 100) / 100;
    const meetingApp = inferMeetingApp(evt.title, evt.location);
    const cleanedTask = cleanTaskDescription(evt.title, meetingApp);

    return {
      id: `te_${evt.id}`,
      date: evt.date,
      startTime: evt.startTime,
      endTime: evt.endTime,
      durationMinutes,
      decimalHours,
      clientId,
      projectId,
      taskName: cleanedTask || evt.title,
      notes: evt.description || (evt.location ? `Meeting Location: ${evt.location}` : 'Imported from calendar'),
      isBillable: true,
      hourlyRate,
      calculatedRevenue,
      actualDurationSeconds: rawSeconds,
      roundingMode,
      aiSuggested: false,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/**
 * Generate realistic sample calendar meetings for a given date
 */
export function generateSampleCalendarEvents(dateStr: string): ParsedCalendarEvent[] {
  return [
    {
      id: `sample_1_${dateStr}`,
      title: 'Apex Capital — Q3 M&A Valuation & Debt Schedule Sync',
      date: dateStr,
      startTime: '09:30',
      endTime: '10:30',
      durationMinutes: 60,
      location: 'Zoom (https://zoom.us/j/9482183921)',
      description: 'Discuss financial model assumptions, debt amortization schedule, and next steps.',
      organizer: 'sarah.miller@apexcapital.com',
      source: 'sample',
    },
    {
      id: `sample_2_${dateStr}`,
      title: 'Horizon Healthcare — HIPAA Compliance & Security Review',
      date: dateStr,
      startTime: '13:00',
      endTime: '13:45',
      durationMinutes: 45,
      location: 'Microsoft Teams',
      description: 'Review security audit checklist, access controls, and vendor compliance reports.',
      organizer: 'david.chen@horizonhealth.org',
      source: 'sample',
    },
    {
      id: `sample_3_${dateStr}`,
      title: 'Weekly Internal Leadership & Practice Alignment',
      date: dateStr,
      startTime: '16:00',
      endTime: '16:30',
      durationMinutes: 30,
      location: 'Conference Room B / Google Meet',
      description: 'Review partner utilization, quarterly targets, and team bandwidth.',
      organizer: 'internal-ops@firm.com',
      source: 'sample',
    },
  ];
}
