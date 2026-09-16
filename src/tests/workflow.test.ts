import { describe,it,expect } from 'vitest';
import { createPeriod,assertEditable,availableRanges,validateAllocations,calculateEntry,finalizePeriod,reopenPeriod,exportTimesheet,splitOvernight,aggregateEntries,consolidateEntries } from '../domain/workflow';
import { weekDates } from '../domain/calendar';
import { mergeActivities } from '../services/activity-tracker';
import { ActivityItem } from '../types/activity';
import { TimeEntry } from '../types/time-entry';
import { Client,Project } from '../types/client-project';
import { validateTimesheetForSubmission } from '../domain/timesheet-machine';
const c:Client={id:'c',name:'Client "A"',code:'A',color:'#fff',createdAt:''};
const p:Project={id:'p',clientId:'c',name:'Project',code:'P',color:'#fff',createdAt:'',defaultHourlyRate:300,isBillableDefault:true};
const a:ActivityItem={id:'a',timestamp:'2026-09-11T09:00:00Z',startTime:'09:00:00',endTime:'09:10:00',durationSeconds:600,appName:'Excel',windowTitle:'PRIVATE FILE',category:'spreadsheet',isIdle:false,isAssigned:false,source:'live',revision:1,finalized:true};
const entry:TimeEntry={id:'e',date:'2026-09-11',startTime:'09:00',endTime:'09:10',durationMinutes:10,decimalHours:10/60,clientId:'c',projectId:'p',taskName:'Review model',notes:'PRIVATE NOTE',isBillable:true,hourlyRate:300,calculatedRevenue:50,createdAt:'',updatedAt:''};
describe('Consultant workflow invariants',()=>{
  it('uses Monday through Sunday without a UTC date shift',()=>expect(weekDates('2026-09-11')).toEqual(['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13']));
  it('updates live revisions and preserves local decisions',()=>{const merged=mergeActivities([{...a,ignored:true}], [{...a,revision:2,durationSeconds:800}]);expect(merged).toHaveLength(1);expect(merged[0].durationSeconds).toBe(800);expect(merged[0].ignored).toBe(true);expect(mergeActivities(merged,[a])[0].revision).toBe(2);expect(mergeActivities(merged, [])).toEqual([]);});
  it('leaves the unallocated remainder and rejects duplicate use',()=>{const e={...entry,allocations:[{activityId:'a',startOffsetSeconds:0,endOffsetSeconds:200}]};expect(availableRanges(a,[e])).toEqual([{activityId:'a',startOffsetSeconds:200,endOffsetSeconds:600}]);expect(()=>validateAllocations({...e,id:'duplicate'},[a],[e])).toThrow('already allocated');expect(availableRanges(a,[])[0].endOffsetSeconds).toBe(600);});
  it('requires review of idle or legacy evidence',()=>{const e={...entry,allocations:[{activityId:'a',startOffsetSeconds:0,endOffsetSeconds:200}]};expect(()=>validateAllocations(e,[{...a,isIdle:true}],[])).toThrow('Review');expect(()=>validateAllocations(e,[{...a,isIdle:true,reviewed:true}],[])).not.toThrow();});
  it('rounds grouped work once and preserves a zero rate',()=>{const e=calculateEntry({...entry,isBillable:false,hourlyRate:0,allocations:[{activityId:'a',startOffsetSeconds:0,endOffsetSeconds:120},{activityId:'b',startOffsetSeconds:0,endOffsetSeconds:120}]},'tenth_hour');expect(e.actualDurationSeconds).toBe(240);expect(e.durationMinutes).toBe(6);expect(e.calculatedRevenue).toBe(0);});
  it('isolates finalization and locks from other weeks',()=>{const week=createPeriod(entry.date,'Name','mail');const final=finalizePeriod(week,[entry,{...entry,id:'other',date:'2026-09-18',projectId:''}],[c],[p],'exact','Name','mail');expect(final.snapshots![0].entries).toHaveLength(1);expect(()=>assertEditable([entry.date],[final])).toThrow('finalized');expect(()=>assertEditable(['2026-09-18'],[final])).not.toThrow();});
  it('blocks overlaps and unresolved suggestions',()=>{const week=createPeriod(entry.date,'N','E');expect(()=>finalizePeriod(week,[entry,{...entry,id:'e2'}],[c],[p],'exact','N','E')).toThrow('overlapping');expect(()=>finalizePeriod(week,[{...entry,needsReview:true}],[c],[p],'exact','N','E')).toThrow('Confirm');});
  it('does not treat a grouped task gap as worked time',()=>{const start=new Date('2026-09-11T09:00').getTime();const grouped={...entry,endTime:'10:00',workIntervals:[[start,start+600000],[start+3000000,start+3600000]] as [number,number][]};expect(()=>finalizePeriod(createPeriod(entry.date,'N','E'),[grouped,{...entry,id:'gap',startTime:'09:20',endTime:'09:30'}],[c],[p],'exact','N','E')).not.toThrow();});
  it('keeps old export immutable when catalog changes and draft reopens',()=>{const final=finalizePeriod(createPeriod(entry.date,'N','E'),[entry],[c],[p],'exact','N','E');const before=exportTimesheet(final,final.snapshots![0]);p.name='Renamed';const reopened=reopenPeriod(final);expect(reopened.revision).toBe(2);expect(exportTimesheet(final,reopened.snapshots![0])).toEqual(before);expect(before.csv).toContain('Client ""A""');expect(before.json).not.toContain('PRIVATE');p.name='Project';});
  it('splits an overnight entry without rounding twice',()=>{const parts=splitOvernight({...entry,startTime:'23:58',endTime:'00:02'},'tenth_hour');expect(parts).toHaveLength(2);expect(parts[1].date).toBe('2026-09-12');expect(parts.reduce((s,e)=>s+e.durationMinutes,0)).toBe(6);expect(parts.reduce((s,e)=>s+e.actualDurationSeconds!,0)).toBe(240);});
  it('validation never uses another week to make an empty period valid',()=>expect(validateTimesheetForSubmission([entry],createPeriod('2026-10-01','N','E')).isValid).toBe(false));

  it('aggregates repeated sessions for the same client and project into a single entry without overbilling gaps',()=>{
    const session1: TimeEntry = {
      ...entry,
      id: 'session-1',
      startTime: '09:00',
      endTime: '09:10',
      taskName: 'Notepad',
      sourceAppName: 'Notepad',
    };
    const session2: TimeEntry = {
      ...entry,
      id: 'session-2',
      startTime: '09:20',
      endTime: '09:30',
      taskName: 'Notepad',
      sourceAppName: 'Notepad',
      notes: 'Second meeting notes',
    };

    const aggregated = aggregateEntries(session1, session2, 'exact');
    expect(aggregated.id).toBe('session-1');
    expect(aggregated.startTime).toBe('09:00');
    expect(aggregated.endTime).toBe('09:30');
    // Actual worked time is 10 + 10 = 20 minutes (1200 seconds), NOT 30 minutes!
    expect(aggregated.actualDurationSeconds).toBe(1200);
    expect(aggregated.durationMinutes).toBe(20);
    expect(aggregated.calculatedRevenue).toBe(100);
    expect(aggregated.notes).toContain('PRIVATE NOTE');
    expect(aggregated.notes).toContain('Second meeting notes');
  });

  it('consolidates same-project duplicate entries while keeping cross-client entries separate',()=>{
    const e1: TimeEntry = { ...entry, id: '1', startTime: '09:00', endTime: '09:10', taskName: 'Notepad', sourceAppName: 'Notepad' };
    const e2: TimeEntry = { ...entry, id: '2', startTime: '09:15', endTime: '09:25', taskName: 'Notepad', sourceAppName: 'Notepad' };
    const e3: TimeEntry = { ...entry, id: '3', clientId: 'c_other', projectId: 'p_other', startTime: '10:00', endTime: '10:15', taskName: 'Notepad' };

    const consolidated = consolidateEntries([e1, e2, e3], 'exact');
    expect(consolidated).toHaveLength(2);
    const mergedSameProject = consolidated.find(e => e.clientId === 'c');
    expect(mergedSameProject).toBeDefined();
    expect(mergedSameProject?.durationMinutes).toBe(20);

    const period = createPeriod(entry.date, 'Consultant', 'mail@test.com');
    const audit = validateTimesheetForSubmission(consolidated, period);
    expect(audit.isValid).toBe(true);
    expect(audit.errors).toHaveLength(0);
  });
});
