import { describe, it, expect } from 'vitest';
import { 
  roundDurationMinutes, 
  timeStringToMinutes, 
  minutesToTimeString, 
  calculateDurationBetweenTimes,
  formatDurationHuman 
} from '../domain/time-calculations';

describe('Domain: Time & Billing Calculations', () => {
  describe('Tenth-Hour (6-Minute) Consulting Rounding', () => {
    it('rounds 2 minutes up to 6 minutes (0.1h)', () => {
      const result = roundDurationMinutes(2, 'tenth_hour');
      expect(result.roundedMinutes).toBe(6);
      expect(result.decimalHours).toBe(0.1);
    });

    it('keeps exact 6 minutes as 6 minutes (0.1h)', () => {
      const result = roundDurationMinutes(6, 'tenth_hour');
      expect(result.roundedMinutes).toBe(6);
      expect(result.decimalHours).toBe(0.1);
    });

    it('rounds 7 minutes up to 12 minutes (0.2h)', () => {
      const result = roundDurationMinutes(7, 'tenth_hour');
      expect(result.roundedMinutes).toBe(12);
      expect(result.decimalHours).toBe(0.2);
    });

    it('rounds 25 minutes to 30 minutes (0.5h)', () => {
      const result = roundDurationMinutes(25, 'tenth_hour');
      expect(result.roundedMinutes).toBe(30);
      expect(result.decimalHours).toBe(0.5);
    });

    it('rounds 58 minutes to 60 minutes (1.0h)', () => {
      const result = roundDurationMinutes(58, 'tenth_hour');
      expect(result.roundedMinutes).toBe(60);
      expect(result.decimalHours).toBe(1.0);
    });
  });

  describe('Quarter-Hour (15-Minute) Rounding', () => {
    it('rounds 10 minutes to 15 minutes (0.25h)', () => {
      const result = roundDurationMinutes(10, 'quarter_hour');
      expect(result.roundedMinutes).toBe(15);
      expect(result.decimalHours).toBe(0.25);
    });

    it('rounds 35 minutes to 45 minutes (0.75h)', () => {
      const result = roundDurationMinutes(35, 'quarter_hour');
      expect(result.roundedMinutes).toBe(45);
      expect(result.decimalHours).toBe(0.75);
    });
  });

  describe('Exact Mode Rounding', () => {
    it('returns exact minutes and decimal hours for standard duration', () => {
      const result = roundDurationMinutes(30, 'exact');
      expect(result.roundedMinutes).toBe(30);
      expect(result.decimalHours).toBe(0.5);
    });

    it('enforces minimum 0.01h for micro-activity under 36 seconds', () => {
      // 4 seconds = 0.0667 minutes
      const result = roundDurationMinutes(4 / 60, 'exact');
      expect(result.roundedMinutes).toBeCloseTo(0.0667, 3);
      expect(result.decimalHours).toBe(0.01);
    });

    it('returns 0 decimal hours when 0 minutes work occurred', () => {
      const result = roundDurationMinutes(0, 'exact');
      expect(result.roundedMinutes).toBe(0);
      expect(result.decimalHours).toBe(0);
    });
  });

  describe('Time String Conversions', () => {
    it('converts HH:mm to minutes from midnight', () => {
      expect(timeStringToMinutes('09:30')).toBe(570);
      expect(timeStringToMinutes('00:00')).toBe(0);
      expect(timeStringToMinutes('23:59')).toBe(1439);
    });

    it('converts minutes to HH:mm string', () => {
      expect(minutesToTimeString(570)).toBe('09:30');
      expect(minutesToTimeString(0)).toBe('00:00');
      expect(minutesToTimeString(1439)).toBe('23:59');
    });

    it('calculates duration between two time strings', () => {
      expect(calculateDurationBetweenTimes('09:15', '10:30')).toBe(75);
      expect(calculateDurationBetweenTimes('14:00', '14:45')).toBe(45);
    });
  });

  describe('Human Duration Formatting', () => {
    it('formats durations correctly', () => {
      expect(formatDurationHuman(45)).toBe('45m');
      expect(formatDurationHuman(60)).toBe('1h');
      expect(formatDurationHuman(75)).toBe('1h 15m');
      expect(formatDurationHuman(130)).toBe('2h 10m');
    });
  });
});
