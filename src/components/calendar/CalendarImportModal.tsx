import React, { useState, useRef, useMemo } from 'react';
import { 
  Upload, 
  Check, 
  Clock, 
  MapPin, 
  AlertCircle,
  Video,
  ListPlus
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Client, Project } from '../../types/client-project';
import { ActivityItem } from '../../types/activity';
import { TimeEntry } from '../../types/time-entry';
import { 
  ParsedCalendarEvent, 
  parseIcsContent, 
  calendarEventsToActivities, 
  calendarEventsToTimeEntries 
} from '../../domain/calendar-import';

interface CalendarImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeDate: string;
  clients: Client[];
  projects: Project[];
  defaultHourlyRate?: number;
  onImportActivities: (activities: ActivityItem[]) => void;
  onImportTimeEntries: (entries: TimeEntry[]) => void;
  onAddProject?: (project: Project) => void;
}

export const CalendarImportModal: React.FC<CalendarImportModalProps> = ({
  isOpen,
  onClose,
  activeDate,
  clients,
  projects,
  defaultHourlyRate = 250,
  onImportActivities,
  onImportTimeEntries,
  onAddProject,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [events, setEvents] = useState<ParsedCalendarEvent[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [importMode, setImportMode] = useState<'activity' | 'timesheet'>('activity');
  const [selectedClientId, setSelectedClientId] = useState<string>(() => {
    const firstActive = clients.find(c => !c.archived) || clients[0];
    return firstActive?.id || '';
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [hourlyRate, setHourlyRate] = useState<number>(defaultHourlyRate);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filter projects by selected client
  const availableProjects = useMemo(() => {
    if (!selectedClientId) return [];
    return projects.filter(p => p.clientId === selectedClientId && !p.archived);
  }, [projects, selectedClientId]);

  // Keep selectedProjectId in sync when availableProjects or selectedClientId changes
  React.useEffect(() => {
    if (availableProjects.length > 0) {
      if (!selectedProjectId || !availableProjects.some(p => p.id === selectedProjectId)) {
        const first = availableProjects[0];
        setSelectedProjectId(first.id);
        if (first.defaultHourlyRate !== undefined) {
          setHourlyRate(first.defaultHourlyRate);
        }
      }
    } else {
      setSelectedProjectId('');
    }
  }, [availableProjects, selectedProjectId]);

  const handleClientChange = (newClientId: string) => {
    setSelectedClientId(newClientId);
    const clientProjects = projects.filter(p => p.clientId === newClientId && !p.archived);
    if (clientProjects.length > 0) {
      setSelectedProjectId(clientProjects[0].id);
      if (clientProjects[0].defaultHourlyRate !== undefined) {
        setHourlyRate(clientProjects[0].defaultHourlyRate);
      }
    } else {
      setSelectedProjectId('');
    }
  };

  const handleProjectChange = (newProjectId: string) => {
    setSelectedProjectId(newProjectId);
    const proj = projects.find(p => p.id === newProjectId);
    if (proj && proj.defaultHourlyRate !== undefined) {
      setHourlyRate(proj.defaultHourlyRate);
    }
  };

  const handleQuickCreateProject = () => {
    if (!selectedClientId) return;
    const client = clients.find(c => c.id === selectedClientId);
    const clientName = client?.name || 'Client';
    const clientCode = (client?.code || clientName.slice(0, 4)).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const newProject: Project = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      clientId: selectedClientId,
      name: `${clientName} General`,
      code: `${clientCode}-GEN`,
      defaultHourlyRate: hourlyRate || defaultHourlyRate,
      isBillableDefault: true,
      color: client?.color || '#0ea5e9',
      createdAt: new Date().toISOString(),
    };
    onAddProject?.(newProject);
    setSelectedProjectId(newProject.id);
    setStatusMessage(`Created project "${newProject.name}" for ${clientName}.`);
  };

  // Reset state when opening modal
  React.useEffect(() => {
    if (isOpen) {
      setEvents([]);
      setSelectedEventIds(new Set());
      setErrorMessage(null);
      setStatusMessage(null);
    }
  }, [isOpen]);

  const handleFile = async (file: File) => {
    try {
      setErrorMessage(null);
      const text = await file.text();
      const parsed = parseIcsContent(text);
      if (parsed.length === 0) {
        setErrorMessage('No valid calendar events (VEVENT) found in this .ics file.');
        return;
      }
      setEvents(parsed);
      setSelectedEventIds(new Set(parsed.map(e => e.id)));
      setStatusMessage(`Found ${parsed.length} meeting event(s) in "${file.name}".`);
    } catch (err) {
      setErrorMessage(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedEventIds.size === events.length) {
      setSelectedEventIds(new Set());
    } else {
      setSelectedEventIds(new Set(events.map(e => e.id)));
    }
  };

  const toggleSelectEvent = (id: string) => {
    setSelectedEventIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExecuteImport = () => {
    const selectedEvents = events.filter(e => selectedEventIds.has(e.id));
    if (selectedEvents.length === 0) {
      setErrorMessage('Please select at least one calendar event to import.');
      return;
    }

    if (importMode === 'activity') {
      const activities = calendarEventsToActivities(selectedEvents);
      onImportActivities(activities);
    } else {
      if (!selectedClientId) {
        setErrorMessage('Please choose a Client for billable time entries.');
        return;
      }
      let projId = selectedProjectId;
      if (!projId) {
        if (availableProjects.length > 0) {
          projId = availableProjects[0].id;
          setSelectedProjectId(projId);
        } else {
          // Client has no projects: auto-create a default project
          const client = clients.find(c => c.id === selectedClientId);
          const clientName = client?.name || 'Client';
          const clientCode = (client?.code || clientName.slice(0, 4)).toUpperCase().replace(/[^A-Z0-9]/g, '');
          const newProj: Project = {
            id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            clientId: selectedClientId,
            name: `${clientName} General`,
            code: `${clientCode}-GEN`,
            defaultHourlyRate: hourlyRate || defaultHourlyRate,
            isBillableDefault: true,
            color: client?.color || '#0ea5e9',
            createdAt: new Date().toISOString(),
          };
          onAddProject?.(newProj);
          projId = newProj.id;
          setSelectedProjectId(projId);
        }
      }

      const timeEntries = calendarEventsToTimeEntries(
        selectedEvents,
        selectedClientId,
        projId,
        hourlyRate
      );
      onImportTimeEntries(timeEntries);
    }

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Import Calendar Meetings"
      subtitle="Import meetings from Google Calendar, Outlook, or Apple Calendar (.ics) into your timeline."
      maxWidth="2xl"
    >
      <div className="space-y-4">
        {/* File Upload Drop Area */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-blue-500 bg-blue-50/50'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60 bg-slate-50/30'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".ics,text/calendar"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) handleFile(e.target.files[0]);
            }}
          />
          <div className="w-9 h-9 rounded-full bg-blue-100/70 text-blue-600 flex items-center justify-center mb-1.5">
            <Upload className="w-4 h-4" />
          </div>
          <span className="text-xs font-semibold text-slate-800">Upload .ics Calendar File</span>
          <span className="text-[10px] text-slate-400 mt-0.5">Drag & drop or click to browse (Google Calendar, Outlook, Apple Calendar)</span>
        </div>

        {/* Status / Error messages */}
        {errorMessage && (
          <div className="flex items-center gap-2 p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
        {statusMessage && !errorMessage && (
          <div className="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-xs">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Events Table / List (shown once a file is loaded) */}
        {events.length > 0 ? (
          <>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600 font-medium">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedEventIds.size === events.length && events.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                  <span>Select All ({selectedEventIds.size}/{events.length})</span>
                </div>
                <span className="text-[11px] text-slate-500 font-medium">
                  {events[0]?.date ? `Meeting Date: ${events[0].date}` : `Date: ${activeDate}`}
                </span>
              </div>

              <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                {events.map((evt) => {
                  const isChecked = selectedEventIds.has(evt.id);
                  return (
                    <div
                      key={evt.id}
                      onClick={() => toggleSelectEvent(evt.id)}
                      className={`p-3 flex items-start gap-3 hover:bg-slate-50/80 cursor-pointer transition-colors ${
                        isChecked ? 'bg-blue-50/20' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}} // Handled by parent div
                        className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-slate-800 truncate">
                            {evt.title}
                          </span>
                          {evt.location && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">
                              {evt.location.toLowerCase().includes('zoom') || evt.location.toLowerCase().includes('teams') ? (
                                <Video className="w-2.5 h-2.5 text-blue-500" />
                              ) : (
                                <MapPin className="w-2.5 h-2.5 text-slate-400" />
                              )}
                              <span className="truncate max-w-[130px]">{evt.location}</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-1">
                          <span className="font-mono text-slate-700 bg-slate-100 px-1 py-0.5 rounded text-[10px]">
                            {evt.date}
                          </span>
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {evt.startTime} – {evt.endTime}
                          </span>
                          <span className="text-slate-400">•</span>
                          <span className="font-medium text-slate-600">{evt.durationMinutes} min</span>
                          {evt.description && (
                            <>
                              <span className="text-slate-400">•</span>
                              <span className="truncate max-w-xs text-slate-400">{evt.description}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Import Mode Selector & Assignment */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Import Destination:</span>
                <div className="flex items-center gap-1 bg-slate-200/70 p-0.5 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setImportMode('activity')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                      importMode === 'activity'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Activity Stream (Raw)
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode('timesheet')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                      importMode === 'timesheet'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Timesheet (Billable Entries)
                  </button>
                </div>
              </div>

              {importMode === 'activity' ? (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Meetings will be added directly into your <strong>Activity</strong> column as verified focus intervals. You can allocate or assign them to clients whenever you are ready.
                </p>
              ) : (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">Client</label>
                      <select
                        value={selectedClientId}
                        onChange={(e) => handleClientChange(e.target.value)}
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {clients.length === 0 && <option value="">No clients available</option>}
                        {clients.map(c => (
                          <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">Project</label>
                      <select
                        value={selectedProjectId}
                        onChange={(e) => handleProjectChange(e.target.value)}
                        className={`w-full text-xs bg-white border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                          availableProjects.length === 0 ? 'border-amber-300 text-amber-900 bg-amber-50/40' : 'border-slate-200 text-slate-800'
                        }`}
                      >
                        {!selectedClientId && <option value="" disabled>Choose a client first</option>}
                        {selectedClientId && availableProjects.length === 0 && (
                          <option value="">No projects for this client</option>
                        )}
                        {availableProjects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">Rate ($/hr)</label>
                      <input
                        type="number"
                        value={hourlyRate}
                        onChange={(e) => setHourlyRate(Number(e.target.value))}
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {selectedClientId && availableProjects.length === 0 && (
                    <div className="flex items-center justify-between p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                      <span>This client has no active projects yet.</span>
                      <button
                        type="button"
                        onClick={handleQuickCreateProject}
                        className="px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-semibold transition-colors cursor-pointer"
                      >
                        + Create Default Project
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="py-2 text-center text-xs text-slate-400">
            Export your calendar as an <code className="text-slate-600 bg-slate-100 px-1 py-0.5 rounded">.ics</code> file from Google Calendar, Outlook, or Apple Calendar and drop it above.
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          {events.length > 0 && (
            <button
              type="button"
              onClick={handleExecuteImport}
              disabled={selectedEventIds.size === 0}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer ${
                selectedEventIds.size > 0
                  ? 'bg-blue-600 hover:bg-blue-700 active:scale-98'
                  : 'bg-slate-300 cursor-not-allowed'
              }`}
            >
              <ListPlus className="w-3.5 h-3.5" />
              <span>Import {selectedEventIds.size} Meeting{selectedEventIds.size === 1 ? '' : 's'}</span>
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
