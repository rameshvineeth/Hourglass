import React, { useState } from 'react';
import { ActivityItem, AppCategory } from '../../types/activity';
import { TimeEntry, RoundingMode } from '../../types/time-entry';
import { Client, Project } from '../../types/client-project';
import { Button } from '../ui/Button';
import { BrandIcon } from '../ui/BrandIcon';
import { 
  roundDurationMinutes, 
  formatDurationHuman, 
  timeStringToMinutes 
} from '../../domain/time-calculations';
import { detectTimelineGaps } from '../../domain/gap-detector';
import { 
  Plus, 
  CheckCircle2, 
  AlertCircle, 
  Activity,
  Clock,
  Briefcase
} from 'lucide-react';

interface ActivityTimelineProps {
  activities: ActivityItem[];
  timeEntries: TimeEntry[];
  clients: Client[];
  projects: Project[];
  activeDate: string;
  roundingMode: RoundingMode;
  isCapturing: boolean;
  onToggleCapture: () => void;
  onSelectActivityToLog: (activity: ActivityItem) => void;
  onOpenAiAutoAssign: () => void;
  onOpenProjectModal?: () => void;
  onClearActivities?: () => void;
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  activities,
  timeEntries,
  clients,
  projects,
  activeDate,
  roundingMode,
  isCapturing,
  onToggleCapture,
  onSelectActivityToLog,
  onOpenProjectModal,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<AppCategory | 'all'>('all');
  const [hoveredActId, setHoveredActId] = useState<string | null>(null);

  const hasEngagements = clients.length > 0 && projects.length > 0;

  // Filter activities by category if clicked
  const filteredActivities = activities
    .filter(act => {
      if (selectedCategory !== 'all' && act.category !== selectedCategory) return false;
      return true;
    })
    .sort((a, b) => timeStringToMinutes(b.startTime) - timeStringToMinutes(a.startTime));

  // Compute total minutes recorded today
  const totalTrackedMinutes = activities.reduce((acc, a) => acc + Math.round(a.durationSeconds / 60), 0);
  const totalTrackedHours = (totalTrackedMinutes / 60).toFixed(1);

  // Category breakdown for subtle mini-stats
  const categoryStats = [
    { id: 'all', label: 'All' },
    { id: 'browser', label: 'Web / Cloud' },
    { id: 'document', label: 'Documents' },
    { id: 'spreadsheet', label: 'Excel / Models' },
    { id: 'meeting', label: 'Meetings' },
    { id: 'communication', label: 'Chats' },
  ];

  // Untracked gaps analysis
  const todaysEntries = timeEntries.filter(e => e.date === activeDate);
  const detectedGaps = detectTimelineGaps(todaysEntries, '09:00', '18:00', 30);

