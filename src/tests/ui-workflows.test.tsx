// @vitest-environment jsdom
import { afterEach,describe,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,cleanup,waitFor } from '@testing-library/react';
import { TimeEntryEditorModal } from '../components/entries/TimeEntryEditorModal';
import { SubmitTimesheetModal } from '../components/timesheet/SubmitTimesheetModal';
import { createPeriod } from '../domain/workflow';
import { Client,Project } from '../types/client-project';
import { WeeklyTimesheetGrid } from '../components/timesheet/WeeklyTimesheetGrid';

const clients:Client[]=[{id:'c',name:'Firm',code:'F',color:'#fff',createdAt:''}];
const projects:Project[]=[{id:'p',clientId:'c',name:'Internal',code:'I',color:'#fff',createdAt:'',defaultHourlyRate:0,isBillableDefault:false}];
afterEach(cleanup);
describe('Consultant UI workflows',()=>{
  it('requires explicit assignment and preserves a zero-rate non-billable project',async()=>{
    const save=vi.fn((_entry: unknown)=>true);render(<TimeEntryEditorModal isOpen onClose={()=>{}} clients={clients} projects={projects} activeDate="2026-09-11" roundingMode="tenth_hour" onSaveEntry={save}/>);
    expect((screen.getByLabelText('Client') as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Client'),{target:{value:'c'}});fireEvent.change(screen.getByLabelText('Project'),{target:{value:'p'}});
    expect((screen.getByLabelText('Billable') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Hourly rate') as HTMLInputElement).value).toBe('0');
    fireEvent.change(screen.getByLabelText('Work description for manager'),{target:{value:'Practice development'}});fireEvent.click(screen.getByRole('button',{name:'Save work entry'}));
    await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(save.mock.calls[0][0]).toMatchObject({isBillable:false,hourlyRate:0,taskName:'Practice development'});
  });
  it('keeps editor open after persistence rejection',async()=>{
    const close=vi.fn();render(<TimeEntryEditorModal isOpen onClose={close} clients={clients} projects={projects} activeDate="2026-09-11" roundingMode="exact" onSaveEntry={()=>false}/>);
    fireEvent.change(screen.getByLabelText('Client'),{target:{value:'c'}});fireEvent.change(screen.getByLabelText('Project'),{target:{value:'p'}});fireEvent.change(screen.getByLabelText('Work description for manager'),{target:{value:'Work'}});fireEvent.click(screen.getByRole('button',{name:'Save work entry'}));
    await screen.findByRole('alert');expect(close).not.toHaveBeenCalled();
  });
  it('offers local finalization rather than simulated manager approval',()=>{
    const submit=vi.fn();render(<SubmitTimesheetModal isOpen onClose={()=>{}} period={createPeriod('2026-09-11','Me','')} entries={[]} clients={clients} projects={projects} consultantName="Me" consultantEmail="" onSubmitTimesheet={submit}/>);
    expect(screen.queryByRole('button',{name:/approve/i})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Finalize and lock revision'}));expect(submit).toHaveBeenCalledOnce();
  });
  it('renders weekly timesheet grid cleanly without log time button or detailed log, and live search filters rows',()=>{
    const period = createPeriod('2026-09-08', 'Me', '');
    const weekDays = [
      { dateStr: '2026-09-08', dayName: 'Mon', dayNumber: 8 },
      { dateStr: '2026-09-09', dayName: 'Tue', dayNumber: 9 },
      { dateStr: '2026-09-10', dayName: 'Wed', dayNumber: 10 },
      { dateStr: '2026-09-11', dayName: 'Thu', dayNumber: 11 },
      { dateStr: '2026-09-12', dayName: 'Fri', dayNumber: 12 },
      { dateStr: '2026-09-13', dayName: 'Sat', dayNumber: 13 },
      { dateStr: '2026-09-14', dayName: 'Sun', dayNumber: 14 },
    ];
    const testEntries = [
      {
        id: 'e1',
        date: '2026-09-08',
        startTime: '09:00',
        endTime: '11:00',
        durationMinutes: 120,
        decimalHours: 2,
        clientId: 'c',
        projectId: 'p',
        taskName: 'Architecture design',
        notes: '',
        isBillable: true,
        hourlyRate: 150,
        calculatedRevenue: 300,
        createdAt: '',
        updatedAt: '',
      }
    ];

    render(
      <WeeklyTimesheetGrid
        period={period}
        timeEntries={testEntries}
        clients={clients}
        projects={projects}
        weekDays={weekDays}
        onOpenValidationModal={() => {}}
        onSelectDate={() => {}}
        activeDate="2026-09-08"
      />
    );

    // Verify + Log Time button and Detailed Log tab are NOT present
    expect(screen.queryByRole('button', { name: /log time/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /detailed log/i })).toBeNull();
    expect(screen.getByRole('button', { name: /by client/i })).toBeDefined();

    // Verify search input is present and filters rows
    const searchInput = screen.getByPlaceholderText('Search timesheet...');
    expect(searchInput).toBeDefined();

    // Searching for non-matching query hides project row and shows empty state
    fireEvent.change(searchInput, { target: { value: 'Nonexistent' } });
    expect(screen.getByText('No Entries Matching "Nonexistent"')).toBeDefined();

    // Clicking either Clear Search button (input X or empty state button) restores the entry
    const clearButtons = screen.getAllByRole('button', { name: /clear search/i });
    expect(clearButtons.length).toBe(2);
    fireEvent.click(clearButtons[0]);
    expect(screen.queryByText('No Entries Matching "Nonexistent"')).toBeNull();
    expect(screen.getByText('Firm')).toBeDefined();
  });

  it('renders micro-duration time entries on the date cell and shows accurate revenue in WeeklyTimesheetGrid', () => {
    const period = createPeriod('2026-09-14', 'Me', '');
    const weekDays = [
      { dateStr: '2026-09-14', dayName: 'Mon', dayNumber: 14 },
      { dateStr: '2026-09-15', dayName: 'Tue', dayNumber: 15 },
      { dateStr: '2026-09-16', dayName: 'Wed', dayNumber: 16 },
      { dateStr: '2026-09-17', dayName: 'Thu', dayNumber: 17 },
      { dateStr: '2026-09-18', dayName: 'Fri', dayNumber: 18 },
      { dateStr: '2026-09-19', dayName: 'Sat', dayNumber: 19 },
      { dateStr: '2026-09-20', dayName: 'Sun', dayNumber: 20 },
    ];
    const microEntries = [
      {
        id: 'micro-1',
        date: '2026-09-16',
        startTime: '06:10:23',
        endTime: '06:10:27',
        durationMinutes: 0.067,
        decimalHours: 0, // Legacy/micro entry before upgrade
        clientId: 'c',
        projectId: 'p',
        taskName: 'Quick update',
        notes: '',
        isBillable: true,
        hourlyRate: 275,
        calculatedRevenue: 0.31,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'micro-2',
        date: '2026-09-16',
        startTime: '06:15:56',
        endTime: '06:16:02',
        durationMinutes: 0.1,
        decimalHours: 0, // Legacy/micro entry before upgrade
        clientId: 'c',
        projectId: 'p',
        taskName: 'Doc review',
        notes: '',
        isBillable: true,
        hourlyRate: 275,
        calculatedRevenue: 0.46,
        createdAt: '',
        updatedAt: '',
      }
    ];

    render(
      <WeeklyTimesheetGrid
        period={period}
        timeEntries={microEntries}
        clients={clients}
        projects={projects}
        weekDays={weekDays}
        onOpenValidationModal={() => {}}
        onSelectDate={() => {}}
        activeDate="2026-09-16"
      />
    );

    // WED 16 cell MUST display the hour badge (0.02h), NOT empty '+'
    const cellButton = screen.getByRole('button', { name: '0.02h' });
    expect(cellButton).toBeDefined();
    expect(cellButton.getAttribute('title')).toMatch(/view \/ edit 0\.02h logged on Wed/i);
    // Revenue of $0.77 must be present in the weekly totals
    expect(screen.getAllByText('$0.77').length).toBeGreaterThanOrEqual(1);
  });
});

