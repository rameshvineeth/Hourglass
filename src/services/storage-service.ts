import { Client, Project } from '../types/client-project';
import { ActivityItem } from '../types/activity';
import { TimeEntry, RoundingMode } from '../types/time-entry';
import { TimesheetPeriod } from '../types/timesheet';
import { isDesktop, nativeApi } from './native-api';
import { roundDurationMinutes } from '../domain/time-calculations';
import { consolidateEntries } from '../domain/workflow';

export interface AppSettings { roundingMode: RoundingMode; groqApiKey: string; consultantName: string; consultantEmail: string; defaultHourlyRate: number; auditGroupByApp?: boolean; activityViewMode?: 'document' | 'app' | 'timeline'; }
export const DEFAULT_SETTINGS: AppSettings = { roundingMode: 'tenth_hour', groqApiKey: '', consultantName: 'vineeth', consultantEmail: 'work.vineethramesh@gmail.com', defaultHourlyRate: 275, auditGroupByApp: true, activityViewMode: 'app' };
export interface AppDocument { version: 2; revision: number; clients: Client[]; projects: Project[]; activities: ActivityItem[]; entries: TimeEntry[]; periods: TimesheetPeriod[]; settings: AppSettings; legacyBackup?: Record<string, string> }
const empty = (): AppDocument => ({ version: 2, revision: 0, clients: [], projects: [], activities: [], entries: [], periods: [], settings: { ...DEFAULT_SETTINGS } });
let state = empty();
let db: IDBDatabase;
let queue: Promise<void> = Promise.resolve();
let scheduled = false;
let failure: Error | null = null;
let lastSaved = '';
let desktop = false;
export function validateDocument(value: unknown): AppDocument {
  const v = value as AppDocument;
  if (!v || v.version !== 2 || !Number.isInteger(v.revision) || !['clients','projects','activities','entries','periods'].every(k => Array.isArray(v[k as keyof AppDocument])) || !v.settings) throw new Error('Invalid backup format. Existing data was preserved.');
  for (const list of [v.clients,v.projects,v.activities,v.entries,v.periods]) {
    if (list.some(x => !x || typeof x.id !== 'string') || new Set(list.map(x => x.id)).size !== list.length) throw new Error('Invalid or duplicate record IDs.');
  }
  if (v.entries.some(e => !Number.isFinite(e.durationMinutes) || typeof e.date !== 'string') || v.activities.some(a => typeof a.windowTitle !== 'string' || !Number.isFinite(a.durationSeconds))) throw new Error('Invalid time records.');
  return v;
}
function request<T>(req: IDBRequest<T>): Promise<T> { return new Promise((resolve,reject) => { req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function browserSave(value: AppDocument) {
  await new Promise<void>((resolve,reject) => {
    const tx=db.transaction('documents','readwrite'); const os=tx.objectStore('documents');
    const old=os.get('app'); old.onsuccess=()=>{if(old.result)os.put(old.result,'backup');os.put(value,'app');};
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('Storage transaction aborted'));
  });
}
function report(error: unknown) { failure=error instanceof Error?error:new Error(String(error)); window.dispatchEvent(new CustomEvent('hourglass-storage-error',{detail:failure.message})); }
function schedule() {
  if(scheduled)return; scheduled=true;
  queueMicrotask(()=>{
    scheduled=false;
    const snapshot=structuredClone(state); snapshot.settings.groqApiKey='';
    const serialized=JSON.stringify({...snapshot,revision:0});
    if(serialized===lastSaved)return;
    queue=queue.then(async()=>{
      failure=null;
      snapshot.revision=state.revision+1;
      if(desktop)await nativeApi('/api/state',snapshot);else await browserSave(snapshot);
      state.revision=snapshot.revision; lastSaved=serialized;
      window.dispatchEvent(new CustomEvent('hourglass-storage-saved'));
    }).catch(report);
  });
}
export class StorageService {
  static async initialize() {
    desktop=isDesktop();
    let loaded: AppDocument | null;
    if(desktop) loaded=await nativeApi<AppDocument | null>('/api/state');
    else {
      const opening=indexedDB.open('hourglass-v2',1);
      opening.onupgradeneeded=()=>opening.result.createObjectStore('documents');
      db=await request(opening);
      loaded=await request(db.transaction('documents').objectStore('documents').get('app')) || null;
    }
    if(loaded){
      state=validateDocument(loaded);
      let migrated = false;
      state.entries = state.entries.map(e => {
        if (e.decimalHours <= 0 && ((e.durationMinutes ?? 0) > 0 || (e.actualDurationSeconds ?? 0) > 0)) {
          migrated = true;
          const billing = roundDurationMinutes(e.durationMinutes || ((e.actualDurationSeconds || 0) / 60), e.roundingMode || state.settings.roundingMode);
          return {
            ...e,
            decimalHours: billing.decimalHours,
            durationMinutes: billing.roundedMinutes,
            calculatedRevenue: e.calculatedRevenue || (e.isBillable ? Math.round(billing.roundedMinutes / 60 * e.hourlyRate * 100) / 100 : 0)
          };
        }
        return e;
      });
      if (migrated) schedule();
      const snap=structuredClone(state);snap.settings.groqApiKey='';lastSaved=JSON.stringify({...snap,revision:0});
    }
    else {
      const backup:Record<string,string>={};
      const read=<T,>(key:string,fallback:T):T=>{ const raw=localStorage.getItem(key); if(!raw)return fallback; backup[key]=raw; try{return JSON.parse(raw) as T;}catch{throw new Error(`Legacy data in ${key} is damaged. It has not been overwritten.`);} };
      const legacy=read<TimesheetPeriod|null>('hourglass_timesheet_v1',null);
      state={...empty(),clients:read('hourglass_clients_v1',[]),projects:read('hourglass_projects_v1',[]),entries:read('hourglass_time_entries_v1',[]),
        activities:read<ActivityItem[]>('hourglass_activities_v1',[]).map(a=>({...a,legacyDateUncertain:a.source==='live',needsReview:a.source==='live'||a.needsReview})),
        periods:legacy?[legacy]:[],settings:{...DEFAULT_SETTINGS,...read('hourglass_settings_v1',{})},legacyBackup:backup};
      // API keys are session-only; never copy a legacy key into a downloadable backup.
      delete backup.hourglass_settings_v1;
      state.settings.groqApiKey='';
      validateDocument(state);schedule();await this.flush();
    }
  }
  static async flush(){await Promise.resolve();await queue;if(failure)throw failure;}
  static getClients(){return state.clients;}
  static saveClients(v:Client[]){state.clients=v;schedule();}
  static getProjects(){return state.projects;}
  static saveProjects(v:Project[]){state.projects=v;schedule();}
  static getActivities(){return state.activities;}
  static saveActivities(v:ActivityItem[]){const persist=v.filter(a=>!desktop||a.source!=='live'||a.legacyDateUncertain||a.reviewed||a.ignored);state.activities=persist.map(a=>({...a,appIcon:undefined}));schedule();}
  static getTimeEntries(): TimeEntry[] {
    const sanitized = state.entries.map(e => {
      if (e.decimalHours <= 0 && ((e.durationMinutes ?? 0) > 0 || (e.actualDurationSeconds ?? 0) > 0)) {
        const billing = roundDurationMinutes(e.durationMinutes || ((e.actualDurationSeconds || 0) / 60), e.roundingMode || state.settings.roundingMode);
        return {
          ...e,
          decimalHours: billing.decimalHours,
          durationMinutes: billing.roundedMinutes,
          calculatedRevenue: e.calculatedRevenue || (e.isBillable ? Math.round(billing.roundedMinutes / 60 * e.hourlyRate * 100) / 100 : 0)
        };
      }
      return e;
    });
    // Auto-consolidate any unfinalized matching same-app / same-project fragments
    const unfinalized = sanitized.filter(e => !state.periods.some(p => (p.status === 'submitted' || p.status === 'approved') && e.date >= p.startDate && e.date <= p.endDate && (!p.clientId || p.clientId === e.clientId) && (!p.projectId || p.projectId === e.projectId)));
    const locked = sanitized.filter(e => !unfinalized.includes(e));
    const consolidatedUnfinalized = consolidateEntries(unfinalized, state.settings?.roundingMode || 'exact');
    return [...locked, ...consolidatedUnfinalized];
  }
  static saveTimeEntries(v:TimeEntry[]){state.entries=v;schedule();}
  static getTimesheet(){return state.periods[0]||null;}
  static saveTimesheet(v:TimesheetPeriod){state.periods=[...state.periods.filter(p=>p.id!==v.id&&!(p.startDate===v.startDate&&(p.clientId||'')===(v.clientId||'')&&(p.projectId||'')===(v.projectId||''))),v];schedule();}
  static getPeriods(){return state.periods;}
  static savePeriods(v:TimesheetPeriod[]){state.periods=v;schedule();}
  static getSettings(){return state.settings;}
  static saveSettings(v:AppSettings){state.settings=v;schedule();}
  static async clearActivities() {
    state.activities = [];
    if (desktop) {
      await this.flush();
      let wasCapturing = false;
      try {
        const status = await nativeApi<{ isCapturing: boolean }>('/api/capture-status');
        if (status.isCapturing) {
          wasCapturing = true;
          await nativeApi('/api/set-capture', { enabled: false });
        }
      } catch {}

      let cleared = false;
      try {
        await nativeApi('/api/clear-activities');
        cleared = true;
      } catch {}

      if (!cleared) {
        let currentRev = state.revision;
        try {
          const currentDoc = await nativeApi<AppDocument | null>('/api/state');
          if (currentDoc && typeof currentDoc.revision === 'number') {
            currentRev = currentDoc.revision;
          }
        } catch {}

        const doc: AppDocument = {
          version: 2,
          revision: currentRev + 1,
          clients: state.clients,
          projects: state.projects,
          activities: [],
          entries: state.entries,
          periods: state.periods,
          settings: state.settings,
        };
        await nativeApi('/api/restore', doc);
        state.revision = doc.revision;
      }

      if (wasCapturing) {
        try {
          await nativeApi('/api/set-capture', { enabled: true });
        } catch {}
      }
    } else {
      schedule();
      await this.flush();
    }
  }

  static async clearAll() {
    const next: AppDocument = {
      ...empty(),
      revision: state.revision,
      settings: state.settings,
    };
    if (desktop) {
      await this.flush();
      let wasCapturing = false;
      try {
        const status = await nativeApi<{ isCapturing: boolean }>('/api/capture-status');
        if (status.isCapturing) {
          wasCapturing = true;
          await nativeApi('/api/set-capture', { enabled: false });
        }
      } catch {}

      try {
        await nativeApi('/api/clear-activities');
      } catch {}

      let currentRev = state.revision;
      try {
        const currentDoc = await nativeApi<AppDocument | null>('/api/state');
        if (currentDoc && typeof currentDoc.revision === 'number') {
          currentRev = currentDoc.revision;
        }
      } catch {}

      next.revision = currentRev + 1;
      await nativeApi('/api/restore', next);
      state = next;

      if (wasCapturing) {
        try {
          await nativeApi('/api/set-capture', { enabled: true });
        } catch {}
      }
    } else {
      state = next;
      schedule();
      await this.flush();
    }
  }
  static async exportBackup(){await this.flush();const v=structuredClone(state);if(desktop){const captured=await nativeApi<ActivityItem[]>('/api/real-activities');const merged=new Map(captured.map(a=>[a.id,a]));for(const a of v.activities)merged.set(a.id,{...merged.get(a.id),...a});v.activities=[...merged.values()];}v.settings.groqApiKey='';return JSON.stringify(v,null,2);}
  static async restoreBackup(raw:string){const next=validateDocument(JSON.parse(raw));next.revision=state.revision;next.settings.groqApiKey='';if(desktop){await this.flush();next.revision=state.revision+1;await nativeApi('/api/restore',next);state=next;}else{state=next;schedule();await this.flush();}}
}
