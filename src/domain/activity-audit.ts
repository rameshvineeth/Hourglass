/**
 * Activity Audit & Reconciliation Engine
 * 
 * Analyzes unassigned captured activities over a day or week to identify recurring
 * documents, consolidate fragmented workstreams (e.g., multiple sessions of the same
 * Word document or Chrome research topic across the day), absorb micro-switch noise,
 * and generate clean, unified billable time entry drafts.
 */

import { ActivityItem } from '../types/activity';
import { Client, Project } from '../types/client-project';
import { TimeEntryDraft, RoundingMode } from '../types/time-entry';
import { roundDurationMinutes } from './time-calculations';
import { parseTimeToMinuteOfDay, formatMinuteOfDay, type AppSessionGroup, type SessionTabItem } from './timeline-layout';

export interface AuditedTimeInterval {
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export interface AuditedWorkstream {
  id: string;
  appName: string;
  executable?: string;
  appIcon?: string;
  category: string;
  normalizedDocumentTitle: string;
  rawSampleTitle: string;
  totalDurationSeconds: number;
  roundedHours: number;
  sessionCount: number;
  intervals: AuditedTimeInterval[];
  activities: ActivityItem[];
  suggestedClientId?: string;
  suggestedProjectId?: string;
  suggestedTaskName: string;
  isBillable: boolean;
  needsReview: boolean;
  isPersonal?: boolean;
  absorbedNoiseCount: number;
  absorbedNoiseSeconds: number;
}

export interface AuditReport {
  scope: 'today' | 'week';
  totalCapturedActivities: number;
  totalUnassignedActivities: number;
  totalUnassignedSeconds: number;
  totalUnassignedHours: number;
  workstreams: AuditedWorkstream[];
  totalRecoverableSeconds: number;
  totalRecoverableHours: number;
  microSwitchesAbsorbed: number;
}

/**
 * Transient noise patterns across ALL applications (browsers and desktop dialogs)
 * that should never appear as individual billable items in the tab/document list.
 */
const NOISE_WINDOW_PATTERNS: RegExp[] = [
  /^new\s+tab$/i,
  /^new\s+incognito\s+tab$/i,
  /^tab$/i,                          // bare "Tab" after browser suffix strip (e.g. "Tab - Brave")
  /^just\s+a\s+moment/i,          // Cloudflare interstitial
  /^checking\s+your\s+browser/i,   // DDoS challenge pages
  /^attention\s+required!\s*\|\s*cloudflare/i,
  /^about:blank$/i,
  /^about:newtab$/i,
  /^untitled$/i,
  /^loading\.{0,3}$/i,
  /^\s*$/,                         // empty string
  /^chrome:\/\//i,                 // internal browser pages
  /^edge:\/\//i,
  /^brave:\/\//i,
  /^127\.0\.0\.1(?:[:/_]|$)/i,     // localhost dev servers
  /^localhost(?:[:/_]|$)/i,
  // System / Browser prompt dialogs (passwords, save popups, notifications)
  /^(?:this\s+page\s+wants\s+to\s+save|save\s+password\??|save\s+address\??|restore\s+pages\??)$/i,
  // System / File Picker / Common transient modal dialogs:
  /^(?:open|open\s+file|save\s+as|save\s+file|select\s+folder|browse\s+for\s+folder|confirm\s+save\s+as|file\s+upload|properties)$/i,
  /^(?:task\s+switching|program\s+manager|windows\s+shell\s+experience\s+host|unlockingwindow)$/i,
  // Windows Spotlight lock screen strings
  /^(?:we\s+like\s+this\s+picture.*|like\s+what\s+you\s+see\??|windows\s+default\s+lock\s+screen)$/i,
];

/**
 * Detects whether an activity represents Windows lock screen, logon UI, screensaver,
 * or system shell chrome that must NEVER appear as a user activity, workstream, or session.
 */
export function isSystemLockOrNoiseActivity(act: { appName?: string; executable?: string; windowTitle?: string }): boolean {
  if (!act) return false;
  const app = (act.appName || '').toLowerCase();
  const exe = (act.executable || '').toLowerCase();
  const title = (act.windowTitle || '').toLowerCase().trim();

  // 1. Windows Start Menu (StartMenuExperienceHost.exe, "Windows Start Experience Host", "Start")
  if (
    app.includes('start experience') ||
    app.includes('startmenuexperiencehost') ||
    exe.includes('startmenuexperiencehost') ||
    title === 'start' ||
    title === 'windows start'
  ) {
    return true;
  }

  // 2. Windows Search (SearchHost.exe, SearchApp.exe, "Search", "Windows Search", "Cortana")
  if (
    app.includes('searchhost') ||
    app.includes('searchapp') ||
    exe.includes('searchhost') ||
    exe.includes('searchapp') ||
    title === 'windows search' ||
    title === 'cortana' ||
    (title === 'search' && (app.includes('windows') || app.includes('microsoft') || app.includes('search') || !app))
  ) {
    return true;
  }

  // 3. Generic "Microsoft Windows Operating System" shell chrome
  if (app.includes('microsoft') && app.includes('windows') && app.includes('operating system')) {
    // If the title is "Search", "Start", empty, or system chrome, it's noise
    if (!title || title === 'search' || title === 'start' || title === 'windows search' || title === 'program manager') {
      return true;
    }
  }

  // 4. Lock screen, logon UI, and Shell Experience processes
  if (app.includes('lockapp') || exe.includes('lockapp')) return true;
  if (app.includes('logonui') || exe.includes('logonui')) return true;
  if (app.includes('shellexperiencehost') || exe.includes('shellexperiencehost')) return true;

  // 5. System task switching, program manager, taskbar, game bar, quick settings
  if (
    title === 'unlockingwindow' ||
    title === 'windows default lock screen' ||
    title === 'task switching' ||
    title === 'program manager' ||
    title === 'taskbar' ||
    title === 'action center' ||
    title === 'quick settings' ||
    title === 'notification center' ||
    app.includes('gamebar') ||
    exe.includes('gamebar')
  ) {
    return true;
  }

  // 6. Windows Spotlight lock screen strings
  if (title.includes('we like this picture') || title.includes('like what you see')) return true;

  return false;
}

/**
 * Detects whether an app is a short-lived transient accessory utility
 * (e.g. Snipping Tool, Windows Search, Calculator) rather than a primary work application.
 */
export function isTransientAccessoryApp(appName: string, windowTitle?: string): boolean {
  const lowerApp = (appName || '').toLowerCase();
  const lowerTitle = (windowTitle || '').toLowerCase();
  return (
    lowerApp.includes('snipping') ||
    lowerApp.includes('search') ||
    lowerApp.includes('calculator') ||
    lowerApp.includes('explorer') ||
    lowerApp.includes('finder') ||
    lowerApp.includes('character map') ||
    lowerApp.includes('magnifier') ||
    lowerTitle === 'search' ||
    lowerTitle === 'windows search' ||
    lowerTitle === 'snipping tool' ||
    (lowerApp.includes('windows') && lowerTitle.includes('search'))
  );
}

/**
 * Returns true if this window title is a noise/transient page or dialog
 * that should be silently absorbed into the session rather than shown as an individual tab/item.
 */
export function isNoiseActivity(appName: string, windowTitle: string): boolean {
  if (isSystemLockOrNoiseActivity({ appName, windowTitle })) return true;
  if (!windowTitle) return true;

  const appLower = (appName || '').toLowerCase();
  if (appLower === 'shell' || appLower === 'task manager' || appLower === 'program manager') {
    return true;
  }

  let cleaned = windowTitle.trim();

  cleaned = cleaned
    .replace(/\s*-\s*(?:Google\s+Chrome|Chrome|Brave(?:\s+Browser)?|Microsoft\s+Edge|Edge|Mozilla\s+Firefox|Firefox|Safari|Opera|Arc)$/i, '')
    .trim();

  return NOISE_WINDOW_PATTERNS.some(p => p.test(cleaned));
}

// Retain backwards compatibility for existing imports
export const isNoiseBrowserTab = isNoiseActivity;

/**
 * Universally normalizes browser tabs:
 * 1. For email clients: extracts and retains the specific email ID / account address.
 * 2. For all other websites/web apps: extracts ONLY the clean website name / brand identity.
 */
export function normalizeBrowserTabIdentity(windowTitle: string): string {
  if (!windowTitle) return 'Untitled';
  let cleaned = windowTitle.trim();

  // 1. Strip browser suffix using generic delimiter matching against common browser identifiers
  cleaned = cleaned
    .replace(/\s*[-–—|]\s*(?:Google\s+Chrome|Chrome|Brave(?:\s+Browser)?|Microsoft\s+Edge|Edge|Mozilla\s+Firefox|Firefox|Safari|Opera|Arc|Browser)\s*$/i, '')
    .trim();

  // 2. Strip leading notification badges: (1), (99+)
  cleaned = cleaned.replace(/^\(\d+\+?\)\s*/, '').trim();

  // 3. EMAIL CLIENTS: Extract and retain the specific email ID / account address
  const emailMatch = cleaned.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  if (emailMatch) {
    return emailMatch[1].toLowerCase();
  }
  if (/\b(?:Gmail|Google\s+Mail)\b/i.test(cleaned)) {
    return 'Gmail';
  }
  if (/\b(?:Outlook|Hotmail)\b/i.test(cleaned)) {
    return 'Outlook';
  }

  // 4. ALL OTHER WEBSITES: EXTRACT WEBNAME ONLY

  // (a) Search Engine query extraction: "[Query] - [AnyEngine] Search"
  const searchMatch = cleaned.match(/^(.+?)\s*[-–—|]\s*\S*\s*Search$/i);
  if (searchMatch) {
    return toTitleCase(searchMatch[1].trim());
  }

  // (b) Raw Search Engine URLs: domain.com/search?q=XYZ
  if (/^[a-z0-9.-]+\/search\?/i.test(cleaned) || /^https?:\/\/[a-z0-9.-]+\/search\?/i.test(cleaned)) {
    try {
      const url = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
      const q = url.searchParams.get('q');
      if (q) return toTitleCase(q.trim());
    } catch {}
  }

  // (c) Raw domain/URL title: e.g. "chatgpt.com", "linkedin.com/jobs/...", "portal.clientfirm.com"
  const urlMatch = cleaned.match(/^(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/.*)?$/i);
  if (urlMatch) {
    const hostname = urlMatch[1];
    const brand = extractDomainBrand(hostname);
    if (brand) return toTitleCase(brand);
  }

  // (d) Pipe-separated web app: "[Page/Feature] | [WebName]"
  // e.g. "Notifications | LinkedIn", "Pull Requests | GitHub", "Invoice #402 | Stripe"
  if (cleaned.includes(' | ')) {
    const segments = cleaned.split(' | ').map(s => s.trim()).filter(Boolean);
    if (segments.length > 1) {
      const siteIdentity = segments[segments.length - 1];
      if (siteIdentity.length < 40) {
        return toTitleCase(siteIdentity);
      }
    }
  }

  // (e) Colon tagline standard: "[WebName]: [Tagline]"
  // e.g. "ChatGPT: Chat, Work, Create & Code with AI"
  if (cleaned.includes(': ')) {
    const parts = cleaned.split(': ');
    if (parts[0].length >= 2 && parts[0].length <= 25) {
      return toTitleCase(parts[0].trim());
    }
  }

  // (f) Hyphen web app separator: "[Page Name] - [WebName]"
  if (cleaned.includes(' - ')) {
    const segments = cleaned.split(' - ').map(s => s.trim()).filter(Boolean);
    if (segments.length > 1) {
      const potentialWebName = segments[segments.length - 1];
      if (potentialWebName.length >= 2 && potentialWebName.length <= 25 && !potentialWebName.includes('/')) {
        return toTitleCase(potentialWebName);
      }
    }
  }

  return toTitleCase(cleaned) || 'Untitled';
}

/**
 * Extracts the registered brand name from any domain hostname.
 * e.g. "chatgpt.com" -> "chatgpt", "sub.linkedin.co.uk" -> "linkedin", "portal.acme.org" -> "acme"
 */
function extractDomainBrand(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length < 2) return hostname;
  const ccTLDs = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
  if (parts.length >= 3 && ccTLDs.has(parts[parts.length - 2])) {
    return parts[parts.length - 3] || parts[0];
  }
  return parts[parts.length - 2] || parts[0];
}

