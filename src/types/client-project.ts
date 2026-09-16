/**
 * Client and Project Definitions for Hourglass
 * Defines structure for corporate clients, project engagements, and task billing defaults.
 */

export interface Client {
  archived?: boolean;
  id: string;
  name: string;
  code: string; // e.g. "ACME", "BETA"
  contactName?: string;
  color: string; // Hex color for visual distinction
  createdAt: string;
}

export interface Project {
  archived?: boolean;
  id: string;
  clientId: string;
  name: string;
  code: string; // e.g. "ACME-MA-01"
  defaultHourlyRate: number; // e.g. 350 ($/hr)
  isBillableDefault: boolean;
  color: string;
  budgetHours?: number; // e.g. 40h cap
  engagementRole?: string; // e.g. "M&A Advisory", "Financial Modeling"
  keywords?: string[]; // e.g. ["Apex", "Valuation", "Due Diligence"]
  billingIncrementMinutes?: number; // default 6
  createdAt: string;
}

export interface TaskCategory {
  id: string;
  name: string;
  isBillable: boolean;
}
