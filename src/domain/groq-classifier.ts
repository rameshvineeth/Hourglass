/**
 * Domain Logic: Groq AI & Heuristic Classifier for Consultant Activities
 * Analyzes raw activity titles, document names, and apps to predict client/project assignments.
 * Flags predictions with lower confidence (< 0.85) for user review.
 */

import { ActivityItem } from '../types/activity';
import { Client, Project } from '../types/client-project';
import { TimeEntryDraft } from '../types/time-entry';
import { roundDurationMinutes } from './time-calculations';

export interface ClassificationResult {
  activityId: string;
  clientId: string;
  projectId: string;
  clientName: string;
  projectName: string;
  taskName: string;
  notes: string;
  isBillable: boolean;
  hourlyRate: number;
  confidence: number; // 0.0 to 1.0
  needsReview: boolean; // True if confidence < 0.85 or ambiguous match
  reasoning: string;
}

/**
 * High-performance local heuristic classifier.
 * Matches client names, project codes, document patterns, and application contexts.
 * Serves as zero-latency offline engine or fallback for Groq API.
 */
export function classifyActivityHeuristic(
  activity: ActivityItem,
  clients: Client[],
  projects: Project[]
): ClassificationResult {
  clients = clients.filter(c => !c.archived);
  projects = projects.filter(p => !p.archived);
  const rawText = `${activity.appName} ${activity.windowTitle}`.toLowerCase();
  // Replace underscores, dashes, dots with spaces so snake_case / kebab-case filenames tokenize cleanly
  const textToScan = rawText.replace(/[^a-z0-9]/g, ' ');

  let bestClient: Client | null = null;
  let bestProject: Project | null = null;
  let bestScore = 0;
  let reasoning = 'No explicit client matches found; classified as internal/general.';

  // Helper for whole-word matching
  const containsWord = (text: string, word: string) => {
    const cleanWord = word.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    if (!cleanWord) return false;
    const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  };

  // 1. Scan for client matches
  for (const client of clients) {
    const clientNameLower = client.name.toLowerCase();
    const clientCodeLower = client.code.toLowerCase();

    // Exact word or code match gives high score
    if (clientCodeLower && containsWord(textToScan, clientCodeLower)) {
      bestClient = client;
      bestScore = 0.95;
      reasoning = `Direct match on client code [${client.code}].`;
      break;
    } else if (clientNameLower && textToScan.includes(clientNameLower)) {
      bestClient = client;
      bestScore = 0.90;
      reasoning = `Found client name "${client.name}" in window/document title.`;
      break;
    }
  }

  // 2. Scan projects
  if (bestClient) {
    const clientProjects = projects.filter(p => p.clientId === bestClient?.id);
    for (const proj of clientProjects) {
      const projNameLower = proj.name.toLowerCase();
      const projCodeLower = proj.code.toLowerCase();

      // Check full code or full name
      if (projCodeLower && containsWord(textToScan, projCodeLower)) {
        bestProject = proj;
        bestScore = Math.min(1.0, bestScore + 0.05);
        reasoning += ` Matched project code [${proj.code}].`;
        break;
      } else if (projNameLower && textToScan.includes(projNameLower)) {
        bestProject = proj;
        bestScore = Math.min(1.0, bestScore + 0.05);
        reasoning += ` Matched project name "${proj.name}".`;
        break;
      }

      // Check custom AI auto-match keywords defined in Project Details
      if (proj.keywords && proj.keywords.length > 0) {
        const matchedKw = proj.keywords.find(kw => kw.trim() && (containsWord(textToScan, kw) || textToScan.includes(kw.toLowerCase().trim())));
        if (matchedKw) {
          bestProject = proj;
          bestScore = Math.min(1.0, bestScore + 0.08);
          reasoning += ` Matched engagement keyword "${matchedKw}" in project "${proj.name}".`;
          break;
        }
      }

      // Check individual significant words in project name (e.g. "valuation", "compliance")
      const projWords = projNameLower.split(/\s+/).filter(w => w.length > 3);
      const matchedWord = projWords.find(w => textToScan.includes(w));
      if (matchedWord) {
        bestProject = proj;
        bestScore = Math.min(1.0, bestScore + 0.04);
        reasoning += ` Matched keyword "${matchedWord}" in project "${proj.name}".`;
        break;
      }
    }

    // Default to first project for this client if none explicitly matched
    if (!bestProject && clientProjects.length > 0) {
      bestProject = clientProjects.length === 1 ? clientProjects[0] : null;
      // Since client is confirmed, confidence remains high (0.88)
      bestScore = bestProject ? bestScore : 0.5;
      reasoning += ` Assigned to primary engagement for ${bestClient.name}.`;
    }
  } else {
    // If no client matched, check all projects for project codes, names, or custom keywords
    for (const proj of projects) {
      const projCodeLower = proj.code.toLowerCase();
      const projNameLower = proj.name.toLowerCase();

      if (projCodeLower && containsWord(textToScan, projCodeLower)) {
        bestProject = proj;
        bestClient = clients.find(c => c.id === proj.clientId) || null;
        bestScore = 0.92;
        reasoning = `Matched project code [${proj.code}].`;
        break;
      }
      if (projNameLower && textToScan.includes(projNameLower)) {
        bestProject = proj;
        bestClient = clients.find(c => c.id === proj.clientId) || null;
        bestScore = 0.88;
        reasoning = `Matched project name "${proj.name}".`;
        break;
      }
      if (proj.keywords && proj.keywords.length > 0) {
        const matchedKw = proj.keywords.find(kw => kw.trim() && (containsWord(textToScan, kw) || textToScan.includes(kw.toLowerCase().trim())));
        if (matchedKw) {
          bestProject = proj;
          bestClient = clients.find(c => c.id === proj.clientId) || null;
          bestScore = 0.90;
          reasoning = `Matched engagement keyword "${matchedKw}" for project "${proj.name}".`;
          break;
        }
      }
    }
  }

  // Detect non-billable indicators using whole-word boundary
  const internalKeywords = ['internal', 'hr', 'all-hands', 'firm sync', 'mentorship', 'timesheet', 'lunch', 'break', 'admin'];
  const isInternal = internalKeywords.some(kw => containsWord(textToScan, kw));
  if (isInternal) {
    bestScore = Math.max(bestScore, 0.90);
    reasoning = 'Identified internal firm / administrative activity.';
  }

  // Generate sensible task description from window title
  let cleanTask = activity.windowTitle
    .replace(/\.[a-zA-Z0-9]+$/, '') // strip extension
    .replace(/^Microsoft (Excel|Word|PowerPoint) - /, '')
    .trim();

  if (!cleanTask || cleanTask.length < 3) {
    cleanTask = `${activity.appName} Session`;
  }

  const isBillable = !isInternal && (bestProject ? bestProject.isBillableDefault : true);
  const hourlyRate = bestProject ? bestProject.defaultHourlyRate : 250;
  const needsReview = !bestClient || !bestProject || bestScore < 0.85;

  return {
    activityId: activity.id,
    clientId: bestClient?.id || '',
    projectId: bestProject?.id || '',
    clientName: bestClient?.name || 'Unassigned / Internal',
    projectName: bestProject?.name || 'General Consulting',
    taskName: cleanTask,
    notes: `Captured from ${activity.appName}: "${activity.windowTitle}". (${reasoning})`,
    isBillable,
    hourlyRate,
    confidence: Number(bestScore.toFixed(2)),
    needsReview,
    reasoning,
  };
}

