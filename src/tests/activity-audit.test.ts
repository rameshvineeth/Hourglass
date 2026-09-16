import { describe, it, expect } from 'vitest';
import { 
  normalizeDocumentTitle, 
  normalizeBrowserTabIdentity,
  getAppItemNoun, 
  auditActivities, 
  createDraftFromWorkstream 
} from '../domain/activity-audit';
import { ActivityItem } from '../types/activity';
import { Client, Project } from '../types/client-project';

describe('Activity Audit & Reconciliation Engine', () => {
  it('normalizes document titles by stripping application chrome and status tags', () => {
    expect(normalizeDocumentTitle('Microsoft Word', 'VINEETH RAMESH - Word')).toBe('VINEETH RAMESH');
    expect(normalizeDocumentTitle('Microsoft Word', 'VINEETH RAMESH [Autosaved] - Word')).toBe('VINEETH RAMESH');
    expect(normalizeDocumentTitle('Microsoft Word', 'VINEETH RAMESH - Compatibility Mode - Word')).toBe('VINEETH RAMESH');
    expect(normalizeDocumentTitle('Microsoft Word', 'Contract_Draft_v2.docx - Word')).toBe('Contract_Draft_v2');
    expect(normalizeDocumentTitle('Microsoft Excel', 'Financial Model 2026.xlsx - Excel')).toBe('Financial Model 2026');
    expect(normalizeDocumentTitle('Google Chrome', 'Hourglass Pull Requests - Google Chrome')).toBe('Hourglass Pull Requests');
    expect(normalizeDocumentTitle('SnippingTool.exe', 'Snipping Tool - 11/09/2026 19:32')).toBe('Snipping Tool');
    expect(normalizeDocumentTitle('Blender', 'Character_Model_v3.blend - Blender')).toBe('Character_Model_v3');
    // Universal Memtime-style normalization across IDEs, communication, and shells
    expect(normalizeDocumentTitle('Visual Studio Code', '● index.ts - hourglass - Visual Studio Code [Administrator]')).toBe('index.ts - hourglass');
    expect(normalizeDocumentTitle('Slack', '(3) #general | Hourglass | Slack')).toBe('#general | Hourglass');
    expect(normalizeDocumentTitle('Windows PowerShell', 'Administrator: Windows PowerShell')).toBe('Windows PowerShell');
  });

  it('selects the correct contextual item noun based on application category', () => {
    expect(getAppItemNoun('Google Chrome')).toBe('tabs');
    expect(getAppItemNoun('Microsoft Edge')).toBe('tabs');
    expect(getAppItemNoun('Microsoft Word')).toBe('documents');
    expect(getAppItemNoun('Microsoft Excel')).toBe('documents');
    expect(getAppItemNoun('Visual Studio Code')).toBe('files');
    expect(getAppItemNoun('SnippingTool.exe')).toBe('windows');
  });

  const mockClients: Client[] = [
    { id: 'c1', name: 'Acme Corp', code: 'ACME', color: '#0ea5e9', createdAt: '2026-09-11T00:00:00Z' },
    { id: 'c2', name: 'Vineeth Ramesh Client', code: 'VR', color: '#10b981', createdAt: '2026-09-11T00:00:00Z' },
  ];

  const mockProjects: Project[] = [
    { id: 'p1', clientId: 'c1', name: 'Hourglass', code: 'HG', color: '#0ea5e9', defaultHourlyRate: 150, isBillableDefault: true, createdAt: '2026-09-11T00:00:00Z' },
    { id: 'p2', clientId: 'c2', name: 'Vineeth Contract', code: 'VC', color: '#10b981', defaultHourlyRate: 200, isBillableDefault: true, createdAt: '2026-09-11T00:00:00Z' },
  ];

  const makeAct = (id: string, appName: string, windowTitle: string, duration: number, startTime: string): ActivityItem => ({
    id,
    appName,
    windowTitle,
    durationSeconds: duration,
    startTime,
    endTime: startTime,
    timestamp: `2026-09-11T${startTime}:00Z`,
    category: 'document',
    isIdle: false,
    isAssigned: false,
    source: 'live',
  });

  it('consolidates multiple separate sessions of the same document across the day into 1 audited workstream', () => {
    // Scenario matching user screenshot:
    // Word at 19:57 (3m), Windows search (1m), Word at 20:00 (6m), Chrome (1m), Word at 20:06 (1m)
    const activities: ActivityItem[] = [
      makeAct('1', 'Microsoft Word', 'VINEETH RAMESH - Word', 180, '19:57'),
      makeAct('2', 'Microsoft Windows Operating System', 'Search', 25, '19:57'),
      makeAct('3', 'Microsoft Word', 'VINEETH RAMESH [Autosaved] - Word', 360, '20:00'),
      makeAct('4', 'SnippingTool.exe', 'Snipping Tool', 20, '20:05'),
      makeAct('5', 'Microsoft Word', 'VINEETH RAMESH - Word', 60, '20:06'),
    ];

    const report = auditActivities(activities, mockClients, mockProjects, {
      absorbMicroSwitches: true,
      microSwitchThresholdSeconds: 30,
      roundingMode: 'quarter_hour',
    });

    // All 3 Word sessions + absorbed 20s snipping tool merge into the primary workstream;
    // 25s Windows Search is discarded as OS shell noise
    const wordStream = report.workstreams.find(w => w.normalizedDocumentTitle === 'VINEETH RAMESH');
    expect(wordStream).toBeDefined();
    expect(wordStream?.sessionCount).toBe(3);
    // Total duration = 180 + 360 + 60 + 20 (snipping absorbed) = 620s (search dropped as OS noise)
    expect(wordStream?.totalDurationSeconds).toBe(620);
    expect(wordStream?.absorbedNoiseCount).toBe(1);

    // Creates draft for logging
    const draft = createDraftFromWorkstream(wordStream!, '2026-09-11', 'c2', 'p2');
    expect(draft.durationMinutes).toBe(10);
    expect(draft.clientId).toBe('c2');
    expect(draft.projectId).toBe('p2');
    expect(draft.sourceActivityIds?.length).toBe(4); // 3 word activities + 1 absorbed micro-switch
  });

  it('consolidates all tabs/documents into one workstream per application when groupByApp is enabled', () => {
    const activities: ActivityItem[] = [
      makeAct('c1', 'Google Chrome', 'GitHub - PR #42 - Google Chrome', 300, '10:00'),
      makeAct('c2', 'Google Chrome', 'StackOverflow - React Hook - Google Chrome', 240, '10:15'),
      makeAct('c3', 'Google Chrome', 'Google Docs - Project Spec - Google Chrome', 600, '11:00'),
      makeAct('w1', 'Microsoft Word', 'Contract Agreement.docx - Word', 400, '14:00'),
      makeAct('w2', 'Microsoft Word', 'Executive Summary.docx - Word', 500, '15:00'),
      makeAct('n1', 'Notepad', 'Quick Notes.txt', 120, '16:00'),
    ];

    // 1. Without groupByApp (default: groups by app + docTitle)
    const defaultReport = auditActivities(activities, mockClients, mockProjects, { groupByApp: false });
    // 3 Chrome tabs + 2 Word docs + 1 Notepad = 6 separate workstreams
    expect(defaultReport.workstreams.length).toBe(6);

    // 2. With groupByApp = true (groups all tabs/docs by parent app)
    const appGroupedReport = auditActivities(activities, mockClients, mockProjects, { groupByApp: true });
    // 1 Chrome workstream + 1 Word workstream + 1 Notepad workstream = 3 workstreams
    expect(appGroupedReport.workstreams.length).toBe(3);

    const chromeWs = appGroupedReport.workstreams.find(w => w.appName === 'Google Chrome');
    expect(chromeWs).toBeDefined();
    expect(chromeWs?.activities.length).toBe(3);
    expect(chromeWs?.totalDurationSeconds).toBe(1140); // 300 + 240 + 600
    expect(chromeWs?.normalizedDocumentTitle).toBe('Google Chrome');

    const wordWs = appGroupedReport.workstreams.find(w => w.appName === 'Microsoft Word');
    expect(wordWs).toBeDefined();
    expect(wordWs?.activities.length).toBe(2);
    expect(wordWs?.totalDurationSeconds).toBe(900); // 400 + 500
  });

  it('does NOT blindly fallback to projects[0] for unmatched workstreams', () => {
    const activities: ActivityItem[] = [
      makeAct('x1', 'Random App', 'Completely Unrelated Window', 300, '10:00'),
    ];

    const report = auditActivities(activities, mockClients, mockProjects, {
      absorbMicroSwitches: false,
    });

    expect(report.workstreams.length).toBe(1);
    const ws = report.workstreams[0];
    // Should NOT have been auto-assigned to projects[0]
    expect(ws.suggestedProjectId).toBeUndefined();
    expect(ws.suggestedClientId).toBeUndefined();
    expect(ws.isBillable).toBe(false);
    expect(ws.needsReview).toBe(true);
  });

  it('absorbs ANY short transient app switch (File Explorer, Calculator) into the current workstream', () => {
    const activities: ActivityItem[] = [
      makeAct('1', 'Microsoft Word', 'VINEETH RAMESH - Word', 300, '10:00'),
      makeAct('2', 'File Explorer', 'Documents', 15, '10:05'),
      makeAct('3', 'Calculator', '2 + 2', 10, '10:05'),
      makeAct('4', 'Microsoft Word', 'VINEETH RAMESH - Word', 300, '10:06'),
    ];

    const report = auditActivities(activities, mockClients, mockProjects, {
      absorbMicroSwitches: true,
      microSwitchThresholdSeconds: 60,
    });

    const wordStream = report.workstreams.find(w => w.normalizedDocumentTitle === 'VINEETH RAMESH');
    expect(wordStream).toBeDefined();
    // File Explorer (15s) and Calculator (10s) should be absorbed
    expect(wordStream?.absorbedNoiseCount).toBe(2);
    expect(wordStream?.totalDurationSeconds).toBe(625); // 300 + 15 + 10 + 300
    // No separate workstreams for File Explorer or Calculator
    expect(report.workstreams.find(w => w.appName === 'File Explorer')).toBeUndefined();
    expect(report.workstreams.find(w => w.appName === 'Calculator')).toBeUndefined();
  });

  it('normalizes titles generically using appName for any app without hardcoded entries', () => {
    // Apps that aren't in the manual suffix list should still get stripped via generic stripper
    expect(normalizeDocumentTitle('Notion', 'My Project Notes - Notion')).toBe('My Project Notes');
    expect(normalizeDocumentTitle('Zed', 'main.rs - hourglass - Zed')).toBe('main.rs - hourglass');
    expect(normalizeDocumentTitle('Warp', 'ssh session - Warp')).toBe('ssh session');
    expect(normalizeDocumentTitle('Obsidian', 'Daily Notes - Obsidian')).toBe('Daily Notes');
  });

  it('returns correct nouns for expanded app categories', () => {
    // New browsers
    expect(getAppItemNoun('Safari')).toBe('tabs');
    expect(getAppItemNoun('Arc')).toBe('tabs');
    // New doc apps
    expect(getAppItemNoun('Notion')).toBe('documents');
    expect(getAppItemNoun('Obsidian')).toBe('documents');
    // New dev/design tools
    expect(getAppItemNoun('Cursor')).toBe('files');
    expect(getAppItemNoun('Figma')).toBe('files');
    expect(getAppItemNoun('Windsurf')).toBe('files');
  });

  it('excludes LockApp.exe and lock screen artifacts completely from workstreams', () => {
    const activities: ActivityItem[] = [
      makeAct('lock1', 'LockApp.exe', 'We like this picture, so we\'re sharing it with you.', 480, '10:50'),
      makeAct('lock2', 'LockApp.exe', 'UnlockingWindow', 10, '10:58'),
      makeAct('b1', 'Brave', 'chatgpt.com - Brave', 60, '10:59'),
      makeAct('b2', 'Brave', 'ChatGPT - Brave', 60, '11:00'),
    ];

    const report = auditActivities(activities, mockClients, mockProjects, {
      groupByApp: true,
      absorbMicroSwitches: true,
    });

    // LockApp.exe MUST NOT be in the workstreams!
    expect(report.workstreams.find(w => w.appName.toLowerCase().includes('lockapp'))).toBeUndefined();
    // Brave MUST be its own workstream
    const braveWs = report.workstreams.find(w => w.appName === 'Brave');
    expect(braveWs).toBeDefined();
    expect(braveWs?.totalDurationSeconds).toBe(120);
  });

  it('normalizes browser tab identities and collapses subpages/searches into canonical brands', () => {
    // Exact titles from user screenshot
    expect(normalizeBrowserTabIdentity('chatgpt.com - Brave')).toBe('ChatGPT');
    expect(normalizeBrowserTabIdentity('chatgpt - Google Search - Brave')).toBe('ChatGPT');
    expect(normalizeBrowserTabIdentity('ChatGPT - Brave')).toBe('ChatGPT');
    expect(normalizeBrowserTabIdentity('ChatGPT: Chat, Work, Create & Code with AI - Brave')).toBe('ChatGPT');

    expect(normalizeBrowserTabIdentity('Notifications | LinkedIn - Brave')).toBe('LinkedIn');
    expect(normalizeBrowserTabIdentity('linkedin.com/notifications/ - Brave')).toBe('LinkedIn');
    expect(normalizeBrowserTabIdentity('linkedin.com/home?originalSubdomain=in - Brave')).toBe('LinkedIn');
    expect(normalizeBrowserTabIdentity('linkedin - Google Search - Brave')).toBe('LinkedIn');
    expect(normalizeBrowserTabIdentity('google.com/search?q=linkedin&oq=li - Brave')).toBe('LinkedIn');

    expect(normalizeBrowserTabIdentity('Cryptocurrency Prices, Charts, and Crypto Market Cap | CoinGecko - Brave')).toBe('CoinGecko');
    expect(normalizeBrowserTabIdentity('coingecko.com - Brave')).toBe('CoinGecko');
    expect(normalizeBrowserTabIdentity('coin gecko - Google Search - Brave')).toBe('CoinGecko');

    // Email tabs extract and retain the email ID
    expect(normalizeBrowserTabIdentity('Technical Interview - work.vineethramesh@gmail.com - Gmail - Brave')).toBe('work.vineethramesh@gmail.com');
    expect(normalizeBrowserTabIdentity('Search results - work.vineethramesh@gmail.com - Gmail - Brave')).toBe('work.vineethramesh@gmail.com');
    expect(normalizeBrowserTabIdentity('Inbox - client.lead@firm.com - Outlook - Google Chrome')).toBe('client.lead@firm.com');
    expect(normalizeBrowserTabIdentity('Gmail - Brave')).toBe('Gmail');
  });

  it('excludes Windows Start Experience Host and Windows Search flyouts as OS noise', () => {
    const activities: ActivityItem[] = [
      makeAct('s1', 'Windows Start Experience Host', 'Start', 60, '11:32'),
      makeAct('s2', 'Microsoft® Windows® Operating System', 'Search', 60, '11:04'),
      makeAct('w1', 'Microsoft Word', 'Document.docx - Word', 300, '11:35'),
    ];

    const report = auditActivities(activities, mockClients, mockProjects, {
      groupByApp: true,
    });

    expect(report.workstreams.find(w => w.appName.toLowerCase().includes('start experience'))).toBeUndefined();
    expect(report.workstreams.find(w => w.appName.toLowerCase().includes('operating system'))).toBeUndefined();
    expect(report.workstreams.length).toBe(1);
    expect(report.workstreams[0].appName).toBe('Microsoft Word');
  });
});

