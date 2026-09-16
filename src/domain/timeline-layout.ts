import { ActivityItem } from '../types/activity';
import { normalizeDocumentTitle, getAppItemNoun, isNoiseBrowserTab, isSystemLockOrNoiseActivity } from './activity-audit';

export interface SlotAppSummary {
  appName: string;
  executable?: string;
  appIcon?: string;
  category: string;
  durationSeconds: number;
  primaryTitle: string;
  tabCount: number;
  items: ActivityItem[];
  isAssigned: boolean;
}

export interface TimeSlotBucket {
  id: string;
  slotStartMinute: number; // minutes from midnight (e.g. 1155 for 19:15)
  slotEndMinute: number;   // e.g. 1170 for 19:30
  startTimeStr: string;    // "19:15"
  endTimeStr: string;      // "19:30"
  slotDurationMinutes: number; // 15
  totalTrackedSeconds: number;
  primaryApp: string;
  primaryTitle: string;
  appIcon?: string;
  appCount: number;
  apps: SlotAppSummary[];
  isAssigned: boolean;
  allActivities: ActivityItem[];
}

/**
 * Formats minute of day to HH:mm string
 */
export function formatMinuteOfDay(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(1439, Math.floor(totalMinutes)));
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Parses HH:mm string to minute of day (0 - 1439)
 */
export function parseTimeToMinuteOfDay(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  const h = isNaN(parts[0]) ? 0 : parts[0];
  const m = isNaN(parts[1]) ? 0 : parts[1];
  return Math.max(0, Math.min(1439, h * 60 + m));
}

/**
 * Aggregates activities into fixed time intervals matching the user's zoom resolution
 * (e.g. 30m, 15m, 5m, or 1m).
 * Every bucket is strictly anchored to its exact clock time on the ruler, completely
 * preventing any vertical drift down the timeline.
 */
export function aggregateIntoTimeSlots(
  activities: ActivityItem[],
  slotMinutes: number
): TimeSlotBucket[] {
  if (!activities || activities.length === 0) return [];

  // Group activities into slot buckets by their startTime
  const bucketsMap = new Map<number, ActivityItem[]>();

  for (const act of activities) {
    const minuteOfDay = parseTimeToMinuteOfDay(act.startTime);
    const slotStart = Math.floor(minuteOfDay / slotMinutes) * slotMinutes;

    if (!bucketsMap.has(slotStart)) {
      bucketsMap.set(slotStart, []);
    }
    bucketsMap.get(slotStart)!.push(act);
  }

  // Sort slots by start minute
  const sortedSlotStarts = Array.from(bucketsMap.keys()).sort((a, b) => a - b);

  return sortedSlotStarts.map((slotStart) => {
    const slotEnd = slotStart + slotMinutes;
    const acts = bucketsMap.get(slotStart)!;

    // Group activities within this slot by application
    const appMap = new Map<string, ActivityItem[]>();
    for (const a of acts) {
      const key = (a.appName || 'Unknown').trim();
      if (!appMap.has(key)) {
        appMap.set(key, []);
      }
      appMap.get(key)!.push(a);
    }

    const apps: SlotAppSummary[] = Array.from(appMap.entries()).map(([appName, items]) => {
      const durationSeconds = items.reduce((sum, it) => sum + (it.durationSeconds || 0), 0);
      const longest = [...items].sort((x, y) => (y.durationSeconds || 0) - (x.durationSeconds || 0))[0];
      return {
        appName,
        executable: items[0].executable,
        appIcon: items[0].appIcon,
        category: items[0].category,
        durationSeconds,
        primaryTitle: longest?.windowTitle || appName,
        tabCount: items.length,
        items,
        isAssigned: items.every(i => i.isAssigned),
      };
    }).sort((a, b) => b.durationSeconds - a.durationSeconds); // Most time spent first

    const totalTrackedSeconds = acts.reduce((s, it) => s + (it.durationSeconds || 0), 0);
    const primaryApp = apps[0]?.appName || 'Activity';
    const primaryTitle = apps[0]?.primaryTitle || '';
    const appIcon = apps[0]?.appIcon;

    return {
      id: `slot-${slotStart}-${slotMinutes}`,
      slotStartMinute: slotStart,
      slotEndMinute: slotEnd,
      startTimeStr: formatMinuteOfDay(slotStart),
      endTimeStr: formatMinuteOfDay(slotEnd),
      slotDurationMinutes: slotMinutes,
      totalTrackedSeconds,
      primaryApp,
      primaryTitle,
      appIcon,
      appCount: apps.length,
      apps,
      isAssigned: acts.every(a => a.isAssigned),
      allActivities: acts,
    };
  });
}