/**
 * Builds the Groq LLM prompt payload for batch classification.
 */
export function buildGroqClassificationPrompt(
  activities: ActivityItem[],
  clients: Client[],
  projects: Project[]
): string {
  const activeClients = clients.filter(c => !c.archived);
  const clientsContext = activeClients.map(c => ({
    id: c.id,
    name: c.name,
    code: c.code,
    projects: projects.filter(p => p.clientId === c.id && !p.archived).map(p => ({
      id: p.id,
      name: p.name,
      code: p.code,
      rate: p.defaultHourlyRate,
      isBillable: p.isBillableDefault,
      role: p.engagementRole,
      keywords: p.keywords,
    })),
  }));

  const activitiesSummary = activities.map(a => ({
    id: a.id,
    app: a.appName,
    title: a.windowTitle,
    durationMinutes: Math.round(a.durationSeconds / 60),
    time: `${a.startTime} - ${a.endTime}`,
  }));

  return `You are Hourglass AI, an intelligent time intelligence system for elite management consultants.
Your job is to examine raw desktop activity logs and match them against the consultant's active clients and projects.

CLIENT & PROJECT CATALOG:
${JSON.stringify(clientsContext, null, 2)}

RAW ACTIVITY STREAM TO CLASSIFY:
${JSON.stringify(activitiesSummary, null, 2)}

INSTRUCTIONS:
1. For each activity, determine the most likely client and project based on window titles, file names, email subjects, or project codes.
2. Provide a confidence score between 0.00 and 1.00.
3. If confidence is below 0.85, or if ambiguous, set "needsReview": true.
4. Output STRICT JSON format matching the schema below without conversational text or markdown fences.

OUTPUT SCHEMA:
[
  {
    "activityId": "string",
    "clientId": "string",
    "projectId": "string",
    "taskName": "Clean task title (e.g. M&A Financial Valuation Model)",
    "notes": "Professional summary of work performed",
    "isBillable": boolean,
    "confidence": number,
    "needsReview": boolean,
    "reasoning": "Brief justification"
  }
]`;
}

/**
 * Converts a classified result into a ready-to-save TimeEntryDraft.
 */
export function classificationToEntryDraft(
  activity: ActivityItem,
  classification: ClassificationResult,
  dateStr: string
): TimeEntryDraft {
  const durationMins = Math.max(1, Math.round(activity.durationSeconds / 60));
  const { roundedMinutes } = roundDurationMinutes(durationMins, 'tenth_hour');

  return {
    date: dateStr,
    startTime: activity.startTime,
    endTime: activity.endTime,
    durationMinutes: roundedMinutes,
    clientId: classification.clientId,
    projectId: classification.projectId,
    taskName: classification.taskName,
    notes: classification.notes,
    isBillable: classification.isBillable,
    hourlyRate: classification.hourlyRate,
    sourceActivityIds: [activity.id],
    aiSuggested: true,
    needsReview: classification.needsReview,
  };
}
