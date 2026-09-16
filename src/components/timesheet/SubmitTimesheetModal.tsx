import React, { useState, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { TimeEntry } from '../../types/time-entry';
import { Client, Project } from '../../types/client-project';
import { TimesheetPeriod } from '../../types/timesheet';
import { ActivityItem } from '../../types/activity';
import { exportTimesheet, createCustomPeriod, createPeriod, workIntervals } from '../../domain/workflow';
import { validateTimesheetForSubmission } from '../../domain/timesheet-machine';
import { formatCurrency } from '../../domain/time-calculations';
import { weekDates, localDate, getRecentDays } from '../../domain/calendar';
import { 
  FileSpreadsheet, 
  FileCode, 
  Lock, 
  Download,
  CalendarDays,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  FileCheck2,
  Building2,
  FolderKanban,
  CheckCircle2,
  Sparkles
} from 'lucide-react';

export type SubmissionScope = 'today' | '3days' | 'week' | 'custom';

export interface SubmitTimesheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  period?: TimesheetPeriod;
  periods?: TimesheetPeriod[];
  entries: TimeEntry[];
  allEntries?: TimeEntry[];
  clients: Client[];
  projects: Project[];
  consultantName: string;
  consultantEmail: string;
  activeDate?: string;
  activities?: ActivityItem[];
  onSubmitTimesheet: (comment: string, period?: TimesheetPeriod) => void | Promise<void>;
  onConsolidateEntries?: (entriesToConsolidate: TimeEntry[]) => void | Promise<void>;
}

