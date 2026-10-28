export const IPC = {
  detectLogsFile: 'logs:detect',
  listSessions: 'sessions:list',
  createSession: 'sessions:create',
  openSession: 'sessions:open',
  machineReport: 'machine:report',
  aiStatus: 'ai:status',
  aiSetKey: 'ai:set-key',
  aiClearKey: 'ai:clear-key',
  aiList: 'ai:conversations',
  aiGet: 'ai:conversation',
  aiRemove: 'ai:remove',
  aiSend: 'ai:send',
  aiCancel: 'ai:cancel',
  aiOpenFile: 'ai:open-file',
  aiEvent: 'ai:event'
} as const
