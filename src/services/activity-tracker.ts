import { ActivityItem } from '../types/activity';
import { nativeApi } from './native-api';
export interface CaptureStatus { isCapturing: boolean; state: string; error?: string }
export function mergeActivities(existing: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
  const existingMap = new Map(existing.map(a => [a.id, a]));
  const incomingIds = new Set(incoming.map(a => a.id));

  // Retain non-live activities (e.g. calendar imports, simulations) and reviewed items not part of native capture
  const nonLive = existing.filter(a => (a.source !== 'live' || a.category === 'meeting' || a.reviewed) && !incomingIds.has(a.id));
  const result: ActivityItem[] = [...nonLive];

  for (const a of incoming) {
    const old = existingMap.get(a.id);
    if (old && (old.revision ?? 0) > (a.revision ?? 0)) {
      result.push(old);
      continue;
    }
    result.push({
      ...old,
      ...a,
      isAssigned: old?.isAssigned ?? false,
      assignedEntryId: old?.assignedEntryId,
      ignored: old?.ignored,
      reviewed: old?.reviewed,
    });
  }
  return result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
export class ActivityTracker {
  private stopped=true;
  private timer:ReturnType<typeof setTimeout>|undefined;
  startLiveTracking(onCaptured:(items:ActivityItem[])=>void,onStatus?:(status:CaptureStatus)=>void,onError?:(message:string)=>void){
    this.stopped=false;
    const poll=async()=>{
      try{
        const [items,status,icons]=await Promise.all([nativeApi<ActivityItem[]>('/api/real-activities'),nativeApi<CaptureStatus>('/api/capture-status'),nativeApi<Record<string,string>>('/api/icons')]);
        if(this.stopped)return;
        if(!Array.isArray(items))throw Error('Invalid capture response');
        onCaptured(items.map(a=>({...a,appIcon:a.iconId?icons[a.iconId]:undefined})));onStatus?.(status);
      }catch(e){if(!this.stopped)onError?.(e instanceof Error?e.message:String(e));}
      finally{if(!this.stopped)this.timer=setTimeout(poll,1000);}
    };void poll();
  }
  stopLiveTracking(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
}
