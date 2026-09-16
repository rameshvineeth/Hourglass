import React, { useState, useEffect, useMemo } from 'react';
import { ActivityItem } from '../../types/activity';
import { TimeEntry, RoundingMode } from '../../types/time-entry';
import { Client, Project } from '../../types/client-project';
import { BrandIcon } from '../ui/BrandIcon';
import { roundDurationMinutes, formatCurrency } from '../../domain/time-calculations';
import { groupActivitiesByAppSession, parseTimeToMinuteOfDay, cleanTaskDescription, cleanEntryNotes, type AppSessionGroup, type SessionTabItem } from '../../domain/timeline-layout';
import { auditActivities, workstreamsToSessionGroups } from '../../domain/activity-audit';
import { 
  CheckCircle2,
  Plus, 
  Activity, 
  Briefcase, 
  Edit3, 
  Trash2,
  ArrowRight, 
  ChevronDown, 
  ChevronUp, 
  Layers
} from 'lucide-react';

interface DualTimelineWorkspaceProps {
  activities: ActivityItem[];
  timeEntries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  activeDate: string;
  roundingMode: RoundingMode;
  auditedActivityIds?: string[];
  onAuditedActivityIdsChange?: (ids: string[]) => void;
  auditGroupByApp?: boolean;
  isCapturing?: boolean;
  onToggleCapture?: () => void;
  onSelectActivityToLog: (activity: ActivityItem, sessionActivities?: ActivityItem[]) => void;
  onOpenAiAutoAssign?: () => void;
  onOpenProjectModal?: () => void;
  onAddNewManualEntry?: () => void;
  onEditEntry: (entry: TimeEntry) => void;
  onDeleteEntry: (entryId: string) => void;
  searchQuery?: string;
  activityViewMode?: 'timeline' | 'document' | 'app';
  onActivityViewModeChange?: (mode: 'timeline' | 'document' | 'app') => void;
  onVisibleUnassignedSessionsChange?: (sessions: AppSessionGroup[]) => void;
}

