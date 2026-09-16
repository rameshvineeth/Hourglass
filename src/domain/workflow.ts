import { TimeEntry, RoundingMode, AllocationRange } from '../types/time-entry';
import { TimesheetPeriod, TimesheetSnapshot } from '../types/timesheet';
import { Client, Project } from '../types/client-project';
import { ActivityItem } from '../types/activity';
import { weekDates, localDate } from './calendar';
import { roundDurationMinutes } from './time-calculations';

export function createPeriod(date:string, name:string,email:string):TimesheetPeriod {
  const days=weekDates(date);
  return {id:`week_${days[0]}`,startDate:days[0],endDate:days[6],status:'draft',revision:1,snapshots:[],consultantName:name,consultantEmail:email,totalHours:0,billableHours:0,nonBillableHours:0,totalRevenue:0,entriesCount:0,auditIssues:[]};
}
export function createCustomPeriod(startDate:string, endDate:string, name:string, email:string, clientId?:string, projectId?:string):TimesheetPeriod {
  const parts = ['period'];
  if (clientId) parts.push(clientId);
  if (projectId) parts.push(projectId);
  parts.push(startDate, endDate);
  return {id:parts.join('_'),startDate,endDate,clientId,projectId,status:'draft',revision:1,snapshots:[],consultantName:name,consultantEmail:email,totalHours:0,billableHours:0,nonBillableHours:0,totalRevenue:0,entriesCount:0,auditIssues:[]};
}
export function periodEntries(entries:TimeEntry[],period:TimesheetPeriod){
  return entries.filter(e=>e.date>=period.startDate&&e.date<=period.endDate&&(!period.clientId||e.clientId===period.clientId)&&(!period.projectId||e.projectId===period.projectId));
}
export function assertEditable(dates:string[],periods:TimesheetPeriod[]){
  if(periods.some(p=>p.status!=='draft'&&p.status!=='rejected'&&dates.some(d=>d>=p.startDate&&d<=p.endDate)))throw Error('This period has been finalized and submitted for approval. It is locked and cannot be edited.');
}
export function assertEntriesEditable(entries:TimeEntry[],periods:TimesheetPeriod[]){
  for(const entry of entries){
    const lockedBy=periods.find(p=>p.status!=='draft'&&p.status!=='rejected'&&entry.date>=p.startDate&&entry.date<=p.endDate&&(!p.clientId||p.clientId===entry.clientId)&&(!p.projectId||p.projectId===entry.projectId));
    if(lockedBy)throw Error('This period has been finalized and submitted for approval. It is locked and cannot be edited.');
  }
}
export function entryIntervals(e:TimeEntry):[number,number][] {
  const norm = (t: string) => t && t.length === 5 ? `${t}:00` : t || '00:00:00';
  const start=new Date(`${e.date}T${norm(e.startTime)}`).getTime();
  let end=new Date(`${e.date}T${norm(e.endTime)}`).getTime();
  if(end < start){
    const diff = start - end;
    if (diff <= 60000 && (e.actualDurationSeconds ?? 0) < 3600) {
      end = start + Math.max(1000, Math.round((e.actualDurationSeconds || (e.durationMinutes * 60)) * 1000));
    } else {
      const d=new Date(end);
      d.setDate(d.getDate()+1);
      end=d.getTime();
    }
  } else if (end === start && (e.actualDurationSeconds ?? 0) > 0) {
    end = start + Math.max(1000, Math.round((e.actualDurationSeconds || (e.durationMinutes * 60)) * 1000));
  }
  return [[start,end]];
}
export function validateEntry(e:TimeEntry,clients:Client[],projects:Project[]):string[] {
  const errors:string[]=[];
  const project=projects.find(p=>p.id===e.projectId);
  if(!clients.some(c=>c.id===e.clientId)||!project||project.clientId!==e.clientId)errors.push('Choose a valid client and its project.');
  if(!e.taskName.trim())errors.push('Describe the work for the reviewer.');
  const [[start,end]]=entryIntervals(e);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>86400000)errors.push('Enter a positive time interval of at most 24 hours.');
  if(!Number.isFinite(e.hourlyRate)||e.hourlyRate<0||!Number.isFinite(e.durationMinutes)||e.durationMinutes<=0)errors.push('Duration and rate must be valid numbers.');
  return errors;
}
export function availableRanges(activity:ActivityItem,entries:TimeEntry[],excludeId?:string):AllocationRange[]{
  const used=entries.filter(e=>e.id!==excludeId).flatMap(e=>e.allocations||((e.sourceActivityIds||[]).includes(activity.id)?[{activityId:activity.id,startOffsetSeconds:0,endOffsetSeconds:activity.durationSeconds}]:[])).filter(a=>a.activityId===activity.id).sort((a,b)=>a.startOffsetSeconds-b.startOffsetSeconds);
  let cursor=0;const free:AllocationRange[]=[];
  for(const a of used){if(a.startOffsetSeconds>cursor)free.push({activityId:activity.id,startOffsetSeconds:cursor,endOffsetSeconds:a.startOffsetSeconds});cursor=Math.max(cursor,a.endOffsetSeconds);}
  if(cursor<activity.durationSeconds)free.push({activityId:activity.id,startOffsetSeconds:cursor,endOffsetSeconds:activity.durationSeconds});
  return free;
}
export function validateAllocations(entry:TimeEntry,activities:ActivityItem[],entries:TimeEntry[]){
  for(const a of entry.allocations||[]){
    const activity=activities.find(x=>x.id===a.activityId);
    if(activity){
      if(activity.finalized===false||activity.legacyDateUncertain||((activity.isIdle||activity.needsReview)&&!activity.reviewed))throw Error('Review this captured interval before allocating it.');
      if(!Number.isFinite(a.startOffsetSeconds)||!Number.isFinite(a.endOffsetSeconds)||a.startOffsetSeconds<0||a.endOffsetSeconds<=a.startOffsetSeconds||a.endOffsetSeconds>activity.durationSeconds+0.001)throw Error('Allocation exceeds the captured interval.');
      if(!availableRanges(activity,entries,entry.id).some(f=>a.startOffsetSeconds>=f.startOffsetSeconds&&a.endOffsetSeconds<=f.endOffsetSeconds))throw Error('This captured time is already allocated.');
    } else {
      if(!Number.isFinite(a.startOffsetSeconds)||!Number.isFinite(a.endOffsetSeconds)||a.startOffsetSeconds<0||a.endOffsetSeconds<=a.startOffsetSeconds)throw Error('Allocation exceeds the captured interval.');
    }
    const same=(entry.allocations||[]).filter(x=>x!==a&&x.activityId===a.activityId);
    if(same.some(x=>x.startOffsetSeconds<a.endOffsetSeconds&&x.endOffsetSeconds>a.startOffsetSeconds))throw Error('Selected allocation ranges overlap.');
  }
}
export function calculateEntry(e:TimeEntry,mode:RoundingMode):TimeEntry {
  const [[start,end]]=entryIntervals(e);
  const seconds = e.allocations?.length
    ? e.allocations.reduce((n, a) => n + (a.endOffsetSeconds - a.startOffsetSeconds), 0)
    : e.workIntervals?.length
      ? e.workIntervals.reduce((n, [s, f]) => n + (f - s) / 1000, 0)
      : (end - start) / 1000;
  const billing=roundDurationMinutes(seconds/60,mode);
  return {...e,actualDurationSeconds:seconds,durationMinutes:billing.roundedMinutes,decimalHours:billing.decimalHours,roundingMode:mode,
    calculatedRevenue:e.isBillable?Math.round(billing.roundedMinutes/60*e.hourlyRate*100)/100:0};
}