/**
 * Universally converts words into clean Title Case while preserving existing camelCase / acronyms.
 */
function toTitleCase(str: string): string {
  if (!str) return '';
  const commonBrands: Record<string, string> = {
    chatgpt: 'ChatGPT',
    openai: 'ChatGPT',
    linkedin: 'LinkedIn',
    github: 'GitHub',
    coingecko: 'CoinGecko',
    coinmarketcap: 'CoinMarketCap',
    gmail: 'Gmail',
    youtube: 'YouTube',
  };
  const lowerKey = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (commonBrands[lowerKey]) return commonBrands[lowerKey];

  if (/[a-z][A-Z]/.test(str)) return str;

  return str.replace(/\b\w+/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

/**
 * Strips window chrome, application suffixes, autosave markers, unsaved bullet points,
 * notification counts, and file extensions to extract the true canonical document / deliverable identity.
 * 
 * Works dynamically across ALL applications on ANY computer without hardcoding app names.
 */
export function normalizeDocumentTitle(appName: string, windowTitle: string, executable?: string): string {
  if (!windowTitle) return 'Untitled Document';

  // For browser apps, use universal domain & search normalization
  const isBrowser = /chrome|brave|edge|firefox|browser|safari|opera|arc/i.test(appName);
  if (isBrowser) {
    return normalizeBrowserTabIdentity(windowTitle);
  }

  let cleaned = windowTitle.trim();

  // 1. Universal editor/OS status tags
  cleaned = cleaned.replace(/^[●*•]\s*/, '').trim(); // Dirty/unsaved indicators (VS Code, Sublime, TextMate, Kate)
  cleaned = cleaned.replace(/^\(\d+\+?\)\s*/, '').trim(); // Notification badges: (1), (99+)
  cleaned = cleaned.replace(/^Administrator:\s*/i, '').trim(); // Elevated shell prefix
  cleaned = cleaned
    .replace(/\[(?:Autosaved|Read-Only|Working Copy|Draft|Administrator|Elevated|Protected View|Compatibility Mode|Restricted Mode)\]/gi, '')
    .replace(/\s*-\s*(?:Compatibility\s+Mode|Read-Only|Saved|Unsaved|Protected View)\b/gi, '')
    .trim();

  // 2. Dynamic app name stripping:
  // Build a set of tokens from the app's own name and executable
  const tokensToStrip = new Set<string>();
  if (appName) {
    const cleanApp = appName.trim();
    tokensToStrip.add(cleanApp);
    // Add individual significant words (e.g. "Google Chrome" -> "Chrome", "Microsoft Word" -> "Word")
    cleanApp.split(/\s+/).filter(w => w.length >= 3 && !/^(microsoft|adobe|google|mozilla|the)$/i.test(w)).forEach(w => tokensToStrip.add(w));
  }
  if (executable) {
    const exeStem = executable.replace(/\.exe$/i, '').trim();
    if (exeStem.length >= 3) {
      tokensToStrip.add(exeStem);
    }
  }

  // Strip trailing delimiter + app name: " - AppName", " | AppName", " — AppName", " – AppName"
  for (const token of tokensToStrip) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const suffixRegex = new RegExp(`\\s*[-–—|:]\\s*${escaped}\\s*$`, 'i');
    if (suffixRegex.test(cleaned)) {
      cleaned = cleaned.replace(suffixRegex, '').trim();
    }
  }

  // If the app is Hourglass itself, strip self-referential app suffixes
  if (appName.toLowerCase().includes('hourglass')) {
    cleaned = cleaned.replace(/\s*-\s*Hourglass(?:\.exe)?$/i, '').trim();
  }

  // 3. Strip trailing file extensions if it leaves a valid document name
  cleaned = cleaned.replace(/\.(docx?|xlsx?|pptx?|pdf|txt|md|csv|html?|json|xml|zip|dwg|blend|ai|psd)$/i, '').trim();

  // 4. Strip accessory timestamps (Snipping Tool, Search)
  if (cleaned.toLowerCase().startsWith('snipping tool')) {
    cleaned = 'Snipping Tool';
  }

  return cleaned || windowTitle.trim() || 'Untitled Document';
}

/**
 * Detects the appropriate noun for multiple sub-items in an application.
 * Uses the activity's category rather than hardcoded app names.
 */
export function getAppItemNoun(appName: string, category?: string): 'tabs' | 'documents' | 'files' | 'windows' {
  if (category === 'browser') return 'tabs';
  if (category === 'spreadsheet' || category === 'document' || category === 'presentation') return 'documents';
  if (category === 'development' || category === 'design') return 'files';

  const lower = (appName || '').toLowerCase();
  if (/browser|chrome|edge|firefox|safari|opera|arc/i.test(lower)) return 'tabs';
  if (/doc|sheet|slide|pdf|writer|calc|office|word|excel|powerpoint|note|notion|obsidian/i.test(lower)) return 'documents';
  if (/code|studio|editor|ide|dev|design|figma|cad|cursor|windsurf/i.test(lower)) return 'files';
  return 'windows';
}

export interface AuditOptions {
  scope?: 'today' | 'week';
  roundingMode?: RoundingMode;
  absorbMicroSwitches?: boolean;
  microSwitchThresholdSeconds?: number; // e.g. 60 seconds
  groupByApp?: boolean; // When true, consolidates all activities by parent application across the day
}

/**
 * Audits unassigned activities, consolidating recurring documents into single workstreams.
 */
export function auditActivities(
  activities: ActivityItem[],
  clients: Client[],
  projects: Project[],
  options: AuditOptions = {}
): AuditReport {
  const {
    scope = 'today',
    roundingMode = 'quarter_hour',
    absorbMicroSwitches = true,
    microSwitchThresholdSeconds = 60,
    groupByApp = false,
  } = options;

  const unassigned = activities.filter(a => !a.isAssigned && !a.isIdle && !isSystemLockOrNoiseActivity(a));
  const totalUnassignedSeconds = unassigned.reduce((s, a) => s + (a.durationSeconds || 0), 0);

  if (unassigned.length === 0) {
    return {
      scope,
      totalCapturedActivities: activities.length,
      totalUnassignedActivities: 0,
      totalUnassignedSeconds: 0,
      totalUnassignedHours: 0,
      workstreams: [],
      totalRecoverableSeconds: 0,
      totalRecoverableHours: 0,
      microSwitchesAbsorbed: 0,
    };
  }

  // Sort chronologically
  const sorted = [...unassigned].sort((a, b) => {
    const minA = parseTimeToMinuteOfDay(a.startTime);
    const minB = parseTimeToMinuteOfDay(b.startTime);
    return minA - minB;
  });

  // Map of canonical key -> list of activities
  // Key format: appName or appName:normalizedDocTitle
  const workstreamMap = new Map<string, {
    appName: string;
    executable?: string;
    appIcon?: string;
    category: string;
    normalizedTitle: string;
    sampleTitle: string;
    activities: ActivityItem[];
    noiseActivities: ActivityItem[];
  }>();

  let absorbedCount = 0;
  let currentPrimaryWorkstreamKey: string | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const act = sorted[i];
    if (isSystemLockOrNoiseActivity(act)) continue;

    const normTitle = normalizeDocumentTitle(act.appName, act.windowTitle);
    const key = groupByApp
      ? (act.appName || act.executable || 'Unknown App').toLowerCase().trim()
      : `${act.appName.toLowerCase()}:::${normTitle.toLowerCase()}`;
    const duration = act.durationSeconds || 0;

    // Micro-switch absorption rules:
    // 1. If groupByApp is TRUE: Every application owns its own activities! NO cross-app absorption.
    //    The only absorption is transient noise tabs/dialogs within the current app.
    // 2. If groupByApp is FALSE (Document View): Only transient accessory utilities
    //    (Snipping Tool, Windows Search, Calculator) or noise browser pages can be absorbed into
    //    an ongoing document focus session. Major applications (Brave, VS Code, Word, etc.) NEVER get absorbed!
    const isNoise = isNoiseActivity(act.appName, act.windowTitle);
    const isAccessory = isTransientAccessoryApp(act.appName, act.windowTitle);

    const currentPrimary = currentPrimaryWorkstreamKey ? workstreamMap.get(currentPrimaryWorkstreamKey) : null;
    const isSameAppAsPrimary = Boolean(
      currentPrimary &&
      (currentPrimary.appName || '').replace(/\.exe$/i, '').toLowerCase().trim() ===
      (act.appName || '').replace(/\.exe$/i, '').toLowerCase().trim()
    );

    // Micro-switch absorption:
    // ONLY absorb noise tabs/dialogs within the SAME application (e.g. Chrome New Tab in Chrome, or Notepad dialog in Notepad).
    // A background or localhost noise tab from an unrelated browser (e.g. Chrome) must NEVER be absorbed into Notepad!
    const isMicroSwitch = absorbMicroSwitches && currentPrimary && (
      (isNoise && isSameAppAsPrimary) ||
      (!groupByApp && isAccessory && duration <= microSwitchThresholdSeconds)
    );

    if (isMicroSwitch && currentPrimary) {
      currentPrimary.noiseActivities.push(act);
      absorbedCount++;
      continue;
    }

    // Isolated noise from another app (e.g. background 1s localhost/127.0.0.1 tab) must be dropped
    if (isNoise && !isSameAppAsPrimary) {
      continue;
    }

    if (!isAccessory) {
      currentPrimaryWorkstreamKey = key;
    }

    if (!workstreamMap.has(key)) {
      workstreamMap.set(key, {
        appName: act.appName,
        executable: act.executable,
        appIcon: act.appIcon,
        category: act.category,
        normalizedTitle: groupByApp ? (act.appName || 'Application') : normTitle,
        sampleTitle: act.windowTitle,
        activities: [act],
        noiseActivities: [],
      });
    } else {
      workstreamMap.get(key)!.activities.push(act);
    }
  }

  // Convert map into AuditedWorkstream list
  const workstreams: AuditedWorkstream[] = [];
  let totalRecoverableSeconds = 0;

  for (const [key, group] of workstreamMap.entries()) {
    const allActs = [...group.activities, ...group.noiseActivities];
    const totalSecs = allActs.reduce((s, a) => s + (a.durationSeconds || 0), 0);
    totalRecoverableSeconds += totalSecs;

    const durationMins = Math.max(1, Math.round(totalSecs / 60));
    const { decimalHours } = roundDurationMinutes(durationMins, roundingMode);

    // Compute intervals from individual activities and merge contiguous blocks (<3 min gap)
    const rawIntervals: AuditedTimeInterval[] = group.activities.map(a => {
      const startMin = parseTimeToMinuteOfDay(a.startTime);
      const endMin = a.endTime ? parseTimeToMinuteOfDay(a.endTime) : startMin + Math.max(1, Math.round((a.durationSeconds || 0) / 60));
      return {
        startTime: a.startTime,
        endTime: a.endTime || formatMinuteOfDay(endMin),
        durationMinutes: Math.max(1, Math.round((a.durationSeconds || 0) / 60)),
      };
    }).sort((a, b) => parseTimeToMinuteOfDay(a.startTime) - parseTimeToMinuteOfDay(b.startTime));

    const intervals: AuditedTimeInterval[] = [];
    for (const cur of rawIntervals) {
      if (intervals.length === 0) {
        intervals.push({ ...cur });
      } else {
        const prev = intervals[intervals.length - 1];
        const prevEnd = parseTimeToMinuteOfDay(prev.endTime);
        const curStart = parseTimeToMinuteOfDay(cur.startTime);
        const curEnd = parseTimeToMinuteOfDay(cur.endTime);

        if (curStart <= prevEnd + 3) {
          prev.endTime = formatMinuteOfDay(Math.max(prevEnd, curEnd));
          prev.durationMinutes = Math.max(1, parseTimeToMinuteOfDay(prev.endTime) - parseTimeToMinuteOfDay(prev.startTime));
        } else {
          intervals.push({ ...cur });
        }
      }
    }

    // Smart heuristic matching to client / project
    const match = matchProjectForWorkstream(group.appName, group.normalizedTitle, clients, projects);
    const noiseSecs = group.noiseActivities.reduce((s, a) => s + (a.durationSeconds || 0), 0);

    const isPersonal = isLikelyPersonalOrNonBillable(group.appName, group.sampleTitle);
    const suggestedTask = generateSuggestedTaskName(group.appName, group.normalizedTitle, group.sampleTitle);

    workstreams.push({
      id: `workstream-${key.replace(/[^a-z0-9]/gi, '-')}`,
      appName: group.appName,
      executable: group.executable,
      appIcon: group.appIcon,
      category: group.category,
      normalizedDocumentTitle: group.normalizedTitle,
      rawSampleTitle: group.sampleTitle,
      totalDurationSeconds: totalSecs,
      roundedHours: decimalHours,
      sessionCount: group.activities.length,
      intervals,
      activities: allActs,
      suggestedClientId: isPersonal ? undefined : match.clientId,
      suggestedProjectId: isPersonal ? undefined : match.projectId,
      suggestedTaskName: suggestedTask,
      isBillable: !isPersonal && match.isBillable,
      needsReview: isPersonal || !match.projectId,
      isPersonal,
      absorbedNoiseCount: group.noiseActivities.length,
      absorbedNoiseSeconds: noiseSecs,
    });
  }

  // Sort workstreams by total duration descending (most impactful first)
  workstreams.sort((a, b) => b.totalDurationSeconds - a.totalDurationSeconds);

  const { decimalHours: totalUnassignedHours } = roundDurationMinutes(
    Math.round(totalUnassignedSeconds / 60),
    roundingMode
  );
  const { decimalHours: totalRecHours } = roundDurationMinutes(
    Math.round(totalRecoverableSeconds / 60),
    roundingMode
  );

  return {
    scope,
    totalCapturedActivities: activities.length,
    totalUnassignedActivities: unassigned.length,
    totalUnassignedSeconds,
    totalUnassignedHours,
    workstreams,
    totalRecoverableSeconds,
    totalRecoverableHours: totalRecHours,
    microSwitchesAbsorbed: absorbedCount,
  };
}

