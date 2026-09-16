import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Client, Project } from '../../types/client-project';
import { TimeEntry, RoundingMode, AllocationRange } from '../../types/time-entry';
import { ActivityItem } from '../../types/activity';
import { availableRanges, calculateEntry, entryIntervals } from '../../domain/workflow';
import { cleanTaskDescription } from '../../domain/timeline-layout';
interface Props {isOpen:boolean;onClose:()=>void;clients:Client[];projects:Project[];activeDate:string;sourceActivity?:ActivityItem|null;sourceActivities?:ActivityItem[];existingEntries?:TimeEntry[];entryToEdit?:TimeEntry|null;roundingMode:RoundingMode;onSaveEntry:(entry:Partial<TimeEntry>)=>boolean|void|Promise<boolean|void>}
export const TimeEntryEditorModal:React.FC<Props>=({isOpen,onClose,clients,projects,activeDate,sourceActivity,sourceActivities=[],existingEntries=[],entryToEdit,roundingMode,onSaveEntry})=>{
  const sources=sourceActivities.length?sourceActivities:sourceActivity?[sourceActivity]:[];
  const [ranges,setRanges]=useState<AllocationRange[]>(()=>entryToEdit?.allocations||sources.flatMap(a=>availableRanges(a,existingEntries)));
  const [date,setDate]=useState(entryToEdit?.date||activeDate);
  const [start,setStart]=useState(entryToEdit?.startTime||'09:00');
  const [end,setEnd]=useState(entryToEdit?.endTime==='24:00'?'00:00':entryToEdit?.endTime||'10:00');
  const [clientId,setClient]=useState(entryToEdit?.clientId||'');
  const [projectId,setProject]=useState(entryToEdit?.projectId||'');
  const defaultTask = entryToEdit?.taskName || (sourceActivity ? cleanTaskDescription(sourceActivity.windowTitle, sourceActivity.appName) : '') || (sources[0] ? cleanTaskDescription(sources[0].windowTitle, sources[0].appName) : '');
  const [task,setTask]=useState(defaultTask);
  const [notes,setNotes]=useState(entryToEdit?.notes||'');
  const [billable,setBillable]=useState(entryToEdit?.isBillable??true);
  const [rate,setRate]=useState(entryToEdit?.hourlyRate??0);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const selectProject=(id:string)=>{setProject(id);const p=projects.find(p=>p.id===id);if(p){setRate(p.defaultHourlyRate);setBillable(p.isBillableDefault);}};
  const workIntervals:[number,number][]=sources.length?ranges.map(r=>{const a=sources.find(a=>a.id===r.activityId)!;const base=a.startedAt?Date.parse(a.startedAt):new Date(`${date}T${a.startTime}`).getTime();return [base+r.startOffsetSeconds*1000,base+r.endOffsetSeconds*1000];}):entryToEdit?.workIntervals||[];
  const clock=(ms:number)=>new Date(ms).toTimeString().slice(0,8);
  const primaryAppName = sourceActivity?.appName || (sources.length ? sources[0].appName : entryToEdit?.sourceAppName);
  const appNames = primaryAppName || (sources.length ? [...new Set(sources.map(s=>s.appName).filter(Boolean))].join(', ') : entryToEdit?.sourceAppName);
  const primaryTitle = sources.length ? (sources[0]?.windowTitle || undefined) : entryToEdit?.sourceWindowTitle;
  const data={...entryToEdit,date,startTime:workIntervals.length?clock(Math.min(...workIntervals.map(i=>i[0]))):start,endTime:workIntervals.length?clock(Math.max(...workIntervals.map(i=>i[1]))):end,clientId,projectId,taskName:task.trim(),notes,isBillable:billable,hourlyRate:rate,allocations:ranges.length?ranges:undefined,sourceActivityIds:ranges.length?[...new Set(ranges.map(r=>r.activityId))]:entryToEdit?.sourceActivityIds,sourceAppName:appNames,sourceWindowTitle:primaryTitle,workIntervals:workIntervals.length?workIntervals:undefined,needsReview:false} as TimeEntry;
  const preview=calculateEntry(data,entryToEdit?.roundingMode||roundingMode);
  const field='w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900';
  return <Modal isOpen={isOpen} onClose={onClose} title={entryToEdit?'Edit work entry':'Log work'} subtitle="Actual work and billing increments are shown separately." maxWidth="xl"><form className="space-y-4 text-sm text-slate-800" onSubmit={async e=>{e.preventDefault();if(!Number.isFinite(preview.actualDurationSeconds)||preview.actualDurationSeconds!<=0){setError('Enter a positive duration.');return;}setSaving(true);try{if(await onSaveEntry({...data,actualDurationSeconds:preview.actualDurationSeconds,durationMinutes:preview.durationMinutes,decimalHours:preview.decimalHours,calculatedRevenue:preview.calculatedRevenue,roundingMode:entryToEdit?.roundingMode||roundingMode})!==false)onClose();else setError('Entry could not be saved. Review the workspace message.');}finally{setSaving(false);}}}>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    {appNames&&<div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200/60 flex items-center gap-2 text-xs text-blue-900"><span className="font-semibold text-blue-800">Source Evidence:</span><span className="font-bold">{appNames}</span></div>}
    <div className="grid grid-cols-2 gap-3"><label>Client<select className={field} required value={clientId} onChange={e=>{setClient(e.target.value);setProject('');}}><option value="">Choose client</option>{clients.filter(c=>!c.archived||c.id===clientId).map(c=><option key={c.id} value={c.id}>{c.name}{c.archived?' (archived)':''}</option>)}</select></label><label>Project<select className={field} required value={projectId} onChange={e=>selectProject(e.target.value)}><option value="">Choose project</option>{projects.filter(p=>p.clientId===clientId&&(!p.archived||p.id===projectId)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
    <label className="block">Work description for manager<input className={field} required value={task} onChange={e=>setTask(e.target.value)} placeholder="e.g. Reviewed client valuation assumptions"/></label>
    {sources.length?<fieldset className="space-y-2"><legend className="font-medium">Allocated ranges (seconds from each capture’s start)</legend>{ranges.map((r,i)=>{const a=sources.find(a=>a.id===r.activityId)!;return <div key={`${r.activityId}-${i}`} className="flex flex-wrap items-center gap-2"><span className="flex-1">{a.appName} · {a.startTime}</span><label>From <input aria-label={`Start offset ${i+1}`} type="number" min="0" step="0.001" max={a.durationSeconds} className="w-24 rounded border p-1" value={r.startOffsetSeconds} onChange={e=>setRanges(v=>v.map((x,j)=>i===j?{...x,startOffsetSeconds:Number(e.target.value)}:x))}/></label><label>To <input aria-label={`End offset ${i+1}`} type="number" min="0" step="0.001" max={a.durationSeconds} className="w-24 rounded border p-1" value={r.endOffsetSeconds} onChange={e=>setRanges(v=>v.map((x,j)=>i===j?{...x,endOffsetSeconds:Number(e.target.value)}:x))}/></label></div>;})}<p className="text-xs text-slate-500">Reduce a range to split work between clients. The remainder stays available.</p></fieldset>:<div className="grid grid-cols-3 gap-3"><label>Date<input className={field} type="date" required value={date} onChange={e=>setDate(e.target.value)} disabled={!!entryToEdit?.allocations?.length}/></label><label>Start<input className={field} type="time" step="1" required value={start} onChange={e=>setStart(e.target.value)} disabled={!!entryToEdit?.allocations?.length}/></label><label>End<input className={field} type="time" step="1" required value={end} onChange={e=>setEnd(e.target.value)} disabled={!!entryToEdit?.allocations?.length}/></label></div>}
    {!sources.length&&!entryToEdit?.allocations?.length&&entryIntervals(data)[0][1]>new Date(date+'T24:00').getTime()&&<p>This overnight entry will be split across its two calendar days, with billing rounded once.</p>}
    <div className="rounded-xl bg-blue-50 p-3">Actual: {Number.isFinite(preview.actualDurationSeconds)?(preview.actualDurationSeconds!/60).toFixed(2):'—'} min · Billing: {Number.isFinite(preview.durationMinutes)?preview.durationMinutes.toFixed(2):'—'} min · Amount: ${Number.isFinite(preview.calculatedRevenue)?preview.calculatedRevenue.toFixed(2):'—'}</div>
    <div className="flex items-center justify-between"><label><input type="checkbox" checked={billable} onChange={e=>setBillable(e.target.checked)}/> Billable</label><label>Hourly rate <input className="w-28 rounded border p-2" type="number" min="0" step="0.01" required value={rate} onChange={e=>setRate(Number(e.target.value))}/></label></div>
    <label className="block">Private notes<textarea className={field} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    <div className="flex justify-end gap-3"><button type="button" onClick={onClose}>Cancel</button><button className="rounded-lg bg-blue-600 px-4 py-2 text-white" disabled={saving} type="submit">{saving?'Saving…':'Save work entry'}</button></div>
  </form></Modal>;
};
