import React, { useState, useEffect, useMemo } from 'react';
import { Client, Project } from './types/client-project';
import { ActivityItem } from './types/activity';
import { TimeEntry, TimeEntryDraft } from './types/time-entry';
import { TimesheetPeriod } from './types/timesheet';
import { StorageService, AppSettings } from './services/storage-service';
import { ActivityTracker, mergeActivities } from './services/activity-tracker';
import { localDate, weekDates } from './domain/calendar';
import { availableRanges, assertEntriesEditable, createPeriod, periodEntries, calculateEntry, validateEntry, validateAllocations, splitOvernight, finalizePeriod, exportTimesheet, aggregateEntries, consolidateEntries, areEntriesMatchingForAggregation } from './domain/workflow';
import { groupActivitiesByAppSession, cleanTaskDescription, cleanEntryNotes, AppSessionGroup } from './domain/timeline-layout';
import { auditActivities, workstreamsToSessionGroups, isSystemLockOrNoiseActivity } from './domain/activity-audit';
import { isDesktop, nativeApi } from './services/native-api';

import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { TrackerHeader } from './components/tracker/TrackerHeader';
import { Sidebar } from './components/navigation/Sidebar';
import { DualTimelineWorkspace } from './components/timeline/DualTimelineWorkspace';
import { WeeklyTimesheetGrid } from './components/timesheet/WeeklyTimesheetGrid';
import { ApprovalsHubView } from './components/approvals/ApprovalsHubView';
import { TimeEntryEditorModal } from './components/entries/TimeEntryEditorModal';
import { SmartAiAutoAssignModal } from './components/entries/SmartAiAutoAssignModal';
import { ClientProjectModal } from './components/projects/ClientProjectModal';
import { ValidationChecklistModal } from './components/timesheet/ValidationChecklistModal';
import { SubmitTimesheetModal } from './components/timesheet/SubmitTimesheetModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { CalendarImportModal } from './components/calendar/CalendarImportModal';

// Sample Boutique Firm seed data for instant 1-click evaluation
const SAMPLE_CLIENTS: Client[] = [
  { id: 'c_apex', name: 'Apex Capital Partners', code: 'APEX', color: '#0ea5e9', createdAt: new Date().toISOString() },
  { id: 'c_horizon', name: 'Horizon Healthcare Systems', code: 'HORIZON', color: '#10b981', createdAt: new Date().toISOString() },
  { id: 'c_internal', name: 'Internal Firm Operations', code: 'INTERNAL', color: '#8b5cf6', createdAt: new Date().toISOString() },
];

const SAMPLE_PROJECTS: Project[] = [
  { id: 'p_apex_ma', clientId: 'c_apex', name: 'M&A Valuation & Debt Schedule', code: 'APEX-MA', defaultHourlyRate: 350, isBillableDefault: true, color: '#0ea5e9', createdAt: new Date().toISOString() },
  { id: 'p_apex_it', clientId: 'c_apex', name: 'Post-Merger IT Systems Integration', code: 'APEX-IT', defaultHourlyRate: 300, isBillableDefault: true, color: '#38bdf8', createdAt: new Date().toISOString() },
  { id: 'p_horizon_sec', clientId: 'c_horizon', name: 'HIPAA Security & Regulatory Audit', code: 'HOR-SEC', defaultHourlyRate: 275, isBillableDefault: true, color: '#10b981', createdAt: new Date().toISOString() },
  { id: 'p_internal_sync', clientId: 'c_internal', name: 'Practice Development & Mentorship', code: 'OPS-SYNC', defaultHourlyRate: 0, isBillableDefault: false, color: '#8b5cf6', createdAt: new Date().toISOString() },
];