export interface SessionTabItem {
  id: string;
  windowTitle: string;
  durationSeconds: number;
  startTime: string;
  isAssigned: boolean;
  activity: ActivityItem;
  activities?: ActivityItem[];
}

export interface AppSessionGroup {
  id: string;
  appName: string;
  executable?: string;
  appIcon?: string;
  category: string;
  date?: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  primaryTitle: string;
  tabCount: number;
  tabNoun: 'tabs' | 'documents' | 'files' | 'windows';
  tabs: SessionTabItem[];
  isAssigned: boolean;
  activities: ActivityItem[];
}

/**
 * Consolidates activities belonging to the same application session
 * into a single unified card with tabs dropdown. Prevents the "deck of cards"
 * stacking when a user switches between multiple browser tabs or document windows.
 */
export function groupActivitiesByAppSession(
  activities: ActivityItem[],
  gapThresholdMinutes = 15
): AppSessionGroup[] {
  if (!activities || activities.length === 0) return [];

  // Sort activities chronologically by timestamp and start time
  const sorted = [...activities].sort((a, b) => {
    const timeA = a.timestamp || a.startTime;
    const timeB = b.timestamp || b.startTime;
    const cmp = timeA.localeCompare(timeB);
    if (cmp !== 0) return cmp;
    const minA = parseTimeToMinuteOfDay(a.startTime);
    const minB = parseTimeToMinuteOfDay(b.startTime);
    return minA - minB;
  });

  const groups: AppSessionGroup[] = [];

  for (const act of sorted) {
    if (isSystemLockOrNoiseActivity(act)) continue;

    const actMinute = parseTimeToMinuteOfDay(act.startTime);

    // Look back at ALL recent groups to see if the user was recently active in this same app within gapThresholdMinutes
    let targetGroup: AppSessionGroup | undefined;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      const gEndMinute = parseTimeToMinuteOfDay(g.endTime);
      const gap = actMinute - gEndMinute;
      // Only look at groups whose end time is within the gap threshold
      if (gap <= gapThresholdMinutes && gap >= -gapThresholdMinutes) {
        if (g.appName.toLowerCase().trim() === (act.appName || '').toLowerCase().trim()) {
          targetGroup = g;
          break;
        }
        // Don't break here — continue scanning earlier groups to find a matching app session
      } else if (gap > gapThresholdMinutes) {
        // All earlier groups will be even further back, so stop scanning
        break;
      }
    }

    if (targetGroup) {
      // Merge into the active app session
      targetGroup.durationSeconds += (act.durationSeconds || 0);
      const actEndMinute = parseTimeToMinuteOfDay(act.endTime || act.startTime);
      const targetEndMinute = parseTimeToMinuteOfDay(targetGroup.endTime);
      if (actEndMinute >= targetEndMinute) {
        targetGroup.endTime = act.endTime || act.startTime;
      }
      targetGroup.activities.push(act);
      if (!act.isAssigned) {
        targetGroup.isAssigned = false;
      }

      // Noise tabs (New Tab, Cloudflare interstitials, about:blank, system modal dialogs) get their
      // duration absorbed into the session total but are NOT shown as individual tab entries
      if (isNoiseBrowserTab(act.appName, act.windowTitle)) {
        // Duration already added above — skip tab creation
      } else {
        // Check if this normalized document/tab already exists
        const normActTitle = normalizeDocumentTitle(act.appName, act.windowTitle).toLowerCase();
        const existingTab = targetGroup.tabs.find(t => 
          normalizeDocumentTitle(targetGroup!.appName, t.windowTitle).toLowerCase() === normActTitle
        );

        if (existingTab) {
          existingTab.durationSeconds += (act.durationSeconds || 0);
          if (!act.isAssigned) existingTab.isAssigned = false;
          if (!existingTab.activities) {
            existingTab.activities = [existingTab.activity];
          }
          existingTab.activities.push(act);
        } else {
          const cleanTabTitle = normalizeDocumentTitle(act.appName, act.windowTitle);
          targetGroup.tabs.push({
            id: act.id,
            windowTitle: cleanTabTitle,
            durationSeconds: act.durationSeconds || 0,
            startTime: act.startTime,
            isAssigned: act.isAssigned,
            activity: act,
            activities: [act],
          });
        }
      }

      // Keep primary title as the tab with the most time spent
      const longestTab = [...targetGroup.tabs].sort((x, y) => y.durationSeconds - x.durationSeconds)[0];
      if (longestTab) {
        targetGroup.primaryTitle = longestTab.windowTitle;
      }
      targetGroup.tabCount = targetGroup.tabs.length;
      targetGroup.tabNoun = getAppItemNoun(targetGroup.appName);
    } else {
      // Start a new app session group
      const isNoise = isNoiseBrowserTab(act.appName, act.windowTitle);
      const cleanTabTitle = normalizeDocumentTitle(act.appName, act.windowTitle);
      const initialTabs: SessionTabItem[] = isNoise ? [] : [{
        id: act.id,
        windowTitle: cleanTabTitle,
        durationSeconds: act.durationSeconds || 0,
        startTime: act.startTime,
        isAssigned: act.isAssigned,
        activity: act,
        activities: [act],
      }];
      groups.push({
        id: `session-${act.id}`,
        appName: act.appName || 'Activity',
        executable: act.executable,
        appIcon: act.appIcon,
        category: act.category || 'general',
        date: act.localDate || act.timestamp?.slice(0, 10),
        startTime: act.startTime,
        endTime: act.endTime || act.startTime,
        durationSeconds: act.durationSeconds || 0,
        primaryTitle: isNoise ? (act.appName || 'Activity') : act.windowTitle,
        tabCount: initialTabs.length,
        tabNoun: getAppItemNoun(act.appName || 'Activity'),
        tabs: initialTabs,
        isAssigned: act.isAssigned,
        activities: [act],
      });
    }
  }

  return groups;
}

