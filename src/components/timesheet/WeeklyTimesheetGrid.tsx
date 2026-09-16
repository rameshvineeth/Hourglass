import React, { useState, useMemo } from 'react';
import { TimesheetPeriod } from '../../types/timesheet';
import { TimeEntry } from '../../types/time-entry';
import { Client, Project } from '../../types/client-project';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { formatCurrency } from '../../domain/time-calculations';
import { cleanTaskDescription, cleanEntryNotes } from '../../domain/timeline-layout';
import { 
  Calendar, 
  Clock, 
  DollarSign, 
  Send, 
  ShieldCheck, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  Building2, 
  FolderKanban, 
  Search, 
  Plus, 
  Edit3, 
  Trash2, 
  TrendingUp,
  FileCheck2,
  CalendarDays,
  Layers,
  X
} from 'lucide-react';
import { ActivityItem } from '../../types/activity';

interface WeeklyTimesheetGridProps {
  period: TimesheetPeriod;
  periods?: TimesheetPeriod[];
  timeEntries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  activities?: ActivityItem[];
  weekDays: { dateStr: string; dayName: string; dayNumber: number }[];
  onOpenValidationModal: () => void;
  onSelectDate: (dateStr: string) => void;
  activeDate: string;
  onNavigateWeek?: (direction: -1 | 1 | 0) => void;
  onAddNewEntry?: (prefill?: { clientId?: string; projectId?: string; date?: string }) => void;
  onEditEntry?: (entry: TimeEntry) => void;
  onDeleteEntry?: (entryId: string) => void;
}

