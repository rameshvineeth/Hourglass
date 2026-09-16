/**
 * Domain: Smart Allocate Matcher
 * Provides:
 * 1. Fingerprint caching persisted in localStorage
 * 2. History-based pre-fill from previously logged time entries
 * 3. Fast offline matching before invoking AI
 */

import { ActivityItem } from '../types/activity';
import { Client, Project } from '../types/client-project';
import { TimeEntry } from '../types/time-entry';
import { AppSessionGroup, cleanTaskDescription } from './timeline-layout';
import { ClassificationResult } from './groq-classifier';

export const SMART_ALLOCATE_CACHE_KEY = 'hourglass_smart_allocate_cache_v2';

export interface CachedAllocation {
  clientId: string;
  projectId: string;
  clientName: string;
  projectName: string;
  taskName?: string;
  notes?: string;
  isBillable: boolean;
  hourlyRate: number;
  confidence: number;
  updatedAt: number;
}

/**
 * Normalizes an app name and window title into a stable lookup fingerprint.
 * Strips common browser window title suffixes so "Dashboard - Google Chrome" matches "Dashboard".
 */
export function createSessionFingerprint(appName: string, title?: string): string {
  const normApp = (appName || '').trim().toLowerCase();
  let normTitle = (title || '').trim().toLowerCase();

  // Strip trailing app suffixes like " - Google Chrome", " — Mozilla Firefox", " - Brave"
  normTitle = normTitle.replace(/\s*[-—–]\s*(google chrome|chrome|firefox|brave|edge|microsoft edge|safari)$/i, '').trim();

  return `${normApp}:::${normTitle}`;
}

/**
 * Retrieves the persisted allocation cache from localStorage.
 */
