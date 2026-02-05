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
    ws: null, // WebSocket connection
    isApplyingRemoteUpdate: false, // Flag to prevent feedback loops
    serverUrl: 'ws://localhost:8080', // Default server URL
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

  // WebSocket connection management
  function connectWebSocket() {
    if (collabState.ws && collabState.ws.readyState === WebSocket.OPEN) {
      console.log('[Collab] WebSocket already connected');
      return;
    }

    try {
      console.log(`[Collab] Connecting to ${collabState.serverUrl}...`);
      const ws = new WebSocket(collabState.serverUrl);

      ws.onopen = function() {
        console.log('[Collab] WebSocket connected');
        // Join room after connection is established
        if (collabState.roomId && collabState.displayName) {
          joinRoomViaWebSocket();
        }
      };

      ws.onmessage = function(event) {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (error) {
          console.error('[Collab] Failed to parse WebSocket message:', error);
        }
      };

      ws.onerror = function(error) {
        console.error('[Collab] WebSocket error:', error);
        showStatus('Connection error. Check if server is running.', true);
      };

      ws.onclose = function() {
        console.log('[Collab] WebSocket closed');
        collabState.ws = null;
        // Attempt reconnection if collaboration is still active
        if (collabState.isActive) {
          console.log('[Collab] Attempting to reconnect...');
          setTimeout(connectWebSocket, 2000);
        }
      };

      collabState.ws = ws;
    } catch (error) {
      console.error('[Collab] Failed to create WebSocket:', error);
      showStatus('Failed to connect to collaboration server', true);
    }
  }

  function disconnectWebSocket() {
    if (collabState.ws) {
      // Send leave message before closing
      if (collabState.ws.readyState === WebSocket.OPEN && collabState.roomId) {
        collabState.ws.send(JSON.stringify({
          type: 'leave',
          roomId: collabState.roomId
        }));
      }
      collabState.ws.close();
      collabState.ws = null;
    }
  }

  function joinRoomViaWebSocket() {
    if (!collabState.ws || collabState.ws.readyState !== WebSocket.OPEN) {
      console.warn('[Collab] Cannot join room: WebSocket not connected');
      return;
    }

    if (!collabState.roomId || !collabState.displayName) {
      console.warn('[Collab] Cannot join room: missing roomId or displayName');
      return;
    }

    console.log(`[Collab] Joining room ${collabState.roomId} as ${collabState.displayName}`);
    collabState.ws.send(JSON.stringify({
      type: 'join',
      roomId: collabState.roomId,
      displayName: collabState.displayName
    }));
  }

  function handleWebSocketMessage(message) {
    const { type, roomId, content, userId, displayName } = message;

    switch (type) {
      case 'connected':
        console.log('[Collab] Server confirmed connection, userId:', message.userId);
        // If we're already in a room, join it now
        if (collabState.roomId && collabState.displayName) {
          joinRoomViaWebSocket();
        }
        break;

      case 'joined':
        console.log(`[Collab] Successfully joined room: ${roomId}`);
        showStatus(`Connected to room ${roomId}`, false);
        break;

      case 'editor-update':
        // Apply remote editor update (only if not from our own change)
        if (content !== undefined && !collabState.isApplyingRemoteUpdate) {
          applyRemoteEditorUpdate(content);
        }
        break;

      case 'user-joined':
        console.log(`[Collab] User joined: ${displayName} (${userId})`);
        showStatus(`${displayName} joined the room`, false);
        break;

      case 'user-left':
        console.log(`[Collab] User left: ${displayName} (${userId})`);
        showStatus(`${displayName} left the room`, false);
        break;

      case 'error':
        console.error('[Collab] Server error:', message.message);
        showStatus(`Server error: ${message.message}`, true);
        break;

      default:
        console.warn('[Collab] Unknown message type:', type);
    }
  }

  function applyRemoteEditorUpdate(content) {
    if (!window.monacoEditor) return;

    // Set flag to prevent feedback loop
    collabState.isApplyingRemoteUpdate = true;

    try {
      // Get current cursor position to restore it after update
      const position = window.monacoEditor.getPosition();
      
      // Apply the remote content (simple full document replace)
      window.monacoEditor.setValue(content || '');

      // Restore cursor position if possible
      if (position) {
        const model = window.monacoEditor.getModel();
        if (model && model.getLineCount() >= position.lineNumber) {
          window.monacoEditor.setPosition(position);
        }
      }
    } catch (error) {
      console.error('[Collab] Error applying remote update:', error);
    } finally {
      // Reset flag after a short delay to allow any queued updates
      setTimeout(() => {
        collabState.isApplyingRemoteUpdate = false;
      }, 100);
    }
  }

  // Setup Monaco editor change listener for collaboration
  function setupMonacoCollaboration() {
    if (!window.monacoEditor) {
      console.warn('[Collab] Monaco editor not available for collaboration setup');
      return;
    }

    // Listen for editor content changes
    window.monacoEditor.onDidChangeModelContent(function(event) {
      // Only broadcast if collaboration is active and we're not applying a remote update
      if (collabState.isActive && !collabState.isApplyingRemoteUpdate && collabState.ws) {
        const content = window.monacoEditor.getValue();
        
        // Only send if WebSocket is open
        if (collabState.ws.readyState === WebSocket.OPEN && collabState.roomId) {
          collabState.ws.send(JSON.stringify({
            type: 'editor-change',
            roomId: collabState.roomId,
            content: content
          }));
        }
      }
    });

    console.log('[Collab] Monaco editor collaboration listener set up');
  }

  // Initialize collaboration UI handlers
  function initCollaboration() {
    // Ensure DOM is fully loaded before querying elements
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCollaboration);
      return;
    }

    const startCollabBtn = document.querySelector('.collab-btn-primary');
    const joinRoomBtn = document.querySelector('.collab-btn:not(.collab-btn-primary)');
    const modalBackdrop = document.querySelector('.collab-modal-backdrop');
    const modalCloseBtn = document.querySelector('.collab-modal-close');
    const modeTabs = document.querySelectorAll('.collab-mode-tab');
    const startSection = document.querySelector('.collab-form-section-start');
    const joinSection = document.querySelector('.collab-form-section-join');
    const startActionBtn = document.querySelector('.collab-primary-action[data-action="start"]');
    const joinActionBtn = document.querySelector('.collab-primary-action-join');
    const cancelBtn = document.querySelector('.collab-secondary-action');
    const displayNameStartInput = document.getElementById('collab-display-name-start');
    const roomNameInput = document.getElementById('collab-room-name');
    const displayNameJoinInput = document.getElementById('collab-display-name-join');
    const roomIdInput = document.getElementById('collab-room-id');

    // Verify critical elements exist
    if (!joinActionBtn) {
      console.error('[Collab] Join button not found. Modal may not be loaded yet.');
      return;
    }

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
      
      // Connect to WebSocket server
      connectWebSocket();
      
      // Setup Monaco collaboration if editor is ready
      setupMonacoCollaboration();
      
      showStatus(`Collaboration started! Room ID: ${roomId}`, false);
    }

    // Join room
    function joinRoom() {
      console.log('[Collab] joinRoom() called - Join button clicked');
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
      
      // Connect to WebSocket server
      connectWebSocket();
      
      // Setup Monaco collaboration if editor is ready
      setupMonacoCollaboration();
      
      showStatus(`Joining room ${roomId}...`, false);
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

  // Setup Monaco collaboration when editor is ready
  if (window.monacoEditor) {
    setupMonacoCollaboration();
  } else {
    // Wait for Monaco to be ready
    window.addEventListener('monaco-ready', function() {
      setupMonacoCollaboration();
    });
  }

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
