/**
 * Domain Logic: Timeline Gap & Overlap Detector
 * Identifies untracked periods throughout the consulting workday and flags overlapping entries.
 */

import { TimeEntry } from '../types/time-entry';
import { timeStringToMinutes, minutesToTimeString } from './time-calculations';

export interface TimelineGap {
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export interface TimelineOverlap {
  entryA: TimeEntry;
  entryB: TimeEntry;
  overlapMinutes: number;
}

/**
 * Finds all untracked gaps during the workday (e.g. 09:00 to 18:00)
 * where no time entry was logged.
 */
export function detectTimelineGaps(
  entries: TimeEntry[],
  dayStart = '09:00',
  dayEnd = '18:00',
  minGapMinutes = 15
): TimelineGap[] {
  if (entries.length === 0) {
    const totalDayMins = timeStringToMinutes(dayEnd) - timeStringToMinutes(dayStart);
    if (totalDayMins >= minGapMinutes) {
      return [{
        startTime: dayStart,
        endTime: dayEnd,
        durationMinutes: totalDayMins,
      }];
    }
    return [];
  }

  // Sort entries by startTime
  const sorted = [...entries].sort((a, b) => 
    timeStringToMinutes(a.startTime) - timeStringToMinutes(b.startTime)
  );

  const gaps: TimelineGap[] = [];
  let currentPointer = timeStringToMinutes(dayStart);

  for (const entry of sorted) {
    const entryStart = timeStringToMinutes(entry.startTime);
    const entryEnd = timeStringToMinutes(entry.endTime);

    // If entry starts after current pointer, there is a gap
    if (entryStart > currentPointer) {
      const gapDuration = entryStart - currentPointer;
      if (gapDuration >= minGapMinutes) {
        gaps.push({
          startTime: minutesToTimeString(currentPointer),
          endTime: minutesToTimeString(entryStart),
          durationMinutes: gapDuration,
        });
      }
    }

    currentPointer = Math.max(currentPointer, entryEnd);
  }

  // Check gap between last entry and dayEnd
  const endOfDayMins = timeStringToMinutes(dayEnd);
  if (currentPointer < endOfDayMins) {
    const tailGap = endOfDayMins - currentPointer;
    if (tailGap >= minGapMinutes) {
      gaps.push({
        startTime: minutesToTimeString(currentPointer),
        endTime: dayEnd,
        durationMinutes: tailGap,
      });
    }
  }

  return gaps;
}

/**
 * Detects overlapping time entries on the same date.
 * Timesheet submission should warn if consultant has logged conflicting times.
 */
export function detectOverlaps(entries: TimeEntry[]): TimelineOverlap[] {
  const overlaps: TimelineOverlap[] = [];
  const sorted = [...entries].sort((a, b) => 
    timeStringToMinutes(a.startTime) - timeStringToMinutes(b.startTime)
  );

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];

      const aStart = timeStringToMinutes(a.startTime);
      const aEnd = timeStringToMinutes(a.endTime);
      const bStart = timeStringToMinutes(b.startTime);
      const bEnd = timeStringToMinutes(b.endTime);

      // If B starts before A ends, they overlap
      if (bStart < aEnd) {
        const overlapStart = Math.max(aStart, bStart);
        const overlapEnd = Math.min(aEnd, bEnd);
        const overlapDuration = overlapEnd - overlapStart;

        if (overlapDuration > 0) {
          overlaps.push({
            entryA: a,
            entryB: b,
            overlapMinutes: overlapDuration,
          });
        }
      } else {
        // Since list is sorted by start time, later items won't overlap with A
        break;
      }
    }
  }

  return overlaps;
}
