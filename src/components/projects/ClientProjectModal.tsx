import React, { useState, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Client, Project } from '../../types/client-project';
import { 
  Plus, 
  Trash2, 
  Building, 
  Briefcase, 
  DollarSign, 
  Tag, 
  Clock, 
  ChevronDown, 
  ChevronRight, 
  Search, 
  X, 
  SlidersHorizontal
} from 'lucide-react';

interface ClientProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  projects: Project[];
  defaultHourlyRate?: number;
  onAddClient: (client: Client) => void;
  onAddProject: (project: Project) => void;
  onUpdateClient?: (client: Client) => void;
  onUpdateProject?: (project: Project) => void;
  onDeleteClient: (clientId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onLoadSampleData?: () => void;
  isOnboardingPrompt?: boolean;
}

const PRESET_COLORS = [
  '#0284c7', // sky
  '#059669', // emerald
  '#7c3aed', // purple
  '#d97706', // amber
  '#db2777', // pink
  '#0d9488', // teal
  '#4f46e5', // indigo
];

const RATE_PRESETS = [200, 275, 350];

// Helper to auto-generate client code from client name
function generateCodeFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.map(w => w[0]).join('').slice(0, 5).toUpperCase();
}

export const ClientProjectModal: React.FC<ClientProjectModalProps> = ({
  isOpen,
  onClose,
  clients,
  projects,
  defaultHourlyRate = 275,
  onAddClient,
  onAddProject,
  onUpdateProject,
  onDeleteClient,
  onDeleteProject,
  onLoadSampleData: _onLoadSampleData,
}) => {
  const [activeTab, setActiveTab] = useState<'clients' | 'projects'>('clients');
  const [searchQuery, setSearchQuery] = useState('');

  // Dropdown accordion state: which clients are expanded to show projects
  const [expandedClientIds, setExpandedClientIds] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    clients.forEach(c => { initial[c.id] = true; });
    return initial;
  });

  const toggleClientExpanded = (clientId: string) => {
    setExpandedClientIds(prev => ({
      ...prev,
      [clientId]: !prev[clientId],
    }));
  };

  // In-app confirmation dialog state
  const [confirmModalState, setConfirmModalState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void;
  } | null>(null);

  // --- Sub-Modal States ---
  // 1. Add Client Modal
  const [isAddClientOpen, setIsAddClientOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientCode, setNewClientCode] = useState('');
  const [newClientColor, setNewClientColor] = useState(PRESET_COLORS[0]);

  // 2. Add Project Modal
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [targetClientIdForNewProject, setTargetClientIdForNewProject] = useState<string>('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectCode, setNewProjectCode] = useState('');
  const [newProjectRate, setNewProjectRate] = useState(String(defaultHourlyRate));
  const [newProjectRole, setNewProjectRole] = useState('Strategy & Advisory');
  const [newProjectBudget, setNewProjectBudget] = useState('40');
  const [newProjectKeywords, setNewProjectKeywords] = useState('');
  const [newProjectIsBillable, setNewProjectIsBillable] = useState(true);
  const [showAdvancedInNewProject, setShowAdvancedInNewProject] = useState(false);

  // 3. Project Detail & Edit Modal
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  const [editProjectName, setEditProjectName] = useState('');
  const [editProjectCode, setEditProjectCode] = useState('');
  const [editProjectClientId, setEditProjectClientId] = useState('');
  const [editProjectRate, setEditProjectRate] = useState('275');
  const [editProjectRole, setEditProjectRole] = useState('');
  const [editProjectBudget, setEditProjectBudget] = useState('');
  const [editProjectKeywords, setEditProjectKeywords] = useState('');
  const [editProjectIsBillable, setEditProjectIsBillable] = useState(true);

  // Active unarchived clients and projects
  const activeClients = useMemo(() => clients.filter(c => !c.archived), [clients]);
  const activeProjects = useMemo(() => projects.filter(p => !p.archived), [projects]);

  // Filtered clients and projects based on search query
  const filteredClients = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return activeClients;
    return activeClients.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.code.toLowerCase().includes(q) ||
      activeProjects.some(p => p.clientId === c.id && (p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)))
    );
  }, [activeClients, activeProjects, searchQuery]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return activeProjects;
    return activeProjects.filter(p => {
      const parent = activeClients.find(c => c.id === p.clientId);
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (parent?.name && parent.name.toLowerCase().includes(q)) ||
        (p.engagementRole && p.engagementRole.toLowerCase().includes(q)) ||
        (p.keywords && p.keywords.some(k => k.toLowerCase().includes(q)))
      );
    });
  }, [activeProjects, activeClients, searchQuery]);

  // Open Add Project Modal with pre-selected client
  const handleOpenAddProject = (clientId?: string) => {
    const parentId = clientId || activeClients[0]?.id || '';
    setTargetClientIdForNewProject(parentId);
    setNewProjectName('');
    setNewProjectCode('');
    setNewProjectRate(String(defaultHourlyRate));
    setNewProjectRole('Strategy & Advisory');
    setNewProjectBudget('40');
    setNewProjectKeywords('');
    setNewProjectIsBillable(true);
    setShowAdvancedInNewProject(false);
    setIsAddProjectOpen(true);
  };

  // Open Project Detail / Edit Modal
  const handleOpenProjectDetail = (proj: Project) => {
    setProjectToEdit(proj);
    setEditProjectName(proj.name);
    setEditProjectCode(proj.code);
    setEditProjectClientId(proj.clientId);
    setEditProjectRate(String(proj.defaultHourlyRate));
    setEditProjectRole(proj.engagementRole || '');
    setEditProjectBudget(proj.budgetHours ? String(proj.budgetHours) : '');
    setEditProjectKeywords(proj.keywords ? proj.keywords.join(', ') : '');
    setEditProjectIsBillable(proj.isBillableDefault);
  };

  // Create Client Submit
  const handleSubmitNewClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return;

    const code = (newClientCode.trim() || generateCodeFromName(newClientName)).toUpperCase();
    const newClient: Client = {
      id: `client_${Date.now()}`,
      name: newClientName.trim(),
      code,
      color: newClientColor,
      createdAt: new Date().toISOString(),
    };

    onAddClient(newClient);
    setExpandedClientIds(prev => ({ ...prev, [newClient.id]: true }));
    setIsAddClientOpen(false);
    setNewClientName('');
    setNewClientCode('');
  };

  // Create Project Submit
  const handleSubmitNewProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !targetClientIdForNewProject) return;

    const parentClient = activeClients.find(c => c.id === targetClientIdForNewProject);
    const parsedKeywords = newProjectKeywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const countForClient = activeProjects.filter(p => p.clientId === targetClientIdForNewProject).length;
    const defaultCode = `${parentClient?.code || 'PRJ'}-${String(countForClient + 1).padStart(2, '0')}`;

    const newProj: Project = {
      id: `proj_${Date.now()}`,
      clientId: targetClientIdForNewProject,
      name: newProjectName.trim(),
      code: newProjectCode.trim().toUpperCase() || defaultCode,
      defaultHourlyRate: parseFloat(newProjectRate) || defaultHourlyRate,
      isBillableDefault: newProjectIsBillable,
      color: parentClient?.color || PRESET_COLORS[0],
      budgetHours: parseFloat(newProjectBudget) || undefined,
      engagementRole: newProjectRole.trim() || undefined,
      keywords: parsedKeywords.length > 0 ? parsedKeywords : [parentClient?.name || '', newProjectName.trim()],
      billingIncrementMinutes: 6,
      createdAt: new Date().toISOString(),
    };

    onAddProject(newProj);
    setExpandedClientIds(prev => ({ ...prev, [targetClientIdForNewProject]: true }));
    setIsAddProjectOpen(false);
  };

  // Save Project Details & Edits
  const handleSaveProjectEdits = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectToEdit || !editProjectName.trim()) return;

    const parsedKeywords = editProjectKeywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    const updated: Project = {
      ...projectToEdit,
      name: editProjectName.trim(),
      code: editProjectCode.trim().toUpperCase() || projectToEdit.code,
      clientId: editProjectClientId || projectToEdit.clientId,
      defaultHourlyRate: parseFloat(editProjectRate) || defaultHourlyRate,
      isBillableDefault: editProjectIsBillable,
      budgetHours: parseFloat(editProjectBudget) || undefined,
      engagementRole: editProjectRole.trim() || undefined,
      keywords: parsedKeywords,
    };

    onUpdateProject?.(updated);
    setProjectToEdit(null);
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Clients & Projects"
        subtitle="Manage client organizations, project rates, and billing settings."
        maxWidth="2xl"
      >
        <div className="space-y-4 pb-2">
          {/* Top Control Bar: Segmented Tabs & Action Button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Segmented Control Tabs */}
            <div className="inline-flex p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('clients')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  activeTab === 'clients'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Building className="w-3.5 h-3.5 text-blue-600" />
                <span>Clients</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'clients' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-600'}`}>
                  {activeClients.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('projects')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  activeTab === 'projects'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Briefcase className="w-3.5 h-3.5 text-blue-600" />
                <span>All Projects</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'projects' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-600'}`}>
                  {activeProjects.length}
                </span>
              </button>
            </div>

            {/* Right Action: "+ Add Client" on clients tab, "+ Add Project" on projects tab */}
            <div className="flex items-center gap-2">
              {activeTab === 'clients' ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setNewClientName('');
                    setNewClientCode('');
                    setNewClientColor(PRESET_COLORS[activeClients.length % PRESET_COLORS.length]);
                    setIsAddClientOpen(true);
                  }}
                  icon={<Plus className="w-3.5 h-3.5" />}
                  className="shadow-xs"
                >
                  Add Client
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => handleOpenAddProject()}
                  icon={<Plus className="w-3.5 h-3.5" />}
                  className="shadow-xs"
                  disabled={activeClients.length === 0}
                >
                  Add Project
                </Button>
              )}
            </div>
          </div>

          {/* Search Filter Bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={activeTab === 'clients' ? "Search clients by name, code, or projects..." : "Search projects by name, code, or client..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50/80 border border-slate-200 rounded-xl pl-8 pr-8 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 p-0.5 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* TAB 1: CLIENTS (With Dropdown Projects & In-Place Add Project) */}
          {activeTab === 'clients' && (
            <div className="space-y-3">
              {filteredClients.length === 0 ? (
                <div className="text-center py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-2.5">
                    <Building className="w-5 h-5" />
                  </div>
                  <h4 className="text-xs font-semibold text-slate-800">
                    {searchQuery ? 'No matching clients found' : 'No clients created yet'}
                  </h4>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto mt-1 mb-3">
                    {searchQuery 
                      ? 'Try a different search term or clear the filter.' 
                      : 'Add your first consulting client to start tracking billable workstreams.'}
                  </p>
                  {!searchQuery && (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => setIsAddClientOpen(true)}
                      icon={<Plus className="w-3.5 h-3.5" />}
                    >
                      Create First Client
                    </Button>
                  )}
                </div>
              ) : (
                filteredClients.map(client => {
                  const clientProjects = activeProjects.filter(p => p.clientId === client.id);
                  const isExpanded = !!expandedClientIds[client.id];

                  return (
                    <div 
                      key={client.id}
                      className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden transition-all"
                    >
                      {/* Client Header Row */}
                      <div className="flex items-center justify-between p-3 bg-slate-50/40 hover:bg-slate-50/90 transition-colors">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {/* Dropdown Chevron toggle */}
                          <button
                            type="button"
                            onClick={() => toggleClientExpanded(client.id)}
                            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
                            title={isExpanded ? "Collapse projects" : "Expand projects"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-slate-600" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-600" />
                            )}
                          </button>

                          {/* Brand Color Indicator */}
                          <div 
                            className="w-3 h-3 rounded-full shrink-0 shadow-2xs" 
                            style={{ backgroundColor: client.color }} 
                          />

                          {/* Client Name & Code */}
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-semibold text-slate-900 truncate">
                              {client.name}
                            </span>
                            <span className="text-[10.5px] font-mono text-slate-600 bg-slate-100 border border-slate-200/80 px-1.5 py-0.2 rounded font-medium">
                              {client.code}
                            </span>
                          </div>

                          {/* Project Count Badge */}
                          <span className="text-[10.5px] text-slate-400 hidden sm:inline-block">
                            · {clientProjects.length} {clientProjects.length === 1 ? 'project' : 'projects'}
                          </span>
                        </div>

                        {/* Right Client Actions: Add Project & Archive */}
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={() => handleOpenAddProject(client.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium border border-blue-200/70 transition-colors cursor-pointer"
                            title="Add project under this client"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Project</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setConfirmModalState({
                                isOpen: true,
                                title: 'Archive Client',
                                message: `Archive client "${client.name}" and all its engagements? Current projects will be marked archived too.`,
                                confirmText: 'Archive Client',
                                onConfirm: () => onDeleteClient(client.id),
                              });
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Archive client"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Dropdown Section: Nested Projects List */}
                      {isExpanded && (
                        <div className="p-2.5 pt-1.5 bg-white border-t border-slate-100 space-y-1.5">
                          {clientProjects.length === 0 ? (
                            <div className="py-4 px-3 text-center bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
                              <p className="text-xs text-slate-500">No project engagements under this client yet.</p>
                              <button
                                type="button"
                                onClick={() => handleOpenAddProject(client.id)}
                                className="mt-1 text-xs text-blue-600 hover:text-blue-800 font-semibold cursor-pointer inline-flex items-center gap-1"
                              >
                                <Plus className="w-3 h-3" />
                                Add First Project
                              </button>
                            </div>
                          ) : (
                            clientProjects.map(proj => (
                              <div
                                key={proj.id}
                                onClick={() => handleOpenProjectDetail(proj)}
                                className="group flex items-center justify-between p-2.5 rounded-lg border border-slate-200/70 hover:border-blue-400 hover:bg-blue-50/20 transition-all cursor-pointer shadow-2xs"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold text-slate-900 group-hover:text-blue-700 transition-colors truncate">
                                        {proj.name}
                                      </span>
                                      <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded">
                                        {proj.code}
                                      </span>
                                      {proj.isBillableDefault ? (
                                        <Badge variant="emerald" size="sm" className="text-[9.5px]">
                                          Billable
                                        </Badge>
                                      ) : (
                                        <Badge variant="slate" size="sm" className="text-[9.5px]">
                                          Non-billable
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-[10.5px] text-slate-500 mt-0.5">
                                      {proj.engagementRole && (
                                        <span className="truncate">{proj.engagementRole}</span>
                                      )}
                                      {proj.budgetHours && (
                                        <span>· Cap: {proj.budgetHours}h</span>
                                      )}
                                      {proj.keywords && proj.keywords.length > 0 && (
                                        <span className="hidden md:inline text-slate-400 truncate">
                                          · Matches: {proj.keywords.slice(0, 3).join(', ')}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                  <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md">
                                    ${proj.defaultHourlyRate}/hr
                                  </span>
                                  <div className="text-slate-400 group-hover:text-blue-600 transition-colors p-1 rounded">
                                    <SlidersHorizontal className="w-3.5 h-3.5" />
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: ALL PROJECTS (Flat searchable list across all clients) */}
          {activeTab === 'projects' && (
            <div className="space-y-2">
              {filteredProjects.length === 0 ? (
                <div className="text-center py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-2.5">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <h4 className="text-xs font-semibold text-slate-800">
                    {searchQuery ? 'No matching projects found' : 'No projects created yet'}
                  </h4>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto mt-1 mb-3">
                    {searchQuery 
                      ? 'Try a different search term or clear the filter.' 
                      : 'Create a project engagement under a client to assign captured activities.'}
                  </p>
                  {!searchQuery && activeClients.length > 0 && (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => handleOpenAddProject()}
                      icon={<Plus className="w-3.5 h-3.5" />}
                    >
                      Add First Project
                    </Button>
                  )}
                </div>
              ) : (
                filteredProjects.map(proj => {
                  const parentClient = activeClients.find(c => c.id === proj.clientId);
                  return (
                    <div
                      key={proj.id}
                      onClick={() => handleOpenProjectDetail(proj)}
                      className="group flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/20 transition-all cursor-pointer shadow-2xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div 
                          className="w-3 h-3 rounded-full shrink-0 shadow-2xs"
                          style={{ backgroundColor: parentClient?.color || '#0284c7' }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-900 group-hover:text-blue-700 transition-colors truncate">
                              {proj.name}
                            </span>
                            <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded font-medium">
                              {proj.code}
                            </span>
                            {proj.isBillableDefault ? (
                              <Badge variant="emerald" size="sm" className="text-[9.5px]">
                                Billable
                              </Badge>
                            ) : (
                              <Badge variant="slate" size="sm" className="text-[9.5px]">
                                Non-billable
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                            <span className="font-medium text-slate-700">
                              {parentClient?.name || 'Unassigned'}
                            </span>
                            {proj.engagementRole && <span>· {proj.engagementRole}</span>}
                            {proj.budgetHours && <span>· Cap: {proj.budgetHours}h</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md">
                          ${proj.defaultHourlyRate}/hr
                        </span>
                        <div className="text-slate-400 group-hover:text-blue-600 transition-colors p-1 rounded">
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* --- SUB-MODAL 1: ADD NEW CLIENT --- */}
      {isAddClientOpen && (
        <Modal
          isOpen={isAddClientOpen}
          onClose={() => setIsAddClientOpen(false)}
          title="Add New Client"
          subtitle="Create an organizational container for your project engagements."
          maxWidth="md"
        >
          <form onSubmit={handleSubmitNewClient} className="space-y-4 pb-1">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Client Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Apex Capital Partners"
                value={newClientName}
                onChange={(e) => {
                  setNewClientName(e.target.value);
                  if (!newClientCode) {
                    setNewClientCode(generateCodeFromName(e.target.value));
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                required
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Client Code <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. APEX"
                  value={newClientCode}
                  onChange={(e) => setNewClientCode(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono uppercase text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Brand Color
                </label>
                <div className="flex items-center gap-1.5 pt-1">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewClientColor(c)}
                      className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${
                        newClientColor === c ? 'scale-125 ring-2 ring-blue-500 ring-offset-2' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsAddClientOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />}>
                Create Client
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* --- SUB-MODAL 2: ADD NEW PROJECT --- */}
      {isAddProjectOpen && (
        <Modal
          isOpen={isAddProjectOpen}
          onClose={() => setIsAddProjectOpen(false)}
          title="Add Project Engagement"
          subtitle="Set up project specifics and billable rates."
          maxWidth="lg"
        >
          <form onSubmit={handleSubmitNewProject} className="space-y-4 pb-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Parent Client <span className="text-rose-500">*</span>
                </label>
                <select
                  value={targetClientIdForNewProject}
                  onChange={(e) => setTargetClientIdForNewProject(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  required
                >
                  {activeClients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Project Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. M&A Valuation & Diligence"
                  value={newProjectName}
                  onChange={(e) => {
                    setNewProjectName(e.target.value);
                    if (!newProjectCode) {
                      const parent = activeClients.find(c => c.id === targetClientIdForNewProject);
                      const prefix = parent?.code || 'PRJ';
                      setNewProjectCode(`${prefix}-01`);
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Project Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. APEX-MA"
                  value={newProjectCode}
                  onChange={(e) => setNewProjectCode(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono uppercase text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  Billable Rate ($/hr)
                </label>
                <div className="space-y-1.5">
                  <div className="relative">
                    <span className="absolute left-2.5 top-2 text-xs font-semibold text-slate-400">$</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={newProjectRate}
                      onChange={(e) => setNewProjectRate(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white pl-6 pr-3 py-1.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      placeholder="275"
                      required
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400 font-medium">Quick rates:</span>
                    {RATE_PRESETS.map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setNewProjectRate(String(r))}
                        className={`text-[11px] px-2 py-0.5 rounded-md border font-mono transition-all cursor-pointer ${
                          newProjectRate === String(r)
                            ? 'bg-blue-600 text-white border-blue-600 font-semibold shadow-2xs'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        ${r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Billable Toggle */}
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-xs font-medium text-slate-800">Billable Project</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newProjectIsBillable}
                  onChange={(e) => setNewProjectIsBillable(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
                />
                <span className="text-xs text-slate-600">
                  {newProjectIsBillable ? 'Billable to client' : 'Non-billable / Internal'}
                </span>
              </label>
            </div>

            {/* Collapsible Advanced Settings Accordion */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvancedInNewProject(!showAdvancedInNewProject)}
                className="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1.5 cursor-pointer py-1"
              >
                {showAdvancedInNewProject ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <span>Advanced Specifics (Role, Budget, AI Keywords)</span>
              </button>

              {showAdvancedInNewProject && (
                <div className="p-3 bg-slate-50/70 border border-slate-200 rounded-xl mt-1.5 space-y-3 animate-in fade-in duration-150">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Engagement Role
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Lead Advisory, Diligence"
                        value={newProjectRole}
                        onChange={(e) => setNewProjectRole(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          Budget Cap (Hours)
                        </span>
                        <span className="text-[10px] text-slate-400 font-normal">Optional</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="e.g. 40 (leave blank if none)"
                        value={newProjectBudget}
                        onChange={(e) => setNewProjectBudget(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                      <Tag className="w-3.5 h-3.5 text-blue-600" />
                      AI Auto-Match Keywords (comma-separated)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Apex, valuation, model, diligence, pitch"
                      value={newProjectKeywords}
                      onChange={(e) => setNewProjectKeywords(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    />
                    <p className="text-[10.5px] text-slate-400 mt-1">
                      Activities matching these words will be suggested directly to this project.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsAddProjectOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />}>
                Save Project
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* --- SUB-MODAL 3: PROJECT DETAIL & EDIT MODAL --- */}
      {projectToEdit && (
        <Modal
          isOpen={!!projectToEdit}
          onClose={() => setProjectToEdit(null)}
          title={editProjectName || projectToEdit.name}
          subtitle={`Project Details & Billing Configuration`}
          maxWidth="lg"
        >
          <form onSubmit={handleSaveProjectEdits} className="space-y-4 pb-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Project Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editProjectName}
                  onChange={(e) => setEditProjectName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Parent Client
                </label>
                <select
                  value={editProjectClientId}
                  onChange={(e) => setEditProjectClientId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                >
                  {activeClients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Project Code
                </label>
                <input
                  type="text"
                  value={editProjectCode}
                  onChange={(e) => setEditProjectCode(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono uppercase text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  Billable Hourly Rate ($/hr)
                </label>
                <div className="space-y-1.5">
                  <div className="relative">
                    <span className="absolute left-2.5 top-2 text-xs font-semibold text-slate-400">$</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={editProjectRate}
                      onChange={(e) => setEditProjectRate(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white pl-6 pr-3 py-1.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      placeholder="275"
                      required
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400 font-medium">Quick rates:</span>
                    {RATE_PRESETS.map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setEditProjectRate(String(r))}
                        className={`text-[11px] px-2 py-0.5 rounded-md border font-mono transition-all cursor-pointer ${
                          editProjectRate === String(r)
                            ? 'bg-blue-600 text-white border-blue-600 font-semibold shadow-2xs'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        ${r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Role & Budget */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Engagement Role
                </label>
                <input
                  type="text"
                  placeholder="e.g. Lead Advisory"
                  value={editProjectRole}
                  onChange={(e) => setEditProjectRole(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    Budget Cap (Hours)
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">Optional</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 40 (leave blank if none)"
                  value={editProjectBudget}
                  onChange={(e) => setEditProjectBudget(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            {/* Billable Setting */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div>
                <div className="text-xs font-semibold text-slate-800">Billable Engagement</div>
                <div className="text-[11px] text-slate-500">Enable to calculate revenue when logging time entries.</div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editProjectIsBillable}
                  onChange={(e) => setEditProjectIsBillable(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
                />
                <span className="text-xs font-medium text-slate-700">
                  {editProjectIsBillable ? 'Billable' : 'Non-billable'}
                </span>
              </label>
            </div>

            {/* Keywords */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-blue-600" />
                AI Auto-Match Keywords (comma-separated)
              </label>
              <input
                type="text"
                placeholder="e.g. Apex, valuation, model, diligence, pitch"
                value={editProjectKeywords}
                onChange={(e) => setEditProjectKeywords(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
              <p className="text-[10.5px] text-slate-400 mt-1">
                Activities matching these words will be suggested directly to this project.
              </p>
            </div>

            {/* Footer Actions */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  setConfirmModalState({
                    isOpen: true,
                    title: 'Archive Project',
                    message: `Archive project "${projectToEdit.name}"? Existing logged time entries will remain safe.`,
                    confirmText: 'Archive Project',
                    onConfirm: () => {
                      onDeleteProject(projectToEdit.id);
                      setProjectToEdit(null);
                    },
                  });
                }}
                icon={<Trash2 className="w-3.5 h-3.5" />}
              >
                Archive Project
              </Button>

              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setProjectToEdit(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  Save Changes
                </Button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* In-App Confirmation Dialog */}
      {confirmModalState && (
        <ConfirmModal
          isOpen={confirmModalState.isOpen}
          onClose={() => setConfirmModalState(null)}
          onConfirm={confirmModalState.onConfirm}
          title={confirmModalState.title}
          message={confirmModalState.message}
          confirmText={confirmModalState.confirmText || 'Archive'}
          variant="danger"
          icon="trash"
        />
      )}
    </>
  );
};
