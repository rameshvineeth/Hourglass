import React, { useState, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { ActivityItem } from '../../types/activity';
import { Client, Project } from '../../types/client-project';
import { TimeEntryDraft, RoundingMode } from '../../types/time-entry';
import { 
  auditActivities, 
  AuditedWorkstream, 
  createDraftFromWorkstream 
} from '../../domain/activity-audit';
import { weekDates } from '../../domain/calendar';
import { BrandIcon } from '../ui/BrandIcon';
import { 
  ClipboardCheck, 
  CheckCircle2, 
  Clock, 
  ArrowRight, 
  CheckCheck,
  AlertCircle,
  Edit2,
  Calendar
} from 'lucide-react';

interface ActivityAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  activities: ActivityItem[];
  clients: Client[];
  projects: Project[];
  activeDate: string;
  roundingMode: RoundingMode;
  groupByApp?: boolean;
  onBatchLogEntries: (entries: TimeEntryDraft[]) => boolean | Promise<boolean>;
}

export const ActivityAuditModal: React.FC<ActivityAuditModalProps> = ({
  isOpen,
  onClose,
  activities,
  clients,
  projects,
  activeDate,
  roundingMode,
  groupByApp = false,
  onBatchLogEntries,
}) => {
  const [scope, setScope] = useState<'today' | 'week'>('today');
  const [absorbMicroSwitches, setAbsorbMicroSwitches] = useState(true);
  const [activeGroupByApp, setActiveGroupByApp] = useState(groupByApp);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loggedWorkstreamIds, setLoggedWorkstreamIds] = useState<Set<string>>(new Set());
  const [excludedWorkstreamIds, setExcludedWorkstreamIds] = useState<Set<string>>(new Set());

  // Local state for assignments: workstreamId -> { clientId, projectId, taskName }
  const [customAssignments, setCustomAssignments] = useState<Record<string, { clientId: string; projectId: string; taskName: string }>>({});

  // Filter activities dynamically based on selected audit scope
  const scopeFilteredActivities = useMemo(() => {
    if (scope === 'today') {
      return activities.filter(a => (a.localDate || a.timestamp.slice(0, 10)) === activeDate);
    }
    const weekDaysList = weekDates(activeDate);
    const weekSet = new Set(weekDaysList);
    return activities.filter(a => weekSet.has(a.localDate || a.timestamp.slice(0, 10)));
  }, [activities, scope, activeDate]);

  // Generate audit report based on options
  const auditReport = useMemo(() => {
    return auditActivities(scopeFilteredActivities, clients, projects, {
      scope,
      roundingMode,
      absorbMicroSwitches,
      microSwitchThresholdSeconds: 60,
      groupByApp: activeGroupByApp,
    });
  }, [scopeFilteredActivities, clients, projects, scope, roundingMode, absorbMicroSwitches, activeGroupByApp]);

  // Auto-exclude personal/non-billable workstreams by default (e.g. YouTube, Spotify)
  React.useEffect(() => {
    const personalIds = auditReport.workstreams.filter(ws => ws.isPersonal).map(ws => ws.id);
    if (personalIds.length > 0) {
      setExcludedWorkstreamIds(prev => {
        const next = new Set(prev);
        personalIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [auditReport.workstreams]);

  const handleToggleExclude = (workstreamId: string) => {
    setExcludedWorkstreamIds(prev => {
      const next = new Set(prev);
      if (next.has(workstreamId)) {
        next.delete(workstreamId);
      } else {
        next.add(workstreamId);
      }
      return next;
    });
  };

  // Unlogged, non-excluded workstreams for bulk actions
  const unloggedWorkstreams = useMemo(() => {
    return auditReport.workstreams.filter(
      ws => !loggedWorkstreamIds.has(ws.id) && !excludedWorkstreamIds.has(ws.id)
    );
  }, [auditReport.workstreams, loggedWorkstreamIds, excludedWorkstreamIds]);

  const excludedCount = useMemo(() => {
    return auditReport.workstreams.filter(ws => excludedWorkstreamIds.has(ws.id)).length;
  }, [auditReport.workstreams, excludedWorkstreamIds]);

  const totalUnloggedHours = useMemo(() => {
    const total = unloggedWorkstreams.reduce((acc, ws) => acc + ws.roundedHours, 0);
    return Math.round(total * 100) / 100;
  }, [unloggedWorkstreams]);

  // Handle assignment changes for a workstream
  const handleClientChange = (workstreamId: string, clientId: string) => {
    const clientProjects = projects.filter(p => p.clientId === clientId && !p.archived);
    const firstProj = clientProjects[0]?.id || '';
    setCustomAssignments(prev => ({
      ...prev,
      [workstreamId]: {
        clientId,
        projectId: firstProj,
        taskName: prev[workstreamId]?.taskName ?? '',
      }
    }));
  };

  const handleProjectChange = (workstreamId: string, projectId: string) => {
    const proj = projects.find(p => p.id === projectId);
    setCustomAssignments(prev => ({
      ...prev,
      [workstreamId]: {
        clientId: proj?.clientId || prev[workstreamId]?.clientId || '',
        projectId,
        taskName: prev[workstreamId]?.taskName ?? '',
      }
    }));
  };

  const handleTaskNameChange = (workstreamId: string, taskName: string) => {
    setCustomAssignments(prev => {
      const existing = prev[workstreamId];
      return {
        ...prev,
        [workstreamId]: {
          clientId: existing?.clientId || '',
          projectId: existing?.projectId || '',
          taskName,
        }
      };
    });
  };

  // Get validated assignment for a workstream
  const getAssignment = (ws: AuditedWorkstream) => {
    const custom = customAssignments[ws.id];
    const assignedClientId = custom?.clientId || ws.suggestedClientId || (clients[0]?.id || '');
    const clientProjects = projects.filter(p => p.clientId === assignedClientId && !p.archived);
    
    let assignedProjectId = custom?.projectId || ws.suggestedProjectId;
    if (!assignedProjectId || !clientProjects.some(p => p.id === assignedProjectId)) {
      assignedProjectId = clientProjects[0]?.id || '';
    }

    const taskName = custom?.taskName !== undefined && custom.taskName !== '' 
      ? custom.taskName 
      : ws.suggestedTaskName;

    return {
      clientId: assignedClientId,
      projectId: assignedProjectId,
      taskName,
    };
  };

  // Log single audited workstream
  const handleLogSingleWorkstream = async (ws: AuditedWorkstream) => {
    const { clientId, projectId, taskName } = getAssignment(ws);
    if (!clientId || !projectId) {
      setErrorMessage(`Please select a valid Client & Project for "${ws.normalizedDocumentTitle}".`);
      return;
    }

    const draft = createDraftFromWorkstream(ws, activeDate, clientId, projectId, taskName);
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const ok = await onBatchLogEntries([draft]);
      if (ok) {
        setLoggedWorkstreamIds(prev => new Set([...prev, ws.id]));
        setSuccessMessage(`Logged ${ws.roundedHours}h for "${ws.normalizedDocumentTitle}".`);
        setTimeout(() => setSuccessMessage(''), 3000);
      }
    } catch {
      setErrorMessage('Failed to log workstream.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Log all unlogged audited workstreams in one click
  const handleLogAllWorkstreams = async () => {
    if (unloggedWorkstreams.length === 0) return;

    const drafts: TimeEntryDraft[] = [];
    for (const ws of unloggedWorkstreams) {
      const { clientId, projectId, taskName } = getAssignment(ws);
      if (!clientId || !projectId) {
        setErrorMessage(`Please ensure all workstreams have a selected Project before logging all.`);
        return;
      }
      drafts.push(createDraftFromWorkstream(ws, activeDate, clientId, projectId, taskName));
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const ok = await onBatchLogEntries(drafts);
      if (ok) {
        setLoggedWorkstreamIds(prev => {
          const next = new Set(prev);
          unloggedWorkstreams.forEach(ws => next.add(ws.id));
          return next;
        });
        setSuccessMessage(`Successfully logged ${drafts.length} audited workstream(s) (${totalUnloggedHours}h total)!`);
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch {
      setErrorMessage('Failed to log audited workstreams.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="End-of-Day & Weekend Activity Audit"
      subtitle="Reconciles fragmented document sessions into consolidated billable workstreams for rapid 1-click logging."
      maxWidth="xl"
    >
      <div className="space-y-4 max-h-[75vh] flex flex-col min-h-0">
        {/* Top Controls & Metrics Banner */}
        <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50/90 via-slate-50 to-indigo-50/70 border border-blue-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shrink-0 shadow-2xs">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-slate-900">Workstream Audit & Reconciliation</h3>
                <Badge variant="sky" size="sm">
                  {unloggedWorkstreams.length} Billable / {auditReport.workstreams.length} Total
                </Badge>
              </div>
              <div className="text-xs text-slate-500 mt-1 flex items-center gap-2.5 font-mono flex-wrap">
                <span>{auditReport.totalUnassignedActivities} raw events</span>
                <span>•</span>
                <span className="font-semibold text-slate-800">{totalUnloggedHours}h billable</span>
                {excludedCount > 0 && (
                  <span className="text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200 text-[10px] font-semibold">
                    {excludedCount} personal/excluded
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Scope Toggle: Today vs Week */}
            <div className="inline-flex rounded-xl bg-white border border-slate-200 p-0.5 shadow-2xs text-xs font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setScope('today')}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  scope === 'today' ? 'bg-blue-600 text-white shadow-2xs' : 'hover:text-slate-900'
                }`}
              >
                Today ({activeDate})
              </button>
              <button
                type="button"
                onClick={() => setScope('week')}
                className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                  scope === 'week' ? 'bg-blue-600 text-white shadow-2xs' : 'hover:text-slate-900'
                }`}
              >
                This Week
              </button>
            </div>

            {/* View Granularity: Document vs App */}
            <div className="inline-flex rounded-xl bg-white border border-slate-200 p-0.5 shadow-2xs text-xs font-semibold text-slate-600">
              <button
                type="button"
                onClick={() => setActiveGroupByApp(false)}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  !activeGroupByApp ? 'bg-slate-800 text-white shadow-2xs' : 'hover:text-slate-900 text-slate-500'
                }`}
                title="Split workstreams by document filename or window topic"
              >
                Document
              </button>
              <button
                type="button"
                onClick={() => setActiveGroupByApp(true)}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  activeGroupByApp ? 'bg-slate-800 text-white shadow-2xs' : 'hover:text-slate-900 text-slate-500'
                }`}
                title="Consolidate all sessions into parent applications"
              >
                App
              </button>
            </div>

            {/* Micro-switch Absorber Toggle */}
            <label 
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-xl shadow-2xs cursor-pointer select-none"
              title="Automatically merges micro-interruptions (< 60s of Windows Search, SnippingTool) into the surrounding primary document workstream"
            >
              <input
                type="checkbox"
                checked={absorbMicroSwitches}
                onChange={(e) => setAbsorbMicroSwitches(e.target.checked)}
                className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
              />
              <span>Absorb noise</span>
            </label>
          </div>
        </div>

        {/* Feedback Alert Messages */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-medium flex items-center gap-2 shrink-0">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Scrollable Workstream Items List */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          {auditReport.workstreams.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200/80">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <div className="text-sm font-bold text-slate-800">All Captured Activities Reconciled!</div>
              <p className="text-xs text-slate-500 mt-1">
                There are no unassigned activities requiring audit for this {scope === 'week' ? 'week' : 'day'}.
              </p>
            </div>
          ) : (
            auditReport.workstreams.map((ws) => {
              const isLogged = loggedWorkstreamIds.has(ws.id);
              const isExcluded = excludedWorkstreamIds.has(ws.id);
              const assignment = getAssignment(ws);
              const clientProjects = projects.filter(p => p.clientId === assignment.clientId && !p.archived);
              const durationMins = Math.max(1, Math.round(ws.totalDurationSeconds / 60));
              const activityDate = ws.activities[0]?.localDate || ws.activities[0]?.timestamp?.slice(0, 10) || activeDate;
              const isSameAsApp = ws.normalizedDocumentTitle.toLowerCase() === ws.appName.toLowerCase();
              const hasDistinctDocTitle = !isSameAsApp && Boolean(ws.normalizedDocumentTitle);

              return (
                <div
                  key={ws.id}
                  className={`p-3.5 rounded-2xl border transition-all space-y-2.5 ${
                    isLogged
                      ? 'bg-emerald-50/20 border-emerald-200/60 opacity-90'
                      : isExcluded
                        ? 'bg-slate-50/70 border-dashed border-slate-200 opacity-60'
                        : 'bg-white border-slate-200/90 shadow-2xs hover:border-blue-300'
                  }`}
                >
                  {/* Top Row: App Icon + Document Title + Badges + Duration & Exclude Action */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <BrandIcon
                        appName={ws.appName}
                        windowTitle={ws.rawSampleTitle}
                        appIcon={ws.appIcon}
                        className="w-5 h-5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-xs">
                            {ws.appName}
                          </span>
                          {hasDistinctDocTitle && (
                            <span className="text-xs font-semibold text-blue-900 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/60 truncate max-w-xs">
                              {ws.normalizedDocumentTitle}
                            </span>
                          )}
                          {ws.isPersonal && (
                            <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              Personal / Entertainment
                            </span>
                          )}
                          {scope === 'week' && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              {activityDate}
                            </span>
                          )}
                        </div>
                        {ws.rawSampleTitle && ws.rawSampleTitle.toLowerCase() !== ws.appName.toLowerCase() && (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate max-w-xl">
                            {ws.rawSampleTitle}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Duration Tag & Status / Exclude Controls */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200/60">
                        {durationMins}m ({ws.roundedHours}h)
                      </span>
                      {isLogged ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 text-[11px] font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Recorded
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleExclude(ws.id)}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                            isExcluded
                              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                              : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                          }`}
                          title={isExcluded ? 'Include in timesheet logging' : 'Exclude from billable timesheet'}
                        >
                          {isExcluded ? 'Excluded (Restore)' : 'Exclude'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Middle Row: Merged Session Intervals & Micro-switch absorption */}
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap bg-slate-50/80 p-2 rounded-xl border border-slate-100">
                    <span className="font-semibold text-slate-700 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{ws.sessionCount} {ws.sessionCount === 1 ? 'session' : 'sessions'}:</span>
                    </span>
                    {ws.intervals.map((interval, idx) => (
                      <span
                        key={idx}
                        className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 text-[10px]"
                      >
                        {interval.startTime !== interval.endTime ? `${interval.startTime} – ${interval.endTime}` : interval.startTime} ({interval.durationMinutes}m)
                      </span>
                    ))}
                    {ws.absorbedNoiseCount > 0 && (
                      <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/60">
                        +{ws.absorbedNoiseCount} noise absorbed ({Math.round(ws.absorbedNoiseSeconds)}s)
                      </span>
                    )}
                  </div>

                  {/* Editable Task Memo Row (if active & not logged) */}
                  {!isLogged && !isExcluded && (
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
                        <Edit2 className="w-3 h-3 text-slate-400" />
                        Memo
                      </span>
                      <input
                        type="text"
                        value={assignment.taskName}
                        onChange={(e) => handleTaskNameChange(ws.id, e.target.value)}
                        placeholder="Deliverable memo for client invoice..."
                        className="flex-1 text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 text-slate-800 placeholder:text-slate-400 transition-all font-medium"
                      />
                    </div>
                  )}

                  {/* Bottom Row: Client / Project Mapping & Log Action */}
                  {isExcluded ? (
                    <div className="text-xs text-amber-800 bg-amber-50/70 px-3 py-1.5 rounded-xl border border-amber-200/60 flex items-center justify-between">
                      <span>Marked as non-billable / personal — skipped during timesheet logging.</span>
                      <button
                        type="button"
                        onClick={() => handleToggleExclude(ws.id)}
                        className="text-xs font-bold text-blue-600 hover:underline cursor-pointer ml-2"
                      >
                        Restore
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3 pt-1 flex-wrap sm:flex-nowrap">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Client Selector */}
                        <select
                          disabled={isLogged}
                          value={assignment.clientId}
                          onChange={(e) => handleClientChange(ws.id, e.target.value)}
                          className="text-xs rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
                        >
                          {clients.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>

                        {/* Project Selector */}
                        <select
                          disabled={isLogged}
                          value={assignment.projectId}
                          onChange={(e) => handleProjectChange(ws.id, e.target.value)}
                          className="text-xs rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 flex-1 min-w-0 truncate disabled:opacity-50"
                        >
                          {clientProjects.length === 0 ? (
                            <option value="">No projects for client</option>
                          ) : (
                            clientProjects.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} {p.isBillableDefault ? `(${p.defaultHourlyRate ? `$${p.defaultHourlyRate}/h` : 'Billable'})` : '(Non-billable)'}
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      {/* Single Workstream Log Button */}
                      {!isLogged ? (
                        <button
                          type="button"
                          disabled={isSubmitting || !assignment.projectId}
                          onClick={() => handleLogSingleWorkstream(ws)}
                          className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/80 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs hover:shadow-xs cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          <span>Log {ws.roundedHours}h</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-600 px-3 py-1.5 shrink-0">
                          ✓ Logged
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer: Bulk Log All Action */}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Close
          </button>

          {unloggedWorkstreams.length > 0 && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleLogAllWorkstreams}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm flex items-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 cursor-pointer"
            >
              <CheckCheck className="w-4 h-4" />
              <span>Approve & Log {unloggedWorkstreams.length} Billable Workstream{unloggedWorkstreams.length === 1 ? '' : 's'} ({totalUnloggedHours}h)</span>
            </button>
          )}

          {unloggedWorkstreams.length === 0 && auditReport.workstreams.length > 0 && (
            <div className="text-xs font-bold text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>All billable workstreams reconciled and logged to timesheet!</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
