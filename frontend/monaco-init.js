(function () {
  require.config({
    paths: { vs: '/node_modules/monaco-editor/min/vs' },
    'vs/nls': { availableLanguages: {} },
  });

  require(['vs/editor/editor.main'], function () {
    const container = document.getElementById('monaco-container');
    const initialContent = [
      "const { app, BrowserWindow } = require('electron');",
      'const path = require("path");',
      '',
      'function createWindow() {',
      '  const win = new BrowserWindow({',
      '    width: 1024,',
      '    height: 768,',
      '    webPreferences: {',
      '      contextIsolation: true,',
      '      nodeIntegration: false,',
      '    },',
      '  });',
      '',
      "  win.loadFile(path.join(__dirname, 'frontend', 'index.html'));",
      '}',
      '',
      'app.whenReady().then(createWindow);',
    ].join('\n');

    window.monacoEditor = monaco.editor.create(container, {
      value: initialContent,
      language: 'javascript',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Consolas", "Monaco", "Courier New", monospace',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
    });

    window.dispatchEvent(new Event('monaco-ready'));
  });
})();