/**
 * Matches a workstream to existing clients and projects by searching
 * project names, client names, and aliases in document title and app name.
 */
function matchProjectForWorkstream(
  appName: string,
  docTitle: string,
  clients: Client[],
  projects: Project[]
): { clientId?: string; projectId?: string; isBillable: boolean } {
  const combinedText = `${appName} ${docTitle}`.toLowerCase();

  // Try exact project name match
  for (const proj of projects) {
    const pName = proj.name.toLowerCase();
    if (pName.length >= 3 && combinedText.includes(pName)) {
      return {
        clientId: proj.clientId,
        projectId: proj.id,
        isBillable: proj.isBillableDefault ?? true,
      };
    }
  }

  // Try client name match
  for (const client of clients) {
    const cName = client.name.toLowerCase();
    if (cName.length >= 3 && combinedText.includes(cName)) {
      const clientProjects = projects.filter(p => p.clientId === client.id);
      if (clientProjects.length > 0) {
        return {
          clientId: client.id,
          projectId: clientProjects[0].id,
          isBillable: clientProjects[0].isBillableDefault ?? true,
        };
      }
    }
  }

  // No match found — leave unassigned so user can review
  return { isBillable: false };
}

/**
 * Creates draft TimeEntries from an audited workstream.
 */
export function createDraftFromWorkstream(
  workstream: AuditedWorkstream,
  date: string,
  clientId: string,
  projectId: string,
  taskName?: string
): TimeEntryDraft {
  const durationMinutes = Math.max(1, Math.round(workstream.totalDurationSeconds / 60));
  const startTime = workstream.intervals[0]?.startTime || '09:00';
  const endTime = workstream.intervals[workstream.intervals.length - 1]?.endTime || '09:30';
  const entryDate = workstream.activities[0]?.localDate || workstream.activities[0]?.timestamp?.slice(0, 10) || date;

  return {
    clientId,
    projectId,
    date: entryDate,
    startTime,
    endTime,
    durationMinutes,
    taskName: taskName || workstream.suggestedTaskName,
    notes: workstream.sessionCount > 1 
      ? `Consolidated ${workstream.sessionCount} focus sessions across ${entryDate} (${workstream.intervals.map(i => i.startTime).join(', ')})`
      : `Focus session on ${workstream.normalizedDocumentTitle}`,
    isBillable: workstream.isBillable,
    hourlyRate: 0,
    sourceActivityIds: workstream.activities.map(a => a.id),
  };
}

