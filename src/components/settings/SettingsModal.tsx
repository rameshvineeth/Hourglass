import React, { useState, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { AppSettings, StorageService } from '../../services/storage-service';
import { RoundingMode } from '../../types/time-entry';
import { 
  Key, 
  Clock, 
  User, 
  Trash2, 
  CheckCircle2, 
  Download, 
  Upload, 
  Database, 
  ShieldAlert,
  Check,
  XCircle,
  Loader2
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onClearData: () => void | Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  onClearData,
}) => {
  const [groqApiKey, setGroqApiKey] = useState(() => {
    return settings.groqApiKey || localStorage.getItem('hourglass_api_key') || '';
  });
  const [roundingMode, setRoundingMode] = useState<RoundingMode>(settings.roundingMode);
  const [consultantName, setConsultantName] = useState(settings.consultantName);
  const [consultantEmail, setConsultantEmail] = useState(settings.consultantEmail);
  const [defaultHourlyRate, setDefaultHourlyRate] = useState(settings.defaultHourlyRate.toString());
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // In-app confirmation dialog state
  const [confirmModalState, setConfirmModalState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleTestConnection = async () => {
    const key = groqApiKey.trim();
    if (!key) {
      setTestStatus('error');
      setTestMessage('Please enter an API key');
      return;
    }

    setTestStatus('testing');
    setTestMessage('');

    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          Authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        setTestStatus('success');
        setTestMessage('Connected successfully');
        try {
          localStorage.setItem('hourglass_api_key', key);
        } catch {}
        onSaveSettings({
          ...settings,
          groqApiKey: key,
          roundingMode,
          consultantName: consultantName.trim() || 'Consultant',
          consultantEmail: consultantEmail.trim() || 'consultant@firm.com',
          defaultHourlyRate: Number(defaultHourlyRate),
          auditGroupByApp: true,
          activityViewMode: 'app',
        });
      } else {
        setTestStatus('error');
        setTestMessage(`Invalid API key (${response.status})`);
      }
    } catch (err) {
      setTestStatus('error');
      setTestMessage('Connection failed. Check network or key.');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const key = groqApiKey.trim();
    try {
      if (key) {
        localStorage.setItem('hourglass_api_key', key);
      } else {
        localStorage.removeItem('hourglass_api_key');
      }
    } catch {}
    onSaveSettings({
      groqApiKey: key,
      roundingMode,
      consultantName: consultantName.trim() || 'Consultant',
      consultantEmail: consultantEmail.trim() || 'consultant@firm.com',
      defaultHourlyRate: Number(defaultHourlyRate),
      auditGroupByApp: true,
      activityViewMode: 'app',
    });
    onClose();
  };

  const handleExportBackup = async () => {
    try {
      const raw = await StorageService.exportBackup();
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Hourglass-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErrorMessage(String(e));
    }
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setConfirmModalState({
      isOpen: true,
      title: 'Restore Workspace Backup',
      message: 'Replace this workspace with the selected backup? All current data will be overwritten.',
      confirmText: 'Restore Backup',
      onConfirm: async () => {
        try {
          await StorageService.restoreBackup(await file.text());
          location.reload();
        } catch (error) {
          setErrorMessage(String(error));
        }
      },
    });
    e.target.value = '';
  };

  return (
    <>
      <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Hourglass Configuration"
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5 pb-1">
        {/* API Key Section */}
        <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
              <Key className="w-3.5 h-3.5 text-blue-600" />
              API Key
            </h4>
            {testStatus === 'success' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/80">
                <Check className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
                Connected
              </span>
            )}
            {testStatus === 'error' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200/80">
                <XCircle className="w-3 h-3 text-rose-600" />
                {testMessage || 'Connection failed'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                placeholder="Enter your API key..."
                value={groqApiKey}
                onChange={(e) => {
                  setGroqApiKey(e.target.value);
                  if (testStatus !== 'idle') {
                    setTestStatus('idle');
                    setTestMessage('');
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 pr-16 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-2 px-2 py-0.5 text-[11px] text-slate-500 hover:text-slate-800 font-medium rounded hover:bg-slate-100 transition-colors cursor-pointer"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>

            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testStatus === 'testing' || !groqApiKey.trim()}
              className="h-8.5 px-3 rounded-lg border text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-2xs active:scale-95 shrink-0"
              title="Test connection with provided API key"
            >
              {testStatus === 'testing' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  <span>Checking...</span>
                </>
              ) : testStatus === 'success' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
                  <span className="text-emerald-700 font-semibold">Valid</span>
                </>
              ) : (
                <span>Check Connection</span>
              )}
            </button>
          </div>
        </div>

        {/* Rounding Increment Option */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            Default Billing Increment
          </label>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {[
              { id: 'tenth_hour', label: '6-Minute (0.1h)' },
              { id: 'quarter_hour', label: '15-Minute (0.25h)' },
              { id: 'exact', label: 'Exact Minutes' },
            ].map(item => (
              <label
                key={item.id}
                className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                  roundingMode === item.id
                    ? 'bg-blue-50/90 border-blue-500 ring-1 ring-blue-500/20 text-blue-900 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50/60'
                }`}
              >
                <span className={`text-xs font-bold ${roundingMode === item.id ? 'text-blue-950' : 'text-slate-800'}`}>
                  {item.label}
                </span>
                <input
                  type="radio"
                  name="roundingMode"
                  value={item.id}
                  checked={roundingMode === item.id}
                  onChange={() => setRoundingMode(item.id as RoundingMode)}
                  className="text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 cursor-pointer accent-blue-600"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Consultant Profile & Rates */}
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-blue-600" />
            Consultant Profile & Rates
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Consultant Name
              </label>
              <input
                type="text"
                value={consultantName}
                onChange={(e) => setConsultantName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Consultant Email
              </label>
              <input
                type="email"
                value={consultantEmail}
                onChange={(e) => setConsultantEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Default Engagement Rate ($/hr)
            </label>
            <div className="relative max-w-xs">
              <span className="absolute left-3 top-2 text-xs text-slate-400 font-semibold">$</span>
              <input
                type="number"
                min="0"
                step="25"
                value={defaultHourlyRate}
                onChange={(e) => setDefaultHourlyRate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white pl-7 pr-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                required
              />
            </div>
          </div>
        </div>


        {/* Data & Storage Management */}
        <div className="pt-2 border-t border-slate-200 space-y-3">
          <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-blue-600" />
            Workspace Backup & Storage
          </div>
          
          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-slate-800">Workspace Snapshot</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExportBackup}
                icon={<Download className="w-3.5 h-3.5 text-slate-600" />}
              >
                Export Backup
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => restoreInputRef.current?.click()}
                icon={<Upload className="w-3.5 h-3.5 text-slate-600" />}
              >
                Restore Backup
              </Button>
              <input
                ref={restoreInputRef}
                type="file"
                accept=".json"
                onChange={handleRestoreFile}
                className="hidden"
              />
            </div>
          </div>

          {/* Danger Zone */}
          <div className="p-3.5 rounded-xl bg-rose-50/40 border border-rose-200/80 space-y-3">
            <div className="text-[11px] font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              Danger Zone
            </div>

            {/* Clear Data */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-0.5">
              <div>
                <div className="text-xs font-semibold text-rose-900">Clear Data</div>
                <div className="text-[10.5px] text-rose-700/80">Permanently wipe all captured activities, timesheets, clients, projects, and local cache.</div>
              </div>
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setConfirmModalState({
                    isOpen: true,
                    title: 'Clear Data',
                    message: 'Are you sure you want to completely clear all data? This will permanently wipe all captured activity history, timesheets, confirmed time entries, clients, projects, and local cache. This action cannot be undone.',
                    confirmText: 'Clear Data',
                    onConfirm: async () => {
                      await onClearData();
                      onClose();
                    },
                  });
                }}
                icon={<Trash2 className="w-3.5 h-3.5" />}
              >
                Clear Data
              </Button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" icon={<CheckCircle2 className="w-4 h-4" />}>
            Save Preferences
          </Button>
        </div>
      </form>
    </Modal>

    {/* In-App Confirmation Dialog */}
    {confirmModalState && (
      <ConfirmModal
        isOpen={confirmModalState.isOpen}
        onClose={() => setConfirmModalState(null)}
        onConfirm={confirmModalState.onConfirm}
        title={confirmModalState.title}
        message={confirmModalState.message}
        confirmText={confirmModalState.confirmText || 'Confirm'}
        variant="danger"
        icon="warning"
      />
    )}

    {/* In-App Error Notification Modal */}
    {errorMessage && (
      <Modal
        isOpen={!!errorMessage}
        onClose={() => setErrorMessage(null)}
        title="Settings Error"
        maxWidth="sm"
      >
        <div className="space-y-4 pt-1">
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200/70 p-3 rounded-lg">
            {errorMessage}
          </p>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setErrorMessage(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      </Modal>
    )}
  </>
  );
};
