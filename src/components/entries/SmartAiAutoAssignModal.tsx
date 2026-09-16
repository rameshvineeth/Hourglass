import React, { useState, useMemo, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ActivityItem } from '../../types/activity';
import { Client, Project } from '../../types/client-project';
import { TimeEntry, TimeEntryDraft, RoundingMode } from '../../types/time-entry';
import { TimesheetPeriod } from '../../types/timesheet';
import { ClassificationResult } from '../../domain/groq-classifier';
import { AiService } from '../../services/ai-service';
import { roundDurationMinutes, formatCurrency } from '../../domain/time-calculations';
import { AppSessionGroup, groupActivitiesByAppSession, cleanTaskDescription, cleanEntryNotes } from '../../domain/timeline-layout';
import { auditActivities, workstreamsToSessionGroups, isSystemLockOrNoiseActivity } from '../../domain/activity-audit';
import { availableRanges } from '../../domain/workflow';
import { getRecentDays, generateDateRange } from '../../domain/calendar';
import { 
  createSessionFingerprint,
  getAllocationCache,
  updateAllocationCacheItem,
  buildHistoryAllocationIndex,
  matchSessionFromCacheOrHistory
} from '../../domain/smart-allocate-matcher';
import { BrandIcon } from '../ui/BrandIcon';
import { 
  Wand2, 
  CheckCircle, 
  CheckCheck, 
  DollarSign, 
  Clock,
  Edit3,
  CalendarDays,
  Lock,
  Filter
} from 'lucide-react';

export type SmartAllocateScope = 'today' | '3days' | '7days' | 'custom';

interface SmartAiAutoAssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  unassignedSessions?: AppSessionGroup[];
  unassignedActivities?: ActivityItem[];
  allActivities?: ActivityItem[];
  existingEntries?: TimeEntry[];
  periods?: TimesheetPeriod[];
  clients: Client[];
  projects: Project[];
  groqApiKey?: string;
  activeDate: string;
  roundingMode: RoundingMode;
  activityViewMode?: 'app' | 'document' | 'timeline';
  auditGroupByApp?: boolean;
  onBatchLogEntries: (entries: TimeEntryDraft[]) => boolean | Promise<boolean>;
}