/**
 * Converts audited workstreams into timeline session cards for in-place
 * grouped display in the Activity stream.
 * 
 * Deduplicates tabs by normalized title and filters noise browser pages
 * to match the same clean presentation used in groupActivitiesByAppSession.
 */
export function workstreamsToSessionGroups(workstreams: AuditedWorkstream[]): AppSessionGroup[] {
  return workstreams.map(ws => {
    const sortedActs = [...ws.activities].sort((a, b) => {
      const tA = a.timestamp || a.startTime;
      const tB = b.timestamp || b.startTime;
      return tA.localeCompare(tB);
    });
    const firstAct = sortedActs[0] || ({} as ActivityItem);
    const lastAct = sortedActs[sortedActs.length - 1] || firstAct;

    // Deduplicate tabs by normalized title and filter noise pages
    const tabMap = new Map<string, SessionTabItem>();
    for (const a of ws.activities) {
      // Skip system lock and shell noise
      if (isSystemLockOrNoiseActivity(a)) continue;
      // Skip noise browser tabs (New Tab, Cloudflare interstitials, etc.)
      if (isNoiseBrowserTab(a.appName, a.windowTitle)) continue;
      // If this activity is an absorbed accessory from a different app (e.g. Snipping Tool absorbed into Word), don't list it as a tab!
      if (isTransientAccessoryApp(a.appName) && a.appName.toLowerCase() !== ws.appName.toLowerCase()) continue;

      const cleanTitle = normalizeDocumentTitle(a.appName, a.windowTitle);
      const normKey = cleanTitle.toLowerCase();
      const existing = tabMap.get(normKey);
      if (existing) {
        existing.durationSeconds += (a.durationSeconds || 0);
        if (!a.isAssigned) existing.isAssigned = false;
        if (!existing.activities) {
          existing.activities = [existing.activity];
        }
        existing.activities.push(a);
      } else {
        tabMap.set(normKey, {
          id: a.id,
          windowTitle: cleanTitle,
          durationSeconds: a.durationSeconds || 0,
          startTime: a.startTime,
          isAssigned: a.isAssigned,
          activity: a,
          activities: [a],
        });
      }
    }
    const tabs = Array.from(tabMap.values());

    const itemNoun = getAppItemNoun(ws.appName);
    const isAppLevelGroup = ws.normalizedDocumentTitle.toLowerCase() === ws.appName.toLowerCase();
    const primaryTitle = isAppLevelGroup
      ? ws.appName
      : (ws.sessionCount > 1 
          ? `${ws.normalizedDocumentTitle} (${ws.sessionCount} focus sessions)`
          : ws.normalizedDocumentTitle);

    return {
      id: ws.id,
      appName: ws.appName,
      executable: ws.executable,
      appIcon: ws.appIcon,
      category: ws.category,
      date: firstAct.localDate || firstAct.timestamp?.slice(0, 10),
      startTime: ws.intervals[0]?.startTime || firstAct.startTime || '00:00',
      endTime: ws.intervals[ws.intervals.length - 1]?.endTime || lastAct.endTime || lastAct.startTime || '00:00',
      durationSeconds: ws.totalDurationSeconds,
      primaryTitle,
      tabCount: tabs.length,
      tabNoun: itemNoun,
      tabs,
      isAssigned: ws.activities.length > 0 && ws.activities.every(a => a.isAssigned),
      activities: ws.activities,
    };
  });
}