/**
 * Merges two time entries for the same client, project, and date into a single consolidated entry.
 * Unifies allocation ranges, source activity IDs, work intervals, time bounds, and notes,
 * then recalculates duration and billing revenue.
 */
export function aggregateEntries(
  existing: TimeEntry, 
  incoming: TimeEntry, 
  mode: RoundingMode = 'tenth_hour'
): TimeEntry {
  const existingAlloc = existing.allocations || [];
  const incomingAlloc = incoming.allocations || [];
  const mergedAlloc: AllocationRange[] = [...existingAlloc];

  for (const a of incomingAlloc) {
    const duplicate = mergedAlloc.some(m => 
      m.activityId === a.activityId &&
      Math.abs(m.startOffsetSeconds - a.startOffsetSeconds) < 0.001 &&
      Math.abs(m.endOffsetSeconds - a.endOffsetSeconds) < 0.001
    );
    if (!duplicate) {
      mergedAlloc.push(a);
    }
  }

  const mergedSourceActivityIds = [
    ...new Set([
      ...(existing.sourceActivityIds || []),
      ...(incoming.sourceActivityIds || [])
    ])
  ];

  const existingIntervals = existing.workIntervals || entryIntervals(existing);
  const incomingIntervals = incoming.workIntervals || entryIntervals(incoming);
  const rawIntervals: [number, number][] = [
    ...existingIntervals,
    ...incomingIntervals
  ].sort((a, b) => a[0] - b[0]);

  // Union overlapping or contiguous intervals so gaps are preserved and overlaps are cleanly unified
  const mergedWorkIntervals: [number, number][] = [];
  for (const interval of rawIntervals) {
    if (!mergedWorkIntervals.length) {
      mergedWorkIntervals.push([interval[0], interval[1]]);
    } else {
      const prev = mergedWorkIntervals[mergedWorkIntervals.length - 1];
      if (interval[0] <= prev[1]) {
        prev[1] = Math.max(prev[1], interval[1]);
      } else {
        mergedWorkIntervals.push([interval[0], interval[1]]);
      }
    }
  }

  const norm = (t: string) => t && t.length === 5 ? `${t}:00` : t || '00:00:00';
  const start1 = norm(existing.startTime);
  const start2 = norm(incoming.startTime);
  const startTime = start1 <= start2 ? existing.startTime : incoming.startTime;

  const end1 = norm(existing.endTime);
  const end2 = norm(incoming.endTime);
  const endTime = end1 >= end2 ? existing.endTime : incoming.endTime;

  let notes = existing.notes || '';
  if (incoming.notes && incoming.notes.trim() && !notes.includes(incoming.notes.trim())) {
    notes = notes ? `${notes} · ${incoming.notes.trim()}` : incoming.notes.trim();
  }

  const getCleanApps = (str?: string) => (str || '').split(/[,·|]/).map(s => s.trim()).filter(Boolean);
  const allApps = [...new Set([...getCleanApps(existing.sourceAppName), ...getCleanApps(incoming.sourceAppName)])];
  const dedicatedApps = allApps.filter(a => !/^(?:google chrome|chrome|edge|brave|firefox|opera)$/i.test(a.trim().replace(/\.exe$/i, '')));
  const appNames = (dedicatedApps.length > 0 ? dedicatedApps : allApps).join(', ');

  // Sanitize task name and preserve document titles in notes
  const cleanTitle = (t?: string) => (t || '').replace(/^\*\s*/, '').trim();
  const title1 = cleanTitle(existing.taskName);
  const title2 = cleanTitle(incoming.taskName);
  if (title2 && title1.toLowerCase() !== title2.toLowerCase() && !notes.includes(title2)) {
    notes = notes ? `${notes} · ${title2}` : title2;
  }

  const mergedDraft: TimeEntry = {
    ...existing,
    taskName: title1 || existing.taskName,
    startTime,
    endTime,
    notes,
    sourceAppName: appNames || existing.sourceAppName,
    allocations: mergedAlloc.length > 0 ? mergedAlloc : undefined,
    sourceActivityIds: mergedSourceActivityIds.length > 0 ? mergedSourceActivityIds : undefined,
    workIntervals: mergedWorkIntervals.length > 0 ? mergedWorkIntervals : undefined,
    needsReview: false,
    updatedAt: new Date().toISOString(),
  };

  return calculateEntry(mergedDraft, mode);
}