export const SmartAiAutoAssignModal: React.FC<SmartAiAutoAssignModalProps> = ({
  isOpen,
  onClose,
  unassignedSessions,
  unassignedActivities = [],
  allActivities = [],
  existingEntries = [],
  periods = [],
  clients,
  projects,
  groqApiKey,
  activeDate,
  roundingMode,
  activityViewMode = 'document',
  auditGroupByApp = false,
  onBatchLogEntries,
}) => {
  const [scope, setScope] = useState<SmartAllocateScope>('today');
  const [customStartDate, setCustomStartDate] = useState(activeDate);
  const [customEndDate, setCustomEndDate] = useState(activeDate);
  const [selectedDayFilter, setSelectedDayFilter] = useState<'all' | string>('all');
  const [consent, setConsent] = useState(true);
  const [error, setError] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [predictions, setPredictions] = useState<ClassificationResult[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);

  // Active unarchived clients and projects matching the Client Details view
  const activeClients = useMemo(() => clients.filter(c => !c.archived), [clients]);
  const activeProjects = useMemo(() => projects.filter(p => !p.archived && activeClients.some(c => c.id === p.clientId)), [projects, activeClients]);

  // Compute resolved dates based on selected scope
  const targetDates = useMemo(() => {
    if (scope === 'today') return [activeDate];
    if (scope === '3days') return getRecentDays(activeDate, 3);
    if (scope === '7days') return getRecentDays(activeDate, 7);
    if (scope === 'custom') return generateDateRange(customStartDate, customEndDate);
    return [activeDate];
  }, [scope, activeDate, customStartDate, customEndDate]);

  // Identify locked dates (belonging to finalized/submitted periods)
  const lockedDatesSet = useMemo(() => {
    if (!periods || periods.length === 0) return new Set<string>();
    const locked = new Set<string>();
    for (const d of targetDates) {
      if (periods.some(p => p.status !== 'draft' && p.status !== 'rejected' && d >= p.startDate && d <= p.endDate)) {
        locked.add(d);
      }
    }
    return locked;
  }, [targetDates, periods]);

  const activeNonLockedDates = useMemo(() => {
    return targetDates.filter(d => !lockedDatesSet.has(d));
  }, [targetDates, lockedDatesSet]);

  // Reset predictions and day filter when scope or date range changes
  useEffect(() => {
    setPredictions([]);
    setHasRun(false);
    setSelectedDayFilter('all');
    setError('');
  }, [scope, customStartDate, customEndDate]);

  // Resolve unassigned sessions across the selected date range
  const sessions: AppSessionGroup[] = useMemo(() => {
    // If scope is 'today' and caller provided unassignedSessions, preserve exact view
    if (scope === 'today' && unassignedSessions && unassignedSessions.length > 0) {
      return unassignedSessions.map(s => ({
        ...s,
        date: s.date || activeDate,
      }));
    }

    const activityPool = allActivities && allActivities.length > 0 ? allActivities : unassignedActivities;
    if (!activityPool || activityPool.length === 0) return [];

    const isAppMode = activityViewMode === 'app' || auditGroupByApp;
    const isDocMode = activityViewMode === 'document';
    const allGroups: AppSessionGroup[] = [];

    for (const d of activeNonLockedDates) {
      const dayActs = activityPool.filter(a => {
        const actDate = a.localDate || a.timestamp.slice(0, 10);
        return (
          actDate === d &&
          !isSystemLockOrNoiseActivity(a) &&
          !a.ignored &&
          a.finalized !== false &&
          !a.legacyDateUncertain &&
          (!(a.isIdle || a.needsReview) || a.reviewed)
        );
      });

      const unassignedDayActs = dayActs.filter(a => availableRanges(a, existingEntries).length > 0);
      if (unassignedDayActs.length === 0) continue;

      if (isDocMode || isAppMode) {
        const report = auditActivities(unassignedDayActs, clients, projects, {
          scope: 'today',
          roundingMode,
          absorbMicroSwitches: true,
          microSwitchThresholdSeconds: 60,
          groupByApp: isAppMode,
        });
        const groups = workstreamsToSessionGroups(report.workstreams).map(s => ({
          ...s,
          date: d,
        }));
        allGroups.push(...groups);
      } else {
        const groups = groupActivitiesByAppSession(unassignedDayActs).map(s => ({
          ...s,
          date: d,
        }));
        allGroups.push(...groups);
      }
    }

    return allGroups;
  }, [
    scope,
    unassignedSessions,
    allActivities,
    unassignedActivities,
    activeNonLockedDates,
    activeDate,
    existingEntries,
    clients,
    projects,
    roundingMode,
    activityViewMode,
    auditGroupByApp,
  ]);

  // Distinct days that actually have unassigned sessions
  const daysWithSessions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      if (s.date) set.add(s.date);
    }
    return Array.from(set).sort();
  }, [sessions]);

  // Filter sessions by selectedDayFilter tab
  const displayedSessions = useMemo(() => {
    if (selectedDayFilter === 'all') return sessions;
    return sessions.filter(s => s.date === selectedDayFilter);
  }, [sessions, selectedDayFilter]);

  const displayedSessionIds = useMemo(() => new Set(displayedSessions.map(s => s.id)), [displayedSessions]);

  // Deduplicated AI Analysis: Check Cache & History pre-fill first, then classify remaining novel items with AI
  const runAiAnalysis = async () => {
    setIsAnalyzing(true);
    setError('');
    try {
      // 1. Group sessions by unique fingerprint across all days
      const uniqueSessionMap = new Map<string, AppSessionGroup>();
      const sessionFingerprintMap = new Map<string, string>();

      for (const s of sessions) {
        const fingerprint = createSessionFingerprint(s.appName, s.primaryTitle);
        sessionFingerprintMap.set(s.id, fingerprint);
        if (!uniqueSessionMap.has(fingerprint)) {
          uniqueSessionMap.set(fingerprint, s);
        }
      }

      const uniqueSessions = Array.from(uniqueSessionMap.values());

      // 2. Load persistent cache & build history index from past logged entries
      const cache = getAllocationCache();
      const historyIndex = buildHistoryAllocationIndex(existingEntries, allActivities, activeClients, activeProjects);

      const resultByFingerprint = new Map<string, ClassificationResult>();
      const sessionsNeedingAi: AppSessionGroup[] = [];

      // Try pre-filling from cache & history (0ms, 0 tokens)
      for (const s of uniqueSessions) {
        const fp = sessionFingerprintMap.get(s.id) || createSessionFingerprint(s.appName, s.primaryTitle);
        const prefilled = matchSessionFromCacheOrHistory(s, cache, historyIndex, activeClients, activeProjects);
        if (prefilled) {
          resultByFingerprint.set(fp, prefilled);
        } else {
          sessionsNeedingAi.push(s);
        }
      }

      // 3. Classify ONLY remaining novel sessions (if any exist)
      if (sessionsNeedingAi.length > 0) {
        if (groqApiKey && !consent) {
          setError('Please allow context sharing above to run AI classification for new activities.');
          setIsAnalyzing(false);
          return;
        }

        const aiResults = await AiService.classifySessions(
          sessionsNeedingAi,
          activeClients,
          activeProjects,
          groqApiKey
        );

        for (const res of aiResults) {
          const orig = sessionsNeedingAi.find(s => s.id === res.activityId);
          if (orig) {
            const fp = sessionFingerprintMap.get(orig.id) || createSessionFingerprint(orig.appName, orig.primaryTitle);
            resultByFingerprint.set(fp, res);
          }
        }
      }

      // 4. Propagate predictions back to EVERY daily session instance
      const propagatedResults: ClassificationResult[] = sessions.map(s => {
        const fingerprint = sessionFingerprintMap.get(s.id) || '';
        const matched = resultByFingerprint.get(fingerprint);
        if (matched) {
          return {
            ...matched,
            activityId: s.id, // target this individual daily session
          };
        }
        return {
          activityId: s.id,
          clientId: '',
          projectId: '',
          clientName: 'Unassigned',
          projectName: 'Review Needed',
          taskName: cleanTaskDescription(s.primaryTitle || s.appName, s.appName),
          notes: '',
          isBillable: true,
          hourlyRate: 250,
          confidence: 0,
          needsReview: true,
          reasoning: 'Review this session.',
        };
      });

      setPredictions(propagatedResults);
      setHasRun(true);
    } catch (err) {
      console.error('Smart Allocate analysis failed:', err);
      setError('Smart classification encountered an issue. Check your connection or retry.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Auto-run analysis when modal opens or when scope changes
  useEffect(() => {
    if (isOpen && !hasRun && !isAnalyzing && sessions.length > 0) {
      runAiAnalysis();
    }
  }, [isOpen, hasRun, isAnalyzing, sessions.length]);

  // Clean reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPredictions([]);
      setHasRun(false);
      setSelectedDayFilter('all');
      setError('');
    }
  }, [isOpen]);

  // Step 1: Change Client — updates client without prematurely auto-locking or closing the card
  const handleClientChange = (activityId: string, newClientId: string) => {
    setPredictions(prev => prev.map(p => {
      if (p.activityId !== activityId) return p;
      const client = activeClients.find(c => c.id === newClientId);
      const clientProjs = activeProjects.filter(proj => proj.clientId === newClientId);
      // Keep existing project if it already belongs to this client, otherwise leave empty so user can choose project
      const currentProjValid = clientProjs.find(proj => proj.id === p.projectId);

      return {
        ...p,
        clientId: newClientId,
        projectId: currentProjValid ? currentProjValid.id : '',
        clientName: client?.name || 'Unassigned',
        projectName: currentProjValid ? currentProjValid.name : '',
        hourlyRate: currentProjValid ? currentProjValid.defaultHourlyRate : (p.hourlyRate || 250),
        isBillable: currentProjValid ? currentProjValid.isBillableDefault : true,
        // Crucial: keep in review so consultant can select their intended project!
        needsReview: true,
        reasoning: `Client assigned to ${client?.name || newClientId}. Choose project.`,
      };
    }));
  };

  // Step 2: Change Project — explicitly selected by the consultant
  const handleProjectChange = (activityId: string, newProjectId: string) => {
    setPredictions(prev => prev.map(p => {
      if (p.activityId !== activityId) return p;
      const project = activeProjects.find(proj => proj.id === newProjectId);
      if (!project) return p;
      const client = activeClients.find(c => c.id === project.clientId);

      // Persist manual project assignment to cache for future auto-allocation
      const session = sessions.find(s => s.id === activityId);
      if (session && client) {
        const fp = createSessionFingerprint(session.appName, session.primaryTitle);
        updateAllocationCacheItem(fp, {
          clientId: project.clientId,
          projectId: project.id,
          clientName: client.name,
          projectName: project.name,
          taskName: p.taskName,
          isBillable: project.isBillableDefault,
          hourlyRate: project.defaultHourlyRate,
          confidence: 1.0,
        });
      }

      return {
        ...p,
        clientId: project.clientId,
        projectId: project.id,
        clientName: client?.name || p.clientName,
        projectName: project.name,
        hourlyRate: project.defaultHourlyRate,
        isBillable: project.isBillableDefault,
        needsReview: false,
        confidence: 1.0,
        reasoning: 'Verified by consultant.',
      };
      return p;
    }));
  };

  // Accept all high-confidence suggestions
  const handleAcceptAll = () => {
    setPredictions(prev => prev.map(p => {
      if (!p.needsReview) return p;
      if (!p.clientId || !p.projectId) return p;
      return {
        ...p,
        needsReview: false,
        confidence: 1.0,
        reasoning: 'Accepted high confidence.',
      };
    }));
  };

  const displayedPredictions = useMemo(() => {
    return predictions.filter(p => displayedSessionIds.has(p.activityId));
  }, [predictions, displayedSessionIds]);

  const highConfidenceList = displayedPredictions.filter(p => !p.needsReview);
  const reviewNeededList = displayedPredictions.filter(p => p.needsReview);

  // Entries that have a valid client and project selected
  const assignableEntries = useMemo(() => {
    return predictions.filter(p => 
      Boolean(p.clientId) && 
      Boolean(p.projectId) && 
      activeClients.some(c => c.id === p.clientId) && 
      activeProjects.some(proj => proj.id === p.projectId && proj.clientId === p.clientId)
    );
  }, [predictions, activeClients, activeProjects]);

  // Convert assigned predictions to consolidated draft entries with date preservation
  const handleLogApproved = async () => {
    setError('');
    const targets = assignableEntries;
    
    if (targets.length === 0) {
      setError('Please select a Client and Project for at least one item before logging.');
      return;
    }

    const drafts: TimeEntryDraft[] = targets.map(p => {
      const session = sessions.find(s => s.id === p.activityId)!;
      const rawMins = session.durationSeconds / 60;
      const { roundedMinutes } = roundDurationMinutes(rawMins, roundingMode);
      const entryDate = session.date || session.activities[0]?.localDate || session.activities[0]?.timestamp?.slice(0, 10) || activeDate;

      return {
        date: entryDate,
        startTime: session.startTime,
        endTime: session.endTime,
        durationMinutes: roundedMinutes,
        clientId: p.clientId,
        projectId: p.projectId,
        taskName: cleanTaskDescription(p.taskName || session.appName, session.appName),
        notes: cleanEntryNotes(p.notes, p.taskName, session.appName),
        isBillable: p.isBillable,
        hourlyRate: p.hourlyRate,
        sourceActivityIds: session.activities.map(a => a.id),
        aiSuggested: true,
        needsReview: false,
        actualDurationSeconds: session.durationSeconds,
        allocations: session.activities.flatMap(a => availableRanges(a, existingEntries)),
      };
    });

    if (await onBatchLogEntries(drafts)) {
      // Persist all approved assignments into cache for future instant auto-allocation
      for (const p of targets) {
        const session = sessions.find(s => s.id === p.activityId);
        if (session && p.clientId && p.projectId) {
          const fp = createSessionFingerprint(session.appName, session.primaryTitle);
          updateAllocationCacheItem(fp, {
            clientId: p.clientId,
            projectId: p.projectId,
            clientName: p.clientName,
            projectName: p.projectName,
            taskName: p.taskName,
            isBillable: p.isBillable,
            hourlyRate: p.hourlyRate,
            confidence: 1.0,
          });
        }
      }
      onClose();
    } else {
      setError('The entries could not be saved. Review the workspace message.');
    }
  };

  // Calculate potential recovered revenue
  const totalRecoveredMinutes = sessions.reduce(
    (acc, s) => acc + Math.max(1, Math.round(s.durationSeconds / 60)), 
    0
  );
  const { decimalHours: totalRecoveredHours } = roundDurationMinutes(totalRecoveredMinutes, roundingMode);
  const estimatedRevenue = predictions.reduce((acc, p) => {
    const session = sessions.find(s => s.id === p.activityId);
    if (!session || !p.isBillable) return acc;
    const { decimalHours } = roundDurationMinutes(Math.round(session.durationSeconds / 60), roundingMode);
    return acc + (decimalHours * p.hourlyRate);
  }, 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Smart Allocate"
      subtitle="AI scans raw window titles, documents, and client codes to predict billable assignments."
      maxWidth="3xl"
    >
      <div className="space-y-6">
        {error && <p role="alert" className="text-red-700 text-xs bg-red-50 p-2.5 rounded-lg border border-red-200">{error}</p>}

        {/* Allocation Scope Selector */}
        <div className="p-3 bg-slate-50/90 rounded-xl border border-slate-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <CalendarDays className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Scope:</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'today', label: 'Today' },
              { id: '3days', label: 'Past 3 Days' },
              { id: '7days', label: 'Past 7 Days' },
              { id: 'custom', label: 'Custom Range' },
            ].map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setScope(item.id as SmartAllocateScope)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  scope === item.id
                    ? 'bg-blue-600 text-white shadow-2xs font-semibold'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Range Picker */}
        {scope === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 bg-white p-2.5 rounded-xl border border-slate-200">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-slate-700">From:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-slate-700">To:</span>
              <input
                type="date"
                value={customEndDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <span className="text-[11px] text-slate-400">
              ({targetDates.length} calendar {targetDates.length === 1 ? 'day' : 'days'})
            </span>
          </div>
        )}

        {/* Locked Periods Safety Notice */}
        {lockedDatesSet.size > 0 && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
            <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>
              {lockedDatesSet.size === 1
                ? `1 day in this range (${Array.from(lockedDatesSet)[0]}) is in a finalized timesheet and is locked.`
                : `${lockedDatesSet.size} days in this range are in finalized timesheets and are locked.`}
              {' '}Activities from finalized periods are safely excluded from modification.
            </span>
          </div>
        )}

        {groqApiKey && (
          <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-3 text-xs text-slate-700 shadow-2xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    if (e.target.checked) setError('');
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span className="font-medium text-slate-700">
                  Include window titles & document context for AI matching
                </span>
              </label>

              <details className="text-[11px] text-slate-500">
                <summary className="cursor-pointer hover:text-slate-800 transition-colors font-medium select-none">
                  Preview payload ({sessions.length} session{sessions.length === 1 ? '' : 's'})
                </summary>
                <div className="mt-2 p-2.5 rounded-lg bg-white border border-slate-200/90 max-h-36 overflow-y-auto space-y-1">
                  <div className="font-semibold text-slate-700 text-[11px] mb-1">Sessions sent for matching:</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-600 font-mono text-[10px]">
                    {sessions.map(s => (
                      <li key={s.id}>
                        {s.date && <span className="font-bold text-slate-600">[{s.date}] </span>}
                        <span className="font-semibold text-slate-800">{s.appName}</span>: {s.primaryTitle} {s.tabCount > 1 ? `(${s.tabCount} ${s.tabNoun})` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </div>
          </div>
        )}

        {/* Banner with stats */}
        <div className="p-3.5 rounded-xl bg-violet-50/70 border border-violet-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white shadow-xs">
              <Wand2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <span>{sessions.length} Unassigned Session{sessions.length === 1 ? '' : 's'}</span>
                {daysWithSessions.length > 1 && (
                  <span className="text-xs text-slate-500 font-normal">
                    across {daysWithSessions.length} days
                  </span>
                )}
                <Badge variant="sky" size="sm">
                  {groqApiKey ? 'AI Connected' : 'Heuristic Engine'}
                </Badge>
              </div>
              <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-3 font-mono">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-violet-600" />
                  {totalRecoveredHours}h total captured
                </span>
                {estimatedRevenue > 0 && (
                  <span className="flex items-center gap-1 text-emerald-700 font-medium">
                    <DollarSign className="w-3.5 h-3.5" />
                    ~{formatCurrency(estimatedRevenue)} billable revenue
                  </span>
                )}
              </div>
            </div>
          </div>

          {hasRun && (
            <Button
              onClick={runAiAnalysis}
              isLoading={isAnalyzing}
              variant="outline"
              size="sm"
              icon={<Wand2 className="w-3.5 h-3.5" />}
            >
              Re-run Analysis
            </Button>
          )}
        </div>

        {/* Day Filter Tabs (when sessions span multiple days) */}
        {daysWithSessions.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <span className="text-slate-500 font-medium shrink-0 flex items-center gap-1 text-[11px]">
              <Filter className="w-3 h-3 text-slate-400" /> Filter day:
            </span>
            <button
              type="button"
              onClick={() => setSelectedDayFilter('all')}
              className={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                selectedDayFilter === 'all'
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Days ({sessions.length})
            </button>
            {daysWithSessions.map(d => {
              const count = sessions.filter(s => s.date === d).length;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelectedDayFilter(d)}
                  className={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                    selectedDayFilter === d
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {d} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Not run state */}
        {!hasRun && !isAnalyzing && (
          <div className="text-center py-8 px-4 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            <div className="w-10 h-10 rounded-full bg-violet-100/70 text-violet-600 flex items-center justify-center mx-auto mb-3">
              <Wand2 className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">
              {sessions.length > 0 
                ? `Ready to automatically assign ${sessions.length} session${sessions.length === 1 ? '' : 's'}` 
                : 'No unassigned activities found'}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              {sessions.length > 0
                ? 'Hourglass will scan window titles, documents, and client codes to predict billable assignments. High-confidence items will be prepared for 1-click logging, and ambiguous entries will be flagged for your review.'
                : 'All activities in this date range have already been assigned or this range contains no captured history.'}
            </p>
            {sessions.length > 0 && (
              <Button
                onClick={runAiAnalysis}
                variant="primary"
                size="md"
                className="mt-4 shadow-sm"
                icon={<Wand2 className="w-4 h-4" />}
              >
                Start Smart Allocate
              </Button>
            )}
          </div>
        )}

        {/* Loading state */}
        {isAnalyzing && (
          <div className="text-center py-10">
            <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-slate-900">Classifying captured activities...</h3>
            <p className="text-xs text-slate-500 mt-1">Matching window titles and files to your active client projects.</p>
          </div>
        )}

        {/* Results List */}
        {hasRun && !isAnalyzing && (
          <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
            {/* Section 1: Needs Client Assignment */}
            {reviewNeededList.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                    Review Needed ({reviewNeededList.length})
                  </h4>
                  {reviewNeededList.some(p => p.clientId && p.projectId) && (
                    <button
                      type="button"
                      onClick={handleAcceptAll}
                      className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-medium"
                    >
                      Accept all matched
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {reviewNeededList.map((item) => {
                    const session = sessions.find(s => s.id === item.activityId);
                    if (!session) return null;
                    const { decimalHours } = roundDurationMinutes(Math.round(session.durationSeconds / 60), roundingMode);

                    return (
                      <div
                        key={item.activityId}
                        className="p-3.5 rounded-xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all space-y-2.5 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200/90 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                              <BrandIcon appName={session.appName} appIcon={session.appIcon} className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {session.date && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200/80">
                                    {session.date}
                                  </span>
                                )}
                                <span className="text-xs font-mono text-slate-500">{session.startTime} - {session.endTime}</span>
                                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                                  {session.appName}
                                </span>
                                {session.tabCount > 1 && (
                                  <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                    {session.tabCount} {session.tabNoun}
                                  </span>
                                )}
                                <span className="text-[10px] px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                  {item.confidence > 0 ? `Partial Match (${Math.round(item.confidence * 100)}%)` : 'Unassigned'}
                                </span>
                              </div>
                              <div className="text-sm font-semibold text-slate-900 mt-1 truncate">
                                {cleanTaskDescription(item.taskName || session.appName, session.appName)}
                              </div>
                              {session.primaryTitle && session.primaryTitle.toLowerCase() !== session.appName.toLowerCase() && (
                                <div className="text-xs text-slate-500 font-mono mt-0.5 truncate">
                                  {session.primaryTitle}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-xs font-mono text-slate-900 font-bold">{decimalHours}h</div>
                            <div className="text-xs font-mono text-emerald-700 font-semibold">
                              {formatCurrency(decimalHours * item.hourlyRate)}
                            </div>
                          </div>
                        </div>

                        {/* Quick assignment dropdown for review item */}
                        <div className="pt-2.5 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <div className="flex items-center gap-1.5 grow min-w-0">
                            <span className="text-[11px] font-semibold text-slate-600 shrink-0">Client:</span>
                            <select
                              value={item.clientId}
                              onChange={(e) => handleClientChange(item.activityId, e.target.value)}
                              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium text-slate-800"
                            >
                              <option value="">Select client...</option>
                              {activeClients.map(c => (
                                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1.5 grow min-w-0">
                            <span className="text-[11px] font-semibold text-slate-600 shrink-0">Project:</span>
                            <select
                              value={item.projectId}
                              onChange={(e) => handleProjectChange(item.activityId, e.target.value)}
                              className={`w-full text-xs bg-white border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium ${
                                !item.projectId ? 'border-slate-300 text-slate-500 bg-slate-50/50' : 'border-slate-200 text-slate-800'
                              }`}
                              disabled={!item.clientId}
                            >
                              <option value="" disabled>
                                {item.clientId ? 'Select project...' : 'Select client first'}
                              </option>
                              {activeProjects.filter(p => p.clientId === item.clientId).map(p => (
                                <option key={p.id} value={p.id}>{p.name} (${p.defaultHourlyRate}/hr)</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Section 2: High-Confidence Auto-Assigned (>=85%) */}
            {highConfidenceList.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4" />
                    High-Confidence Predictions ({highConfidenceList.length})
                  </h4>
                  <span className="text-[11px] text-slate-500">
                    Direct match — review or change project anytime
                  </span>
                </div>

                <div className="space-y-2">
                  {highConfidenceList.map(item => {
                    const session = sessions.find(s => s.id === item.activityId);
                    if (!session) return null;
                    const { decimalHours } = roundDurationMinutes(Math.round(session.durationSeconds / 60), roundingMode);
                    const isEditing = editingAssignmentId === item.activityId;

                    return (
                      <div
                        key={item.activityId}
                        className="p-3 rounded-xl bg-white border border-slate-200 hover:border-slate-300 flex flex-col justify-between gap-2.5 shadow-xs transition-all"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200/90 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                              <BrandIcon appName={session.appName} appIcon={session.appIcon} className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {session.date && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200/80">
                                    {session.date}
                                  </span>
                                )}
                                <span className="text-xs font-mono text-slate-500">{session.startTime} - {session.endTime}</span>
                                <Badge variant="emerald" size="sm">
                                  {Math.round(item.confidence * 100)}% Match
                                </Badge>
                                <span className="text-xs font-bold text-slate-900">
                                  {item.clientName}
                                </span>
                                <span className="text-slate-400">›</span>
                                <span className="text-xs text-blue-700 font-semibold">
                                  {item.projectName}
                                </span>
                                {session.tabCount > 1 && (
                                  <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                    {session.tabCount} {session.tabNoun}
                                  </span>
                                )}
                              </div>

                              <div className="text-sm text-slate-900 font-semibold truncate mt-1">
                                {cleanTaskDescription(item.taskName || session.appName, session.appName)}
                              </div>
                              {session.primaryTitle && session.primaryTitle.toLowerCase() !== session.appName.toLowerCase() && (
                                <div className="text-xs text-slate-500 font-mono truncate">
                                  {session.primaryTitle}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0 flex flex-col items-end justify-between self-stretch">
                            <div className="font-mono">
                              <div className="text-xs text-slate-900 font-bold">{decimalHours}h</div>
                              <div className="text-xs text-emerald-700 font-semibold">
                                {formatCurrency(decimalHours * item.hourlyRate)}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => setEditingAssignmentId(isEditing ? null : item.activityId)}
                              className="text-[10.5px] font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer flex items-center gap-1 mt-2"
                              title="Change client or project assignment"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>{isEditing ? 'Done' : 'Change project'}</span>
                            </button>
                          </div>
                        </div>

                        {/* Inline assignment editor for High Confidence cards */}
                        {isEditing && (
                          <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-slate-50/70 p-2 rounded-lg">
                            <div className="flex items-center gap-1.5 grow min-w-0">
                              <span className="text-[11px] font-semibold text-slate-600 shrink-0">Client:</span>
                              <select
                                value={item.clientId}
                                onChange={(e) => handleClientChange(item.activityId, e.target.value)}
                                className="glass-input text-xs py-1 grow bg-white min-w-0"
                              >
                                {activeClients.map(c => (
                                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                                ))}
                              </select>
                            </div>

                            <div className="flex items-center gap-1.5 grow min-w-0">
                              <span className="text-[11px] font-semibold text-slate-600 shrink-0">Project:</span>
                              <select
                                value={item.projectId}
                                onChange={(e) => handleProjectChange(item.activityId, e.target.value)}
                                className="glass-input text-xs py-1 grow bg-white min-w-0"
                                disabled={!item.clientId}
                              >
                                <option value="" disabled>Select project...</option>
                                {activeProjects.filter(p => p.clientId === item.clientId).map(p => (
                                  <option key={p.id} value={p.id}>{p.name} (${p.defaultHourlyRate}/hr)</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        {hasRun && !isAnalyzing && (
          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {assignableEntries.length === predictions.length ? (
                <span className="text-emerald-700 font-medium flex items-center gap-1.5">
                  <CheckCheck className="w-4 h-4 text-emerald-600" />
                  All {predictions.length} activities ready to log
                </span>
              ) : assignableEntries.length > 0 ? (
                <span>
                  <strong className="text-slate-800 font-semibold">{assignableEntries.length}</strong> of {predictions.length} assigned · unassigned items will remain available
                </span>
              ) : (
                <span className="text-slate-500">
                  Select a client and project above to log activities
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleLogApproved}
                disabled={assignableEntries.length === 0}
                icon={<CheckCircle className="w-4 h-4" />}
              >
                {assignableEntries.length === predictions.length
                  ? `Log All ${predictions.length} Entries`
                  : `Log ${assignableEntries.length} Assigned Entr${assignableEntries.length === 1 ? 'y' : 'ies'}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
