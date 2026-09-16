import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { TimeEntry } from '../../types/time-entry';
import { TimesheetPeriod } from '../../types/timesheet';
import { validateTimesheetForSubmission } from '../../domain/timesheet-machine';
import { 
  XCircle, 
  AlertTriangle, 
  ArrowRight, 
  FileCheck2,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';

interface ValidationChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: TimeEntry[];
  period: TimesheetPeriod;
  unallocatedCount?: number;
  onProceedToSubmit: () => void;
}

export const ValidationChecklistModal: React.FC<ValidationChecklistModalProps> = ({
  isOpen,
  onClose,
  entries,
  period,
  unallocatedCount = 0,
  onProceedToSubmit,
}) => {
  const validation = validateTimesheetForSubmission(entries, period);
  if (unallocatedCount) {
    validation.warnings.push({
      type: 'warning',
      message: `${unallocatedCount} captured intervals still contain unallocated time. Review them on the Activity tab or leave them unbilled.`
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Pre-Submission Audit Checklist"
      subtitle={`Compliance verification for period ${period.startDate} to ${period.endDate}`}
      maxWidth="lg"
    >
      <div className="space-y-4 pt-1">
        {/* Overall Status Banner */}
        <div className={`p-3.5 rounded-xl border flex items-center gap-3 ${
          validation.isValid
            ? 'bg-emerald-50 border-emerald-200/80 text-emerald-900'
            : 'bg-rose-50 border-rose-200/80 text-rose-900'
        }`}>
          <div className={`p-2 rounded-lg shrink-0 ${
            validation.isValid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
          }`}>
            {validation.isValid ? (
              <ShieldCheck className="w-5 h-5" />
            ) : (
              <ShieldAlert className="w-5 h-5" />
            )}
          </div>

          <div className="text-xs min-w-0 flex-1">
            <div className="font-bold text-slate-900">
              {validation.isValid 
                ? "Pre-submission audit passed! Ready for finalization."
                : "Compliance issues detected. Corrections required before locking."}
            </div>
            <div className="text-slate-500 mt-0.5 font-medium">
              {validation.errors.length} blocking error(s) · {validation.warnings.length} advisory notice(s) · {entries.length} total entries
            </div>
          </div>
        </div>

        {/* Audit Checklist Items */}
        <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
          {/* Blocking Errors */}
          {validation.errors.map((err, i) => (
            <div
              key={`err_${i}`}
              className="p-3 rounded-xl bg-rose-50/70 border border-rose-200/70 flex items-start gap-2.5 text-xs text-rose-800"
            >
              <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-rose-900">Blocking Requirement</div>
                <div className="text-rose-700 mt-0.5">{err.message}</div>
              </div>
            </div>
          ))}

          {/* Warnings */}
          {validation.warnings.map((warn, i) => (
            <div
              key={`warn_${i}`}
              className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/70 flex items-start gap-2.5 text-xs text-amber-800"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-900">Advisory Notice</div>
                <div className="text-amber-700 mt-0.5">{warn.message}</div>
              </div>
            </div>
          ))}

          {/* Clean State */}
          {validation.errors.length === 0 && validation.warnings.length === 0 && (
            <div className="text-center py-8 space-y-2 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center mx-auto">
                <FileCheck2 className="w-5 h-5" />
              </div>
              <div className="text-xs font-bold text-slate-800">
                All client codes, task descriptions, and durations conform to standards.
              </div>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                Zero overlaps detected, all billing hours validated, and catalog references intact.
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={onClose}>
            Back to Timesheet
          </Button>

          <Button
            variant="primary"
            size="sm"
            disabled={!validation.isValid}
            onClick={() => {
              onClose();
              onProceedToSubmit();
            }}
            icon={<ArrowRight className="w-4 h-4" />}
          >
            Proceed to Finalize ({entries.length} entries)
          </Button>
        </div>
      </div>
    </Modal>
  );
};