  return (
    <div className="space-y-3">
      {/* Prerequisite Setup Alert if no clients/projects */}
      {!hasEngagements && (
        <div className="p-4 rounded-2xl bg-blue-50/80 border border-blue-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm shadow-blue-500/20">
              <Briefcase className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-blue-950 uppercase tracking-wider">
                Step 1: Configure Client Engagement
              </h4>
              <p className="text-xs text-blue-800 mt-0.5 leading-relaxed">
                Add at least one client, project engagement, and bill rate ($/hr) before enabling automatic capture.
              </p>
            </div>
          </div>
          {onOpenProjectModal && (
            <Button
              onClick={onOpenProjectModal}
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              className="shrink-0"
            >
              Add First Client & Rate
            </Button>
          )}
        </div>
      )}

      {/* Untracked Workday Gaps Banner */}
      {detectedGaps.length > 0 && todaysEntries.length > 0 && (
        <div className="p-3 rounded-2xl bg-amber-50/80 border border-amber-200/80 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-amber-900">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>{detectedGaps.length} Untracked Gap(s) Detected:</strong>{' '}
              {detectedGaps.map(g => `${g.startTime}-${g.endTime} (${formatDurationHuman(g.durationMinutes)})`).join(', ')}.
            </span>
          </div>
          <span className="text-amber-700 font-mono text-[11px] shrink-0 font-medium">
            Lost time is lost revenue
          </span>
        </div>
      )}

      {/* Modern High-Precision Timeline Ruler & Activity Stream Card */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        {/* Timeline Stream Top Control Strip */}
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">Activity Stream</span>
            <span className="text-[11px] font-mono text-slate-400">• {filteredActivities.length} events ({totalTrackedHours}h total)</span>
          </div>

          {/* Clean segmented category pills */}
          <div className="flex items-center gap-1 bg-white p-0.5 rounded-xl border border-slate-200/60 shadow-2xs">
            {categoryStats.map(cat => {
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id as any)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                    isSelected
                      ? 'bg-blue-50 text-blue-700 font-semibold shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Timeline Canvas / Stream */}
        {filteredActivities.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            {!hasEngagements ? (
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center mx-auto">
                  <Briefcase className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Setup Required Before Starting
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Add your client engagements and billable rates so your recorded time can be attributed and submitted on your weekly timesheet.
                </p>
                {onOpenProjectModal && (
                  <div className="pt-2">
                    <Button onClick={onOpenProjectModal} variant="primary" size="sm" icon={<Plus className="w-4 h-4" />}>
                      Set Up First Client & Rate
                    </Button>
                  </div>
                )}
              </div>
            ) : isCapturing ? (
              <div className="space-y-3">
                <div className="relative w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto">
                  <span className="w-6 h-6 rounded-full bg-emerald-400/30 animate-ping absolute" />
                  <Activity className="w-6 h-6 relative z-10" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Automatic Background Capture is Active
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  Hourglass is actively recording all your foreground applications and browser tabs in the background. Switch to Chrome, Excel, Word, or any document to populate the timeline.
                </p>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Native Win32 Hook Active
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
                  <Clock className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Activity Capture is Paused
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  Time capture is currently paused. Switch capture ON in the sidebar to record background app usage.
                </p>
                <Button onClick={onToggleCapture} variant="primary" size="sm">
                  Turn Capture ON
                </Button>
              </div>
            )}
          </div>
        ) : (
          /* Continuous Native Proportional Time Strip */
          <div className="p-4 sm:p-5 space-y-1.5">
            {filteredActivities.map((act) => {
              const durationMins = Math.max(1, Math.round(act.durationSeconds / 60));
              const { decimalHours } = roundDurationMinutes(durationMins, roundingMode);
              const assignedEntry = timeEntries.find(e => act.assignedEntryId === e.id || e.sourceActivityIds?.includes(act.id));
              const assignedClient = assignedEntry ? clients.find(c => c.id === assignedEntry.clientId) : null;
              const assignedProject = assignedEntry ? projects.find(p => p.id === assignedEntry.projectId) : null;

              // Card proportions: 1-2 min is sleek compact block, 3-7 min medium, 8+ min tall hero card
              const isLargeBlock = durationMins >= 8;
              const isMediumBlock = durationMins >= 3 && durationMins < 8;

              // Extract minute label e.g. ":52"
              const minuteLabel = act.startTime.includes(':') ? `:${act.startTime.split(':')[1]}` : act.startTime;
              const isHovered = hoveredActId === act.id;

              return (
                <div
                  key={act.id}
                  onMouseEnter={() => setHoveredActId(act.id)}
                  onMouseLeave={() => setHoveredActId(null)}
                  className="flex items-stretch gap-3.5 group relative"
                >
                  {/* Left Column: Native Vertical Time Ruler Marking */}
                  <div className="w-11 shrink-0 flex flex-col justify-between py-1 text-right select-none">
                    <span className="font-mono text-xs font-semibold text-slate-400 group-hover:text-blue-600 transition-colors">
                      {minuteLabel}
                    </span>
                    {isLargeBlock && (
                      <span className="font-mono text-[10px] text-slate-300">
                        {act.endTime.includes(':') ? `:${act.endTime.split(':')[1]}` : ''}
                      </span>
                    )}
                  </div>

                  {/* Vertical Ruler Line with Tick */}
                  <div className="relative flex flex-col items-center">
                    <div className={`w-2 h-2 rounded-full border transition-all shrink-0 mt-2.5 z-10 ${
                      assignedEntry
                        ? 'bg-emerald-500 border-emerald-600'
                        : isHovered
                        ? 'bg-blue-600 border-blue-600 scale-125'
                        : 'bg-white border-slate-300 group-hover:border-blue-400'
                    }`} />
                    <div className="w-px bg-slate-200/80 flex-1 my-0.5" />
                  </div>

                  {/* Activity Bar Capsule */}
                  <div
                    className={`flex-1 rounded-2xl border transition-all duration-150 p-3 shadow-2xs ${
                      assignedEntry
                        ? 'bg-emerald-50/40 border-emerald-200'
                        : isHovered
                        ? 'bg-blue-50/20 border-blue-300 shadow-xs'
                        : isLargeBlock
                        ? 'bg-slate-50/70 border-slate-200/90'
                        : 'bg-white border-slate-200/80 hover:border-slate-300'
                    } ${
                      isLargeBlock
                        ? 'min-h-[96px] flex flex-col justify-between'
                        : isMediumBlock
                        ? 'min-h-[58px] flex flex-col justify-between'
                        : 'min-h-[44px] flex items-center justify-between'
                    }`}
                  >
                    {/* Top Row: App Icon + Clean Title + Duration */}
                    <div className="flex items-center justify-between gap-3 w-full">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <BrandIcon
                          appName={act.appName}
                          windowTitle={act.windowTitle}
                          appIcon={act.appIcon}
                          className="w-4 h-4 shrink-0"
                        />
                        <span 
                          className="text-[13px] font-semibold text-slate-900 truncate tracking-tight" 
                          title={act.windowTitle}
                        >
                          {act.windowTitle}
                        </span>
                      </div>

                      {/* Right Duration Pill & 1-Click Billable Logger */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono text-slate-500 bg-slate-100/90 px-2 py-0.5 rounded-lg font-medium">
                          {durationMins}m
                        </span>

                        {!assignedEntry ? (
                          <button
                            type="button"
                            onClick={() => onSelectActivityToLog(act)}
                            className="text-[11px] font-semibold text-blue-600 hover:text-white hover:bg-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200/80 transition-all duration-150 shadow-2xs"
                          >
                            Log {decimalHours}h
                          </button>
                        ) : (
                          <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200/80">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Billed
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Extended Details for High-Focus Sessions */}
                    {isLargeBlock && (
                      <div className="pt-3 mt-2 border-t border-slate-200/50 flex items-center justify-between text-xs text-slate-500">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-700">{act.appName}</span>
                          <span>•</span>
                          <span className="font-mono text-slate-600">{act.startTime} - {act.endTime}</span>
                          <span>•</span>
                          <span className="text-blue-700 font-semibold">{decimalHours}h Billable (0.1h Tenth-Hour)</span>
                        </div>
                        {assignedEntry && (
                          <span className="text-emerald-700 font-medium text-[11px]">
                            {assignedClient?.name} › {assignedProject?.name}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
