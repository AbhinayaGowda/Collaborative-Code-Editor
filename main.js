const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const PROJECT_ROOT = __dirname;
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

let staticServer = null;

function createStaticServer() {
  return new Promise((resolve) => {
    staticServer = http.createServer((req, res) => {
      const urlPath = req.url === '/' ? '/frontend/index.html' : req.url.split('?')[0];
      const filePath = path.join(PROJECT_ROOT, urlPath.replace(/^\//, '').replace(/%20/g, ' '));
      const safePath = path.resolve(filePath);
      const projectRootResolved = path.resolve(PROJECT_ROOT);
      if (!safePath.startsWith(projectRootResolved)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(safePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        const ext = path.extname(safePath);
        res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        res.end(data);
      });
    });
    staticServer.listen(0, '127.0.0.1', () => {
      const port = staticServer.address().port;
      resolve(port);
    });
  });
}

async function createWindow() {
  const port = await createStaticServer();
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL(`http://127.0.0.1:${port}/frontend/index.html`);
}

ipcMain.handle('open-file', async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Text', extensions: ['js', 'html', 'css', 'txt'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return { filePath, content };
});

ipcMain.handle('save-file', async (_event, { filePath, content }) => {
  if (!filePath || content === undefined) {
    return { success: false, error: 'Missing filePath or content' };
  }
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-file-as', async (_event, content) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return { cancelled: true };
  const result = await dialog.showSaveDialog(win, {
    filters: [
      { name: 'Text', extensions: ['js', 'html', 'css', 'txt'] },
    ],
  });
  if (result.canceled || !result.filePath) return { cancelled: true };
  const filePath = result.filePath;
  try {
    const exists = await fs.promises.access(filePath).then(() => true).catch(() => false);
    if (exists) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Overwrite', 'Cancel'],
        defaultId: 1,
        title: 'Save As',
        message: 'This file already exists. Overwrite?',
      });
      if (response !== 0) return { cancelled: true };
    }
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { filePath };
  } catch (err) {
    return { error: err.message };
  }
});

const TEXT_EXT = new Set(['.js', '.html', '.css', '.txt', '.py']);
const IGNORED_DIRS = new Set(['node_modules', '.git']);

function isHidden(name) {
  return name.startsWith('.');
}

async function buildTree(dirPath, dirName = path.basename(dirPath)) {
  const children = [];
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });
  for (const ent of sorted) {
    const fullPath = path.join(dirPath, ent.name);
    if (ent.isDirectory()) {
      if (IGNORED_DIRS.has(ent.name) || isHidden(ent.name)) continue;
      children.push(await buildTree(fullPath, ent.name));
    } else {
      if (isHidden(ent.name)) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!TEXT_EXT.has(ext)) continue;
      children.push({ name: ent.name, path: fullPath, type: 'file' });
    }
  }
  return { name: dirName, path: dirPath, type: 'folder', children };
}

const RECENT_PROJECTS_FILE = path.join(app.getPath('userData'), 'recent-projects.json');
const RECENT_MAX = 5;

async function readRecentProjects() {
  try {
    const data = await fs.promises.readFile(RECENT_PROJECTS_FILE, 'utf-8');
    const list = JSON.parse(data);
    if (!Array.isArray(list)) return [];
    const existing = [];
    for (const p of list) {
      if (typeof p !== 'string') continue;
      try {
        const stat = await fs.promises.stat(p);
        if (stat.isDirectory()) existing.push(p);
      } catch {
        /* skip missing */
      }
    }
    if (existing.length !== list.length) {
      await fs.promises.writeFile(RECENT_PROJECTS_FILE, JSON.stringify(existing), 'utf-8');
    }
    return existing;
  } catch {
    return [];
  }
}

async function addRecentProject(folderPath) {
  let list = await readRecentProjects();
  list = list.filter((p) => p !== folderPath);
  list.unshift(folderPath);
  list = list.slice(0, RECENT_MAX);
  await fs.promises.writeFile(RECENT_PROJECTS_FILE, JSON.stringify(list), 'utf-8');
}

ipcMain.handle('open-folder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folderPath = result.filePaths[0];
  await addRecentProject(folderPath);
  return buildTree(folderPath);
});

ipcMain.handle('get-recent-projects', async () => {
  return readRecentProjects();
});