/**
 * Detects whether an application session is likely personal/entertainment
 * (e.g. YouTube, Spotify, Netflix, Social media, Gaming) rather than billable client work.
 */
export function isLikelyPersonalOrNonBillable(appName?: string, title?: string): boolean {
  const combined = `${appName || ''} ${title || ''}`.toLowerCase();
  const nonBillableKeywords = [
    'youtube', 'spotify', 'netflix', 'hulu', 'disney', 'twitch', 'reddit',
    'twitter', 'x.com', 'facebook', 'instagram', 'tiktok', 'steam', 'epic games',
    'discord', 'whatsapp', 'telegram', 'solitaire', 'idle'
  ];
  return nonBillableKeywords.some(k => combined.includes(k));
}

/**
 * Extracts a professional, meaningful task memo from window title and app name.
 */
export function generateSuggestedTaskName(appName: string, normTitle: string, rawTitle: string): string {
  if (isLikelyPersonalOrNonBillable(appName, rawTitle)) {
    return 'Personal / Non-billable Activity';
  }

  let cleaned = (rawTitle || normTitle || appName).trim();
  // Strip tab count markers like (8) YouTube
  cleaned = cleaned.replace(/^\(\d+\)\s*/, '');
  // Strip common browser and window suffixes
  cleaned = cleaned.replace(/\s*-\s*(?:Google Chrome|Brave|Microsoft Edge|Mozilla Firefox|Visual Studio Code|Notepad(?:\+\+)?|Word|Excel|PowerPoint|Antigravity)$/i, '').trim();

  if (!cleaned || cleaned.toLowerCase() === appName.toLowerCase()) {
    return `${appName} Focus`;
  }
  return cleaned;
}