export const App: React.FC = () => {
  // Persistence state
  const [clients, setClients] = useState<Client[]>(() => StorageService.getClients());
  const [projects, setProjects] = useState<Project[]>(() => StorageService.getProjects());
  const [activities, setActivities] = useState<ActivityItem[]>(() => {
    const saved = StorageService.getActivities();
    return saved.filter(a => a.windowTitle.toLowerCase() !== 'hourglass' && !a.windowTitle.toLowerCase().includes('hourglass —'));
  });
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>(() => StorageService.getTimeEntries());
  const [settings, setSettings] = useState<AppSettings>(() => {
    const s = StorageService.getSettings();
    const savedKey = localStorage.getItem('hourglass_api_key');
    if (savedKey && !s.groqApiKey) {
      return { ...s, groqApiKey: savedKey };
    }
    return s;
  });
  const [activeDate, setActiveDate] = useState<string>(() => {
    const today = new Date();
    return localDate(today);
  });
  const [viewMode, setViewMode] = useState<'timeline' | 'timesheet' | 'approvals'>('timeline');

  // Modal controls
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [entryToEdit, setEntryToEdit] = useState<TimeEntry | null>(null);
  const [sourceActivityForEntry, setSourceActivityForEntry] = useState<ActivityItem | null>(null);

  const [isAiAssignOpen, setIsAiAssignOpen] = useState(false);
  const [isCalendarImportOpen, setIsCalendarImportOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [viewSnapshotPeriod, setViewSnapshotPeriod] = useState<TimesheetPeriod | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [notice, setNotice] = useState('');
  const [selectedActivities, setSelectedActivities] = useState<ActivityItem[]>([]);
  const [liveUnassignedSessions, setLiveUnassignedSessions] = useState<AppSessionGroup[] | null>(null);
  const [periods, setPeriods] = useState<TimesheetPeriod[]>(() => StorageService.getPeriods());
  const weekDays = useMemo(() => weekDates(activeDate).map((dateStr,i) => ({dateStr,dayName:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i],dayNumber:new Date(dateStr+'T12:00:00').getDate()})),[activeDate]);
  const timesheet = useMemo(() => {
    const weekStart = weekDays[0].dateStr;
    const weekEnd = weekDays[6].dateStr;
    const matching = periods.filter(p => p.startDate === weekStart && p.endDate === weekEnd);
    const draft = matching.find(p => p.status === 'draft' || p.status === 'rejected');
    if (draft) return draft;
    const consolidated = matching.find(p => !p.clientId && !p.projectId);
    if (consolidated) return consolidated;
    if (matching.length > 0) return matching[0];
    return createPeriod(activeDate, settings.consultantName, settings.consultantEmail);
  }, [periods, weekDays, activeDate, settings.consultantName, settings.consultantEmail]);
  const selectedWeekEntries = periodEntries(timeEntries,timesheet);
  useEffect(()=>{const listener=(event:Event)=>setNotice((event as CustomEvent<string>).detail);window.addEventListener('hourglass-storage-error',listener);return()=>window.removeEventListener('hourglass-storage-error',listener);},[]);
  useEffect(()=>{
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Save to storage on changes
  useEffect(() => {
    StorageService.saveClients(clients);
  }, [clients]);

  useEffect(() => {
    StorageService.saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    StorageService.saveActivities(activities);
  }, [activities]);

  useEffect(() => {
    StorageService.saveTimeEntries(timeEntries);
  }, [timeEntries]);

  useEffect(() => {
    StorageService.savePeriods(periods);
  }, [periods]);

  useEffect(() => {
    StorageService.saveSettings(settings);
    try {
      if (settings.groqApiKey) {
        localStorage.setItem('hourglass_api_key', settings.groqApiKey);
      }
    } catch {}
  }, [settings]);

  const activeClients = useMemo(() => clients.filter(c => !c.archived), [clients]);
  const activeProjects = useMemo(() => projects.filter(p => !p.archived && activeClients.some(c => c.id === p.clientId)), [projects, activeClients]);
  const hasEngagements = activeClients.length > 0 && activeProjects.length > 0;

  const [isCapturing, setIsCapturing] = useState(false);
  const handleToggleCapture = async () => {
    try { const status=await nativeApi<{isCapturing:boolean;state:string}>('/api/set-capture',{enabled:!isCapturing});setIsCapturing(status.isCapturing); }
    catch(e){setNotice(String(e));}
  };
  useEffect(()=>{
    if(!isDesktop())return;
    const tracker = new ActivityTracker();
    tracker.startLiveTracking(
      items => setActivities(prev => mergeActivities(prev, items.filter(a => a.windowTitle.toLowerCase() !== 'hourglass' && !a.windowTitle.toLowerCase().includes('hourglass —')))),
      status => { setIsCapturing(status.isCapturing); if (status.error) setNotice('Capture stopped: ' + status.error); },
      message => { setIsCapturing(false); setNotice(message); }
    );
    return()=>tracker.stopLiveTracking();
  },[]);

  // Handlers for Clients & Projects
  const handleAddClient = (client: Client) => {
    setClients(prev => [...prev, client]);
  };

  const handleAddProject = (project: Project) => {
    setProjects(prev => [...prev, project]);
  };

  const handleUpdateClient = (updated: Client) => {
    setClients(prev => prev.map(c => c.id === updated.id ? updated : c));
  };

  const handleUpdateProject = (updated: Project) => {
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
  };

  const handleDeleteClient = (clientId: string) => {
    setClients(prev => prev.map(c => c.id === clientId ? {...c,archived:true}:c));
    setProjects(prev => prev.map(p => p.clientId === clientId ? {...p,archived:true}:p));
  };

  const handleDeleteProject = (projectId: string) => {
    setProjects(prev => prev.map(p => p.id === projectId ? {...p,archived:true}:p));
  };

  const handleLoadSampleEngagements = () => {
    setClients(prev=>[...prev,...SAMPLE_CLIENTS.filter(c=>!prev.some(p=>p.id===c.id))]);
    setProjects(prev=>[...prev,...SAMPLE_PROJECTS.filter(c=>!prev.some(p=>p.id===c.id))]);
  };

  const buildEntry = (data:Partial<TimeEntry>):TimeEntry => {
    const existing=timeEntries.find(e=>e.id===data.id);
    const now=new Date().toISOString();
    const sourceApp = data.sourceAppName || existing?.sourceAppName;
    const taskName = cleanTaskDescription(data.taskName || existing?.taskName || '', sourceApp);
    const notes = cleanEntryNotes(data.notes ?? existing?.notes ?? '', data.taskName || existing?.taskName, sourceApp);
    return {...existing,...data,id:data.id||crypto.randomUUID(),date:data.date||activeDate,startTime:data.startTime||'09:00',endTime:data.endTime||'10:00',durationMinutes:data.durationMinutes??existing?.durationMinutes??60,decimalHours:data.decimalHours??existing?.decimalHours??1,clientId:data.clientId||'',projectId:data.projectId||'',taskName,notes,isBillable:data.isBillable??existing?.isBillable??true,hourlyRate:data.hourlyRate??existing?.hourlyRate??settings.defaultHourlyRate,calculatedRevenue:data.calculatedRevenue??existing?.calculatedRevenue??0,createdAt:existing?.createdAt||now,updatedAt:now} as TimeEntry;
  };
  const commitEntries = (incoming: TimeEntry[], currentActivities = activities) => {
    const replacements = incoming.flatMap(e => splitOvernight(e, e.roundingMode || settings.roundingMode));
    assertEntriesEditable([...replacements, ...timeEntries.filter(e => incoming.some(n => n.id === e.id))], StorageService.getPeriods());
    const others = StorageService.getTimeEntries().filter(e => !incoming.some(n => n.id === e.id));
    for (const entry of replacements) {
      const errors = validateEntry(entry, clients, projects);
      if (errors.length) throw Error(errors[0]);
      validateAllocations(entry, currentActivities, [...others, ...replacements.filter(e => e.id !== entry.id)]);
    }
    const next = [...replacements, ...others];
    setTimeEntries(next);
    StorageService.saveTimeEntries(next);
  };
  const handleSaveEntry = async (data: Partial<TimeEntry>) => {
    try {
      let entry = buildEntry(data);
      const isNewEntry = !data.id || !timeEntries.some(e => e.id === data.id);
      let wasAggregated = false;

      // Auto-aggregate repeated sessions for the same client, project, and app/task on the same date
      if (isNewEntry && entry.clientId && entry.projectId) {
        const existingMatch = timeEntries.find(e => {
          // Verify existing entry is editable (not locked by an approved or submitted period)
          const isLocked = periods.some(p =>
            (p.status === 'submitted' || p.status === 'approved') &&
            e.date >= p.startDate && e.date <= p.endDate &&
            (!p.clientId || p.clientId === e.clientId) &&
            (!p.projectId || p.projectId === e.projectId)
          );
          if (isLocked) return false;

          return areEntriesMatchingForAggregation(e, entry);
        });

        if (existingMatch) {
          entry = aggregateEntries(existingMatch, entry, settings.roundingMode);
          wasAggregated = true;
        }
      }

      const allocatedIds = new Set([
        ...(entry.sourceActivityIds || []),
        ...(entry.allocations?.map(a => a.activityId) || [])
      ]);

      if (allocatedIds.size > 0) {
        const updatedActivities = activities.map(a =>
          allocatedIds.has(a.id)
            ? { ...a, reviewed: true, needsReview: false }
            : a
        );
        setActivities(updatedActivities);
        StorageService.saveActivities(updatedActivities);
        commitEntries([entry], updatedActivities);
      } else {
        commitEntries([entry], activities);
      }

      await StorageService.flush();
      setNotice(wasAggregated 
        ? `Consolidated with existing ${entry.taskName || 'work'} entry for this project.` 
        : 'Entry saved locally.'
      );
      return true;
    } catch (e) {
      setNotice(String(e));
      return false;
    }
  };
  const handleDeleteEntry = (id:string) => {
    try {assertEntriesEditable(timeEntries.filter(e=>e.id===id),periods);const next=timeEntries.filter(e=>e.id!==id);setTimeEntries(next);StorageService.saveTimeEntries(next);}
    catch(e){setNotice(String(e));}
  };
  const handleBatchLogAiEntries = async (drafts: TimeEntryDraft[]) => {
    try {
      const allocatedIds = new Set<string>();
      for (const d of drafts) {
        if (d.sourceActivityIds) d.sourceActivityIds.forEach(id => allocatedIds.add(id));
        if (d.allocations) d.allocations.forEach(a => allocatedIds.add(a.activityId));
      }

      const updatedActivities = activities.map(a =>
        allocatedIds.has(a.id)
          ? { ...a, reviewed: true, needsReview: false, finalized: true, isIdle: false, legacyDateUncertain: false }
          : a
      );

      setActivities(updatedActivities);
      StorageService.saveActivities(updatedActivities);

      // Consolidate batch drafts
      const rawEntries = drafts.map(d => calculateEntry(buildEntry({ ...d, aiSuggested: true }), settings.roundingMode));
      const batchConsolidated = consolidateEntries(rawEntries, settings.roundingMode);

      // Merge with any existing matching entries in timeEntries
      const finalEntriesToCommit: TimeEntry[] = [];
      let currentPool = [...timeEntries];

      for (const item of batchConsolidated) {
        const existingIndex = currentPool.findIndex(e => {
          const isLocked = periods.some(p => 
            (p.status === 'submitted' || p.status === 'approved') &&
            e.date >= p.startDate && e.date <= p.endDate &&
            (!p.clientId || p.clientId === e.clientId) &&
            (!p.projectId || p.projectId === e.projectId)
          );
          if (isLocked) return false;
          return areEntriesMatchingForAggregation(e, item);
        });

        if (existingIndex >= 0) {
          const merged = aggregateEntries(currentPool[existingIndex], item, settings.roundingMode);
          currentPool[existingIndex] = merged;
          finalEntriesToCommit.push(merged);
        } else {
          currentPool.push(item);
          finalEntriesToCommit.push(item);
        }
      }

      commitEntries(finalEntriesToCommit, updatedActivities);

      await StorageService.flush();
      setNotice('Reviewed suggestions saved and consolidated.');
      return true;
    } catch (e) {
      setNotice(String(e));
      return false;
    }
  };

  const handleConsolidateEntries = async (entriesToConsolidate: TimeEntry[]) => {
    try {
      const consolidated = consolidateEntries(entriesToConsolidate, settings.roundingMode);
      const idsToRemove = new Set(entriesToConsolidate.map(e => e.id));
      const next = [
        ...timeEntries.filter(e => !idsToRemove.has(e.id)),
        ...consolidated
      ];
      setTimeEntries(next);
      StorageService.saveTimeEntries(next);
      await StorageService.flush();
      setNotice(`Consolidated ${entriesToConsolidate.length} entries into ${consolidated.length} unified line item(s).`);
    } catch (err) {
      setNotice(`Failed to consolidate: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImportCalendarActivities = async (newActivities: ActivityItem[]) => {
    try {
      setActivities(prev => {
        const merged = mergeActivities(prev, newActivities);
        StorageService.saveActivities(merged);
        return merged;
      });
      await StorageService.flush();
      if (newActivities.length > 0) {
        const targetDate = newActivities[0].localDate || newActivities[0].timestamp.slice(0, 10);
        if (targetDate) {
          setActiveDate(targetDate);
        }
      }
      setNotice(`Imported ${newActivities.length} calendar meeting(s) to Activity stream.`);
    } catch (err) {
      setNotice(`Failed to import activities: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImportCalendarTimeEntries = async (newEntries: TimeEntry[]) => {
    try {
      commitEntries(newEntries);
      await StorageService.flush();
      if (newEntries.length > 0 && newEntries[0].date) {
        setActiveDate(newEntries[0].date);
      }
      setNotice(`Logged ${newEntries.length} calendar meeting(s) directly to timesheet.`);
    } catch (err) {
      setNotice(`Failed to import entries: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const isSamePeriod = (a: TimesheetPeriod, b: TimesheetPeriod) =>
    a.id === b.id || (
      a.startDate === b.startDate &&
      a.endDate === b.endDate &&
      (a.clientId || '') === (b.clientId || '') &&
      (a.projectId || '') === (b.projectId || '')
    );

  const handleSubmitTimesheet = async (comment: string, periodToSubmit?: TimesheetPeriod) => {
    try {
      const targetPeriod = periodToSubmit || timesheet;
      const currentAllEntries = StorageService.getTimeEntries();
      let targetEntries = periodEntries(currentAllEntries, targetPeriod);

      // Auto-consolidate repeated same-project app sessions before finalization
      const consolidated = consolidateEntries(targetEntries, settings.roundingMode);
      let activeEntriesList = currentAllEntries;
      if (consolidated.length !== targetEntries.length) {
        const targetIds = new Set(targetEntries.map(e => e.id));
        activeEntriesList = [
          ...currentAllEntries.filter(e => !targetIds.has(e.id)),
          ...consolidated
        ];
        setTimeEntries(activeEntriesList);
        StorageService.saveTimeEntries(activeEntriesList);
        targetEntries = consolidated;
      }

      for (const entry of targetEntries) validateAllocations(entry, activities, activeEntriesList);
      const next = {
        ...finalizePeriod(targetPeriod, activeEntriesList, clients, projects, settings.roundingMode, settings.consultantName, settings.consultantEmail),
        submissionComment: comment,
      };
      const nextPeriods = [
        ...periods.filter(p => !isSamePeriod(p, next)),
        next,
      ];
      setPeriods(nextPeriods);
      StorageService.savePeriods(nextPeriods);
      await StorageService.flush();
      const clientName = clients.find(c => c.id === next.clientId)?.name;
      const scopeName = clientName ? ` (${clientName})` : '';
      setNotice(`Timesheet ${next.startDate} to ${next.endDate}${scopeName} submitted successfully.`);
    } catch (e) {
      setNotice(String(e));
    }
  };


  const handleApprovePeriod = async (targetPeriod: TimesheetPeriod) => {
    try {
      const currentPeriods = StorageService.getPeriods();
      const existing = currentPeriods.find(p => isSamePeriod(p, targetPeriod)) || targetPeriod;
      const approvedPeriod: TimesheetPeriod = {
        ...existing,
        status: 'approved',
        approvedAt: new Date().toISOString(),
        snapshots: existing.snapshots || targetPeriod.snapshots || [],
      };
      const nextPeriods = currentPeriods.map(p =>
        isSamePeriod(p, approvedPeriod) ? approvedPeriod : p
      );
      if (!nextPeriods.some(p => isSamePeriod(p, approvedPeriod))) {
        nextPeriods.push(approvedPeriod);
      }
      setPeriods(nextPeriods);
      StorageService.savePeriods(nextPeriods);
      await StorageService.flush();
      const clientName = clients.find(c => c.id === targetPeriod.clientId)?.name;
      const scopeName = clientName ? ` (${clientName})` : '';
      setNotice(`Timesheet ${targetPeriod.startDate} to ${targetPeriod.endDate}${scopeName} has been approved.`);
    } catch (err) {
      setNotice(`Failed to approve: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDownloadPeriodExport = (periodToExport: TimesheetPeriod, format: 'csv' | 'json') => {
    try {
      const snapshot = periodToExport.snapshots && periodToExport.snapshots.length > 0
        ? periodToExport.snapshots[periodToExport.snapshots.length - 1]
        : null;

      if (!snapshot) {
        setNotice('No finalized snapshot available to download for this period.');
        return;
      }

      const client = clients.find(c => c.id === periodToExport.clientId);
      const project = projects.find(p => p.id === periodToExport.projectId);

      const content = exportTimesheet(periodToExport, snapshot, periodToExport.clientId, periodToExport.projectId)[format];
      const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const clientSlug = client ? client.name.replace(/[^a-zA-Z0-9]/g, '') : 'Consolidated';
      const projectSlug = project ? `_${project.name.replace(/[^a-zA-Z0-9]/g, '')}` : '';
      a.download = `Timesheet_${clientSlug}${projectSlug}_${periodToExport.startDate}_${periodToExport.endDate}_r${snapshot.revision}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Downloaded ${format.toUpperCase()} export for ${client?.name || 'All Clients'}.`);
    } catch (err) {
      setNotice(`Failed to export: ${err instanceof Error ? err.message : String(err)}`);
    }
  };


  const handleClearData = async () => {
    try {
      await StorageService.clearAll();
      try {
        await StorageService.clearActivities();
      } catch {}
      setClients([]);
      setProjects([]);
      setActivities([]);
      setTimeEntries([]);
      setPeriods([]);
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (
            key &&
            (key.startsWith('hourglass_audited_ids_') ||
             key.startsWith('hourglass_activities_'))
          ) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      } catch {}
      setAuditedActivityIds([]);
      setNotice('All data has been completely cleared.');
    } catch (err) {
      setNotice(`Failed to clear data: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const [searchQuery, setSearchQuery] = useState('');

  // Filter activities for active day (excluding system lock screen / shell noise)
  const activeDayActivities = activities
    .filter(a => (a.localDate || a.timestamp.slice(0, 10)) === activeDate && !isSystemLockOrNoiseActivity(a))
    .map(a => ({ ...a, isAssigned: availableRanges(a, timeEntries).length === 0 }));
  const unassignedDayActivities = activeDayActivities.filter(a => !a.isAssigned && !a.ignored && a.finalized !== false && !a.legacyDateUncertain && (!(a.isIdle || a.needsReview) || a.reviewed));

  // Live search filtering across activities and confirmed time entries
  const searchedDayActivities = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return activeDayActivities;
    return activeDayActivities.filter(a =>
      (a.appName && a.appName.toLowerCase().includes(q)) ||
      (a.windowTitle && a.windowTitle.toLowerCase().includes(q)) ||
      (a.category && a.category.toLowerCase().includes(q)) ||
      (a.executable && a.executable.toLowerCase().includes(q))
    );
  }, [activeDayActivities, searchQuery]);

  const searchedTimeEntries = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return timeEntries;
    return timeEntries.filter(e => {
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
  }, [timeEntries, clients, projects, searchQuery]);

  // Audited activity IDs for activeDate to synchronize the sidebar badge with consolidated workstreams
  const [auditedActivityIds, setAuditedActivityIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(`hourglass_audited_ids_${activeDate}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`hourglass_audited_ids_${activeDate}`);
      setAuditedActivityIds(stored ? JSON.parse(stored) : []);
    } catch {
      setAuditedActivityIds([]);
    }
    setLiveUnassignedSessions(null);
  }, [activeDate]);

  // Compute consolidated unassigned session groups / workstreams matching the Activity tab lens exactly
  const unassignedDaySessions = useMemo(() => {
    if (!unassignedDayActivities || unassignedDayActivities.length === 0) return [];

    const isAppMode = settings.activityViewMode === 'app' || settings.auditGroupByApp;
    const isDocMode = settings.activityViewMode === 'document';

    // When in document or app lens, audit all unassigned activities with micro-switch absorption
    if (isDocMode || isAppMode) {
      const report = auditActivities(unassignedDayActivities, clients, projects, {
        scope: 'today',
        roundingMode: settings.roundingMode,
        absorbMicroSwitches: true,
        microSwitchThresholdSeconds: 60,
        groupByApp: isAppMode,
      });
      return workstreamsToSessionGroups(report.workstreams);
    }

    if (auditedActivityIds.length === 0) {
      return groupActivitiesByAppSession(unassignedDayActivities);
    }
    const auditedSet = new Set(auditedActivityIds);
    const auditedActs = unassignedDayActivities.filter(a => auditedSet.has(a.id));
    const newActs = unassignedDayActivities.filter(a => !auditedSet.has(a.id));

    const list: AppSessionGroup[] = [];
    if (auditedActs.length > 0) {
      const report = auditActivities(auditedActs, clients, projects, {
        scope: 'today',
        roundingMode: settings.roundingMode,
        absorbMicroSwitches: true,
        microSwitchThresholdSeconds: 60,
        groupByApp: settings.auditGroupByApp,
      });
      list.push(...workstreamsToSessionGroups(report.workstreams));
    }
    if (newActs.length > 0) {
      list.push(...groupActivitiesByAppSession(newActs));
    }
    return list;
  }, [auditedActivityIds, unassignedDayActivities, clients, projects, settings.roundingMode, settings.activityViewMode, settings.auditGroupByApp]);

  const effectiveUnassignedSessions = liveUnassignedSessions ?? unassignedDaySessions;
  const unassignedSessionCount = effectiveUnassignedSessions.length;

  return (
    <div className="h-screen w-screen bg-[#f5f5f7] text-slate-900 flex font-sans overflow-hidden select-none">
      {/* Poppable Apple-style Left Sidebar */}
      <Sidebar
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        isCapturing={isCapturing}
        hasEngagements={hasEngagements}
        onToggleCapture={handleToggleCapture}
        onOpenProjectModal={() => setIsProjectModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onOpenAiAutoAssign={() => setIsAiAssignOpen(true)}
        unassignedCount={unassignedSessionCount}
        pendingApprovalsCount={periods.filter(p => p.status === 'submitted').length}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        consultantName={settings.consultantName || 'vineeth'}
      />

      {/* Main Workspace Column */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-white">
        {/* Top Header */}
        <TrackerHeader
          viewMode={viewMode}
          onChangeViewMode={setViewMode}
          activeDate={activeDate}
          onSelectDate={setActiveDate}
          weekDays={weekDays}
          isCapturing={isCapturing}
          hasEngagements={hasEngagements}
          onToggleCapture={handleToggleCapture}
          onOpenProjectModal={() => setIsProjectModalOpen(true)}
          onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
          onAddNewEntry={() => {
            setEntryToEdit(null);
            setSourceActivityForEntry(null);
            setSelectedActivities([]);
            setIsEntryModalOpen(true);
          }}
          onOpenCalendarImport={() => setIsCalendarImportOpen(true)}
          onOpenAiAutoAssign={() => setIsAiAssignOpen(true)}
          unassignedCount={unassignedDayActivities.length}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {/* Floating Top-Center Notification Banner */}
        {notice && (
          <div
            role="alert"
            className={`fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-all animate-in fade-in slide-in-from-top-2 duration-200 pointer-events-auto ${
              /fail|error|unable|stopped|rejection|cannot/i.test(notice)
                ? 'bg-red-600 text-white border border-red-700/60 shadow-red-950/20'
                : 'bg-slate-900 text-white border border-slate-800 shadow-slate-950/25'
            }`}
          >
            {/fail|error|unable|stopped|rejection|cannot/i.test(notice) ? (
              <AlertCircle className="w-3.5 h-3.5 text-white shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            <span className="truncate max-w-xs sm:max-w-md select-none">
              {notice.replace(/^TypeError:\s*/i, '')}
            </span>
            <button
              type="button"
              onClick={() => setNotice('')}
              className="ml-1 -mr-1 p-0.5 rounded-md hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
              title="Dismiss"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Workspace Body - Edge to Edge flush without gaps */}
        <main className="flex-1 min-h-0 w-full flex flex-col overflow-hidden bg-white">
        {viewMode === 'timeline' ? (
          <DualTimelineWorkspace
            activities={searchedDayActivities}
            timeEntries={searchedTimeEntries}
            searchQuery={searchQuery}
            clients={activeClients}
            projects={activeProjects}
            activeDate={activeDate}
            roundingMode={settings.roundingMode}
            auditedActivityIds={auditedActivityIds}
            onAuditedActivityIdsChange={setAuditedActivityIds}
            auditGroupByApp={settings.auditGroupByApp}
            activityViewMode={settings.activityViewMode}
            onActivityViewModeChange={(mode) => setSettings({ ...settings, activityViewMode: mode, auditGroupByApp: mode === 'app' })}
            onVisibleUnassignedSessionsChange={setLiveUnassignedSessions}
            isCapturing={isCapturing}
            onToggleCapture={handleToggleCapture}
            onSelectActivityToLog={(act, sessionActivities) => {
              const acts = sessionActivities && sessionActivities.length > 0 ? sessionActivities : [act];
              setSourceActivityForEntry(acts[0]);
              setSelectedActivities(acts);
              setEntryToEdit(null);
              setIsEntryModalOpen(true);
            }}
            onOpenAiAutoAssign={() => setIsAiAssignOpen(true)}
            onOpenProjectModal={() => setIsProjectModalOpen(true)}
            onAddNewManualEntry={() => {
              setEntryToEdit(null);
              setSourceActivityForEntry(null);
          setSelectedActivities([]);
              setIsEntryModalOpen(true);
            }}
            onEditEntry={(entry) => {
              setEntryToEdit(entry);
              setSourceActivityForEntry(null);
              setSelectedActivities(activities.filter(a=>entry.allocations?.some(r=>r.activityId===a.id)));
              setIsEntryModalOpen(true);
            }}
            onDeleteEntry={handleDeleteEntry}
          />
        ) : viewMode === 'timesheet' ? (
          /* Weekly Timesheet Matrix View */
          <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
            <WeeklyTimesheetGrid
              period={timesheet}
              periods={periods}
              timeEntries={timeEntries}
              clients={activeClients}
              projects={activeProjects}
              activities={activities}
              weekDays={weekDays}
              onOpenValidationModal={() => setIsSubmitModalOpen(true)}
              onSelectDate={(d) => {
                setActiveDate(d);
                setViewMode('timeline');
              }}
              activeDate={activeDate}
              onNavigateWeek={(direction) => {
                if (direction === 0) {
                  setActiveDate(localDate(new Date()));
                  return;
                }
                const current = new Date(`${activeDate}T12:00:00`);
                current.setDate(current.getDate() + direction * 7);
                setActiveDate(localDate(current));
              }}
              onAddNewEntry={(prefill) => {
                setEntryToEdit(prefill ? {
                  id: '',
                  date: prefill.date || activeDate,
                  startTime: '09:00',
                  endTime: '10:00',
                  durationMinutes: 60,
                  decimalHours: 1,
                  clientId: prefill.clientId || '',
                  projectId: prefill.projectId || '',
                  taskName: '',
                  notes: '',
                  isBillable: true,
                  hourlyRate: settings.defaultHourlyRate,
                  calculatedRevenue: 0,
                  createdAt: '',
                  updatedAt: '',
                } : null);
                setSourceActivityForEntry(null);
                setSelectedActivities([]);
                setIsEntryModalOpen(true);
              }}
              onEditEntry={(entry) => {
                setEntryToEdit(entry);
                setSourceActivityForEntry(null);
                setSelectedActivities(activities.filter(a => entry.allocations?.some(r => r.activityId === a.id)));
                setIsEntryModalOpen(true);
              }}
              onDeleteEntry={handleDeleteEntry}
            />
          </div>
        ) : (
          /* Approvals & Submissions Ledger Hub */
          <ApprovalsHubView
            periods={periods}
            clients={activeClients}
            projects={activeProjects}
            consultantName={settings.consultantName}
            consultantEmail={settings.consultantEmail}
            onViewSnapshot={(p) => {
              setViewSnapshotPeriod(p);
              setIsSubmitModalOpen(true);
            }}
            onApprovePeriod={handleApprovePeriod}
            onDownloadExport={handleDownloadPeriodExport}
            onNavigateToTimesheet={(dateStr) => {
              if (dateStr) {
                setActiveDate(dateStr);
              }
              setViewMode('timesheet');
            }}
          />
        )}
        </main>
      </div>

      {/* Modals */}
      {isEntryModalOpen && (
        <TimeEntryEditorModal
          isOpen={isEntryModalOpen}
          onClose={() => {
            setIsEntryModalOpen(false);
            setEntryToEdit(null);
            setSourceActivityForEntry(null);
          setSelectedActivities([]);
          }}
          clients={activeClients}
          projects={activeProjects}
          activeDate={activeDate}
          sourceActivity={sourceActivityForEntry}
          sourceActivities={selectedActivities}
          existingEntries={timeEntries}
          entryToEdit={entryToEdit}
          roundingMode={settings.roundingMode}
          onSaveEntry={handleSaveEntry}
        />
      )}

      {isAiAssignOpen && (
        <SmartAiAutoAssignModal
          isOpen={isAiAssignOpen}
          onClose={() => setIsAiAssignOpen(false)}
          unassignedSessions={effectiveUnassignedSessions}
          allActivities={activities}
          existingEntries={timeEntries}
          periods={periods}
          clients={activeClients}
          projects={activeProjects}
          groqApiKey={settings.groqApiKey}
          activeDate={activeDate}
          roundingMode={settings.roundingMode}
          activityViewMode={settings.activityViewMode}
          auditGroupByApp={settings.auditGroupByApp}
          onBatchLogEntries={handleBatchLogAiEntries}
        />
      )}

      {isProjectModalOpen && (
        <ClientProjectModal
          isOpen={isProjectModalOpen}
          onClose={() => setIsProjectModalOpen(false)}
          clients={clients}
          projects={projects}
          defaultHourlyRate={settings.defaultHourlyRate}
          onAddClient={handleAddClient}
          onAddProject={handleAddProject}
          onUpdateClient={handleUpdateClient}
          onUpdateProject={handleUpdateProject}
          onDeleteClient={handleDeleteClient}
          onDeleteProject={handleDeleteProject}
          onLoadSampleData={handleLoadSampleEngagements}
        />
      )}

      {isValidationModalOpen && (
        <ValidationChecklistModal
          isOpen={isValidationModalOpen}
          onClose={() => setIsValidationModalOpen(false)}
          entries={selectedWeekEntries}
          period={timesheet}
          unallocatedCount={activities.filter(a=>(a.localDate||a.timestamp.slice(0,10))>=timesheet.startDate&&(a.localDate||a.timestamp.slice(0,10))<=timesheet.endDate&&!a.ignored&&availableRanges(a,timeEntries).length>0).length}
          onProceedToSubmit={() => {
            setIsValidationModalOpen(false);
            setIsSubmitModalOpen(true);
          }}
        />
      )}

      {isSubmitModalOpen && (
        <SubmitTimesheetModal
          isOpen={isSubmitModalOpen}
          onClose={() => {
            setIsSubmitModalOpen(false);
            setViewSnapshotPeriod(null);
          }}
          period={viewSnapshotPeriod || timesheet}
          periods={periods}
          entries={periodEntries(timeEntries, viewSnapshotPeriod || timesheet)}
          allEntries={timeEntries}
          clients={activeClients}
          projects={activeProjects}
          consultantName={settings.consultantName}
          consultantEmail={settings.consultantEmail}
          activeDate={activeDate}
          activities={activities}
          onSubmitTimesheet={handleSubmitTimesheet}
          onConsolidateEntries={handleConsolidateEntries}
        />
      )}

      {isCalendarImportOpen && (
        <CalendarImportModal
          isOpen={isCalendarImportOpen}
          onClose={() => setIsCalendarImportOpen(false)}
          activeDate={activeDate}
          clients={activeClients.length > 0 ? activeClients : clients}
          projects={activeProjects.length > 0 ? activeProjects : projects}
          defaultHourlyRate={settings.defaultHourlyRate}
          onImportActivities={handleImportCalendarActivities}
          onImportTimeEntries={handleImportCalendarTimeEntries}
          onAddProject={handleAddProject}
        />
      )}

      {isSettingsModalOpen && (
        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          settings={settings}
          onSaveSettings={setSettings}
          onClearData={handleClearData}
        />
      )}
    </div>
  );
};