/**
 * Checks if two entries represent work on the same engagement and same application or task.
 */
export function areEntriesMatchingForAggregation(a: TimeEntry, b: TimeEntry): boolean {
  if (a.date !== b.date || a.clientId !== b.clientId || a.projectId !== b.projectId) {
    return false;
  }

  const getAppTokens = (app?: string) =>
    (app || '')
      .split(/[,·|]/)
      .map(s => s.trim().replace(/\.exe$/i, '').toLowerCase())
      .filter(Boolean);

  const appsA = getAppTokens(a.sourceAppName);
  const appsB = getAppTokens(b.sourceAppName);
  const hasMatchingApp = appsA.length > 0 && appsB.length > 0 && appsA.some(x => appsB.some(y => x === y || x.includes(y) || y.includes(x)));

  const cleanTask = (t?: string) =>
    (t || '')
      .replace(/^\*\s*/, '')
      .replace(/\s*-\s*[^-]+$/, '')
      .trim()
      .toLowerCase();

  const taskA = (a.taskName || '').trim().toLowerCase();
  const taskB = (b.taskName || '').trim().toLowerCase();
  const exactTaskMatch = Boolean(taskA && taskB && taskA === taskB);

  const baseTaskA = cleanTask(a.taskName);
  const baseTaskB = cleanTask(b.taskName);
  const baseTaskMatch = Boolean(baseTaskA && baseTaskB && baseTaskA === baseTaskB);

  const taskMentionsApp =
    appsA.some(app => taskB.includes(app)) ||
    appsB.some(app => taskA.includes(app));

  return hasMatchingApp || exactTaskMatch || baseTaskMatch || taskMentionsApp;
}