ipcMain.handle('open-recent-project', async (_event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') return { error: 'Invalid path' };
  try {
    const stat = await fs.promises.stat(folderPath);
    if (!stat.isDirectory()) return { error: 'Not a directory' };
  } catch (err) {
    return { error: err.message };
  }
  await addRecentProject(folderPath);
  try {
    return { tree: await buildTree(folderPath) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('get-folder-tree', async (_event, rootPath) => {
  if (!rootPath) return null;
  try {
    return await buildTree(rootPath);
  } catch (err) {
    return null;
  }
});

ipcMain.handle('create-file', async (_event, { directoryPath, fileName }) => {
  console.log('[main] create-file called:', { directoryPath, fileName });
  if (!directoryPath || !fileName || typeof fileName !== 'string') {
    return { error: 'Missing directory or file name' };
  }
  const trimmed = fileName.trim();
  if (!trimmed) return { error: 'File name cannot be empty' };
  if (trimmed.includes(path.sep) || trimmed.includes('/') || trimmed === '.' || trimmed === '..') {
    return { error: 'Invalid file name' };
  }
  const filePath = path.join(directoryPath, trimmed);
  try {
    await fs.promises.access(filePath);
    return { error: 'File already exists' };
  } catch {
    // File does not exist, OK to create
  }
  try {
    await fs.promises.writeFile(filePath, '', 'utf-8');
    return { filePath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('read-file', async (_event, filePath) => {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return { filePath, content };
  } catch (err) {
    return { error: err.message };
  }
});

let terminalProcess = null;
let terminalWebContents = null;

function sendTerminalOutput(webContents, type, chunk) {
  if (webContents && !webContents.isDestroyed()) {
    webContents.send('terminal-output', { type, chunk });
  }
}

ipcMain.handle('terminal-start', async (event) => {
  if (terminalProcess) {
    return { alreadyStarted: true };
  }
  terminalWebContents = event.sender;
  terminalProcess = spawn('powershell.exe', ['-NoLogo'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  terminalProcess.stdout.setEncoding('utf8');
  terminalProcess.stderr.setEncoding('utf8');
  terminalProcess.stdout.on('data', (data) => {
    sendTerminalOutput(terminalWebContents, 'stdout', data);
  });
  terminalProcess.stderr.on('data', (data) => {
    sendTerminalOutput(terminalWebContents, 'stderr', data);
  });
  terminalProcess.on('error', (err) => {
    sendTerminalOutput(terminalWebContents, 'stderr', err.message + '\n');
  });
  terminalProcess.on('exit', (code, signal) => {
    terminalProcess = null;
    terminalWebContents = null;
  });
  return { started: true };
});

ipcMain.handle('terminal-write', async (_event, command) => {
  if (!terminalProcess || !terminalProcess.stdin.writable) return { ok: false };
  terminalProcess.stdin.write(command + '\n');
  return { ok: true };
});

ipcMain.handle('terminal-kill', async () => {
  if (!terminalProcess) return { ok: true };
  try {
    terminalProcess.kill('SIGTERM');
  } catch {
    terminalProcess.kill();
  }
  terminalProcess = null;
  terminalWebContents = null;
  return { ok: true };
});

// Run Current File: .js → node, .py → python (Windows only)
const RUN_EXT_MAP = {
  '.js': 'node',
  '.py': 'python',
};

ipcMain.handle('run-file', async (_event, filePath) => {
  if (process.platform !== 'win32') {
    return { error: 'Run Current File is only supported on Windows' };
  }
  if (!filePath || typeof filePath !== 'string') {
    return { error: 'No file open' };
  }
  const ext = path.extname(filePath).toLowerCase();
  const runner = RUN_EXT_MAP[ext];
  if (!runner) {
    return { error: `Unsupported file type: ${ext || '(no extension)'}. Supported: .js, .py` };
  }
  try {
    await fs.promises.access(filePath);
  } catch {
    return { error: 'File not found' };
  }
  if (!terminalProcess || !terminalProcess.stdin.writable) {
    return { error: 'Terminal not ready. Please wait for it to initialize.' };
  }
  // Clear terminal (cls on Windows PowerShell)
  terminalProcess.stdin.write('cls\n');
  // Escape path for PowerShell: use single quotes to avoid expansion
  const escapedPath = filePath.replace(/'/g, "''");
  const command = `${runner} '${escapedPath}'`;
  terminalProcess.stdin.write(command + '\n');
  return { ok: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