export function getAllocationCache(): Record<string, CachedAllocation> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(SMART_ALLOCATE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Saves the entire allocation cache to localStorage.
 */
export function saveAllocationCache(cache: Record<string, CachedAllocation>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SMART_ALLOCATE_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

/**
 * Stores or updates a single fingerprint in the persistent allocation cache.
 */
export function updateAllocationCacheItem(
  fingerprint: string,
  item: Omit<CachedAllocation, 'updatedAt'>
): void {
  if (!fingerprint) return;
  const cache = getAllocationCache();
  cache[fingerprint] = {
    ...item,
    updatedAt: Date.now(),
  };
  saveAllocationCache(cache);
}

export interface HistoryIndex {
  byFingerprint: Map<string, { entry: TimeEntry; client: Client; project: Project }>;
  byTitle: Map<string, { entry: TimeEntry; client: Client; project: Project }>;
  byTaskName: Map<string, { entry: TimeEntry; client: Client; project: Project }>;
}

/**
 * Builds an in-memory index from previously logged TimeEntries and ActivityItems.
 * Matches previously confirmed work to avoid calling AI for repeat activities.
 */
export function buildHistoryAllocationIndex(
  existingEntries: TimeEntry[],
  allActivities: ActivityItem[],
  clients: Client[],
  projects: Project[]
): HistoryIndex {
  const byFingerprint = new Map<string, { entry: TimeEntry; client: Client; project: Project }>();
  const byTitle = new Map<string, { entry: TimeEntry; client: Client; project: Project }>();
  const byTaskName = new Map<string, { entry: TimeEntry; client: Client; project: Project }>();

  const activeClientsMap = new Map(clients.filter(c => !c.archived).map(c => [c.id, c]));
  const activeProjectsMap = new Map(projects.filter(p => !p.archived).map(p => [p.id, p]));
  const activityMap = new Map((allActivities || []).map(a => [a.id, a]));

  // Iterate chronologically so newer entries overwrite older ones
  const sortedEntries = [...existingEntries].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  for (const entry of sortedEntries) {
    const client = activeClientsMap.get(entry.clientId);
    const project = activeProjectsMap.get(entry.projectId);
    if (!client || !project) continue;

    const payload = { entry, client, project };

    // 1. Map by taskName
    if (entry.taskName) {
      byTaskName.set(entry.taskName.toLowerCase().trim(), payload);
    }

    // 2. Map by associated activities
    if (entry.sourceActivityIds && entry.sourceActivityIds.length > 0) {
      for (const actId of entry.sourceActivityIds) {
        const act = activityMap.get(actId);
        if (act) {
          const fp = createSessionFingerprint(act.appName, act.windowTitle);
          byFingerprint.set(fp, payload);

          if (act.windowTitle) {
            byTitle.set(act.windowTitle.toLowerCase().trim(), payload);
          }
        }
      }
    }
  }

  return { byFingerprint, byTitle, byTaskName };
}

/**
 * Tries to match an unassigned AppSessionGroup against:
 * 1. Persistent local cache (exact match from prior user confirmation)
 * 2. History index (direct match from previously logged time entries)
 * 
 * Returns ClassificationResult with high confidence (>= 0.85) if matched, or null if novel.
 */
export function matchSessionFromCacheOrHistory(
  session: AppSessionGroup,
  cache: Record<string, CachedAllocation>,
  historyIndex: HistoryIndex,
  clients: Client[],
  projects: Project[]
): ClassificationResult | null {
  const activeClientsMap = new Map(clients.filter(c => !c.archived).map(c => [c.id, c]));
  const activeProjectsMap = new Map(projects.filter(p => !p.archived).map(p => [p.id, p]));

  const primaryFp = createSessionFingerprint(session.appName, session.primaryTitle);

  // 1. Check Persistent Fingerprint Cache (Priority 1)
  const cached = cache[primaryFp];
  if (cached) {
    const client = activeClientsMap.get(cached.clientId);
    const project = activeProjectsMap.get(cached.projectId);
    if (client && project) {
      return {
        activityId: session.id,
        clientId: client.id,
        projectId: project.id,
        clientName: client.name,
        projectName: project.name,
        taskName: cached.taskName || cleanTaskDescription(session.primaryTitle || session.appName, session.appName),
        notes: cached.notes || '',
        isBillable: cached.isBillable !== undefined ? cached.isBillable : project.isBillableDefault,
        hourlyRate: cached.hourlyRate || project.defaultHourlyRate,
        confidence: 1.0,
        needsReview: false,
        reasoning: 'Auto-matched from your previous confirmation.',
      };
    }
  }

  // 2. Check History Index by exact app + primaryTitle fingerprint (Priority 2)
  const histFpMatch = historyIndex.byFingerprint.get(primaryFp);
  if (histFpMatch) {
    const { entry, client, project } = histFpMatch;
    return {
      activityId: session.id,
      clientId: client.id,
      projectId: project.id,
      clientName: client.name,
      projectName: project.name,
      taskName: entry.taskName || cleanTaskDescription(session.primaryTitle || session.appName, session.appName),
      notes: entry.notes || '',
      isBillable: entry.isBillable !== undefined ? entry.isBillable : project.isBillableDefault,
      hourlyRate: entry.hourlyRate || project.defaultHourlyRate,
      confidence: 0.95,
      needsReview: false,
      reasoning: `Pre-filled from previous entry "${entry.taskName || project.name}".`,
    };
  }

  // 3. Check History Index by session tabs (Priority 3)
  if (session.tabs && session.tabs.length > 0) {
    for (const tab of session.tabs) {
      if (!tab.windowTitle) continue;
      const tabFp = createSessionFingerprint(session.appName, tab.windowTitle);
      const tabMatch = historyIndex.byFingerprint.get(tabFp);
      if (tabMatch) {
        const { entry, client, project } = tabMatch;
        return {
          activityId: session.id,
          clientId: client.id,
          projectId: project.id,
          clientName: client.name,
          projectName: project.name,
          taskName: entry.taskName || cleanTaskDescription(tab.windowTitle, session.appName),
          notes: entry.notes || '',
          isBillable: entry.isBillable !== undefined ? entry.isBillable : project.isBillableDefault,
          hourlyRate: entry.hourlyRate || project.defaultHourlyRate,
          confidence: 0.90,
          needsReview: false,
          reasoning: `Pre-filled from tab history "${tab.windowTitle}".`,
        };
      }
    }
  }

  // 4. Check History Index by task name matching primaryTitle (Priority 4)
  const cleanTitle = (session.primaryTitle || '').toLowerCase().trim();
  if (cleanTitle) {
    const taskMatch = historyIndex.byTaskName.get(cleanTitle);
    if (taskMatch) {
      const { entry, client, project } = taskMatch;
      return {
        activityId: session.id,
        clientId: client.id,
        projectId: project.id,
        clientName: client.name,
        projectName: project.name,
        taskName: entry.taskName,
        notes: entry.notes || '',
        isBillable: entry.isBillable !== undefined ? entry.isBillable : project.isBillableDefault,
        hourlyRate: entry.hourlyRate || project.defaultHourlyRate,
        confidence: 0.88,
        needsReview: false,
        reasoning: `Pre-filled from matching task "${entry.taskName}".`,
      };
    }
  }

  return null;
}