/**
 * Consolidates multiple fragmented entries for the same client, project, date, and task/app into aggregated entries.
 */
export function consolidateEntries(entries: TimeEntry[], mode: RoundingMode): TimeEntry[] {
  const result: TimeEntry[] = [];

  for (const entry of entries) {
    const matchIndex = result.findIndex(e => areEntriesMatchingForAggregation(e, entry));

    if (matchIndex >= 0) {
      result[matchIndex] = aggregateEntries(result[matchIndex], entry, mode);
    } else {
      result.push(entry);
    }
  }

  return result;
}
export function splitOvernight(e:TimeEntry,mode:RoundingMode):TimeEntry[]{
  const [[start,end]]=entryIntervals(e); const midnight=new Date(start);midnight.setHours(24,0,0,0);
  if(end<=midnight.getTime()||e.allocations?.length)return [calculateEntry(e,mode)];
  // Bill once for the work entry, then distribute rounded time across calendar days.
  const full=calculateEntry(e,mode);const firstSeconds=(midnight.getTime()-start)/1000;
  const fraction=firstSeconds/full.actualDurationSeconds!;
  const firstMinutes=full.durationMinutes*fraction;
  const part=(entry:TimeEntry,seconds:number,minutes:number)=>{
    const dec = Number((minutes / 60).toFixed(2));
    const decimalHours = minutes > 0 && dec === 0 ? 0.01 : dec;
    return {...entry,actualDurationSeconds:seconds,durationMinutes:minutes,decimalHours,roundingMode:mode,calculatedRevenue:entry.isBillable?Math.round(minutes/60*entry.hourlyRate*100)/100:0};
  };
  return [part({...e,endTime:'24:00'},firstSeconds,firstMinutes),part({...e,id:crypto.randomUUID(),date:localDate(midnight),startTime:'00:00'},full.actualDurationSeconds!-firstSeconds,full.durationMinutes-firstMinutes)];
}
export function finalizePeriod(period:TimesheetPeriod,entries:TimeEntry[],clients:Client[],projects:Project[],mode:RoundingMode,name:string,email:string):TimesheetPeriod {
  const selected=periodEntries(entries,period);
  if(!selected.length)throw Error('This period contains no time entries.');
  for(const e of selected){const problems=validateEntry(e,clients,projects);if(problems.length)throw Error(problems[0]);if(e.needsReview)throw Error('Confirm all suggestions before finalizing.');}
  for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++){
    if(workIntervals(selected[i]).some(([a,b])=>workIntervals(selected[j]).some(([c,d])=>a<d&&c<b)))throw Error('Resolve overlapping work before finalizing.');
  }
  if(period.status!=='draft'&&period.status!=='rejected')throw Error('This revision is already finalized.');
  const snapshot:TimesheetSnapshot=structuredClone({revision:period.revision||1,finalizedAt:new Date().toISOString(),consultantName:name,consultantEmail:email,roundingMode:mode,entries:selected,clients,projects});
  return {...period,status:'submitted',submittedAt:snapshot.finalizedAt,consultantName:name,consultantEmail:email,snapshots:[...(period.snapshots||[]),snapshot]};
}
// Grouped work can have gaps: do not claim its entire bounding interval.
export function workIntervals(e:TimeEntry):[number,number][]{
  return e.workIntervals?.length?e.workIntervals:entryIntervals(e);
}
export function reopenPeriod(period:TimesheetPeriod):TimesheetPeriod {return {...period,status:'draft',revision:(period.revision||1)+1,submittedAt:undefined,approvedAt:undefined};}
export function csvCell(value:unknown){let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
export function exportTimesheet(period:TimesheetPeriod,snapshot:TimesheetSnapshot,clientFilterId?:string,projectFilterId?:string){
  const targetClientId=clientFilterId||period.clientId;
  const targetProjectId=projectFilterId||period.projectId;
  const rawEntries=snapshot.entries.filter(e=>
    (!targetClientId||e.clientId===targetClientId)&&
    (!targetProjectId||e.projectId===targetProjectId)
  );
  const relevantClients=targetClientId?snapshot.clients.filter(c=>c.id===targetClientId):snapshot.clients;
  const relevantProjects=targetProjectId
    ?snapshot.projects.filter(p=>p.id===targetProjectId)
    :targetClientId
      ?snapshot.projects.filter(p=>p.clientId===targetClientId)
      :snapshot.projects;
  const entries=rawEntries.map(e=>({date:e.date,startTime:e.startTime,endTime:e.endTime,client:snapshot.clients.find(c=>c.id===e.clientId)?.name||'',project:snapshot.projects.find(p=>p.id===e.projectId)?.name||'',description:e.taskName,actualHours:(e.actualDurationSeconds??e.durationMinutes*60)/3600,billedHours:e.durationMinutes/60,billable:e.isBillable,rate:e.hourlyRate,amount:e.calculatedRevenue}));
  const metrics={actualHours:entries.reduce((s,e)=>s+e.actualHours,0),billedHours:entries.reduce((s,e)=>s+e.billedHours,0),amount:Math.round(entries.reduce((s,e)=>s+e.amount,0)*100)/100};
  const headers=['date','startTime','endTime','client','project','description','actualHours','billedHours','billable','rate','amount'] as const;
  const csv=[headers.join(','),...entries.map(e=>headers.map(k=>csvCell(e[k])).join(','))].join('\r\n');
  return {csv,json:JSON.stringify({startDate:period.startDate,endDate:period.endDate,revision:snapshot.revision,finalizedAt:snapshot.finalizedAt,consultantName:snapshot.consultantName,consultantEmail:snapshot.consultantEmail,roundingMode:snapshot.roundingMode,clientId:targetClientId,projectId:targetProjectId,metrics,clients:relevantClients,projects:relevantProjects,entries},null,2)};
}
