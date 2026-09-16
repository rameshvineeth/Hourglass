// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe,it,expect,vi } from 'vitest';
describe('IndexedDB migration and recovery',()=>{
 it('migrates once, keeps a legacy backup, then reloads and restores',async()=>{
   localStorage.setItem('hourglass_clients_v1',JSON.stringify([{id:'legacy',name:'Existing client'}]));
   const {StorageService}=await import('../services/storage-service');await StorageService.initialize();
   expect(StorageService.getClients()[0].id).toBe('legacy');const backup=await StorageService.exportBackup();expect(JSON.parse(backup).legacyBackup.hourglass_clients_v1).toContain('Existing client');
   StorageService.saveClients([]);await StorageService.flush();await StorageService.restoreBackup(backup);expect(StorageService.getClients()).toHaveLength(1);
   await expect(StorageService.restoreBackup('{"version":1}')).rejects.toThrow();expect(StorageService.getClients()).toHaveLength(1);
   vi.resetModules();const reload=await import('../services/storage-service');await reload.StorageService.initialize();expect(reload.StorageService.getClients()[0].id).toBe('legacy');
 });
});