export const WeeklyTimesheetGrid: React.FC<WeeklyTimesheetGridProps> = ({
  period,
  periods = [],
  timeEntries,
  clients,
  projects,
  activities = [],
  weekDays,
  onOpenValidationModal,
  onSelectDate,
  activeDate,
  onNavigateWeek,
  onAddNewEntry,
  onEditEntry,
  onDeleteEntry,
}) => {
  // Grouping Mode: Group by Client (nested projects) vs. Direct Project list
  const [groupBy, setGroupBy] = useState<'client' | 'project'>('client');

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Interactive Cell Inspector Modal
  const [inspectCell, setInspectCell] = useState<{
    projectId: string;
    dateStr: string;
    clientName: string;
    projectName: string;
    rate: number;
  } | null>(null);

  // Client accordion expand/collapse state
  const [expandedClientIds, setExpandedClientIds] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    clients.forEach(c => { initial[c.id] = true; });
    return initial;
  });

  const toggleClientExpand = (clientId: string) => {
    setExpandedClientIds(prev => ({ ...prev, [clientId]: !prev[clientId] }));
  };

  const expandAllClients = () => {
    const next: Record<string, boolean> = {};
    clients.forEach(c => { next[c.id] = true; });
    setExpandedClientIds(next);
  };

  const collapseAllClients = () => {
    setExpandedClientIds({});
  };

  // Check if any approved or submitted periods exist for the active week
  const hasApprovedOrSubmitted = useMemo(() => {
    const weekStart = weekDays[0]?.dateStr;
    return (periods || []).some(
      p => (p.startDate === weekStart || p.startDate === period.startDate) &&
           (p.status === 'approved' || p.status === 'submitted')
    ) || (period.status === 'approved' || period.status === 'submitted');
  }, [periods, weekDays, period]);

  // Restrict time entries to the active week period
  const weekDateSet = useMemo(() => new Set(weekDays.map(d => d.dateStr)), [weekDays]);
  
  const weekEntries = useMemo(() => {
    return timeEntries.filter(e => weekDateSet.has(e.date));
  }, [timeEntries, weekDateSet]);

  // Filter entries by live search query
  const filteredWeekEntries = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return weekEntries;
    return weekEntries.filter(e => {
      const client = clients.find(c => c.id === e.clientId);
      const project = projects.find(p => p.id === e.projectId);
      return (
        (e.taskName && e.taskName.toLowerCase().includes(q)) ||
        (e.notes && e.notes.toLowerCase().includes(q)) ||
        (client?.name && client.name.toLowerCase().includes(q)) ||
        (client?.code && client.code.toLowerCase().includes(q)) ||
        (project?.name && project.name.toLowerCase().includes(q)) ||
        (project?.code && project.code.toLowerCase().includes(q))
      );
    });
  }, [weekEntries, clients, projects, searchQuery]);

  // Active search state and displayed entries
  const isSearching = searchQuery.trim().length > 0;
  const displayEntries = isSearching ? filteredWeekEntries : weekEntries;

  const getEntryHours = (e: TimeEntry) => {
    if (e.decimalHours > 0) return e.decimalHours;
    if (e.durationMinutes > 0) return Math.max(0.01, Number((e.durationMinutes / 60).toFixed(2)));
    if ((e.actualDurationSeconds ?? 0) > 0) return Math.max(0.01, Number(((e.actualDurationSeconds! / 3600)).toFixed(2)));
    return 0;
  };

  // Weekly metrics calculations (for overall period summary cards)
  const totalPeriodHours = useMemo(() => {
    return weekEntries.reduce((acc, e) => acc + getEntryHours(e), 0);
  }, [weekEntries]);

  const billableHours = useMemo(() => {
    return weekEntries.filter(e => e.isBillable).reduce((acc, e) => acc + getEntryHours(e), 0);
  }, [weekEntries]);

  const totalRevenue = useMemo(() => {
    return weekEntries.reduce((acc, e) => acc + (e.calculatedRevenue || 0), 0);
  }, [weekEntries]);

  const billablePercent = totalPeriodHours > 0 ? Math.round((billableHours / totalPeriodHours) * 100) : 0;
  const avgEffectiveRate = billableHours > 0 ? Math.round(totalRevenue / billableHours) : 0;

  // Active projects with time logged in this week (filtered by search when active)
  const activeProjects = useMemo(() => {
    const activeIds = new Set(displayEntries.map(e => e.projectId));
    return projects.filter(p => activeIds.has(p.id));
  }, [projects, displayEntries]);

  // Active clients with projects logged in this week (filtered by search when active)
  const activeClients = useMemo(() => {
    const clientIdsWithHours = new Set(activeProjects.map(p => p.clientId));
    return clients.filter(c => clientIdsWithHours.has(c.id));
  }, [clients, activeProjects]);

  // Aggregate hours for a specific project on a specific date (uses displayEntries)
  const getHoursForProjectAndDate = (projectId: string, dateStr: string) => {
    return displayEntries
      .filter(e => e.projectId === projectId && e.date === dateStr)
      .reduce((acc, e) => acc + getEntryHours(e), 0);
  };

  // Aggregate hours for an entire client on a specific date (uses displayEntries)
  const getHoursForClientAndDate = (clientId: string, dateStr: string) => {
    return displayEntries
      .filter(e => e.clientId === clientId && e.date === dateStr)
      .reduce((acc, e) => acc + getEntryHours(e), 0);
  };

  // Aggregate total day hours (uses displayEntries)
  const getDayTotalHours = (dateStr: string) => {
    return displayEntries
      .filter(e => e.date === dateStr)
      .reduce((acc, e) => acc + getEntryHours(e), 0);
  };

  // Get raw entries for a specific project on a specific date
  const getEntriesForProjectAndDate = (projectId: string, dateStr: string) => {
    return displayEntries.filter(e => e.projectId === projectId && e.date === dateStr);
  };

  // Get raw entries for a client on a specific date
  const getEntriesForClientAndDate = (clientId: string, dateStr: string) => {
    return displayEntries.filter(e => e.clientId === clientId && e.date === dateStr);
  };

  // Display totals for footer summary (matches search filter)
  const displayTotalPeriodHours = useMemo(() => {
    return displayEntries.reduce((acc, e) => acc + getEntryHours(e), 0);
  }, [displayEntries]);

  const displayTotalRevenue = useMemo(() => {
    return displayEntries.reduce((acc, e) => acc + (e.calculatedRevenue || 0), 0);
  }, [displayEntries]);

  // Entries for the inspect cell popup
  const inspectCellEntries = useMemo(() => {
    if (!inspectCell) return [];
    return displayEntries.filter(
      e => e.projectId === inspectCell.projectId && e.date === inspectCell.dateStr
    );
  }, [displayEntries, inspectCell]);

  return (
    <div className="space-y-5 pb-6">
      {/* 1. TOP STAT CARDS — Executive Overview (Compact) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Total Work Hours */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">Total Work Hours</span>
            <div className="p-1 rounded-md bg-blue-50 text-blue-600">
              <Clock className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-slate-900">{totalPeriodHours >= 0.1 ? `${totalPeriodHours.toFixed(1)}h` : totalPeriodHours > 0 ? `${totalPeriodHours.toFixed(2)}h` : '0.0h'}</span>
            <span className="text-[11px] text-slate-400 font-mono">/ 40.0h</span>
          </div>
          <div className="w-full bg-slate-100 h-1 rounded-full mt-2 overflow-hidden">
            <div 
              className="bg-blue-600 h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, (totalPeriodHours / 40) * 100)}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-400 mt-1 font-medium flex items-center justify-between">
            <span>{Math.min(100, Math.round((totalPeriodHours / 40) * 100))}% week</span>
            <span>{(totalPeriodHours / 5).toFixed(1)}h/workday</span>
          </div>
        </div>

        {/* Billable Utilization */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">Billable Utilization</span>
            <div className="p-1 rounded-md bg-emerald-50 text-emerald-600">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-emerald-700">{billablePercent}%</span>
            <span className="text-[11px] text-slate-500 font-mono">({billableHours >= 0.1 ? `${billableHours.toFixed(1)}h` : billableHours > 0 ? `${billableHours.toFixed(2)}h` : '0.0h'})</span>
          </div>
          <div className="w-full bg-slate-100 h-1 rounded-full mt-2 overflow-hidden">
            <div 
              className="bg-emerald-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${billablePercent}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-400 mt-1 font-medium flex items-center justify-between">
            <span>{(totalPeriodHours - billableHours).toFixed(1)}h admin</span>
            <span className="text-emerald-700 font-semibold">{billableHours >= 0.1 ? `${billableHours.toFixed(1)}h` : billableHours > 0 ? `${billableHours.toFixed(2)}h` : '0.0h'} billable</span>
          </div>
        </div>

        {/* Projected Revenue */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">Projected Revenue</span>
            <div className="p-1 rounded-md bg-emerald-50 text-emerald-600">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-slate-900">{formatCurrency(totalRevenue)}</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-emerald-600" />
              <span>Yield: <strong className="font-mono text-slate-800">${avgEffectiveRate}/h</strong></span>
            </div>
            <span className="text-slate-400 font-mono text-[9.5px]">
              {weekEntries.length} {weekEntries.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </div>

        {/* Period Status & Submission Action */}
        <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">Timesheet Status</span>
            {period.status === 'approved' ? (
              <Badge variant="emerald" size="sm">Approved</Badge>
            ) : period.status === 'submitted' ? (
              <Badge variant="sky" size="sm">Rev #{period.revision || 1} Locked</Badge>
            ) : period.status === 'rejected' ? (
              <Badge variant="rose" size="sm">Needs Revision</Badge>
            ) : (
              <Badge variant="slate" size="sm">Draft Period</Badge>
            )}
          </div>
          
          <div className="mt-2.5 flex items-center gap-1.5">
            <Button
              onClick={onOpenValidationModal}
              variant="primary"
              size="sm"
              className="flex-1 justify-center shadow-xs text-xs h-8"
              icon={<Send className="w-3.5 h-3.5" />}
            >
              {period.status === 'draft' ? 'Review & Finalize' : 'Submit Timesheet'}
            </Button>
            {hasApprovedOrSubmitted && (
              <Button
                onClick={onOpenValidationModal}
                variant="outline"
                size="sm"
                className="justify-center text-xs h-8 px-2.5 text-slate-700"
                title="Export Finalized Snapshot (CSV/JSON)"
                icon={<FileCheck2 className="w-3.5 h-3.5 text-slate-600" />}
              >
                Export
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 2. TOOLBAR: Week Navigation, View Modes, Grouping, & Search */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Left: Week Navigation Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {onNavigateWeek && (
            <div className="flex items-center border border-slate-200 rounded-xl bg-slate-50/70 p-0.5">
              <button
                type="button"
                onClick={() => onNavigateWeek(-1)}
                className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                title="Previous Week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigateWeek(0)}
                className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-blue-600 transition-colors cursor-pointer"
              >
                This Week
              </button>
              <button
                type="button"
                onClick={() => onNavigateWeek(1)}
                className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                title="Next Week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100/90 border border-slate-200/80 text-xs font-medium text-slate-800">
            <CalendarDays className="w-3.5 h-3.5 text-blue-600" />
            <span>{period.startDate}</span>
            <span className="text-slate-400">→</span>
            <span>{period.endDate}</span>
          </div>
        </div>

        {/* Center/Right: Grouping Toggle & Live Search */}
        <div className="flex items-center gap-3 flex-wrap justify-between lg:justify-end">
          {/* Grouping Toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-400">Group:</span>
            <div className="flex items-center bg-slate-100/80 p-0.5 rounded-lg border border-slate-200/60">
              <button
                type="button"
                onClick={() => setGroupBy('client')}
                className={`px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer flex items-center gap-1.5 ${
                  groupBy === 'client'
                    ? 'bg-white text-blue-700 font-semibold shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Group projects nested under clients"
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>By Client</span>
              </button>
              <button
                type="button"
                onClick={() => setGroupBy('project')}
                className={`px-2.5 py-1 rounded-md text-xs transition-all cursor-pointer flex items-center gap-1.5 ${
                  groupBy === 'project'
                    ? 'bg-white text-blue-700 font-semibold shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Flat list by project"
              >
                <FolderKanban className="w-3.5 h-3.5" />
                <span>By Project</span>
              </button>
            </div>
          </div>

          {/* Live Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search timesheet..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 focus:bg-white text-slate-800 w-44 sm:w-56 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5 transition-colors"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. MAIN CONTENT: Matrix View */}
      <div className="bg-white rounded-2xl overflow-hidden border border-slate-200/90 shadow-2xs">
          {/* Header Controls */}
          <div className="p-3.5 px-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                {groupBy === 'client' ? <Building2 className="w-4 h-4 text-blue-600" /> : <FolderKanban className="w-4 h-4 text-blue-600" />}
                <span>
                  {groupBy === 'client' 
                    ? `Client Engagements (${activeClients.length} active clients, ${activeProjects.length} projects)` 
                    : `Active Project Engagements (${activeProjects.length} projects)`}
                </span>
              </span>

              {groupBy === 'client' && activeClients.length > 0 && (
                <div className="flex items-center gap-2 text-[11px] text-slate-400 ml-2 pl-2 border-l border-slate-200">
                  <button
                    type="button"
                    onClick={expandAllClients}
                    className="hover:text-blue-600 cursor-pointer"
                  >
                    Expand All
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={collapseAllClients}
                    className="hover:text-blue-600 cursor-pointer"
                  >
                    Collapse All
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Billable hours</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-slate-100 border border-slate-200" />
                <span>Click cell to inspect / edit</span>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 uppercase tracking-wider font-semibold text-[10.5px]">
                  <th className="p-3.5 min-w-[260px]">
                    {groupBy === 'client' ? 'Client & Engagements' : 'Project & Client'}
                  </th>
                  <th className="p-3.5 text-right w-24">Rate</th>
                  {weekDays.map(d => {
                    const isWeekend = d.dayName === 'Sat' || d.dayName === 'Sun';
                    const isActive = activeDate === d.dateStr;

                    return (
                      <th 
                        key={d.dateStr} 
                        onClick={() => onSelectDate(d.dateStr)}
                        className={`p-3 text-center cursor-pointer transition-colors w-24 select-none ${
                          isActive 
                            ? 'bg-blue-50 text-blue-700 font-bold border-b-2 border-blue-600' 
                            : isWeekend 
                            ? 'bg-slate-100/50 text-slate-500 hover:bg-slate-100' 
                            : 'hover:bg-slate-100 text-slate-700'
                        }`}
                        title={`Click to focus ${d.dayName} (${d.dateStr})`}
                      >
                        <div className="font-semibold">{d.dayName}</div>
                        <div className="text-[10px] font-mono font-normal text-slate-400 mt-0.5">{d.dayNumber}</div>
                      </th>
                    );
                  })}
                  <th className="p-3.5 text-right font-bold w-28 text-slate-900">Weekly Total</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 font-mono">
                {activeProjects.length === 0 ? (
                  <tr>
                    <td colSpan={weekDays.length + 3} className="p-12 text-center text-slate-400 text-xs font-sans">
                      {isSearching ? (
                        <div className="max-w-sm mx-auto">
                          <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-2.5 text-slate-400">
                            <Search className="w-5 h-5 text-slate-400" />
                          </div>
                          <div className="font-semibold text-slate-700 mb-1">No Entries Matching "{searchQuery}"</div>
                          <p className="text-slate-400 mb-3">
                            No timesheet entries found for this week matching your search query.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSearchQuery('')}
                          >
                            Clear Search
                          </Button>
                        </div>
                      ) : (
                        <div>
                          <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-2.5">
                            <Calendar className="w-5 h-5 text-slate-400" />
                          </div>
                          <div className="font-semibold text-slate-700 mb-1">No Time Entries Recorded for this Week</div>
                          <p className="text-slate-400 max-w-sm mx-auto">
                            Convert timeline activities on the Activity tab or click cells to log work directly.
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : groupBy === 'client' ? (
                  /* --- GROUP BY CLIENT (Nested hierarchy) --- */
                  activeClients.map(client => {
                    const clientProjects = activeProjects.filter(p => p.clientId === client.id);
                    const isExpanded = expandedClientIds[client.id] !== false;

                    const clientEntries = displayEntries.filter(e => e.clientId === client.id);
                    const clientWeeklyTotal = clientEntries.reduce((acc, e) => acc + getEntryHours(e), 0);
                    const clientWeeklyRevenue = clientEntries.reduce((sum, e) => sum + (e.calculatedRevenue || 0), 0);

                    return (
                      <React.Fragment key={`client_grp_${client.id}`}>
                        {/* Parent Client Summary Header Row */}
                        <tr className="bg-slate-50/70 border-t border-slate-200/80 hover:bg-blue-50/30 transition-colors">
                          <td className="p-3 font-sans">
                            <button
                              type="button"
                              onClick={() => toggleClientExpand(client.id)}
                              className="flex items-center gap-2 text-left cursor-pointer w-full group"
                            >
                              <div className="p-1 rounded hover:bg-slate-200/60 text-slate-500 transition-colors">
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                              </div>
                              <span 
                                className="w-2.5 h-2.5 rounded-full shrink-0" 
                                style={{ backgroundColor: client.color || '#0284c7' }} 
                              />
                              <span className="font-bold text-xs text-slate-900 group-hover:text-blue-700 transition-colors">
                                {client.name}
                              </span>
                              <span className="text-[10.5px] text-slate-400 font-normal">
                                · {clientProjects.length} {clientProjects.length === 1 ? 'project' : 'projects'}
                              </span>
                            </button>
                          </td>

                          <td className="p-3 text-right text-[11px] text-slate-400 font-sans">
                            Client Total
                          </td>

                          {weekDays.map(d => {
                            const isWeekend = d.dayName === 'Sat' || d.dayName === 'Sun';
                            const clientDayEntries = getEntriesForClientAndDate(client.id, d.dateStr);
                            const clientDayHours = getHoursForClientAndDate(client.id, d.dateStr);

                            return (
                              <td 
                                key={d.dateStr}
                                onClick={() => onSelectDate(d.dateStr)}
                                className={`p-2.5 text-center text-xs font-bold transition-colors cursor-pointer ${
                                  activeDate === d.dateStr
                                    ? 'bg-blue-50/50'
                                    : isWeekend
                                    ? 'bg-slate-100/40'
                                    : ''
                                }`}
                              >
                                {clientDayEntries.length > 0 ? (
                                  <span className="text-slate-800 font-semibold font-mono">
                                    {clientDayHours >= 0.1 ? `${clientDayHours.toFixed(1)}h` : `${clientDayHours.toFixed(2)}h`}
                                  </span>
                                ) : (
                                  <span className="text-slate-300 font-normal">·</span>
                                )}
                              </td>
                            );
                          })}

                          <td className="p-3 text-right">
                            <div className="text-xs font-bold text-slate-900 font-mono">
                              {clientWeeklyTotal >= 0.1 ? `${clientWeeklyTotal.toFixed(1)}h` : clientWeeklyTotal > 0 ? `${clientWeeklyTotal.toFixed(2)}h` : '0.0h'}
                            </div>
                            <div className="text-[10px] text-emerald-700 font-semibold font-mono">
                              {formatCurrency(clientWeeklyRevenue)}
                            </div>
                          </td>
                        </tr>

                        {/* Nested Child Project Rows */}
                        {isExpanded && clientProjects.map(proj => {
                          const projectEntries = displayEntries.filter(e => e.projectId === proj.id);
                          const projectTotal = projectEntries.reduce((acc, e) => acc + getEntryHours(e), 0);
                          const projectRevenue = projectEntries.reduce((sum, e) => sum + (e.calculatedRevenue || 0), 0);

                          return (
                            <tr key={proj.id} className="hover:bg-blue-50/20 transition-colors bg-white">
                              {/* Indented Project Name & Code */}
                              <td className="p-3 pl-8 font-sans">
                                <div className="flex items-center gap-2">
                                  <span 
                                    className="w-1.5 h-1.5 rounded-full shrink-0" 
                                    style={{ backgroundColor: proj.color || client.color || '#0284c7' }} 
                                  />
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold text-slate-800 truncate">
                                      {proj.name}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      <span className="text-[10px] font-mono font-medium text-slate-400 uppercase bg-slate-100 px-1 py-0.2 rounded">
                                        {proj.code}
                                      </span>
                                      {!proj.isBillableDefault && (
                                        <span className="text-[9.5px] text-slate-400 italic">
                                          Non-billable
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Rate */}
                              <td className="p-3 text-right text-slate-600 font-mono text-xs">
                                {proj.isBillableDefault ? `$${proj.defaultHourlyRate}/h` : '—'}
                              </td>

                              {/* Mon - Sun Day Cells */}
                              {weekDays.map(d => {
                                const isWeekend = d.dayName === 'Sat' || d.dayName === 'Sun';
                                const cellEntries = getEntriesForProjectAndDate(proj.id, d.dateStr);
                                const cellHours = getHoursForProjectAndDate(proj.id, d.dateStr);

                                return (
                                  <td 
                                    key={d.dateStr} 
                                    className={`p-2 text-center transition-all ${
                                      activeDate === d.dateStr 
                                        ? 'bg-blue-50/40' 
                                        : isWeekend 
                                        ? 'bg-slate-50/40' 
                                        : ''
                                    }`}
                                  >
                                    {cellEntries.length > 0 ? (
                                      <button
                                        type="button"
                                        onClick={() => setInspectCell({
                                          projectId: proj.id,
                                          dateStr: d.dateStr,
                                          clientName: client.name,
                                          projectName: proj.name,
                                          rate: proj.defaultHourlyRate,
                                        })}
                                        className="font-bold text-blue-900 bg-blue-50/90 hover:bg-blue-100 border border-blue-200/80 px-2 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer shadow-2xs hover:scale-105 active:scale-95"
                                        title={`View / edit ${cellHours >= 0.1 ? cellHours.toFixed(1) : cellHours.toFixed(2)}h logged on ${d.dayName} (${cellEntries.length} ${cellEntries.length === 1 ? 'entry' : 'entries'})`}
                                      >
                                        {cellHours >= 0.1 ? `${cellHours.toFixed(1)}h` : `${cellHours.toFixed(2)}h`}
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => onAddNewEntry && onAddNewEntry({
                                          clientId: client.id,
                                          projectId: proj.id,
                                          date: d.dateStr,
                                        })}
                                        className="w-7 h-6 rounded-md hover:bg-slate-100 text-slate-300 hover:text-blue-600 flex items-center justify-center mx-auto transition-colors cursor-pointer text-xs"
                                        title={`Log time on ${proj.name} for ${d.dayName}`}
                                      >
                                        +
                                      </button>
                                    )}
                                  </td>
                                );
                              })}

                              {/* Project Total Column */}
                              <td className="p-3 text-right">
                                <div className="text-xs font-bold text-slate-900 font-mono">
                                  {projectTotal >= 0.1 ? `${projectTotal.toFixed(1)}h` : projectTotal > 0 ? `${projectTotal.toFixed(2)}h` : '0.0h'}
                                </div>
                                <div className="text-[10px] text-slate-500 font-normal font-mono">
                                  {formatCurrency(projectRevenue)}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })
                ) : (
                  /* --- GROUP BY PROJECT (Direct flat list) --- */
                  activeProjects.map(proj => {
                    const parentClient = clients.find(c => c.id === proj.clientId);
                    const projectEntries = displayEntries.filter(e => e.projectId === proj.id);
                    const projectTotal = projectEntries.reduce((acc, e) => acc + getEntryHours(e), 0);
                    const projectRevenue = projectEntries.reduce((sum, e) => sum + (e.calculatedRevenue || 0), 0);

                    return (
                      <tr key={proj.id} className="hover:bg-blue-50/30 transition-colors bg-white">
                        <td className="p-3 font-sans">
                          <div className="flex items-center gap-2.5">
                            <span 
                              className="w-2.5 h-2.5 rounded-full shrink-0" 
                              style={{ backgroundColor: proj.color || parentClient?.color || '#0284c7' }} 
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900 truncate">
                                {proj.name}
                              </div>
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                <span>{parentClient?.name || 'Client'}</span>
                                <span className="font-mono text-[10px] bg-slate-100 px-1 py-0.2 rounded text-slate-400">
                                  {proj.code}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="p-3 text-right text-slate-600 font-mono text-xs">
                          {proj.isBillableDefault ? `$${proj.defaultHourlyRate}/h` : '—'}
                        </td>

                        {weekDays.map(d => {
                          const isWeekend = d.dayName === 'Sat' || d.dayName === 'Sun';
                          const cellEntries = getEntriesForProjectAndDate(proj.id, d.dateStr);
                          const cellHours = getHoursForProjectAndDate(proj.id, d.dateStr);

                          return (
                            <td 
                              key={d.dateStr} 
                              className={`p-2 text-center transition-all ${
                                activeDate === d.dateStr 
                                  ? 'bg-blue-50/40' 
                                  : isWeekend 
                                  ? 'bg-slate-50/40' 
                                  : ''
                              }`}
                            >
                              {cellEntries.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setInspectCell({
                                    projectId: proj.id,
                                    dateStr: d.dateStr,
                                    clientName: parentClient?.name || 'Client',
                                    projectName: proj.name,
                                    rate: proj.defaultHourlyRate,
                                  })}
                                  className="font-bold text-blue-900 bg-blue-50/90 hover:bg-blue-100 border border-blue-200/80 px-2 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer shadow-2xs hover:scale-105 active:scale-95"
                                  title={`View / edit ${cellHours >= 0.1 ? cellHours.toFixed(1) : cellHours.toFixed(2)}h logged on ${d.dayName} (${cellEntries.length} ${cellEntries.length === 1 ? 'entry' : 'entries'})`}
                                >
                                  {cellHours >= 0.1 ? `${cellHours.toFixed(1)}h` : `${cellHours.toFixed(2)}h`}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onAddNewEntry && onAddNewEntry({
                                    clientId: parentClient?.id,
                                    projectId: proj.id,
                                    date: d.dateStr,
                                  })}
                                  className="w-7 h-6 rounded-md hover:bg-slate-100 text-slate-300 hover:text-blue-600 flex items-center justify-center mx-auto transition-colors cursor-pointer text-xs"
                                  title={`Log time on ${proj.name} for ${d.dayName}`}
                                >
                                  +
                                </button>
                              )}
                            </td>
                          );
                        })}

                        <td className="p-3 text-right">
                          <div className="text-xs font-bold text-slate-900 font-mono">
                            {projectTotal >= 0.1 ? `${projectTotal.toFixed(1)}h` : projectTotal > 0 ? `${projectTotal.toFixed(2)}h` : '0.0h'}
                          </div>
                          <div className="text-[10px] text-slate-500 font-normal font-mono">
                            {formatCurrency(projectRevenue)}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* High Contrast Footer Summary Row */}
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-mono font-bold text-slate-900">
                  <td className="p-3.5 font-sans flex items-center justify-between">
                    <span>{isSearching ? 'Search Total Daily Hours' : 'Total Daily Hours'}</span>
                    <span className="text-[10px] text-slate-400 font-normal uppercase">
                      {weekDays.length} Days
                    </span>
                  </td>
                  <td className="p-3.5 text-right text-slate-400 font-normal">—</td>
                  {weekDays.map(d => {
                    const isWeekend = d.dayName === 'Sat' || d.dayName === 'Sun';
                    const dayTotal = getDayTotalHours(d.dateStr);
                    const dayEntries = displayEntries.filter(e => e.date === d.dateStr);

                    return (
                      <td 
                        key={d.dateStr} 
                        onClick={() => onSelectDate(d.dateStr)}
                        className={`p-3 text-center transition-colors cursor-pointer ${
                          activeDate === d.dateStr 
                            ? 'bg-blue-100/70 text-blue-900 font-extrabold' 
                            : isWeekend
                            ? 'bg-slate-100/70 text-slate-700'
                            : 'text-slate-800'
                        }`}
                        title={`Focus ${d.dayName}`}
                      >
                        {dayEntries.length > 0 ? (dayTotal >= 0.1 ? `${dayTotal.toFixed(1)}h` : `${dayTotal.toFixed(2)}h`) : '-'}
                      </td>
                    );
                  })}
                  <td className="p-3.5 text-right text-emerald-800 text-sm font-extrabold bg-emerald-50/40">
                    <div>{displayTotalPeriodHours >= 0.1 ? `${displayTotalPeriodHours.toFixed(1)}h` : displayTotalPeriodHours > 0 ? `${displayTotalPeriodHours.toFixed(2)}h` : '0.0h'}</div>
                    <div className="text-[10px] font-normal text-emerald-700">
                      {formatCurrency(displayTotalRevenue)}
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

      {/* 4. CELL INSPECTION MODAL (When user clicks an hour badge on the matrix) */}
      {inspectCell && (
        <Modal
          isOpen={!!inspectCell}
          onClose={() => setInspectCell(null)}
          title={`Entries: ${inspectCell.projectName}`}
          subtitle={`${inspectCell.clientName} · ${inspectCell.dateStr} · $${inspectCell.rate}/hr`}
          maxWidth="md"
        >
          <div className="space-y-3 pt-1">
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {inspectCellEntries.map(e => {
                const sourceActs = (e.sourceActivityIds || e.allocations?.map(a => a.activityId) || [])
                  .map(id => activities.find(a => a.id === id))
                  .filter(Boolean) as ActivityItem[];
                const sourceAppName = e.sourceAppName || (sourceActs.length > 0 ? [...new Set(sourceActs.map(a => a.appName).filter(Boolean))].join(', ') : undefined);

                return (
                  <div 
                    key={e.id}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900">
                        {cleanTaskDescription(e.taskName, sourceAppName)}
                      </div>
                      {cleanEntryNotes(e.notes, e.taskName, sourceAppName) && (
                        <div className="text-[11px] text-slate-500 italic mt-0.5">
                          "{cleanEntryNotes(e.notes, e.taskName, sourceAppName)}"
                        </div>
                      )}
                      <div className="text-[10px] text-slate-400 font-mono mt-1">
                        {e.startTime && e.endTime ? `${e.startTime.slice(0, 5)} - ${e.endTime.slice(0, 5)} · ` : ''}
                        {e.durationMinutes < 1 ? `${Math.round(e.durationMinutes * 60)}s` : `${e.durationMinutes.toFixed(1)} min`} billing
                      </div>
                      {/* Activity Evidence Justification */}
                      {sourceAppName ? (
                        <div className="flex items-center gap-1.5 text-[10px] bg-white border border-slate-200/90 rounded-md px-2 py-0.5 text-slate-600 w-fit mt-1">
                          <Layers className="w-3 h-3 text-blue-600 shrink-0" />
                          <span className="font-semibold text-slate-700 shrink-0">Logged from:</span>
                          <span className="font-medium text-slate-800 truncate max-w-[260px]" title={sourceAppName}>
                            {sourceAppName}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                          <span>Manual timesheet entry</span>
                        </div>
                      )}
                    </div>

                  <div className="text-right font-mono shrink-0">
                    <div className="font-bold text-slate-900">{getEntryHours(e) >= 0.1 ? `${getEntryHours(e).toFixed(1)}h` : `${getEntryHours(e).toFixed(2)}h`}</div>
                    <div className="text-[10.5px] text-emerald-700 font-semibold">{formatCurrency(e.calculatedRevenue)}</div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {onEditEntry && (
                      <button
                        type="button"
                        onClick={() => {
                          setInspectCell(null);
                          onEditEntry(e);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-100/60 transition-colors cursor-pointer"
                        title="Edit this entry"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onDeleteEntry && (
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteEntry(e.id);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Delete this entry"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const target = inspectCell;
                  setInspectCell(null);
                  onSelectDate(target.dateStr);
                }}
              >
                Focus Day on Timeline
              </Button>

              {onAddNewEntry && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const target = inspectCell;
                    setInspectCell(null);
                    onAddNewEntry({
                      projectId: target.projectId,
                      date: target.dateStr,
                    });
                  }}
                  icon={<Plus className="w-3.5 h-3.5" />}
                >
                  Add Another Entry
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
