import React, { useState, useMemo } from 'react';
import { TimesheetPeriod } from '../../types/timesheet';
import { Client, Project } from '../../types/client-project';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCurrency } from '../../domain/time-calculations';
import { 
  ClipboardCheck, 
  Clock, 
  CheckCircle2, 
  AlertTriangle,
  FileSpreadsheet, 
  FileCode, 
  Search, 
  CalendarDays, 
  Layers, 
  ArrowRight,
  Check, 
  Eye, 
  DollarSign
} from 'lucide-react';

interface ApprovalsHubViewProps {
  periods: TimesheetPeriod[];
  clients: Client[];
  projects: Project[];
  consultantName: string;
  consultantEmail: string;
  onViewSnapshot: (period: TimesheetPeriod) => void;
  onApprovePeriod?: (period: TimesheetPeriod) => void;
  onDownloadExport: (period: TimesheetPeriod, format: 'csv' | 'json') => void;
  onNavigateToTimesheet: (dateStr?: string) => void;
}

export const ApprovalsHubView: React.FC<ApprovalsHubViewProps> = ({
  periods,
  clients,
  projects,
  onViewSnapshot,
  onApprovePeriod,
  onDownloadExport,
  onNavigateToTimesheet,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'approved'>('all');
  const [clientFilter, setClientFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Active clients
  const activeClients = useMemo(() => clients.filter(c => !c.archived), [clients]);

  // Metric counts across all periods
  const totalSubmissions = periods.filter(p => p.status === 'submitted' || p.status === 'approved').length;
  const pendingCount = periods.filter(p => p.status === 'submitted').length;
  const approvedCount = periods.filter(p => p.status === 'approved').length;

  // Calculate total billed revenue across submitted/approved periods
  const totalSubmittedRevenue = useMemo(() => {
    return periods
      .filter(p => p.status === 'submitted' || p.status === 'approved')
      .reduce((sum, p) => {
        const lastSnapshot = p.snapshots && p.snapshots.length > 0 ? p.snapshots[p.snapshots.length - 1] : null;
        if (lastSnapshot) {
          const snapRev = lastSnapshot.entries.reduce((s, e) => s + (e.calculatedRevenue || 0), 0);
          return sum + snapRev;
        }
        return sum + (p.totalRevenue || 0);
      }, 0);
  }, [periods]);

  // Filtered periods list
  const filteredPeriods = useMemo(() => {
    return periods.filter(p => {
      // Status filter
      if (statusFilter === 'all') {
        if (p.status !== 'submitted' && p.status !== 'approved') return false;
      } else if (statusFilter === 'submitted' && p.status !== 'submitted') {
        return false;
      } else if (statusFilter === 'approved' && p.status !== 'approved') {
        return false;
      }

      // Client filter
      if (clientFilter && p.clientId !== clientFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const client = clients.find(c => c.id === p.clientId);
        const project = projects.find(pr => pr.id === p.projectId);
        const matchClient = client?.name.toLowerCase().includes(q) || client?.code.toLowerCase().includes(q);
        const matchProject = project?.name.toLowerCase().includes(q) || project?.code.toLowerCase().includes(q);
        const matchDate = p.startDate.includes(q) || p.endDate.includes(q);
        const matchComment = p.submissionComment?.toLowerCase().includes(q);
        if (!matchClient && !matchProject && !matchDate && !matchComment) return false;
      }

      return true;
    }).sort((a, b) => {
      // Sort submitted first, then by date descending
      if (a.status === 'submitted' && b.status !== 'submitted') return -1;
      if (b.status === 'submitted' && a.status !== 'submitted') return 1;
      return b.startDate.localeCompare(a.startDate);
    });
  }, [periods, statusFilter, clientFilter, searchQuery, clients, projects]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-1 pb-8">
      {/* 1. Header Banner */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-200/60 flex items-center justify-center">
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">
              Approvals & Submissions Ledger
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Track, inspect, and export submitted timesheets across all clients and projects.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigateToTimesheet()}
            icon={<CalendarDays className="w-3.5 h-3.5 text-slate-500" />}
          >
            Weekly Timesheet
          </Button>
        </div>
      </div>

      {/* 2. Top KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Submissions */}
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Submissions</div>
            <div className="text-lg font-bold text-slate-900 font-mono mt-0.5">{totalSubmissions}</div>
          </div>
        </div>

        {/* Pending Approval */}
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 border border-sky-200/60 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-sky-700 uppercase tracking-wider">Pending Approval</div>
            <div className="text-lg font-bold text-sky-700 font-mono mt-0.5">{pendingCount}</div>
          </div>
        </div>

        {/* Approved */}
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Approved</div>
            <div className="text-lg font-bold text-emerald-700 font-mono mt-0.5">{approvedCount}</div>
          </div>
        </div>

        {/* Billed Value */}
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-200/60 flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">Submitted Value</div>
            <div className="text-lg font-bold text-indigo-700 font-mono mt-0.5">{formatCurrency(totalSubmittedRevenue)}</div>
          </div>
        </div>
      </div>

      {/* 3. Toolbar: Status Tabs, Client Filter, & Search */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/60 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              statusFilter === 'all'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Submissions ({totalSubmissions})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('submitted')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              statusFilter === 'submitted'
                ? 'bg-white text-sky-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-sky-600" />
            Pending ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('approved')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              statusFilter === 'approved'
                ? 'bg-white text-emerald-700 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Approved ({approvedCount})
          </button>
        </div>

        {/* Client Filter & Search */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Client Selector */}
          <div className="relative">
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="text-xs font-medium rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-slate-700 focus:outline-none focus:border-blue-500"
            >
              <option value="">All Clients ({activeClients.length})</option>
              {activeClients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.code ? `(${c.code})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Quick Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search submissions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* 4. Submissions Ledger List */}
      {filteredPeriods.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 border border-blue-200/60 flex items-center justify-center mx-auto">
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <div className="text-sm font-bold text-slate-800">
            No Timesheet Submissions Found
          </div>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {periods.length === 0
              ? 'When you finalize and submit timesheets, they will appear here with live approval status and one-click exports.'
              : 'No timesheets match your current filters. Clear the search or status filter to view all.'}
          </p>
          <div className="pt-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => onNavigateToTimesheet()}
              icon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Go to Timesheet
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPeriods.map(p => {
            const client = clients.find(c => c.id === p.clientId);
            const project = projects.find(pr => pr.id === p.projectId);
            const lastSnapshot = p.snapshots && p.snapshots.length > 0 ? p.snapshots[p.snapshots.length - 1] : null;
            
            const entriesCount = lastSnapshot ? lastSnapshot.entries.length : p.entriesCount;
            const hours = lastSnapshot 
              ? lastSnapshot.entries.reduce((sum, e) => sum + e.decimalHours, 0)
              : p.totalHours;
            const revenue = lastSnapshot
              ? lastSnapshot.entries.reduce((sum, e) => sum + e.calculatedRevenue, 0)
              : p.totalRevenue;

            return (
              <div
                key={p.id}
                className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs hover:border-blue-200 transition-all space-y-3"
              >
                {/* Row Header */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Revision Pill */}
                    <div className="px-2 h-7 rounded-lg bg-blue-50 text-blue-700 border border-blue-200/60 flex items-center justify-center font-bold text-xs shrink-0 font-sans" title={`Timesheet Revision ${p.revision || 1}`}>
                      Rev #{p.revision || 1}
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {client ? (
                          <Badge variant="sky" size="sm">{client.name}</Badge>
                        ) : (
                          <Badge variant="slate" size="sm">All Clients</Badge>
                        )}
                        {project && (
                          <span className="text-xs font-bold text-slate-800">
                            {project.name}
                          </span>
                        )}
                        <span className="text-xs text-slate-500 font-mono flex items-center gap-1">
                          <CalendarDays className="w-3 h-3 text-slate-400" />
                          {p.startDate} → {p.endDate}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {p.status === 'approved' ? (
                      <Badge variant="emerald" size="sm">
                        <CheckCircle2 className="w-3 h-3 mr-1 inline" />
                        Approved
                      </Badge>
                    ) : p.status === 'submitted' ? (
                      <Badge variant="sky" size="sm">
                        <Clock className="w-3 h-3 mr-1 inline" />
                        Pending Approval
                      </Badge>
                    ) : p.status === 'rejected' ? (
                      <Badge variant="rose" size="sm">
                        <AlertTriangle className="w-3 h-3 mr-1 inline" />
                        Revision Needed
                      </Badge>
                    ) : (
                      <Badge variant="slate" size="sm">
                        Draft Revision
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Metrics & Meta Details */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 font-mono text-xs">
                  <div className="bg-slate-50/70 p-2 rounded-xl border border-slate-100">
                    <span className="text-[10px] text-slate-400 font-sans uppercase font-semibold block">Entries</span>
                    <span className="font-bold text-slate-800">{entriesCount} logged</span>
                  </div>
                  <div className="bg-slate-50/70 p-2 rounded-xl border border-slate-100">
                    <span className="text-[10px] text-slate-400 font-sans uppercase font-semibold block">Billed Time</span>
                    <span className="font-bold text-blue-700">{hours.toFixed(1)}h</span>
                  </div>
                  <div className="bg-slate-50/70 p-2 rounded-xl border border-slate-100">
                    <span className="text-[10px] text-slate-400 font-sans uppercase font-semibold block">Total Revenue</span>
                    <span className="font-bold text-emerald-700">{formatCurrency(revenue)}</span>
                  </div>
                  <div className="bg-slate-50/70 p-2 rounded-xl border border-slate-100">
                    <span className="text-[10px] text-slate-400 font-sans uppercase font-semibold block">Submitted At</span>
                    <span className="text-slate-600 font-sans text-[11px] truncate block">
                      {p.submittedAt ? new Date(p.submittedAt).toLocaleDateString() : 'Draft'}
                    </span>
                  </div>
                </div>

                {/* Submission Notes if present */}
                {p.submissionComment && (
                  <div className="text-[11.5px] text-slate-600 bg-slate-50/80 p-2 rounded-xl border border-slate-100 italic">
                    "{p.submissionComment}"
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-1.5">
                    {/* One-Click Download Buttons (for periods with snapshot) */}
                    {lastSnapshot && (
                      <>
                        <button
                          type="button"
                          onClick={() => onDownloadExport(p, 'csv')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 hover:bg-emerald-100 transition-colors cursor-pointer"
                          title="Download Client CSV"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>CSV</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDownloadExport(p, 'json')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 hover:bg-blue-100 transition-colors cursor-pointer"
                          title="Download Structured JSON"
                        >
                          <FileCode className="w-3.5 h-3.5" />
                          <span>JSON</span>
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Inspect Snapshot Modal */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onViewSnapshot(p)}
                      icon={<Eye className="w-3.5 h-3.5 text-slate-500" />}
                    >
                      View Details
                    </Button>

                    {/* Quick Approve Action */}
                    {p.status === 'submitted' && onApprovePeriod && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onApprovePeriod(p)}
                        icon={<Check className="w-3.5 h-3.5" />}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-2xs"
                      >
                        Approve
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
