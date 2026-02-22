const { contextBridge, ipcRenderer } = require('electron');

let terminalOutputCallback = null;
ipcRenderer.on('terminal-output', (_event, data) => {
  if (terminalOutputCallback) terminalOutputCallback(data);
});

contextBridge.exposeInMainWorld('editorAPI', {
  openFile: () => ipcRenderer.invoke('open-file'),
  saveFile: (filePath, content) =>
    ipcRenderer.invoke('save-file', { filePath, content }),
  saveFileAs: (content) => ipcRenderer.invoke('save-file-as', content),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  getFolderTree: (rootPath) => ipcRenderer.invoke('get-folder-tree', rootPath),
  createFile: (directoryPath, fileName) =>
    ipcRenderer.invoke('create-file', { directoryPath, fileName }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  openRecentProject: (folderPath) => ipcRenderer.invoke('open-recent-project', folderPath),
  startTerminal: () => ipcRenderer.invoke('terminal-start'),
  writeTerminal: (command) => ipcRenderer.invoke('terminal-write', command),
  onTerminalOutput: (callback) => { terminalOutputCallback = callback; },
  killTerminal: () => ipcRenderer.invoke('terminal-kill'),
  runCurrentFile: (filePath) => ipcRenderer.invoke('run-file', filePath),
});