export const SubmitTimesheetModal: React.FC<SubmitTimesheetModalProps> = ({
  isOpen,
  onClose,
  period,
  periods = [],
  entries,
  allEntries,
  clients,
  projects,
  consultantName,
  consultantEmail,
  activeDate: propActiveDate,
  onSubmitTimesheet,
  onConsolidateEntries,
}) => {
  const effectiveBaseDate = useMemo(() => {
    return propActiveDate || period?.startDate || localDate(new Date());
  }, [propActiveDate, period?.startDate]);

  // Filter out any archived clients or projects
  const activeClients = useMemo(() => {
    return (clients || []).filter(c => !c.archived);
  }, [clients]);

  const activeProjects = useMemo(() => {
    return (projects || []).filter(p => !p.archived);
  }, [projects]);

  // Scope selection: today (1 day), 3days, week (7 days), custom
  const [scope, setScope] = useState<SubmissionScope>('week');
  const [customStartDate, setCustomStartDate] = useState(effectiveBaseDate);
  const [customEndDate, setCustomEndDate] = useState(effectiveBaseDate);
  
  // Client and Project billing filters
  const [selectedClientId, setSelectedClientId] = useState<string>(period?.clientId || '');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(period?.projectId || '');



  const [comment, setComment] = useState(period?.submissionComment || '');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState<number | undefined>();
  const [showItemizedEntries, setShowItemizedEntries] = useState(false);

  // Filter projects available for the selected client
  const clientProjects = useMemo(() => {
    if (!selectedClientId) return activeProjects;
    return activeProjects.filter(p => p.clientId === selectedClientId);
  }, [activeProjects, selectedClientId]);

  // Compute resolved start and end dates based on chosen scope
  const { resolvedStartDate, resolvedEndDate, scopeLabel } = useMemo(() => {
    if (scope === 'today') {
      return {
        resolvedStartDate: effectiveBaseDate,
        resolvedEndDate: effectiveBaseDate,
        scopeLabel: `Today · ${effectiveBaseDate}`
      };
    }
    if (scope === '3days') {
      const recent = getRecentDays(effectiveBaseDate, 3);
      return {
        resolvedStartDate: recent[0],
        resolvedEndDate: recent[recent.length - 1],
        scopeLabel: `Past 3 Days · ${recent[0]} to ${recent[recent.length - 1]}`
      };
    }
    if (scope === 'week') {
      const days = weekDates(effectiveBaseDate);
      return {
        resolvedStartDate: days[0],
        resolvedEndDate: days[6],
        scopeLabel: `This Week · ${days[0]} to ${days[6]}`
      };
    }
    // custom
    const s = customStartDate <= customEndDate ? customStartDate : customEndDate;
    const e = customStartDate <= customEndDate ? customEndDate : customStartDate;
    return {
      resolvedStartDate: s,
      resolvedEndDate: e,
      scopeLabel: `Custom Range · ${s} to ${e}`
    };
  }, [scope, effectiveBaseDate, customStartDate, customEndDate]);

  // Find matching period from existing periods list, or check incoming prop
  const currentPeriod: TimesheetPeriod = useMemo(() => {
    const existing = periods.find(p => 
      p.startDate === resolvedStartDate && 
      p.endDate === resolvedEndDate &&
      (selectedClientId ? p.clientId === selectedClientId : !p.clientId) &&
      (selectedProjectId ? p.projectId === selectedProjectId : !p.projectId)
    );
    if (existing) return existing;
    if (
      period && 
      period.startDate === resolvedStartDate && 
      period.endDate === resolvedEndDate &&
      (selectedClientId ? period.clientId === selectedClientId : !period.clientId) &&
      (selectedProjectId ? period.projectId === selectedProjectId : !period.projectId)
    ) {
      return period;
    }
    if (scope === 'week' && !selectedClientId && !selectedProjectId && (!period?.clientId && !period?.projectId)) {
      return period || createPeriod(resolvedStartDate, consultantName, consultantEmail);
    }
    return createCustomPeriod(
      resolvedStartDate, 
      resolvedEndDate, 
      consultantName, 
      consultantEmail, 
      selectedClientId || undefined, 
      selectedProjectId || undefined
    );
  }, [periods, period, resolvedStartDate, resolvedEndDate, selectedClientId, selectedProjectId, scope, consultantName, consultantEmail]);

  // Filter entries to match the resolved date range, client, and project
  const scopedEntries = useMemo(() => {
    const source = allEntries && allEntries.length > 0 ? allEntries : entries;
    return source.filter(e => {
      const inDate = e.date >= resolvedStartDate && e.date <= resolvedEndDate;
      const inClient = !selectedClientId || e.clientId === selectedClientId;
      const inProject = !selectedProjectId || e.projectId === selectedProjectId;
      return inDate && inClient && inProject;
    });
  }, [allEntries, entries, resolvedStartDate, resolvedEndDate, selectedClientId, selectedProjectId]);

  // Pre-submission compliance audit validation
  const validation = useMemo(() => {
    return validateTimesheetForSubmission(scopedEntries, currentPeriod);
  }, [scopedEntries, currentPeriod]);

  // Snapshot & Revision state
  const snapshots = currentPeriod.snapshots || [];
  const snapshot = snapshots.find(s => s.revision === revision) || snapshots[snapshots.length - 1];

  // Financial and time calculations
  const totalHours = scopedEntries.reduce((n, e) => n + e.decimalHours, 0);
  const billableHours = scopedEntries.filter(e => e.isBillable).reduce((n, e) => n + e.decimalHours, 0);
  const nonBillableHours = totalHours - billableHours;
  const totalRevenue = scopedEntries.reduce((n, e) => n + e.calculatedRevenue, 0);
  const avgYield = totalHours > 0 ? Math.round(totalRevenue / totalHours) : 0;

  const isFinalized = currentPeriod.status === 'submitted' || currentPeriod.status === 'approved';

  // Find client and project labels for UI and export file naming
  const activeClient = activeClients.find(c => c.id === selectedClientId);
  const activeProject = activeProjects.find(p => p.id === selectedProjectId);

  const handleDownload = (format: 'csv' | 'json') => {
    if (!snapshot) return;
    const clientFilter = selectedClientId || undefined;
    const projectFilter = selectedProjectId || undefined;
    const content = exportTimesheet(currentPeriod, snapshot, clientFilter, projectFilter)[format];
    const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;

    const clientSlug = activeClient ? activeClient.name.replace(/[^a-zA-Z0-9]/g, '') : 'Consolidated';
    const projectSlug = activeProject ? `_${activeProject.name.replace(/[^a-zA-Z0-9]/g, '')}` : '';
    a.download = `Timesheet_${clientSlug}${projectSlug}_${currentPeriod.startDate}_${currentPeriod.endDate}_r${snapshot.revision}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleFinalize = async () => {
    setBusy(true);
    try {
      await onSubmitTimesheet(comment, currentPeriod);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const consolidatableGroups = useMemo(() => {
    if (isFinalized || scopedEntries.length < 2) return [];
    const candidates: TimeEntry[] = [];
    for (let i = 0; i < scopedEntries.length; i++) {
      for (let j = i + 1; j < scopedEntries.length; j++) {
        const e1 = scopedEntries[i];
        const e2 = scopedEntries[j];
        if (e1.date === e2.date && e1.clientId === e2.clientId && e1.projectId === e2.projectId) {
          const sameTask = Boolean(e1.taskName && e2.taskName && e1.taskName.toLowerCase().trim() === e2.taskName.toLowerCase().trim());
          const sameApp = Boolean(e1.sourceAppName && e2.sourceAppName && e1.sourceAppName.toLowerCase().trim() === e2.sourceAppName.toLowerCase().trim());
          const overlaps = workIntervals(e1).some(([a, b]) => workIntervals(e2).some(([c, d]) => a < d && c < b));
          if (sameTask || sameApp || overlaps) {
            if (!candidates.some(c => c.id === e1.id)) candidates.push(e1);
            if (!candidates.some(c => c.id === e2.id)) candidates.push(e2);
          }
        }
      }
    }
    return candidates;
  }, [scopedEntries, isFinalized]);

  const [isConsolidating, setIsConsolidating] = useState(false);

  const handleConsolidateClick = async () => {
    if (!onConsolidateEntries || consolidatableGroups.length === 0) return;
    setIsConsolidating(true);
    try {
      await onConsolidateEntries(consolidatableGroups);
    } finally {
      setIsConsolidating(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isFinalized ? "Finalized Timesheet Revision" : "Submit Timesheet for Approval"}
      subtitle={scopeLabel}
      maxWidth="lg"
    >
      <div className="space-y-4 pt-1">
        {/* 1. Scope & Billing Target Controls */}
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
          {/* Date Scope Pills */}
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-blue-600" />
              Period Scope
            </span>
            <span className="text-[11px] text-slate-600 font-mono font-medium">
              {resolvedStartDate} → {resolvedEndDate}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5 bg-white p-1 rounded-xl border border-slate-200/60">
            <button
              type="button"
              onClick={() => setScope('today')}
              className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                scope === 'today'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              Today (1 Day)
            </button>
            <button
              type="button"
              onClick={() => setScope('3days')}
              className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                scope === '3days'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              Past 3 Days
            </button>
            <button
              type="button"
              onClick={() => setScope('week')}
              className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                scope === 'week'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              This Week
            </button>
            <button
              type="button"
              onClick={() => setScope('custom')}
              className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                scope === 'custom'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              Custom Range
            </button>
          </div>

          {/* Custom Date Pickers */}
          {scope === 'custom' && (
            <div className="grid grid-cols-2 gap-3 pt-0.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full text-xs font-mono rounded-lg border border-slate-200 bg-white px-3 py-1.5 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full text-xs font-mono rounded-lg border border-slate-200 bg-white px-3 py-1.5 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {/* Client & Project Billing Filters (Always accessible to switch clients) */}
          <div className="pt-2 border-t border-slate-200/60 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Client Filter */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                Billable Client
              </label>
              <select
                value={selectedClientId}
                onChange={(e) => {
                  const nextClient = e.target.value;
                  setSelectedClientId(nextClient);
                  setSelectedProjectId(''); // Reset project if client changed
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:border-blue-500"
              >
                <option value="">All Clients ({activeClients.length})</option>
                {activeClients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.code ? `(${c.code})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Project Filter */}
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <FolderKanban className="w-3.5 h-3.5 text-indigo-600" />
                Billable Project
              </label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:border-blue-500"
              >
                <option value="">
                  {selectedClientId ? 'All Projects for this Client' : 'All Projects'}
                </option>
                {clientProjects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.code ? `[${p.code}]` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 2. Executive Summary Metrics */}
        <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/90 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-200/60 flex items-center justify-center font-bold text-xs">
                {currentPeriod.revision ? `R${currentPeriod.revision}` : 'R1'}
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900">
                  {consultantName || 'Consultant'} {consultantEmail ? `(${consultantEmail})` : ''}
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                  <span className="font-mono">{resolvedStartDate} → {resolvedEndDate}</span>
                  {activeClient && (
                    <>
                      <span>·</span>
                      <Badge variant="sky" size="sm">{activeClient.name}</Badge>
                    </>
                  )}
                  {activeProject && (
                    <span className="font-medium text-slate-700">({activeProject.name})</span>
                  )}
                </div>
              </div>
            </div>

            <Badge variant={isFinalized ? 'sky' : 'slate'} size="sm">
              {isFinalized ? `Revision #${currentPeriod.revision || 1} Finalized` : 'Draft Period'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200/60 font-mono text-center">
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/60">
              <div className="text-[10px] text-slate-400 font-sans uppercase font-semibold">Entries</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5">{scopedEntries.length}</div>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/60">
              <div className="text-[10px] text-slate-400 font-sans uppercase font-semibold">Hours</div>
              <div className="text-sm font-bold text-blue-700 mt-0.5">{totalHours.toFixed(1)}h</div>
              <div className="text-[10px] text-slate-500 font-sans mt-0.5">
                {billableHours.toFixed(1)}h billable{nonBillableHours > 0 ? ` · ${nonBillableHours.toFixed(1)}h non-billable` : ''}
              </div>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/60">
              <div className="text-[10px] text-slate-400 font-sans uppercase font-semibold">Revenue</div>
              <div className="text-sm font-bold text-emerald-700 mt-0.5">{formatCurrency(totalRevenue)}</div>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/60">
              <div className="text-[10px] text-slate-400 font-sans uppercase font-semibold">Effective Yield</div>
              <div className="text-sm font-bold text-indigo-700 mt-0.5">${avgYield}/h</div>
            </div>
          </div>
        </div>

        {/* Same-Project Repeated Session Consolidation Banner */}
        {!isFinalized && consolidatableGroups.length > 0 && onConsolidateEntries && (
          <div className="p-3 rounded-xl bg-amber-50/90 border border-amber-200/90 text-amber-900 flex items-center justify-between gap-3 text-xs shadow-xs">
            <div className="flex items-start gap-2.5 min-w-0">
              <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-amber-950">Repeated App Sessions Detected: </span>
                <span className="text-amber-800 text-[11.5px]">
                  Found {consolidatableGroups.length} sessions on the same project (e.g. repeated app launches). Consolidate them into unified line items to eliminate overlaps.
                </span>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              isLoading={isConsolidating}
              onClick={handleConsolidateClick}
              className="bg-white hover:bg-amber-100/70 border-amber-300 text-amber-900 shrink-0 font-semibold text-xs shadow-xs cursor-pointer"
            >
              Consolidate ({consolidatableGroups.length})
            </Button>
          </div>
        )}

        {/* 3. Pre-Submission Compliance & Audit Verification */}
        {!isFinalized && (
          <div className="space-y-2">
            {validation.isValid ? (
              <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200/80 text-emerald-900 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <span className="font-bold text-emerald-950">Pre-Submission Audit Passed: </span>
                  <span className="text-emerald-800">
                    All {scopedEntries.length} entries conform to client codes, task descriptions, and billing standards.
                  </span>
                </div>
              </div>
            ) : scopedEntries.length > 0 ? (
              <div className="p-3 rounded-xl bg-rose-50/80 border border-rose-200/80 text-rose-900 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1 min-w-0 flex-1">
                  <div className="font-bold text-rose-950">Compliance Issues Detected Before Finalization:</div>
                  <ul className="list-disc list-inside text-[11.5px] text-rose-800 space-y-0.5">
                    {validation.errors.map((err, i) => (
                      <li key={`err_${i}`}>{err.message}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 flex items-center gap-2 text-xs">
                <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
                <span>
                  No time entries match this {selectedClientId ? 'selected client' : 'period'}
                  {selectedProjectId ? ' and project' : ''}.
                </span>
              </div>
            )}
          </div>
        )}

        {/* 4. Itemized Entries Review Toggle */}
        {scopedEntries.length > 0 && (
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <button
              type="button"
              onClick={() => setShowItemizedEntries(prev => !prev)}
              className="w-full px-3 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <FileCheck2 className="w-3.5 h-3.5 text-slate-500" />
                Itemized Work Entries ({scopedEntries.length})
                {activeClient && (
                  <span className="text-slate-400 font-normal">· {activeClient.name}</span>
                )}
              </span>
              <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                {showItemizedEntries ? 'Hide' : 'Show preview'}
                {showItemizedEntries ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </span>
            </button>

            {showItemizedEntries && (
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 p-1">
                {scopedEntries.map(entry => {
                  const client = activeClients.find(c => c.id === entry.clientId);
                  const project = activeProjects.find(p => p.id === entry.projectId);
                  return (
                    <div key={entry.id} className="p-2 flex items-center justify-between text-xs hover:bg-slate-50 rounded-lg">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[11px] text-slate-500">{entry.date}</span>
                          <span className="font-mono text-[11px] text-slate-700">{entry.startTime}–{entry.endTime}</span>
                          <Badge variant="sky" size="sm">{client?.name || 'Client'}</Badge>
                          <span className="text-[11px] font-semibold text-slate-700 truncate">{project?.name}</span>
                        </div>
                        <div className="text-[11.5px] text-slate-600 truncate mt-0.5 font-medium">
                          {entry.taskName || 'Untitled task'}
                        </div>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <div className="font-bold text-slate-900">{entry.decimalHours.toFixed(1)}h</div>
                        <div className="text-[11px] text-emerald-700">{formatCurrency(entry.calculatedRevenue)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 5. Draft vs Finalized Action Sections */}
        {!isFinalized ? (
          /* DRAFT: Notes & Finalize Action */
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Submission Notes or Manager Comment (Optional)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="e.g. Completed phase 2 client deliverables, financial model validations, and final review."
                rows={2}
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200/70 text-xs text-blue-900 flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="text-[11.5px] leading-relaxed">
                Submitting locks this timesheet period as an immutable snapshot revision. 
                {selectedClientId ? (
                  <span> Entries for <strong>{activeClient?.name}</strong>{activeProject ? ` (${activeProject.name})` : ''} will be locked, while other client work remains freely editable.</span>
                ) : (
                  <span> All entries in this period will be locked.</span>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleFinalize}
                isLoading={busy}
                icon={<Lock className="w-3.5 h-3.5" />}
              >
                Finalize and lock revision
              </Button>
            </div>
          </div>
        ) : (
          /* FINALIZED: Snapshot Exports & Revision Management */
          <div className="space-y-3">
            {/* Status Guidance Banner */}
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-emerald-900">
                  This timesheet scope is {currentPeriod.status === 'approved' ? 'Approved' : `Submitted (Rev #${snapshot?.revision || currentPeriod.revision || 1})`}
                </div>
                <div className="text-[11.5px] text-emerald-800 leading-relaxed">
                  To submit a timesheet for another client or project, select them in the <strong>Billable Client</strong> dropdown above.
                </div>
              </div>
            </div>
            {/* Revision Dropdown if multiple snapshots exist */}
            {snapshots.length > 1 && (
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <span className="font-semibold text-slate-700">Snapshot Revision:</span>
                <select
                  value={snapshot?.revision}
                  onChange={(e) => setRevision(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500"
                >
                  {snapshots.map(s => (
                    <option key={s.revision} value={s.revision}>
                      Revision {s.revision} · {new Date(s.finalizedAt).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </div>
            )}


            {/* Export Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* CSV Export Card */}
              <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-2 flex flex-col justify-between">
                <div className="flex items-start gap-2.5">
                  <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/60 shrink-0">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">Spreadsheet Export (CSV)</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                      {activeClient ? `Itemized billing sheet for ${activeClient.name}` : 'Full consolidated billing sheet across all clients.'}
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-center text-xs"
                  onClick={() => handleDownload('csv')}
                  icon={<Download className="w-3.5 h-3.5" />}
                >
                  Download CSV
                </Button>
              </div>

              {/* JSON Export Card */}
              <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-2 flex flex-col justify-between">
                <div className="flex items-start gap-2.5">
                  <div className="p-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200/60 shrink-0">
                    <FileCode className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">Structured Data (JSON)</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                      Machine-readable payload formatted for billing APIs and accounting software.
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-center text-xs"
                  onClick={() => handleDownload('json')}
                  icon={<Download className="w-3.5 h-3.5" />}
                >
                  Download JSON
                </Button>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onClose}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
