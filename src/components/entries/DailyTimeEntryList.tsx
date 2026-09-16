import React from 'react';
import { TimeEntry } from '../../types/time-entry';
import { Client, Project } from '../../types/client-project';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCurrency } from '../../domain/time-calculations';
import { Clock, DollarSign, Edit3, Trash2, AlertTriangle, Plus, Sparkles } from 'lucide-react';

interface DailyTimeEntryListProps {
  entries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  activeDate: string;
  onEditEntry: (entry: TimeEntry) => void;
  onDeleteEntry: (entryId: string) => void;
  onAddNewManualEntry: () => void;
}

export const DailyTimeEntryList: React.FC<DailyTimeEntryListProps> = ({
  entries,
  clients,
  projects,
  activeDate,
  onEditEntry,
  onDeleteEntry,
  onAddNewManualEntry,
}) => {
  const todaysEntries = entries.filter(e => e.date === activeDate);

  const totalDayHours = todaysEntries.reduce((acc, e) => acc + e.decimalHours, 0);
  const totalDayRevenue = todaysEntries.reduce((acc, e) => acc + e.calculatedRevenue, 0);
  const unreviewedCount = todaysEntries.filter(e => e.needsReview).length;

  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <span>Billable Timesheet Entries</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono">
              {todaysEntries.length}
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Confirmed records ready for weekly timesheet submission
          </p>
        </div>

        <Button
          onClick={onAddNewManualEntry}
          variant="secondary"
          size="sm"
          icon={<Plus className="w-3.5 h-3.5 text-blue-600" />}
        >
          Add Manual
        </Button>
      </div>

      {/* Daily Metrics Pill */}
      {todaysEntries.length > 0 && (
        <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Logged Hours</div>
              <div className="text-sm font-bold font-mono text-slate-900">{totalDayHours.toFixed(1)}h</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Daily Revenue</div>
              <div className="text-sm font-bold font-mono text-emerald-700">{formatCurrency(totalDayRevenue)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Unreviewed AI entries alert */}
      {unreviewedCount > 0 && (
        <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{unreviewedCount} entry requires confirmation before final approval.</span>
        </div>
      )}

      {/* List of Entries */}
      <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
        {todaysEntries.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-xs">
            No entries logged for this day yet. Click an activity on the timeline or click "Add Manual" above.
          </div>
        ) : (
          todaysEntries.map(entry => {
            const client = clients.find(c => c.id === entry.clientId);
            const project = projects.find(p => p.id === entry.projectId);

            return (
              <div
                key={entry.id}
                className="p-3.5 rounded-xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all space-y-2 group shadow-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900">
                        {client?.name || 'Unassigned Client'}
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="text-xs text-slate-600 font-medium">
                        {project?.name || 'General Consulting'}
                      </span>
                      {entry.aiSuggested && (
                        <Badge variant="purple" size="sm">
                          <Sparkles className="w-3 h-3" /> AI
                        </Badge>
                      )}
                      {entry.needsReview && (
                        <Badge variant="amber" size="sm">
                          Review Needed
                        </Badge>
                      )}
                    </div>

                    <div className="text-sm font-semibold text-slate-800 mt-1">
                      {entry.taskName}
                    </div>

                    {entry.notes && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                        {entry.notes}
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold font-mono text-slate-900">
                      {entry.decimalHours}h
                    </div>
                    <div className="text-xs font-mono text-emerald-700 font-medium">
                      {formatCurrency(entry.calculatedRevenue)}
                    </div>
                  </div>
                </div>

                {/* Entry Footer: Timespan and Controls */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                  <span className="font-mono text-slate-500">
                    {entry.startTime} - {entry.endTime} ({entry.durationMinutes}m)
                  </span>

                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => onEditEntry(entry)}
                      className="p-1 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-colors"
                      title="Edit entry"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteEntry(entry.id)}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title="Delete entry"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
