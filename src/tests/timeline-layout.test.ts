import { describe, it, expect } from 'vitest';
import { aggregateIntoTimeSlots, formatMinuteOfDay, parseTimeToMinuteOfDay, groupActivitiesByAppSession, computeSessionVisualLayout, cleanTaskDescription, cleanEntryNotes } from '../domain/timeline-layout';
import { ActivityItem } from '../types/activity';

describe('Timeline Interval Slot Aggregation', () => {
  const makeAct = (id: string, appName: string, windowTitle: string, duration: number, startTime = '19:18'): ActivityItem => ({
    id,
    appName,
    windowTitle,
    durationSeconds: duration,
    startTime,
    endTime: startTime,
    timestamp: '2026-09-11T19:18:00Z',
    category: 'browser',
    isIdle: false,
    isAssigned: false,
    source: 'live',
  });

  it('correctly parses and formats minutes of the day', () => {
    expect(parseTimeToMinuteOfDay('19:15')).toBe(1155);
    expect(formatMinuteOfDay(1155)).toBe('19:15');
    expect(formatMinuteOfDay(0)).toBe('00:00');
  });

  it('groups rapid switches across Antigravity, Chrome, and SnippingTool into 1 exact 15m slot', () => {
    // 10 alternating switches between 19:15 and 19:28
    const activities: ActivityItem[] = [
      makeAct('1', 'Antigravity', 'Developing Hourglass', 60, '19:15'),
      makeAct('2', 'Google Chrome', 'LinkedIn', 90, '19:16'),
      makeAct('3', 'Snipping Tool', 'Snipping Tool', 30, '19:18'),
      makeAct('4', 'Antigravity', 'Developing Hourglass', 120, '19:20'),
      makeAct('5', 'Google Chrome', 'Documentation', 60, '19:23'),
      makeAct('6', 'Snipping Tool', 'Screenshot 2', 40, '19:25'),
    ];

    const slots = aggregateIntoTimeSlots(activities, 15);
    // Exactly ONE 15-minute slot from 19:15 to 19:30!
    expect(slots).toHaveLength(1);
    expect(slots[0].startTimeStr).toBe('19:15');
    expect(slots[0].endTimeStr).toBe('19:30');
    expect(slots[0].slotStartMinute).toBe(1155);
    expect(slots[0].appCount).toBe(3); // Antigravity, Chrome, Snipping Tool
    expect(slots[0].totalTrackedSeconds).toBe(400);

    // Apps aggregated inside the slot
    expect(slots[0].apps.map(a => a.appName)).toEqual(['Antigravity', 'Google Chrome', 'Snipping Tool']);
  });

  it('creates separate distinct slots when activities occur in different intervals', () => {
    const activities: ActivityItem[] = [
      makeAct('1', 'Antigravity', 'Developing Hourglass', 600, '09:00'),
      makeAct('2', 'Google Chrome', 'Client Call', 900, '14:30'),
      makeAct('3', 'Microsoft Excel', 'Financial Model', 600, '14:40'),
    ];

    const slots = aggregateIntoTimeSlots(activities, 15);
    expect(slots).toHaveLength(2);
    expect(slots[0].startTimeStr).toBe('09:00');
    expect(slots[1].startTimeStr).toBe('14:30');
    expect(slots[1].appCount).toBe(2); // Chrome and Excel in the 14:30-14:45 slot
  });

  it('consolidates rapid multiple Chrome tabs into 1 unified Chrome card with tab list', () => {
    // 5 Chrome tabs opened/visited around 19:08 (matching user screenshot)
    const activities: ActivityItem[] = [
      makeAct('1', 'Google Chrome', 'Inbox (73,188) - work.vineethramesh@gmail.com', 60, '19:08'),
      makeAct('2', 'Google Chrome', 'GitHub - Hourglass Pull Requests', 45, '19:08'),
      makeAct('3', 'Google Chrome', 'Stripe Billing Dashboard', 30, '19:09'),
      makeAct('4', 'Google Chrome', 'Client Specification v2', 90, '19:09'),
      makeAct('5', 'Google Chrome', 'Google Search - Rust Windows hooks', 20, '19:10'),
      makeAct('6', 'SnippingTool.exe', 'Snipping Tool', 60, '19:48'),
    ];

    const sessions = groupActivitiesByAppSession(activities);

    // Exactly TWO sessions: 1 for Chrome, 1 for Snipping Tool!
    expect(sessions).toHaveLength(2);
    expect(sessions[0].appName).toBe('Google Chrome');
    expect(sessions[0].startTime).toBe('19:08');
    expect(sessions[0].tabCount).toBe(5);
    expect(sessions[0].tabs).toHaveLength(5);
    expect(sessions[0].durationSeconds).toBe(245); // 60 + 45 + 30 + 90 + 20

    expect(sessions[1].appName).toBe('SnippingTool.exe');
    expect(sessions[1].startTime).toBe('19:48');
    expect(sessions[1].tabCount).toBe(1);

    // Test visual layout with no overlap
    const layout = computeSessionVisualLayout(sessions, (t) => {
      const [h, m] = t.split(':').map(Number);
      return (h * 60 + m) * 2.4;
    }, 2.4);

    expect(layout[0].visualTop).toBeLessThan(layout[1].visualTop);
    // Card 1 bottom is well before Card 2 top (no overlap, zero collision)
    expect(layout[0].visualTop + layout[0].cardHeight).toBeLessThan(layout[1].visualTop);
  });

  it('deduplicates identical document polling in Microsoft Word to tabCount: 1 and tabNoun: documents', () => {
    const activities: ActivityItem[] = [
      makeAct('1', 'Microsoft Word', 'VINEETH RAMESH - Word', 60, '19:57'),
      makeAct('2', 'Microsoft Word', 'VINEETH RAMESH [Autosaved] - Word', 60, '19:58'),
      makeAct('3', 'Microsoft Word', 'VINEETH RAMESH - Word', 60, '19:59'),
    ];

    const sessions = groupActivitiesByAppSession(activities);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tabCount).toBe(1);
    expect(sessions[0].tabNoun).toBe('documents');
    expect(sessions[0].durationSeconds).toBe(180);
  });

  it('consolidates micro-switches to Snipping Tool without fragmenting the primary Antigravity session', () => {
    const activities: ActivityItem[] = [
      makeAct('1', 'Antigravity', 'Developing Hourglass', 60, '10:40'),
      makeAct('2', 'SnippingTool.exe', 'Snipping Tool', 10, '10:40'),
      makeAct('3', 'Antigravity', 'Developing Hourglass', 60, '10:41'),
      makeAct('4', 'SnippingTool.exe', 'Snipping Tool', 10, '10:42'),
      makeAct('5', 'Antigravity', 'Developing Hourglass', 60, '10:43'),
    ];

    const sessions = groupActivitiesByAppSession(activities);
    // Should be exactly TWO consolidated sessions (Antigravity & SnippingTool), NOT 5 fragmented slices
    expect(sessions).toHaveLength(2);
    expect(sessions[0].appName).toBe('Antigravity');
    expect(sessions[0].durationSeconds).toBe(180);
    expect(sessions[1].appName).toBe('SnippingTool.exe');
    expect(sessions[1].durationSeconds).toBe(20);
  });

  it('cleans expanded tabs from task descriptions to keep only app name alone', () => {
    // Exact string from user screenshot for Antigravity
    const antigravityExpanded = 'Antigravity (6 windows) (Developing Hourglass Time... | Developing Hourglass Time... | Developing Hourglass Time...)';
    expect(cleanTaskDescription(antigravityExpanded, 'Antigravity, SnippingTool.exe')).toBe('Antigravity');
    expect(cleanTaskDescription('Antigravity (6 windows) (6 windows)', 'Antigravity')).toBe('Antigravity');
    expect(cleanTaskDescription('Antigravity (6 windows)')).toBe('Antigravity');

    // Exact string from user screenshot for Brave Browser
    const braveExpanded = 'Brave Browser (11 tabs) ((8) YouTube - Brave | YouTube - Brave | Notifications | LinkedIn - Brave)';
    expect(cleanTaskDescription(braveExpanded, 'Brave Browser')).toBe('Brave Browser');
    expect(cleanTaskDescription('Brave Browser (11 tabs) (11 tabs)', 'Brave Browser')).toBe('Brave Browser');
    expect(cleanTaskDescription('Brave Browser (11 tabs)')).toBe('Brave Browser');

    // Suffix with (+X tabs)
    expect(cleanTaskDescription('Google Chrome (+5 tabs)', 'Google Chrome')).toBe('Google Chrome');
    expect(cleanTaskDescription('Google Chrome: Dashboard (+5 tabs)', 'Google Chrome')).toBe('Google Chrome');

    // Legit custom task description should be preserved
    expect(cleanTaskDescription('Reviewed Q3 valuation model', 'Microsoft Excel')).toBe('Reviewed Q3 valuation model');
  });

  it('cleans redundant tab count notes to prevent duplicate strings', () => {
    // Exact note from user screenshot
    expect(cleanEntryNotes('"Antigravity (6 windows) (6 windows)"', 'Antigravity', 'Antigravity')).toBe('');
    expect(cleanEntryNotes('Antigravity (6 windows) (6 windows)', 'Antigravity', 'Antigravity')).toBe('');
    expect(cleanEntryNotes('"Brave Browser (11 tabs) (11 tabs)"', 'Brave Browser', 'Brave Browser')).toBe('');
    expect(cleanEntryNotes('Brave Browser (11 tabs)', 'Brave Browser', 'Brave Browser')).toBe('');

    // Custom user notes preserved
    expect(cleanEntryNotes('Discussed engagement rate with CFO', 'Financial Model', 'Excel')).toBe('Discussed engagement rate with CFO');
  });

  it('filters noise browser tabs (New Tab, Cloudflare interstitials) and absorbs their duration', () => {
    const activities: ActivityItem[] = [
      makeAct('1', 'Google Chrome', 'New Tab - Google Chrome', 30, '11:14'),
      makeAct('2', 'Google Chrome', 'Just a moment... - Google Chrome', 15, '11:14'),
      makeAct('3', 'Google Chrome', 'SEEK - Australia\'s no. 1 jobs - Google Chrome', 60, '11:14'),
      makeAct('4', 'Google Chrome', 'Gmail - Google Chrome', 60, '11:15'),
    ];

    const sessions = groupActivitiesByAppSession(activities);
    expect(sessions).toHaveLength(1);
    // Only real pages appear as tabs — New Tab and Just a moment... are absorbed
    expect(sessions[0].tabs).toHaveLength(2);
    expect(sessions[0].tabs.map(t => t.windowTitle)).not.toContain('New Tab - Google Chrome');
    expect(sessions[0].tabs.map(t => t.windowTitle)).not.toContain('Just a moment... - Google Chrome');
    // But total duration includes all 4 activities
    expect(sessions[0].durationSeconds).toBe(165); // 30 + 15 + 60 + 60
  });

  it('merges LinkedIn subpages and notification variants into a single tab', () => {
    const activities: ActivityItem[] = [
      makeAct('1', 'Google Chrome', 'LinkedIn - Google Chrome', 60, '11:14'),
      makeAct('2', 'Google Chrome', '(3) Notifications | LinkedIn - Google Chrome', 60, '11:15'),
      makeAct('3', 'Google Chrome', '(2) Notifications | LinkedIn - Google Chrome', 60, '11:15'),
      makeAct('4', 'Google Chrome', 'Grow | LinkedIn - Google Chrome', 60, '11:16'),
      makeAct('5', 'Google Chrome', 'Nikhil Sridharan | LinkedIn - Google Chrome', 60, '11:16'),
      makeAct('6', 'Google Chrome', 'Founding Software Engineer | Applied Intelligence | LinkedIn - Google Chrome', 60, '11:17'),
    ];

    const sessions = groupActivitiesByAppSession(activities);
    expect(sessions).toHaveLength(1);
    // All LinkedIn subpages and notification counts should merge into 1 tab
    expect(sessions[0].tabs).toHaveLength(1);
    expect(sessions[0].durationSeconds).toBe(360); // 6 × 60s
    expect(sessions[0].tabs[0].durationSeconds).toBe(360);
    expect(sessions[0].tabs[0].activities).toHaveLength(6); // All 6 visits tracked
  });

  it('merges Gmail Inbox/Spam variants into a single email account tab', () => {
    const activities: ActivityItem[] = [
      makeAct('1', 'Google Chrome', 'Inbox - work.vineethramesh@gmail.com - Gmail - Google Chrome', 30, '11:14'),
      makeAct('2', 'Google Chrome', 'Inbox (73,204) - work.vineethramesh@gmail.com - Gmail - Google Chrome', 60, '11:15'),
      makeAct('3', 'Google Chrome', 'Spam (755) - work.vineethramesh@gmail.com - Gmail - Google Chrome', 30, '11:16'),
    ];

    const sessions = groupActivitiesByAppSession(activities);
    expect(sessions).toHaveLength(1);
    // All variants for this email account merge into 1 tab
    expect(sessions[0].tabs).toHaveLength(1);
    expect(sessions[0].tabs[0].windowTitle).toBe('work.vineethramesh@gmail.com');
    expect(sessions[0].durationSeconds).toBe(120);
  });

  it('does NOT break early when an intermediate app is between two Chrome sessions within threshold', () => {
    // Chrome → Slack (2min) → Chrome should still merge Chrome into 1 session
    const activities: ActivityItem[] = [
      makeAct('1', 'Google Chrome', 'GitHub - Google Chrome', 120, '10:00'),
      makeAct('2', 'Slack', 'team-general — Slack', 120, '10:02'),
      makeAct('3', 'Google Chrome', 'Pull Requests - Google Chrome', 60, '10:04'),
    ];

    const sessions = groupActivitiesByAppSession(activities);
    // Chrome sessions should merge (gap = 4 - 2 = 2 min < 15 min threshold)
    const chromeSessions = sessions.filter(s => s.appName === 'Google Chrome');
    expect(chromeSessions).toHaveLength(1);
    expect(chromeSessions[0].durationSeconds).toBe(180);
    expect(chromeSessions[0].tabs).toHaveLength(2);
  });
});
