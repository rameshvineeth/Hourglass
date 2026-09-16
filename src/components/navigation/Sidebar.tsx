import React from 'react';
import { 
  LayoutDashboard, 
  CalendarDays, 
  Briefcase, 
  Wand2, 
  Settings, 
  PanelLeftClose, 
  PanelLeft, 
  Power,
  ClipboardCheck
} from 'lucide-react';

interface SidebarProps {
  viewMode: 'timeline' | 'timesheet' | 'approvals';
  onChangeViewMode: (mode: 'timeline' | 'timesheet' | 'approvals') => void;
  isCapturing: boolean;
  hasEngagements: boolean;
  onToggleCapture: () => void;
  onOpenProjectModal: () => void;
  onOpenSettingsModal: () => void;
  onOpenAiAutoAssign: () => void;
  unassignedCount: number;
  pendingApprovalsCount?: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  consultantName?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  viewMode,
  onChangeViewMode,
  isCapturing,
  onToggleCapture,
  onOpenProjectModal,
  onOpenSettingsModal,
  onOpenAiAutoAssign,
  unassignedCount,
  pendingApprovalsCount = 0,
  isCollapsed,
  onToggleCollapse,
  consultantName,
}) => {
  return (
    <aside
      className={`relative flex flex-col bg-white border-r border-slate-100 select-none transition-all duration-200 ease-in-out z-30 shrink-0 ${
        isCollapsed ? 'w-13' : 'w-48'
      }`}
    >
      {/* Brand Header - Slim & Clean */}
      <div className={`h-11 flex items-center border-b border-slate-100 transition-all ${
        isCollapsed ? 'justify-center px-1' : 'justify-between px-3'
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          {/* Hourglass Icon */}
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-xs shrink-0">
            <svg 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2.2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="w-3.5 h-3.5"
            >
              <path d="M5 22h14" />
              <path d="M5 2h14" />
              <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
              <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
              <circle cx="12" cy="16" r="1" fill="currentColor" />
            </svg>
          </div>

          {!isCollapsed && (
            <span className="font-bold text-slate-900 tracking-tight text-xs font-sans truncate">
              Hourglass
            </span>
          )}
        </div>

        {/* Collapse Toggle */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer ${
            isCollapsed ? 'hidden' : 'block'
          }`}
          title="Collapse Sidebar"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* When collapsed, quick expand button */}
      {isCollapsed && (
        <div className="flex justify-center pt-2 pb-0.5">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Expand Sidebar"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Navigation */}
      <div className={`flex-1 overflow-y-auto no-scrollbar space-y-4 ${isCollapsed ? 'px-1 py-2' : 'px-2 py-3'}`}>
        {/* Section: Overview */}
        <div>
          {!isCollapsed && (
            <div className="px-2 mb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Overview
            </div>
          )}
          <nav className="space-y-1">
            {/* Timeline Stream */}
            <button
              type="button"
              onClick={() => onChangeViewMode('timeline')}
              className={`w-full flex items-center transition-all duration-150 cursor-pointer ${
                isCollapsed
                  ? 'justify-center w-9 h-9 mx-auto rounded-xl'
                  : 'gap-2.5 px-2.5 py-1.5 rounded-xl text-xs font-medium'
              } ${
                viewMode === 'timeline'
                  ? 'bg-blue-50/80 text-blue-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
              title="Activity & Timeline"
            >
              <LayoutDashboard className={`w-4 h-4 shrink-0 ${
                viewMode === 'timeline' ? 'text-blue-600' : 'text-slate-400'
              }`} />
              {!isCollapsed && (
                <span className="text-xs font-medium tracking-tight truncate">Timeline</span>
              )}
            </button>

            {/* Weekly Timesheet Matrix */}
            <button
              type="button"
              onClick={() => onChangeViewMode('timesheet')}
              className={`w-full flex items-center transition-all duration-150 cursor-pointer ${
                isCollapsed
                  ? 'justify-center w-9 h-9 mx-auto rounded-xl'
                  : 'gap-2.5 px-2.5 py-1.5 rounded-xl text-xs font-medium'
              } ${
                viewMode === 'timesheet'
                  ? 'bg-blue-50/80 text-blue-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
              title="Weekly Timesheet Matrix"
            >
              <CalendarDays className={`w-4 h-4 shrink-0 ${
                viewMode === 'timesheet' ? 'text-blue-600' : 'text-slate-400'
              }`} />
              {!isCollapsed && (
                <span className="text-xs font-medium tracking-tight truncate">Timesheet</span>
              )}
            </button>

            {/* Approvals & Submissions */}
            <button
              type="button"
              onClick={() => onChangeViewMode('approvals')}
              className={`w-full flex items-center transition-all duration-150 cursor-pointer ${
                isCollapsed
                  ? 'justify-center w-9 h-9 mx-auto rounded-xl relative'
                  : 'justify-between px-2.5 py-1.5 rounded-xl text-xs font-medium'
              } ${
                viewMode === 'approvals'
                  ? 'bg-blue-50/80 text-blue-600 shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
              title="Approvals & Submissions Ledger"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ClipboardCheck className={`w-4 h-4 shrink-0 ${
                  viewMode === 'approvals' ? 'text-blue-600' : 'text-slate-400'
                }`} />
                {!isCollapsed && (
                  <span className="text-xs font-medium tracking-tight truncate">Approvals</span>
                )}
              </div>
              {pendingApprovalsCount > 0 && (
                isCollapsed ? (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white" />
                ) : (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 font-mono">
                    {pendingApprovalsCount}
                  </span>
                )
              )}
            </button>
          </nav>
        </div>

        {/* Section: Practice & AI */}
        <div>
          {!isCollapsed && (
            <div className="px-2 mb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Workspace
            </div>
          )}
          <nav className="space-y-1">
            {/* Smart Allocate */}
            <button
              type="button"
              onClick={onOpenAiAutoAssign}
              className={`relative w-full flex items-center transition-all duration-150 cursor-pointer ${
                isCollapsed
                  ? 'justify-center w-9 h-9 mx-auto rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  : 'justify-between px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
              title="Smart Allocate (AI Assisted)"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Wand2 className="w-4 h-4 shrink-0 text-violet-600" />
                {!isCollapsed && (
                  <span className="text-xs font-medium tracking-tight truncate">Smart Allocate</span>
                )}
              </div>
              {!isCollapsed && unassignedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-violet-50 text-violet-700 border border-violet-200/60 font-mono">
                  {unassignedCount}
                </span>
              )}
              {isCollapsed && unassignedCount > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-violet-600 ring-2 ring-white" />
              )}
            </button>

            {/* Clients */}
            <button
              type="button"
              onClick={onOpenProjectModal}
              className={`w-full flex items-center transition-all duration-150 cursor-pointer ${
                isCollapsed
                  ? 'justify-center w-9 h-9 mx-auto rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  : 'gap-2.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-50'
              }`}
              title="Clients & Projects"
            >
              <Briefcase className="w-4 h-4 shrink-0 text-indigo-500" />
              {!isCollapsed && (
                <span className="text-xs font-medium tracking-tight truncate">Clients</span>
              )}
            </button>
          </nav>
        </div>
      </div>

      {/* Footer: User Profile, Live Capture & Settings */}
      <div className={`border-t border-slate-100 ${isCollapsed ? 'p-1.5 space-y-2' : 'p-2 space-y-2'}`}>
        {/* Horizontal Round Cartoon Avatar & Username */}
        <div
          onClick={onOpenSettingsModal}
          className={`flex items-center transition-all duration-150 cursor-pointer group ${
            isCollapsed 
              ? 'justify-center w-9 h-9 mx-auto rounded-xl hover:bg-slate-50' 
              : 'gap-2.5 px-2 py-1.5 rounded-xl hover:bg-slate-50 w-full'
          }`}
          title="User Profile & Settings"
        >
          {/* Round Cartoon Avatar Picture */}
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full overflow-hidden ring-1.5 ring-slate-200/90 shadow-2xs bg-amber-100 flex items-center justify-center transition-transform group-hover:scale-105 active:scale-95">
              <img
                src="https://api.dicebear.com/7.x/avataaars/svg?seed=vineeth&backgroundColor=ffdfbf,ffd5dc,d1d4f9,c0aede,b6e3f4&accessoriesChance=0"
                alt="vineeth"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              {/* Cute Cartoon Character SVG Fallback */}
              <svg viewBox="0 0 36 36" fill="none" className="w-full h-full text-indigo-500">
                <circle cx="18" cy="18" r="18" fill="#FDE68A" />
                <circle cx="12" cy="15" r="2" fill="#1F2937" />
                <circle cx="24" cy="15" r="2" fill="#1F2937" />
                <path d="M12 21C12 24.3137 14.6863 27 18 27C21.3137 27 24 24.3137 24 21" stroke="#1F2937" strokeWidth="2" strokeLinecap="round" />
                <path d="M8 12C9.5 8 13 6 18 6C23 6 26.5 8 28 12" stroke="#B45309" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
            {/* Online Status Indicator */}
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-1.5 ring-white" />
          </div>

          {/* Adjacent Name & Role */}
          {!isCollapsed && (
            <div className="min-w-0 flex-1 text-left">
              <span className="text-xs font-semibold text-slate-800 tracking-tight block truncate leading-tight">
                {consultantName && consultantName !== 'Consultant' ? consultantName : 'vineeth'}
              </span>
              <span className="text-[10px] font-medium text-slate-400 block truncate leading-tight mt-0.5">
                Consultant
              </span>
            </div>
          )}
        </div>

        {/* Live Capture Switch */}
        {isCollapsed ? (
          <button
            type="button"
            onClick={onToggleCapture}
            className={`w-9 h-9 mx-auto rounded-xl flex items-center justify-center transition-all cursor-pointer ${
              isCapturing
                ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
            }`}
            title={
              isCapturing
                ? 'Capturing Active — click to pause'
                : 'Capturing Paused — click to resume'
            }
          >
            <Power className={`w-4 h-4 ${isCapturing ? 'animate-pulse' : ''}`} />
          </button>
        ) : (
          <div
            onClick={onToggleCapture}
            className={`cursor-pointer rounded-xl p-2 border transition-all ${
              isCapturing
                ? 'bg-emerald-50/70 border-emerald-200/80 text-emerald-900 hover:bg-emerald-100/70'
                : 'bg-slate-50 border-slate-200/80 text-slate-600 hover:bg-slate-100'
            }`}
            title={
              isCapturing
                ? 'Tracking Active: Click to pause'
                : 'Tracking Paused: Click to resume'
            }
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isCapturing
                      ? 'bg-emerald-500 animate-pulse'
                      : 'bg-slate-400'
                  }`}
                />
                <span className="text-[11px] font-semibold tracking-tight truncate">
                  {isCapturing ? 'Capture ON' : 'Capture OFF'}
                </span>
              </div>

              {/* iOS Style Switch Track */}
              <div
                className={`w-7 h-4 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
                  isCapturing ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white shadow-2xs transform transition-transform ${
                    isCapturing ? 'translate-x-3' : 'translate-x-0'
                  }`}
                />
              </div>
            </div>
          </div>
        )}

        {/* Settings button */}
        <button
          type="button"
          onClick={onOpenSettingsModal}
          className={`flex items-center transition-all duration-150 cursor-pointer ${
            isCollapsed
              ? 'justify-center w-9 h-9 mx-auto rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50'
              : 'w-full gap-2.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
          title="Preferences & Groq API"
        >
          <Settings className="w-4 h-4 shrink-0 text-slate-400" />
          {!isCollapsed && (
            <span className="text-xs font-medium tracking-tight truncate">Settings</span>
          )}
        </button>
      </div>
    </aside>
  );
};
