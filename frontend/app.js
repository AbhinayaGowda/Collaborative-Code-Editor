function getEditorContent() {
  return window.monacoEditor ? window.monacoEditor.getValue() : '';
}

function setEditorContent(content, language) {
  if (window.monacoEditor) {
    window.monacoEditor.setValue(content || '');
    if (language) {
      const model = window.monacoEditor.getModel();
      if (model) monaco.editor.setModelLanguage(model, language);
    }
  }
}

function getLanguageFromPath(filePath) {
  const ext = (filePath || '').split('.').pop().toLowerCase();
  if (ext === 'js') return 'javascript';
  if (ext === 'html') return 'html';
  if (ext === 'css') return 'css';
  return 'plaintext';
}

function initApp() {
  const editor = window.monacoEditor;
  console.log('[initApp] running, monacoEditor:', !!editor);
  if (!editor) return;

  const openFileBtn = document.querySelector('.open-file-btn');
  const openFolderBtn = document.querySelector('.open-folder-btn');
  const newFileBtn = document.querySelector('.new-file-btn');
  console.log('[initApp] newFileBtn:', newFileBtn ? 'found' : 'NULL');
  const saveBtn = document.querySelector('.save-btn');
  const saveAsBtn = document.querySelector('.save-as-btn');
  const runBtn = document.querySelector('.run-btn');
  const currentTab = document.getElementById('current-tab');
  const statusMessage = document.getElementById('status-message');
  const folderTreeEmpty = document.getElementById('folder-tree-empty');
  const folderTree = document.getElementById('folder-tree');
  const recentProjectsList = document.getElementById('recent-projects-list');

  // Collaboration state
  const collabState = {
    isActive: false,
    role: null, // 'host' or 'guest'
    roomId: null,
    displayName: null,
  };

  // Generate a random room ID (8 characters, alphanumeric)
  function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Update collaboration status in status bar
  function updateCollabStatus() {
    const collabStatusEl = document.getElementById('collab-status');
    if (!collabState.isActive) {
      collabStatusEl.style.display = 'none';
      return;
    }
    collabStatusEl.style.display = 'inline';
    const roleText = collabState.role === 'host' ? 'Host' : 'Guest';
    collabStatusEl.textContent = `Collaborating • ${roleText} • Room: ${collabState.roomId}`;
    collabStatusEl.title = `Display name: ${collabState.displayName || 'Unknown'}`;
  }

  // Update Monaco editor read-only state based on role
  function updateEditorReadOnly() {
    if (!window.monacoEditor) return;
    const isReadOnly = collabState.isActive && collabState.role === 'guest';
    window.monacoEditor.updateOptions({ readOnly: isReadOnly });
    if (isReadOnly) {
      window.monacoEditor.updateOptions({ 
        readOnlyMessage: { value: 'You are a guest. Only the host can edit.' }
      });
    }
  }

  // Initialize collaboration UI handlers
  function initCollaboration() {
    const startCollabBtn = document.querySelector('.collab-btn-primary');
    const joinRoomBtn = document.querySelector('.collab-btn:not(.collab-btn-primary)');
    const modalBackdrop = document.querySelector('.collab-modal-backdrop');
    const modalCloseBtn = document.querySelector('.collab-modal-close');
    const modeTabs = document.querySelectorAll('.collab-mode-tab');
    const startSection = document.querySelector('.collab-form-section-start');
    const joinSection = document.querySelector('.collab-form-section-join');
    const startActionBtn = document.querySelector('.collab-primary-action[data-action="start"]');
    const joinActionBtn = document.querySelector('.collab-primary-action[data-action="join"]');
    const cancelBtn = document.querySelector('.collab-secondary-action');
    const displayNameStartInput = document.getElementById('collab-display-name-start');
    const roomNameInput = document.getElementById('collab-room-name');
    const displayNameJoinInput = document.getElementById('collab-display-name-join');
    const roomIdInput = document.getElementById('collab-room-id');

    // Show modal
    function showModal(mode) {
      modalBackdrop.classList.remove('collab-modal-hidden');
      modalBackdrop.setAttribute('aria-hidden', 'false');
      if (mode === 'join') {
        switchToJoinMode();
      } else {
        switchToStartMode();
      }
    }

    // Hide modal
    function hideModal() {
      modalBackdrop.classList.add('collab-modal-hidden');
      modalBackdrop.setAttribute('aria-hidden', 'true');
      // Reset form
      displayNameStartInput.value = '';
      roomNameInput.value = '';
      displayNameJoinInput.value = '';
      roomIdInput.value = '';
    }

    // Switch to "Start" mode
    function switchToStartMode() {
      modeTabs.forEach(tab => {
        if (tab.dataset.mode === 'start') {
          tab.classList.add('collab-mode-tab-active');
          tab.setAttribute('aria-selected', 'true');
        } else {
          tab.classList.remove('collab-mode-tab-active');
          tab.setAttribute('aria-selected', 'false');
        }
      });
      startSection.style.display = 'flex';
      joinSection.style.display = 'none';
      startActionBtn.style.display = 'inline-block';
      joinActionBtn.style.display = 'none';
    }

    // Switch to "Join" mode
    function switchToJoinMode() {
      modeTabs.forEach(tab => {
        if (tab.dataset.mode === 'join') {
          tab.classList.add('collab-mode-tab-active');
          tab.setAttribute('aria-selected', 'true');
        } else {
          tab.classList.remove('collab-mode-tab-active');
          tab.setAttribute('aria-selected', 'false');
        }
      });
      startSection.style.display = 'none';
      joinSection.style.display = 'flex';
      startActionBtn.style.display = 'none';
      joinActionBtn.style.display = 'inline-block';
    }

    // Start collaboration
    function startCollaboration() {
      const displayName = displayNameStartInput.value.trim();
      if (!displayName) {
        showStatus('Please enter a display name', true);
        return;
      }

      const roomId = generateRoomId();
      collabState.isActive = true;
      collabState.role = 'host';
      collabState.roomId = roomId;
      collabState.displayName = displayName;

      updateCollabStatus();
      updateEditorReadOnly();
      hideModal();
      showStatus(`Collaboration started! Room ID: ${roomId}`, false);
    }

    // Join room
    function joinRoom() {
      const displayName = displayNameJoinInput.value.trim();
      const roomId = roomIdInput.value.trim().toUpperCase();

      if (!displayName) {
        showStatus('Please enter a display name', true);
        return;
      }
      if (!roomId) {
        showStatus('Please enter a room ID', true);
        return;
      }
      if (roomId.length !== 8) {
        showStatus('Room ID must be 8 characters', true);
        return;
      }

      collabState.isActive = true;
      collabState.role = 'guest';
      collabState.roomId = roomId;
      collabState.displayName = displayName;

      updateCollabStatus();
      updateEditorReadOnly();
      hideModal();
      showStatus(`Joined room ${roomId} as guest`, false);
    }

    // Event listeners
    startCollabBtn?.addEventListener('click', () => showModal('start'));
    joinRoomBtn?.addEventListener('click', () => showModal('join'));
    modalCloseBtn?.addEventListener('click', hideModal);
    cancelBtn?.addEventListener('click', hideModal);
    
    // Close modal on backdrop click
    modalBackdrop?.addEventListener('click', function(e) {
      if (e.target === modalBackdrop) {
        hideModal();
      }
    });

    // Mode tab switching
    modeTabs.forEach(tab => {
      tab.addEventListener('click', function() {
        if (tab.dataset.mode === 'start') {
          switchToStartMode();
        } else {
          switchToJoinMode();
        }
      });
    });

    // Form submission
    startActionBtn?.addEventListener('click', startCollaboration);
    joinActionBtn?.addEventListener('click', joinRoom);

    // Enter key to submit
    [displayNameStartInput, roomNameInput, displayNameJoinInput, roomIdInput].forEach(input => {
      if (input) {
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            if (startSection.style.display !== 'none') {
              startActionBtn.click();
            } else {
              joinActionBtn.click();
            }
          }
        });
      }
    });
  }

  // Initialize collaboration handlers
  initCollaboration();

  let currentFolderRoot = null;

  function renderRecentProjects(paths) {
    recentProjectsList.innerHTML = '';
    if (!paths || paths.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'recent-projects-empty';
      empty.textContent = 'No recent projects';
      recentProjectsList.appendChild(empty);
      return;
    }
    paths.forEach(function (folderPath) {
      const name = folderPath.replace(/^.*[/\\]/, '') || folderPath;
      const el = document.createElement('div');
      el.className = 'recent-project-item';
      el.dataset.path = folderPath;
      el.textContent = name;
      el.title = folderPath;
      el.addEventListener('click', async function () {
        const result = await window.editorAPI.openRecentProject(folderPath);
        if (result.error) {
          showStatus(result.error, true);
          renderRecentProjects(await window.editorAPI.getRecentProjects());
          return;
        }
        currentFolderRoot = result.tree.path;
        renderTree(result.tree);
        renderRecentProjects(await window.editorAPI.getRecentProjects());
      });
      recentProjectsList.appendChild(el);
    });
  }

  function showStatus(text, isError) {
    statusMessage.textContent = text;
    statusMessage.className = 'status-item' + (isError ? ' status-error' : '');
    clearTimeout(showStatus._timer);
    showStatus._timer = setTimeout(function () {
      statusMessage.textContent = '';
      statusMessage.className = 'status-item';
    }, 3000);
  }

  function setActiveFile(filePath) {
    folderTree.querySelectorAll('.tree-file').forEach(function (el) {
      el.classList.toggle('active', el.dataset.path === filePath);
    });
  }

  function renderTreeNode(node, depth) {
    if (node.type === 'file') {
      const el = document.createElement('div');
      el.className = 'tree-file';
      el.dataset.path = node.path;
      el.textContent = node.name;
      el.style.paddingLeft = (12 + depth * 12) + 'px';
      el.addEventListener('click', async function () {
        const result = await window.editorAPI.readFile(node.path);
        if (result.error) {
          showStatus('Error: ' + result.error, true);
          return;
        }
        setEditorContent(result.content, getLanguageFromPath(node.path));
        currentTab.textContent = node.name;
        currentTab.dataset.filePath = node.path;
        setActiveFile(node.path);
      });
      return el;
    }
    const folder = document.createElement('div');
    folder.className = 'tree-folder';
    const label = document.createElement('div');
    label.className = 'tree-folder-label';
    label.style.paddingLeft = (12 + depth * 12) + 'px';
    label.textContent = node.name;
    folder.appendChild(label);
    const children = document.createElement('div');
    children.className = 'tree-children';
    (node.children || []).forEach(function (child) {
      children.appendChild(renderTreeNode(child, depth + 1));
    });
    folder.appendChild(children);
    return folder;
  }

  function renderTree(root) {
    folderTree.innerHTML = '';
    if (root.children && root.children.length) {
      root.children.forEach(function (child) {
        folderTree.appendChild(renderTreeNode(child, 0));
      });
    }
    folderTreeEmpty.hidden = true;
    folderTree.hidden = false;
  }

  openFileBtn.addEventListener('click', async function () {
    const result = await window.editorAPI.openFile();
    if (!result) return;
    setEditorContent(result.content, getLanguageFromPath(result.filePath));
    const fileName = result.filePath.replace(/^.*[/\\]/, '');
    currentTab.textContent = fileName;
    currentTab.dataset.filePath = result.filePath;
    setActiveFile(result.filePath);
  });

  openFolderBtn.addEventListener('click', async function () {
    const tree = await window.editorAPI.openFolder();
    if (!tree) return;
    currentFolderRoot = tree.path;
    renderTree(tree);
    renderRecentProjects(await window.editorAPI.getRecentProjects());
  });

  if (!newFileBtn) {
    console.error('[initApp] newFileBtn not found - cannot attach listener');
  }
  newFileBtn?.addEventListener('click', async function () {
    console.log('[NewFile] click fired, currentFolderRoot:', currentFolderRoot);
    if (!currentFolderRoot) {
      showStatus('Open a folder first', true);
      return;
    }
    const fileName = window.prompt('File name (e.g. script.js):', 'untitled.js');
    if (fileName === null) return;
    const trimmed = fileName.trim();
    if (!trimmed) {
      showStatus('File name cannot be empty', true);
      return;
    }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') {
      showStatus('Invalid file name', true);
      return;
    }
    console.log('[NewFile] calling createFile:', currentFolderRoot, trimmed);
    const result = await window.editorAPI.createFile(currentFolderRoot, trimmed);
    console.log('[NewFile] createFile result:', result);
    if (result.error) {
      showStatus(result.error, true);
      return;
    }
    const tree = await window.editorAPI.getFolderTree(currentFolderRoot);
    if (tree) renderTree(tree);
    const openResult = await window.editorAPI.readFile(result.filePath);
    if (openResult.error) {
      showStatus('Created but could not open: ' + openResult.error, true);
      return;
    }
    setEditorContent(openResult.content, getLanguageFromPath(result.filePath));
    currentTab.textContent = trimmed;
    currentTab.dataset.filePath = result.filePath;
    setActiveFile(result.filePath);
    showStatus('Created ' + trimmed);
  });

  saveBtn.addEventListener('click', async function () {
    const filePath = currentTab.dataset.filePath;
    if (!filePath) {
      showStatus('No file open', true);
      return;
    }
    const result = await window.editorAPI.saveFile(filePath, getEditorContent());
    if (result.success) {
      showStatus('Saved');
    } else {
      showStatus('Error: ' + (result.error || 'Save failed'), true);
    }
  });

  (async function loadRecentProjects() {
    renderRecentProjects(await window.editorAPI.getRecentProjects());
  })();

  const terminalOutput = document.getElementById('terminal-output');
  const terminalInput = document.getElementById('terminal-input');

  window.editorAPI.onTerminalOutput(function (data) {
    const span = document.createElement('span');
    if (data.type === 'stderr') span.className = 'terminal-stderr';
    span.textContent = data.chunk;
    terminalOutput.appendChild(span);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  });

  (async function initTerminal() {
    await window.editorAPI.startTerminal();
  })();

  terminalInput.addEventListener('keydown', async function (event) {
    if (event.ctrlKey && event.key === 'c') {
      event.preventDefault();
      await window.editorAPI.killTerminal();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const command = terminalInput.value.trim();
    terminalInput.value = '';
    if (!command) return;
    await window.editorAPI.writeTerminal(command);
  });

  runBtn.addEventListener('click', async function () {
    const filePath = currentTab.dataset.filePath;
    if (!filePath) {
      showStatus('No file open', true);
      return;
    }
    const dotIdx = filePath.lastIndexOf('.');
    const ext = dotIdx >= 0 ? filePath.substring(dotIdx).toLowerCase() : '(no extension)';
    if (!['.js', '.py'].includes(ext)) {
      showStatus('Unsupported file type. Supported: .js, .py', true);
      return;
    }
    // Save before running so we execute latest content
    const saveResult = await window.editorAPI.saveFile(filePath, getEditorContent());
    if (!saveResult.success) {
      showStatus('Save failed: ' + (saveResult.error || 'Unknown error'), true);
      return;
    }
    const result = await window.editorAPI.runCurrentFile(filePath);
    if (result.error) {
      showStatus(result.error, true);
      return;
    }
    showStatus('Running ' + currentTab.textContent);
  });

  saveAsBtn.addEventListener('click', async function () {
    const result = await window.editorAPI.saveFileAs(getEditorContent());
    if (result.cancelled) return;
    if (result.error) {
      showStatus('Error: ' + result.error, true);
      return;
    }
    const fileName = result.filePath.replace(/^.*[/\\]/, '');
    currentTab.dataset.filePath = result.filePath;
    currentTab.textContent = fileName;
    setActiveFile(result.filePath);
    showStatus('Saved as ' + fileName);
  });

  document.addEventListener('keydown', function (event) {
    if (event.target.id === 'terminal-input') return;
    if (!event.ctrlKey) return;
    if (event.key === 's') {
      event.preventDefault();
      if (event.shiftKey) {
        saveAsBtn.click();
      } else {
        saveBtn.click();
      }
      return;
    }
    if (event.key === 'o') {
      event.preventDefault();
      openFileBtn.click();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    if (window.monacoEditor) {
      initApp();
    } else {
      console.log('[app] waiting for monaco-ready');
      window.addEventListener('monaco-ready', initApp);
    }
  });
} else {
  if (window.monacoEditor) {
    initApp();
  } else {
    console.log('[app] waiting for monaco-ready (DOM already loaded)');
    window.addEventListener('monaco-ready', initApp);
  }
}
