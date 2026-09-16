/**
 * Domain Logic: Time & Billing Calculations
 * Pure mathematical functions for tenth-hour (6-minute), quarter-hour, and exact time increments.
 * Follows management consulting & legal billing standards.
 */

import { RoundingMode } from '../types/time-entry';

/**
 * Rounds duration in minutes according to the specified billing mode.
 * - tenth_hour: 6-minute increments (0.1h). In consulting, any work up to 6m is rounded to 0.1h,
 *   7m to 12m is 0.2h, etc.
 * - quarter_hour: 15-minute increments (0.25h).
 * - exact: Unrounded, exact fractional minutes.
 */
export function roundDurationMinutes(
  rawMinutes: number, 
  mode: RoundingMode = 'tenth_hour',
  strategy: 'ceil' | 'round' = 'ceil'
): { roundedMinutes: number; decimalHours: number } {
  if (rawMinutes <= 0) {
    return { roundedMinutes: 0, decimalHours: 0 };
  }

  let stepMinutes = 1;
  if (mode === 'tenth_hour') {
    stepMinutes = 6;
  } else if (mode === 'quarter_hour') {
    stepMinutes = 15;
  } else {
    // exact: unrounded minutes, decimal hours with at least 0.01h minimum if work occurred
    const rawDecimal = rawMinutes / 60;
    const decimal = Number(rawDecimal.toFixed(2));
    const decimalHours = rawMinutes > 0 && decimal === 0 ? 0.01 : decimal;
    return { roundedMinutes: rawMinutes, decimalHours };
  }

  let roundedMinutes: number;
  if (strategy === 'ceil') {
    roundedMinutes = Math.ceil(rawMinutes / stepMinutes) * stepMinutes;
  } else {
    roundedMinutes = Math.round(rawMinutes / stepMinutes) * stepMinutes;
  }

  // Ensure minimum increment if work occurred
  if (rawMinutes > 0 && roundedMinutes === 0) {
    roundedMinutes = stepMinutes;
  }

  const decimalHours = Number((roundedMinutes / 60).toFixed(2));
  return { roundedMinutes, decimalHours };
}

/**
 * Converts HH:mm time string into total minutes from midnight.
 */
export function timeStringToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

/**
 * Converts minutes from midnight into 24-hour HH:mm string.
 */
export function minutesToTimeString(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(1439, totalMinutes));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Calculates duration between start HH:mm and end HH:mm strings in minutes.
 * Handles crossing midnight cleanly.
 */
export function calculateDurationBetweenTimes(startTime: string, endTime: string): number {
  const start = timeStringToMinutes(startTime);
  let end = timeStringToMinutes(endTime);
  if (end < start) {
    end += 24 * 60; // crossed midnight
  }
  return end - start;
}

/**
 * Formats duration in minutes to human-readable string: e.g. "2h 15m" or "45m"
 */
export function formatDurationHuman(minutes: number): string {
  if (minutes < 0) return '0m';
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

/**
 * Formats currency amount for client timesheet presentation.
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