/**
 * Positions sessions vertically with guaranteed magnetic clearance
 * so that even if different applications overlap at the same minute,
 * neither card is ever occluded or hidden.
 */
export function computeSessionVisualLayout(
  sessions: AppSessionGroup[],
  getMinuteOffset: (timeStr: string) => number,
  rowHeightPerMin: number
) {
  let prevBottom = -Infinity;
  return sessions.map((session) => {
    const calculatedTop = getMinuteOffset(session.startTime);
    const durationMins = Math.max(1, Math.round(session.durationSeconds / 60));
    const cardHeight = Math.max(36, durationMins * rowHeightPerMin);
    // Ensure at least 6px clearance from previous card so cards never collide
    const visualTop = Math.max(calculatedTop, prevBottom + 6);
    prevBottom = visualTop + cardHeight;
    return {
      ...session,
      visualTop,
      cardHeight,
    };
  });
}

/**
 * Strips expanding tab/window metadata and raw tab concatenations from task descriptions
 * so that logged application sessions cleanly use the application name alone.
 */
export function cleanTaskDescription(taskName?: string, appName?: string): string {
  if (!taskName) return appName ? appName.replace(/\.exe$/i, '').trim() : '';
  let cleaned = taskName.trim();

  // Strip leading '*' unsaved changes marker in Windows editors (e.g. "*gk.txt - Notepad" -> "gk.txt - Notepad")
  cleaned = cleaned.replace(/^\*\s*/, '').trim();

  // Strip trailing " - AppName" suffix (e.g. "gk.txt - Notepad" with appName "Notepad.exe" -> "gk.txt")
  if (appName) {
    const cleanApp = appName.replace(/\.exe$/i, '').trim();
    if (cleanApp) {
      cleaned = cleaned.replace(new RegExp(`\\s*-\\s*${cleanApp}(?:\\.exe)?$`, 'i'), '').trim();
    }
  }

  // Pattern 1: AppName (X tabs/windows) (...) -> AppName
  // e.g. "Antigravity (6 windows) (Developing Hourglass... | ...)" -> "Antigravity"
  // e.g. "Brave Browser (11 tabs) ((8) YouTube... | ...)" -> "Brave Browser"
  const appTabsExpandedRegex = /^([^(]+?)\s*\(\d+\s*(?:tabs?|windows?|documents?|files?)\)\s*(?:\(.*|\(+\d+\s*(?:tabs?|windows?|documents?|files?)\)?.*)?$/i;
  const match1 = cleaned.match(appTabsExpandedRegex);
  if (match1 && match1[1]) {
    return match1[1].trim();
  }

  // Pattern 2: Multiple pipes representing tab titles e.g. "(Tab1 | Tab2 | Tab3)"
  if (cleaned.includes(' | ')) {
    if (appName) {
      return appName.split(',')[0].trim();
    }
    const beforeParen = cleaned.replace(/\s*\(.*\|.*$/, '').trim();
    if (beforeParen) return beforeParen;
  }

  // Pattern 3: "AppName: Something (+X tabs)" or "Something (+X tabs)"
  if (/\(\+\d+\s*(?:tabs?|windows?|documents?|files?)\)/i.test(cleaned)) {
    if (appName) {
      const primaryApp = appName.split(',')[0].trim();
      if (cleaned.toLowerCase().startsWith(primaryApp.toLowerCase())) {
        return primaryApp;
      }
    }
    cleaned = cleaned.replace(/\s*\(\+\d+\s*(?:tabs?|windows?|documents?|files?)\)/gi, '').trim();
  }

  // Pattern 4: "AppName (X tabs)" or "AppName (X windows)"
  const appCountRegex = /^([^(]+?)\s*\(\d+\s*(?:tabs?|windows?|documents?|files?)\)$/i;
  const match2 = cleaned.match(appCountRegex);
  if (match2 && match2[1]) {
    return match2[1].trim();
  }

  // Pattern 5: If appName is provided and taskName is "${appName} Session" or "${appName} Focus"
  if (appName) {
    const primaryApp = appName.split(',')[0].trim();
    if (cleaned.toLowerCase() === `${primaryApp.toLowerCase()} session` || 
        cleaned.toLowerCase() === `${primaryApp.toLowerCase()} focus`) {
      return primaryApp;
    }
  }

  return cleaned;
}

/**
 * Strips redundant tab/window count reflections from notes.
 * If the note is just repetitive tab counts (e.g. '"Antigravity (6 windows) (6 windows)"'),
 * it returns an empty string so notes are not cluttered.
 */
export function cleanEntryNotes(notes?: string, taskName?: string, appName?: string): string {
  if (!notes) return '';
  const trimmed = notes.trim();
  const unquoted = trimmed.replace(/^["']|["']$/g, '').trim();

  // Pattern A: Repeated or single tab count groups e.g. "Antigravity (6 windows) (6 windows)", "(11 tabs)"
  if (/^([^(]+?)?\s*(\(\d+\s*(?:tabs?|windows?|documents?|files?)\)\s*)+$/i.test(unquoted)) {
    return '';
  }

  // Pattern B: Starts with app name and contains tab/window counts
  if (appName) {
    const primaryApp = appName.split(',')[0].trim().toLowerCase();
    if (unquoted.toLowerCase().startsWith(primaryApp) && /\b\d+\s*(?:tabs?|windows?|documents?|files?)\b/i.test(unquoted)) {
      return '';
    }
  }

  // Pattern C: If notes is identical to clean task name or raw task name
  const cleanTask = cleanTaskDescription(taskName, appName).toLowerCase();
  if (unquoted.toLowerCase() === cleanTask || trimmed.toLowerCase() === cleanTask) {
    return '';
  }

  return trimmed;
}


