import React, { useRef, useMemo } from 'react';
import { 
  Search, 
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { localDate } from '../../domain/calendar';

interface TrackerHeaderProps {
  viewMode: 'timeline' | 'timesheet' | 'approvals';
  onChangeViewMode: (mode: 'timeline' | 'timesheet' | 'approvals') => void;
  activeDate: string;
  onSelectDate: (date: string) => void;
  weekDays: { dateStr: string; dayName: string; dayNumber: number }[];
  isCapturing: boolean;
  hasEngagements?: boolean;
  onToggleCapture: () => void;
  onOpenProjectModal: () => void;
  onOpenSettingsModal: () => void;
  onAddNewEntry?: () => void;
  onOpenCalendarImport?: () => void;
  onOpenAiAutoAssign?: () => void;
  unassignedCount?: number;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export const TrackerHeader: React.FC<TrackerHeaderProps> = ({
  viewMode,
  onChangeViewMode,
  activeDate,
  onSelectDate,
  onAddNewEntry,
  onOpenAiAutoAssign,
  onOpenCalendarImport,
  searchQuery = '',
  onSearchChange,
}) => {
  const todayStr = useMemo(() => localDate(new Date()), []);
  const lastWheelTimeRef = useRef<number>(0);

  // Shift active date by specified days
  const shiftDate = (days: number) => {
    const current = new Date(`${activeDate}T12:00:00`);
    current.setDate(current.getDate() + days);
    onSelectDate(localDate(current));
  };

  // Generate exactly 5 dates centered around activeDate (-2, -1, center=0, +1, +2)
  const visibleDates = useMemo(() => {
    const center = new Date(`${activeDate}T12:00:00`);
    return [-2, -1, 0, 1, 2].map((offset) => {
      const d = new Date(center);
      d.setDate(d.getDate() + offset);
      const dateStr = localDate(d);
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
      return {
        dateStr,
        dayName,
        dayNumber: d.getDate(),
        monthShort: d.toLocaleString('en-US', { month: 'short' }),
        isToday: dateStr === todayStr,
        isSelected: offset === 0, // Center date is active date
      };
    });
  }, [activeDate, todayStr]);

  // Mouse wheel roll handler over the 5-date ribbon
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const now = Date.now();
    if (now - lastWheelTimeRef.current < 150) return;

    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(delta) < 4) return;

    lastWheelTimeRef.current = now;
    if (delta < 0) {
      shiftDate(-1); // roll up/left: older date
    } else {
      shiftDate(1);  // roll down/right: future date
    }
  };

  return (
    <header className="border-b border-slate-100 bg-white sticky top-0 z-20 shrink-0 select-none">
      <div className="w-full px-2 sm:px-3 h-10 flex items-center justify-between gap-1.5 sm:gap-2 min-w-0">
        {/* Left Side: Compact View Switcher & Responsive Search */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-shrink">
          {/* Segmented View Switcher */}
          <div className="flex items-center h-7 p-0.5 bg-slate-100 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => onChangeViewMode('timeline')}
              className={`h-6 px-2 sm:px-2.5 flex items-center justify-center rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                viewMode === 'timeline'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
              title="Timeline view"
            >
              Timeline
            </button>

            <button
              type="button"
              onClick={() => onChangeViewMode('timesheet')}
              className={`h-6 px-2 sm:px-2.5 flex items-center justify-center rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                viewMode === 'timesheet'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
              title="Timesheet view"
            >
              Timesheet
            </button>

            <button
              type="button"
              onClick={() => onChangeViewMode('approvals')}
              className={`h-6 px-2 sm:px-2.5 flex items-center justify-center rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                viewMode === 'approvals'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
              title="Approvals and Submissions Ledger"
            >
              Approvals
            </button>
          </div>

          {/* Clean Matching Search Bar (Responsive Width) */}
          <div className="flex items-center h-7 w-28 sm:w-36 md:w-44 lg:w-52 focus-within:w-40 sm:focus-within:w-52 px-2 sm:px-2.5 bg-slate-100 hover:bg-slate-100/90 focus-within:bg-white focus-within:ring-1 focus-within:ring-blue-500/40 focus-within:border-blue-400 border border-transparent rounded-lg transition-all min-w-[70px] shrink">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-1.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none leading-none min-w-0"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange?.('')}
                className="text-slate-400 hover:text-slate-600 p-0.5 rounded-full cursor-pointer ml-1 shrink-0"
                title="Clear search"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>

        {/* Center: Clean 5-Date Carousel Ribbon (Responsive Width) */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink min-w-0 justify-center">
          {/* Previous day chevron */}
          <button
            type="button"
            onClick={() => shiftDate(-1)}
            className="p-0.5 sm:p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer active:scale-90 shrink-0"
            title="Previous day (or roll mouse wheel left)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {/* Exactly 5 Clean Dates Container with Mouse Wheel listener */}
          <div 
            onWheel={handleWheel}
            className="flex items-center gap-0.5 sm:gap-1 select-none cursor-ew-resize py-0.5"
            title="Roll mouse wheel to shift dates back and forward"
          >
            {visibleDates.map(d => {
              const isSelected = d.isSelected;
              const isToday = d.isToday;

              return (
                <button
                  key={d.dateStr}
                  type="button"
                  onClick={() => onSelectDate(d.dateStr)}
                  className={`relative w-9 sm:w-10 md:w-11 h-7 flex flex-col items-center justify-center rounded-lg text-xs transition-all duration-150 ease-out cursor-pointer shrink-0 transform active:scale-80 hover:scale-105 ${
                    isSelected
                      ? 'bg-blue-600 text-white font-bold shadow-xs scale-105 ring-2 ring-blue-500/25'
                      : isToday
                      ? 'bg-slate-600 text-white font-semibold shadow-2xs hover:bg-slate-700'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/80'
                  }`}
                  title={`${d.dayName}, ${d.monthShort} ${d.dayNumber}, ${d.dateStr}${isToday ? ' (Today)' : ''}`}
                >
                  <span className={`text-[7.5px] sm:text-[8px] uppercase font-semibold leading-tight flex items-center gap-0.5 ${
                    isSelected
                      ? 'text-blue-100'
                      : isToday
                      ? 'text-slate-200 font-semibold'
                      : 'text-slate-400'
                  }`}>
                    {d.dayName}
                    {isToday && (
                      <span className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-slate-300'}`} />
                    )}
                  </span>
                  <span className={`font-mono text-[10px] sm:text-[11px] leading-tight font-semibold ${
                    isSelected || isToday ? 'text-white' : 'text-slate-700'
                  }`}>
                    {d.dayNumber}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Next day chevron */}
          <button
            type="button"
            onClick={() => shiftDate(1)}
            className="p-0.5 sm:p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer active:scale-90 shrink-0"
            title="Next day (or roll mouse wheel right)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* Jump to Today Button */}
          {activeDate !== todayStr && (
            <button
              type="button"
              onClick={() => onSelectDate(todayStr)}
              className="px-1 sm:px-1.5 py-0.5 text-[8.5px] sm:text-[9px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200/70 rounded-md transition-all cursor-pointer shrink-0 active:scale-90 ml-0.5"
              title="Return to Today"
            >
              Today
            </button>
          )}
        </div>

        {/* Right Side: Clean Action Buttons in Same Theme */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {/* Premium Manual Entry Button: Log Time */}
          {onAddNewEntry && (
            <div className="flex items-center h-7 p-0.5 bg-slate-100 rounded-lg shrink-0">
              <button
                type="button"
                onClick={onAddNewEntry}
                className="h-6 px-2 sm:px-2.5 flex items-center justify-center rounded-md text-[11px] font-semibold text-slate-700 hover:text-slate-950 hover:bg-white hover:shadow-2xs transition-all cursor-pointer active:scale-95 whitespace-nowrap"
                title="Log manual time entry"
              >
                Log Time
              </button>
            </div>
          )}

          {/* AI Auto-Assign Renamed in Premium Theme: Smart Allocate */}
          {onOpenAiAutoAssign && (
            <div className="flex items-center h-7 p-0.5 bg-slate-100 rounded-lg shrink-0">
              <button
                type="button"
                onClick={onOpenAiAutoAssign}
                className="h-6 px-2 sm:px-2.5 flex items-center justify-center rounded-md text-[11px] font-semibold text-slate-700 hover:text-slate-950 hover:bg-white hover:shadow-2xs transition-all cursor-pointer active:scale-95 whitespace-nowrap"
                title="Smart AI automated allocation of captured activities"
              >
                <span>Smart Allocate</span>
              </button>
            </div>
          )}

          {/* Import Calendar Button */}
          <div className="flex items-center h-7 p-0.5 bg-slate-100 rounded-lg shrink-0">
            <button
              type="button"
              onClick={onOpenCalendarImport}
              className="h-6 px-2 sm:px-2.5 flex items-center justify-center rounded-md text-[11px] font-semibold text-slate-700 hover:text-slate-950 hover:bg-white hover:shadow-2xs transition-all cursor-pointer active:scale-95 whitespace-nowrap"
              title="Import calendar meetings (.ics, Google, Outlook)"
            >
              Import Calendar
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