export const DualTimelineWorkspace: React.FC<DualTimelineWorkspaceProps> = ({
  activities,
  timeEntries,
  clients,
  projects,
  activeDate,
  roundingMode,
  auditedActivityIds: externalAuditedIds,
  onAuditedActivityIdsChange,
  auditGroupByApp = false,
  onSelectActivityToLog,
  onOpenProjectModal,
  onEditEntry,
  onDeleteEntry,
  searchQuery = '',
  activityViewMode: externalViewMode,
  onActivityViewModeChange,
  onVisibleUnassignedSessionsChange,
}) => {
  const [internalViewMode, setInternalViewMode] = useState<'document' | 'app' | 'timeline'>(() => {
    const saved = localStorage.getItem('hourglass_activity_view_mode') as 'document' | 'app' | 'timeline';
    return (saved === 'timeline' ? 'app' : saved) || externalViewMode || 'app';
  });

  const currentViewMode = externalViewMode || internalViewMode;

  const handleSetViewMode = (mode: 'document' | 'app' | 'timeline') => {
    setInternalViewMode(mode);
    localStorage.setItem('hourglass_activity_view_mode', mode);
    onActivityViewModeChange?.(mode);
  };

  const hasEngagements = clients.length > 0 && projects.length > 0;

  // Todays confirmed entries
  const todaysEntries = timeEntries.filter(e => e.date === activeDate);
  const getEntryHours = (e: TimeEntry) => {
    if (e.decimalHours > 0) return e.decimalHours;
    if (e.durationMinutes > 0) return Math.max(0.01, Number((e.durationMinutes / 60).toFixed(2)));
    if ((e.actualDurationSeconds ?? 0) > 0) return Math.max(0.01, Number(((e.actualDurationSeconds! / 3600)).toFixed(2)));
    return 0;
  };
  const totalDayHours = todaysEntries.reduce((acc, e) => acc + getEntryHours(e), 0);
  const totalDayRevenue = todaysEntries.reduce((acc, e) => acc + (e.calculatedRevenue || 0), 0);
  const totalCapturedMinutes = activities.reduce((acc, a) => acc + Math.round(a.durationSeconds / 60), 0);
  const totalCapturedHours = (totalCapturedMinutes / 60).toFixed(1);


  // Formatted Month and Date for clear date context (e.g. "Sep 12")
  const formattedDate = useMemo(() => {
    try {
      const d = new Date(`${activeDate}T12:00:00`);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return activeDate;
    }
  }, [activeDate]);

  // App Session tab dropdown state
  const [expandedSessionIds, setExpandedSessionIds] = useState<Record<string, boolean>>({});

  const toggleSessionDropdown = (sessionId: string) => {
    setExpandedSessionIds(prev => ({
      ...prev,
      [sessionId]: !prev[sessionId],
    }));
  };

  // Track audited activity IDs for the active date so audited workstreams persist in the activity tab
  const [internalAuditedIds, setInternalAuditedIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`hourglass_audited_ids_${activeDate}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const effectiveAuditedIds = externalAuditedIds ?? internalAuditedIds;

  // Re-sync from localStorage when activeDate changes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`hourglass_audited_ids_${activeDate}`);
      const parsed = stored ? JSON.parse(stored) : [];
      setInternalAuditedIds(parsed);
      onAuditedActivityIdsChange?.(parsed);
    } catch {
      setInternalAuditedIds([]);
      onAuditedActivityIdsChange?.([]);
    }
  }, [activeDate, onAuditedActivityIdsChange]);

  // Split activities into:
  // 1) Audited activities (activities whose IDs were audited)
  // 2) New incoming captures (activities captured after the audit)
  const { auditedActivities, newCaptures } = useMemo(() => {
    if (effectiveAuditedIds.length === 0) {
      return { auditedActivities: [], newCaptures: activities };
    }
    const auditedSet = new Set(effectiveAuditedIds);
    const audited: ActivityItem[] = [];
    const newOnes: ActivityItem[] = [];

    for (const a of activities) {
      if (auditedSet.has(a.id)) {
        audited.push(a);
      } else {
        newOnes.push(a);
      }
    }
    return { auditedActivities: audited, newCaptures: newOnes };
  }, [activities, effectiveAuditedIds]);

  // Generate audit report for the audited activities
  const auditReport = useMemo(() => {
    if (auditedActivities.length === 0) return null;
    return auditActivities(auditedActivities, clients, projects, {
      scope: 'today',
      roundingMode,
      absorbMicroSwitches: true,
      microSwitchThresholdSeconds: 60,
      groupByApp: auditGroupByApp,
    });
  }, [auditedActivities, clients, projects, roundingMode, auditGroupByApp]);

  // Combined list of session cards to display:
  // - Mode 'document': Consolidates identical documents/deliverables across today
  // - Mode 'app': Rolls up all tabs/documents into parent applications
  // - Mode 'timeline': Chronological morning-to-evening focus sessions
  const appSessions = useMemo(() => {
    if (!activities || activities.length === 0) return [];

    // Mode 1: By Document — consolidates all sessions of the same deliverable across today
    if (currentViewMode === 'document') {
      const docReport = auditActivities(activities, clients, projects, {
        scope: 'today',
        roundingMode,
        absorbMicroSwitches: true,
        microSwitchThresholdSeconds: 60,
        groupByApp: false,
      });
      return workstreamsToSessionGroups(docReport.workstreams);
    }

    // Mode 2: By App — rolls up all tabs & files into parent software applications
    if (currentViewMode === 'app') {
      const appReport = auditActivities(activities, clients, projects, {
        scope: 'today',
        roundingMode,
        absorbMicroSwitches: true,
        microSwitchThresholdSeconds: 60,
        groupByApp: true,
      });
      return workstreamsToSessionGroups(appReport.workstreams);
    }

    // Mode 3: Timeline (Default) — chronological focus sessions with gap threshold
    const sessions: AppSessionGroup[] = [];

    if (auditReport && auditReport.workstreams.length > 0) {
      sessions.push(...workstreamsToSessionGroups(auditReport.workstreams));
    }

    if (newCaptures.length > 0) {
      // Group new captures naturally by app session
      sessions.push(...groupActivitiesByAppSession(newCaptures));
    }

    // If nothing has been audited yet, show all activities grouped naturally
    if (sessions.length === 0) {
      return groupActivitiesByAppSession(activities);
    }

    // Sort chronologically from morning to evening
    sessions.sort((a, b) => {
      const minA = parseTimeToMinuteOfDay(a.startTime);
      const minB = parseTimeToMinuteOfDay(b.startTime);
      return minA - minB;
    });

    return sessions;
  }, [currentViewMode, auditReport, newCaptures, activities, clients, projects, roundingMode]);

  // Unassigned cards currently visible in the active lens
  const unassignedSessions = useMemo(() => {
    return appSessions.filter(s => !s.isAssigned);
  }, [appSessions]);

  const unassignedSessionsCount = unassignedSessions.length;

  useEffect(() => {
    onVisibleUnassignedSessionsChange?.(unassignedSessions);
  }, [unassignedSessions, onVisibleUnassignedSessionsChange]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden">
      {/* Prerequisite Banner if no clients setup */}
      {!hasEngagements && (
        <div className="shrink-0 mx-3 my-2 px-3 py-2 rounded-lg bg-blue-50/90 border border-blue-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Briefcase className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-xs font-semibold text-blue-950">
                Setup client engagement before logging
              </h4>
              <p className="text-[11px] text-blue-700/90 mt-0.5 leading-snug">
                Add your client engagements and bill rates ($/hr) so your captured activities can be converted into confirmed billable entries.
              </p>
            </div>
          </div>
          {onOpenProjectModal && (
            <button
              type="button"
              onClick={onOpenProjectModal}
              className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shadow-2xs flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add client & rate
            </button>
          )}
        </div>
      )}

      {/* Main Dual-Column Frame - Full bleed edge-to-edge */}
      <div className="flex-1 min-h-0 bg-white flex flex-col overflow-hidden">
        {/* Synchronized Header Bar - Ultra-Slim & Pure White */}
        <div className="shrink-0 h-8 grid grid-cols-1 md:grid-cols-2 border-b border-slate-100 bg-white select-none">
          {/* Left Column Header: Activity (Automatic Capture) */}
          <div className="px-2.5 sm:px-3.5 flex items-center justify-between border-r border-slate-100 min-w-0 h-full gap-2">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />
              <div className="flex items-baseline gap-1 sm:gap-1.5 min-w-0">
                <span className="text-[11px] font-semibold text-slate-800 tracking-tight whitespace-nowrap">
                  Activity
                </span>
                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded whitespace-nowrap hidden sm:inline">
                  {formattedDate}
                </span>
                <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap hidden xl:inline">
                  · {totalCapturedHours}h · {appSessions.length} {currentViewMode === 'document' ? 'docs' : currentViewMode === 'app' ? 'apps' : 'sessions'}{unassignedSessionsCount > 0 ? ` (${unassignedSessionsCount} unassigned)` : ''}
                </span>
              </div>
            </div>

            {/* 2-Way View Lens: By Document (Default) | By App */}
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/70 shadow-2xs text-[10px] font-semibold text-slate-600 shrink-0">
              <button
                type="button"
                onClick={() => handleSetViewMode('document')}
                className={`px-2.5 py-0.5 rounded-md transition-all cursor-pointer ${
                  currentViewMode === 'document' || currentViewMode === 'timeline'
                    ? 'bg-white text-blue-700 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Consolidate all sessions of identical files/deliverables across today (Default)"
              >
                By Document
              </button>
              <button
                type="button"
                onClick={() => handleSetViewMode('app')}
                className={`px-2.5 py-0.5 rounded-md transition-all cursor-pointer ${
                  currentViewMode === 'app'
                    ? 'bg-white text-indigo-700 shadow-xs font-bold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Roll up all activities into parent software applications"
              >
                By App
              </button>
            </div>
          </div>

          {/* Right Column Header: Confirmed Time Entries */}
          <div className="px-2.5 sm:px-3.5 flex items-center justify-between min-w-0 h-full">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <div className="flex items-baseline gap-1 sm:gap-1.5 min-w-0">
                <span className="text-[11px] font-semibold text-slate-800 tracking-tight whitespace-nowrap">
                  Time Entries
                </span>
                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                  {formattedDate}
                </span>
                <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
                  · {totalDayHours >= 0.1 ? `${totalDayHours.toFixed(1)}h` : totalDayHours > 0 ? `${totalDayHours.toFixed(2)}h` : '0.0h'} · <span className="font-semibold text-emerald-700">{formatCurrency(totalDayRevenue)}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Dual-Column Body: Independent Scrollable Lists */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200/80 bg-slate-50/20 overflow-hidden">
          {/* LEFT COLUMN: Clean Natural-Scrolling Passive Activity Cards */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2.5 sm:px-3.5 pt-2.5 pb-8 space-y-[-4px] select-none [scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent] flex flex-col">
            {appSessions.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <div className="w-10 h-10 rounded-xl bg-slate-100/90 border border-slate-200/60 flex items-center justify-center mb-2.5">
                  <Activity className="w-5 h-5 text-slate-400" />
                </div>
                <h3 className="font-semibold text-slate-700 text-xs sm:text-sm">No Activities Captured</h3>
                <p className="text-[11px] text-slate-400 max-w-xs mt-1 leading-relaxed">
                  Start the capture service or focus on different applications to see your automatic timeline populated here.
                </p>
              </div>
            ) : (
              appSessions.map((session) => {
                const durationMins = Math.max(1, Math.round(session.durationSeconds / 60));
                const { decimalHours } = roundDurationMinutes(durationMins, roundingMode);
                const isDropdownOpen = !!expandedSessionIds[session.id];

                return (
                  <div
                    key={session.id}
                    className={`group relative transition-all duration-150 ease-out rounded-xl p-2.5 bg-white border ${
                      isDropdownOpen 
                        ? 'z-30 ring-2 ring-blue-500/20 shadow-sm -translate-y-0.5 border-blue-200' 
                        : 'z-10 hover:z-20 hover:-translate-y-1 hover:shadow-md hover:shadow-slate-200/60 hover:border-slate-300'
                    } ${
                      session.isAssigned
                        ? 'bg-emerald-50/50 border-emerald-200/80 text-emerald-950 border-l-2 border-l-emerald-400/60'
                        : 'border-slate-200/80 border-l-2 border-l-blue-300/80 shadow-2xs hover:bg-slate-50/40'
                    }`}
                  >
                    {/* Top Header Row */}
                    <div className="flex items-center justify-between gap-1.5 sm:gap-2 w-full min-h-[28px]">
                      {/* Left: Time Badge, App icon, App Name, Primary Title, Tabs Dropdown Toggle */}
                      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 overflow-hidden">
                        <span className="font-mono text-[10px] font-semibold text-slate-500 bg-slate-100/90 border border-slate-200/60 px-1.5 py-0.5 rounded-md shrink-0">
                          {session.startTime}
                        </span>

                        <BrandIcon
                          appName={session.appName}
                          windowTitle={session.primaryTitle}
                          appIcon={session.appIcon}
                          className="w-4 h-4 shrink-0"
                        />

                        <span className="font-bold text-slate-900 text-xs tracking-tight shrink-0 truncate max-w-[130px] sm:max-w-none">
                          {session.appName}
                        </span>

                        {session.primaryTitle && 
                         session.primaryTitle.trim().toLowerCase() !== session.appName.trim().toLowerCase() && (
                          <span 
                            className="text-[11px] text-slate-500 truncate font-normal min-w-0 flex-1"
                            title={session.primaryTitle}
                          >
                            {session.primaryTitle}
                          </span>
                        )}

                        {/* Multiple Tabs Dropdown Pill Button */}
                        {session.tabCount > 1 && (
                          <button
                            type="button"
                            onClick={() => toggleSessionDropdown(session.id)}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-semibold border border-blue-200/70 shrink-0 transition-colors cursor-pointer"
                            title={isDropdownOpen ? `Click to collapse` : `Click to see all ${session.tabCount} ${session.tabNoun || 'items'} visited`}
                          >
                            <span>{session.tabCount} {session.tabNoun || 'tabs'}</span>
                            {isDropdownOpen ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </div>

                      {/* Right: Duration badge & Log Action Button */}
                      <div className="flex items-center gap-1.5 shrink-0 ml-auto pl-1">
                        <span className="font-mono text-[10px] text-slate-600 bg-slate-100/90 border border-slate-200/60 px-1.5 py-0.5 rounded-md font-semibold shrink-0">
                          {durationMins}m
                        </span>

                        {!session.isAssigned ? (
                          <button
                            type="button"
                            onClick={() => {
                              // Synthesize an activity representing the whole session
                              const firstAct = session.activities[0];
                              const synth: ActivityItem = {
                                ...firstAct,
                                id: session.id,
                                appName: session.appName,
                                windowTitle: (session.primaryTitle && session.primaryTitle.toLowerCase() !== session.appName.toLowerCase())
                                  ? session.primaryTitle
                                  : session.appName,
                                durationSeconds: session.durationSeconds,
                                startTime: session.startTime,
                                endTime: session.endTime,
                              };
                              onSelectActivityToLog(synth, session.activities);
                            }}
                            className="text-[11px] font-semibold text-blue-700 hover:text-white hover:bg-blue-600 bg-blue-50/80 hover:border-blue-600 px-2 sm:px-2.5 py-1 rounded-lg border border-blue-200/80 transition-all flex items-center gap-1 shadow-2xs whitespace-nowrap cursor-pointer shrink-0 active:scale-95"
                            title={`Log entire ${session.appName} session (${decimalHours}h)`}
                          >
                            <span>Log {decimalHours}h</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        ) : (
                          <span className="text-[10px] font-semibold text-emerald-700 flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200 whitespace-nowrap shrink-0">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Logged
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Dropdown Drawer: Visible when user clicks the tabs button */}
                    {isDropdownOpen && session.tabCount > 1 && (
                      <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5 w-full bg-slate-50/70 p-2.5 rounded-xl">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                          <span>Tabs visited in this {session.appName} session:</span>
                          <span>{session.tabCount} tabs</span>
                        </div>
                        {session.tabs.map((tab: SessionTabItem) => {
                          const tabMins = Math.max(1, Math.round(tab.durationSeconds / 60));
                          const { decimalHours: tabDec } = roundDurationMinutes(tabMins, roundingMode);

                          return (
                            <div
                              key={tab.id}
                              className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white hover:bg-blue-50/50 border border-slate-200/60 transition-colors text-[11px] shadow-2xs"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                <span 
                                  className="truncate text-slate-700 font-medium"
                                  title={tab.windowTitle}
                                >
                                  {tab.windowTitle}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono text-[10px] text-slate-400">
                                  {tabMins}m
                                </span>
                                {!tab.isAssigned ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const tabActs = tab.activities && tab.activities.length > 0 ? tab.activities : [tab.activity];
                                      const synthTabAct: ActivityItem = {
                                        ...tab.activity,
                                        durationSeconds: tab.durationSeconds,
                                        windowTitle: tab.windowTitle,
                                      };
                                      onSelectActivityToLog(synthTabAct, tabActs);
                                    }}
                                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline px-2 py-0.5 rounded bg-blue-50 border border-blue-200/60 whitespace-nowrap cursor-pointer"
                                    title={`Log only this item (${tabDec}h)`}
                                  >
                                    Log {tabDec}h
                                  </button>
                                ) : (
                                  <span className="text-[9px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                    Logged
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* RIGHT COLUMN: Confirmed Billable Timesheet Blocks */}
          <div 
            tabIndex={0} 
            className="flex-1 min-h-0 overflow-y-auto px-2.5 sm:px-3.5 pt-2.5 pb-8 space-y-2 no-scrollbar focus:outline-none flex flex-col"
          >
            {todaysEntries.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <div className="w-10 h-10 rounded-xl bg-slate-100/90 border border-slate-200/60 flex items-center justify-center mb-2.5">
                  <Briefcase className="w-5 h-5 text-slate-400" />
                </div>
                <h3 className="font-semibold text-slate-700 text-xs sm:text-sm">
                  {searchQuery ? `No time entries matching "${searchQuery}"` : 'No Time Entries Recorded'}
                </h3>
                <p className="text-[11px] text-slate-400 max-w-xs mt-1 leading-relaxed">
                  {searchQuery
                    ? 'Try searching for a different task, client, or clear the search.'
                    : 'Click "Log" on any activity card on the left, or use "+ Entry" above to add billable hours.'}
                </p>
              </div>
            ) : (
              todaysEntries.map((entry) => {
                const client = clients.find(c => c.id === entry.clientId);
                const project = projects.find(p => p.id === entry.projectId);

                // Find linked source activity evidence
                const sourceActs = (entry.sourceActivityIds || entry.allocations?.map(a => a.activityId) || [])
                  .map(id => activities.find(a => a.id === id))
                  .filter(Boolean) as ActivityItem[];
                
                const sourceAppName = entry.sourceAppName || (sourceActs.length > 0 ? [...new Set(sourceActs.map(a => a.appName).filter(Boolean))].join(', ') : undefined);

                return (
                  <div
                    key={entry.id}
                    className="group rounded-xl border border-slate-200/90 bg-white hover:border-blue-400 hover:shadow-2xs p-2.5 flex flex-col justify-between gap-2 transition-all"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                          {entry.startTime}
                        </span>
                        <span 
                          className="w-2.5 h-2.5 rounded-full shrink-0" 
                          style={{ backgroundColor: project?.color || client?.color || '#0ea5e9' }}
                        />
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {client?.name || 'Client'} › {project?.name || 'Project'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/60">
                          {getEntryHours(entry) >= 0.1 ? `${getEntryHours(entry).toFixed(1)}h` : `${getEntryHours(entry).toFixed(2)}h`} ({formatCurrency(entry.calculatedRevenue)})
                        </span>

                        <button
                          type="button"
                          onClick={() => onEditEntry(entry)}
                          className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
                          title="Edit entry"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteEntry(entry.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                          title="Delete entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Task Description & Notes */}
                    <div className="space-y-0.5 pt-1 border-t border-slate-100">
                      <div className="text-xs font-semibold text-slate-800">
                        {cleanTaskDescription(entry.taskName, sourceAppName || entry.sourceAppName) || 'Logged work'}
                      </div>
                      {cleanEntryNotes(entry.notes, entry.taskName, sourceAppName || entry.sourceAppName) && (
                        <div className="text-[11px] text-slate-500 italic">
                          "{cleanEntryNotes(entry.notes, entry.taskName, sourceAppName || entry.sourceAppName)}"
                        </div>
                      )}
                    </div>

                    {/* Activity Evidence Justification Badge */}
                    {sourceAppName ? (
                      <div className="flex items-center gap-1.5 text-[10.5px] bg-slate-50 border border-slate-200/70 rounded-lg px-2 py-1 text-slate-600">
                        <Layers className="w-3 h-3 text-blue-600 shrink-0" />
                        <span className="font-semibold text-slate-700 shrink-0">Logged from:</span>
                        <span className="font-medium text-slate-800 truncate" title={sourceAppName}>
                          {sourceAppName}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-[10px] text-slate-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                        <span>Manual timesheet entry</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
