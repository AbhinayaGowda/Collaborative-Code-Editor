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

  // ─── Collaboration State ───────────────────────────────────────────────────

  const collabState = {
    isActive: false,
    role: null,           // 'host' | 'guest'
    myPermission: null,   // 'Host' | 'Editor' | 'Viewer'
    roomId: null,
    displayName: null,
    ws: null,
    isApplyingRemoteUpdate: false,
    serverUrl: 'ws://localhost:8080',
    participants: [],     // [{ userId, displayName, role, joinedAt }]
  };

  // ─── Participant Panel ─────────────────────────────────────────────────────
  // Inject the permission control panel HTML once into the document

  function injectPermissionPanel() {
    if (document.getElementById('collab-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'collab-panel';
    panel.className = 'collab-panel collab-panel-hidden';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Collaboration Control Panel');
    panel.innerHTML = `
      <div class="collab-panel-header">
        <span class="collab-panel-title">👥 Participants</span>
        <div class="collab-panel-actions">
          <span id="collab-panel-room-id" class="collab-panel-room-id" title="Click to copy"></span>
          <button type="button" id="collab-panel-close" class="collab-panel-close" aria-label="Close panel">✕</button>
        </div>
      </div>
      <div id="collab-panel-body" class="collab-panel-body">
        <p class="collab-panel-empty">No participants yet.</p>
      </div>
      <div id="collab-intruder-log" class="collab-intruder-log collab-intruder-log-hidden">
        <div class="collab-intruder-log-header">🚨 Intruder Log</div>
        <div id="collab-intruder-log-entries"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // Close button
    panel.querySelector('#collab-panel-close').addEventListener('click', () => {
      panel.classList.add('collab-panel-hidden');
    });

    // Copy room ID on click
    panel.querySelector('#collab-panel-room-id').addEventListener('click', () => {
      const roomIdText = collabState.roomId;
      if (!roomIdText) return;
      navigator.clipboard.writeText(roomIdText).then(() => {
        showStatus('Room ID copied to clipboard!');
      });
    });
  }

  // Join-request notification toast for host
  function injectJoinRequestToast() {
    if (document.getElementById('join-request-container')) return;
    const container = document.createElement('div');
    container.id = 'join-request-container';
    container.className = 'join-request-container';
    document.body.appendChild(container);
  }

  injectPermissionPanel();
  injectJoinRequestToast();

  // Inject panel styles
  injectCollabStyles();

  // ─── Participant Panel Rendering ───────────────────────────────────────────

  function renderParticipants(users) {
    const body = document.getElementById('collab-panel-body');
    if (!body) return;

    // Count element in status bar
    const countEl = document.getElementById('count');
    if (countEl) countEl.textContent = users.length;

    if (!users.length) {
      body.innerHTML = '<p class="collab-panel-empty">No participants.</p>';
      return;
    }

    body.innerHTML = '';
    users.forEach(user => {
      const isMe = user.displayName === collabState.displayName;
      const isHost = collabState.myPermission === 'Host';

      const row = document.createElement('div');
      row.className = 'collab-participant-row';
      row.dataset.userId = user.userId;

      const roleClass = `role-badge role-${(user.role || 'viewer').toLowerCase()}`;
      const meLabel = isMe ? ' <span class="collab-me-label">(you)</span>' : '';

      row.innerHTML = `
        <div class="collab-participant-info">
          <span class="collab-participant-name">${escHtml(user.displayName)}${meLabel}</span>
          <span class="${roleClass}">${escHtml(user.role)}</span>
        </div>
        <div class="collab-participant-controls" id="controls-${user.userId}"></div>
      `;

      // Only host sees controls over non-host users that aren't themselves
      if (isHost && user.role !== 'Host' && !isMe) {
        const controls = row.querySelector(`#controls-${user.userId}`);

        const grantBtn = document.createElement('button');
        grantBtn.type = 'button';
        grantBtn.className = 'collab-ctrl-btn collab-ctrl-edit';
        grantBtn.title = user.role === 'Editor' ? 'Revoke edit access' : 'Grant edit access';
        grantBtn.textContent = user.role === 'Editor' ? '✏️ Revoke Edit' : '✏️ Grant Edit';
        grantBtn.addEventListener('click', () => {
          const newPerm = user.role === 'Editor' ? 'view' : 'edit';
          sendWs({ type: 'set-permission', targetUserId: user.userId, permission: newPerm });
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'collab-ctrl-btn collab-ctrl-remove';
        removeBtn.title = 'Remove from room';
        removeBtn.textContent = '🚫 Remove';
        removeBtn.addEventListener('click', () => {
          if (confirm(`Remove "${user.displayName}" from the room?`)) {
            sendWs({ type: 'remove-participant', targetUserId: user.userId });
          }
        });

        controls.appendChild(grantBtn);
        controls.appendChild(removeBtn);
      }

      body.appendChild(row);
    });
  }

  // ─── Join Request Toast (Host UI) ──────────────────────────────────────────

  function showJoinRequestToast(socketId, displayName, requestedAt) {
    const container = document.getElementById('join-request-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'join-request-toast';
    toast.dataset.socketId = socketId;
    toast.innerHTML = `
      <div class="join-request-info">
        <span class="join-request-icon">🔔</span>
        <div>
          <strong>${escHtml(displayName)}</strong> wants to join
          <div class="join-request-time">at ${formatTime(requestedAt)}</div>
        </div>
      </div>
      <div class="join-request-btns">
        <button type="button" class="join-approve-btn">Approve</button>
        <button type="button" class="join-reject-btn">Reject</button>
      </div>
    `;

    toast.querySelector('.join-approve-btn').addEventListener('click', () => {
      sendWs({ type: 'approve', socketId });
      toast.remove();
    });

    toast.querySelector('.join-reject-btn').addEventListener('click', () => {
      sendWs({ type: 'reject', socketId });
      toast.remove();
    });

    // Auto-dismiss after 60 seconds (user may have left)
    const autoTimer = setTimeout(() => toast.remove(), 60000);
    toast.querySelector('.join-approve-btn').addEventListener('click', () => clearTimeout(autoTimer));
    toast.querySelector('.join-reject-btn').addEventListener('click', () => clearTimeout(autoTimer));

    container.appendChild(toast);

    // Play a subtle alert (if browser allows)
    try { new Audio('data:audio/wav;base64,//uQRAAAAWMSLwUIYAAsYkXgoQwAEaYLWfkWgAI0wWs/ItAAAGDgYtAgAyN+QWaAAihwMWm4G8QQRDiMcCBcH3Cc+CDv/7xA4Tvh9Rz/y8QADBwMWgQAZG/ILNAARQ4GLTcDeIIIhxGOBAuD7hOfBB3/94gcJ3w+o5/5eIAIAAAVwWgQAVQ2ORaIQwEMAJiDg95G4nQL7mQVWI6GwRcfsZAcsKkJvxgxEjzFUgfHoSQ9Qq7KNwqHwuB13MA4a1q/DmBrHgPcmjiGoh//EwC5nGPEmS4RcfkVKOhJf+WOgoxJclFz3kgn//dBA+ya1GhurNn8zb//9NNutNuhz31f////9vt///z+IdAEAAAK4LQIAKobHItEIYCGAExBwe8jcToF9zIKrEdDYIuP2MgOWFSE34wYiR5iqQPj0JIeoVdlG4VD4XA67mAcNa1fhzA1jwHuTRxDUQ//iYBczjHiTJcIuPyKlHQkv/LHQUYkuSi57yQT//uggfZNajQ3Vmz+Zt//+mm3Wm3Q576v////+32///5/EOgAAADVghQAAAAA==').play().catch(() => {}); } catch(e) {}
  }

  // ─── Intruder Alert (Host UI) ──────────────────────────────────────────────

  function showIntruderAlert(data) {
    const logEl = document.getElementById('collab-intruder-log');
    const entriesEl = document.getElementById('collab-intruder-log-entries');
    if (!logEl || !entriesEl) return;

    logEl.classList.remove('collab-intruder-log-hidden');

    const entry = document.createElement('div');
    entry.className = 'intruder-entry';
    entry.innerHTML = `
      <span class="intruder-icon">🚨</span>
      <span class="intruder-details">
        <strong>${escHtml(data.displayName || 'Unknown')}</strong> (${escHtml(data.userId)})
        — ${escHtml(data.reason)}
        <span class="intruder-time">${formatTime(data.attemptedAt)}</span>
      </span>
    `;
    entriesEl.prepend(entry);

    // Also show a status flash
    showStatus(`🚨 Intruder alert: ${data.displayName || data.userId}`, true);

    // Ensure the panel is open so host sees it
    const panel = document.getElementById('collab-panel');
    if (panel) panel.classList.remove('collab-panel-hidden');
  }

  // ─── Panel Visibility Toggle ───────────────────────────────────────────────

  function toggleParticipantPanel(show) {
    const panel = document.getElementById('collab-panel');
    if (!panel) return;
    if (show === undefined) {
      panel.classList.toggle('collab-panel-hidden');
    } else if (show) {
      panel.classList.remove('collab-panel-hidden');
    } else {
      panel.classList.add('collab-panel-hidden');
    }
    // Update room ID label
    const roomIdLabel = document.getElementById('collab-panel-room-id');
    if (roomIdLabel && collabState.roomId) {
      roomIdLabel.textContent = `Room: ${collabState.roomId}`;
      roomIdLabel.title = 'Click to copy room ID';
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString();
    } catch { return iso; }
  }

  function sendWs(data) {
    if (collabState.ws && collabState.ws.readyState === WebSocket.OPEN) {
      collabState.ws.send(JSON.stringify(data));
    }
  }

  // ─── Status Bar & Editor ───────────────────────────────────────────────────

  function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
  }

  function updateCollabStatus() {
    const collabStatusEl = document.getElementById('collab-status');
    if (!collabState.isActive) {
      collabStatusEl.style.display = 'none';
      return;
    }
    collabStatusEl.style.display = 'inline';
    const roleText = collabState.myPermission || (collabState.role === 'host' ? 'Host' : 'Viewer');
    collabStatusEl.textContent = `Collaborating • ${roleText} • Room: ${collabState.roomId}`;
    collabStatusEl.title = `Display name: ${collabState.displayName || 'Unknown'}`;
    collabStatusEl.style.cursor = 'pointer';
    collabStatusEl.onclick = () => toggleParticipantPanel();
  }

  function updateEditorReadOnly() {
    if (!window.monacoEditor) return;
    const canEdit = !collabState.isActive
      || collabState.myPermission === 'Host'
      || collabState.myPermission === 'Editor';
    window.monacoEditor.updateOptions({ readOnly: !canEdit });
    if (!canEdit) {
      window.monacoEditor.updateOptions({
        readOnlyMessage: { value: 'View-only mode. The host has not granted you edit access.' },
      });
    }
  }

  function notifyCollabStateChange() {
    if (window.editorAPI && typeof window.editorAPI.notifyCollabState === 'function') {
      window.editorAPI.notifyCollabState(collabState.isActive);
    }
  }

  // ─── WebSocket Management ──────────────────────────────────────────────────

  function connectWebSocket() {
    if (collabState.ws && collabState.ws.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(collabState.serverUrl);

      ws.onopen = function () {
        if (collabState.roomId && collabState.displayName) joinRoomViaWebSocket();
      };

      ws.onmessage = function (event) {
        try {
          handleWebSocketMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('[Collab] Failed to parse WS message:', err);
        }
      };

      ws.onerror = function () {
        showStatus('Connection error. Check if server is running.', true);
      };

      ws.onclose = function () {
        collabState.ws = null;
        if (collabState.isActive) {
          setTimeout(connectWebSocket, 2000);
        }
      };

      collabState.ws = ws;
    } catch (err) {
      showStatus('Failed to connect to collaboration server', true);
    }
  }

  function disconnectWebSocket() {
    if (collabState.ws) {
      if (collabState.ws.readyState === WebSocket.OPEN && collabState.roomId) {
        sendWs({ type: 'leave', roomId: collabState.roomId });
      }
      collabState.ws.close();
      collabState.ws = null;
    }
  }

  function joinRoomViaWebSocket() {
    if (!collabState.ws || collabState.ws.readyState !== WebSocket.OPEN) return;
    sendWs({ type: 'join', roomId: collabState.roomId, displayName: collabState.displayName });
  }

  // ─── WebSocket Message Handler ─────────────────────────────────────────────

  function handleWebSocketMessage(message) {
    const { type } = message;

    switch (type) {

      case 'connected':
        if (collabState.roomId && collabState.displayName) joinRoomViaWebSocket();
        break;

      case 'joined': {
        // Server confirmed our join
        const role = message.role; // 'Host' | 'Viewer'
        collabState.myPermission = role;
        collabState.role = role === 'Host' ? 'host' : 'guest';
        updateCollabStatus();
        updateEditorReadOnly();
        showStatus(`Joined room ${collabState.roomId} as ${role}`);
        toggleParticipantPanel(true);
        break;
      }

      case 'waiting':
        showStatus(message.message || 'Waiting for host approval…');
        break;

      case 'join-rejected':
        showStatus(`Join rejected: ${message.reason || 'Host declined your request.'}`, true);
        // Reset collab state
        endCollaboration(true);
        break;

      case 'join-request':
        // Use collabState.role which is set immediately when host starts the session,
        // well before myPermission arrives via the 'joined' message.
        if (collabState.role === 'host') {
          showJoinRequestToast(message.socketId, message.displayName, message.requestedAt);
        }
        break;

      case 'request-expired':
        // Remove stale toast if it's still showing
        {
          const staleToast = document.querySelector(`.join-request-toast[data-socket-id="${message.socketId}"]`);
          if (staleToast) staleToast.remove();
          showStatus('A join request expired (user disconnected).', false);
        }
        break;

      case 'editor-update':
        if (message.content !== undefined && !collabState.isApplyingRemoteUpdate) {
          applyRemoteEditorUpdate(message.content);
        }
        break;

      case 'participants-update':
        collabState.participants = message.users || [];
        renderParticipants(collabState.participants);
        break;

      case 'permission-changed': {
        const newRole = message.role;
        collabState.myPermission = newRole;
        updateEditorReadOnly();
        updateCollabStatus();
        showStatus(`Your permission was changed to: ${newRole}`);
        break;
      }

      case 'removed-from-room':
        showStatus(message.reason || 'You were removed from the room.', true);
        endCollaboration(true);
        break;

      case 'host-left':
        showStatus(message.message || 'Host left. Session ended.', true);
        endCollaboration(true);
        break;

      case 'intruder-alert':
        if (collabState.role === 'host') {
          showIntruderAlert(message);
        }
        break;

      case 'permission-denied':
        showStatus(message.message || 'Permission denied.', true);
        break;

      case 'error':
        showStatus(`Error: ${message.message}`, true);
        break;

      default:
        console.warn('[Collab] Unknown message type:', type);
    }
  }

  // ─── Editor Sync ───────────────────────────────────────────────────────────

  function applyRemoteEditorUpdate(content) {
    if (!window.monacoEditor) return;
    collabState.isApplyingRemoteUpdate = true;
    try {
      const position = window.monacoEditor.getPosition();
      window.monacoEditor.setValue(content || '');
      if (position) {
        const model = window.monacoEditor.getModel();
        if (model && model.getLineCount() >= position.lineNumber) {
          window.monacoEditor.setPosition(position);
        }
      }
    } catch (err) {
      console.error('[Collab] Error applying remote update:', err);
    } finally {
      setTimeout(() => { collabState.isApplyingRemoteUpdate = false; }, 100);
    }
  }

  function setupMonacoCollaboration() {
    if (!window.monacoEditor) return;
    window.monacoEditor.onDidChangeModelContent(function () {
      if (
        collabState.isActive &&
        !collabState.isApplyingRemoteUpdate &&
        collabState.ws &&
        collabState.ws.readyState === WebSocket.OPEN &&
        collabState.roomId
      ) {
        // Only send if we have edit rights (server will also enforce)
        if (collabState.myPermission === 'Host' || collabState.myPermission === 'Editor') {
          sendWs({ type: 'editor-change', roomId: collabState.roomId, content: window.monacoEditor.getValue() });
        }
      }
    });
  }

  // ─── Collaboration Start/End ───────────────────────────────────────────────

  function startCollaborationSession(displayName) {
    const roomId = generateRoomId();
    collabState.isActive = true;
    collabState.role = 'host';
    collabState.myPermission = 'Host'; // set immediately, confirmed by server 'joined' later
    collabState.roomId = roomId;
    collabState.displayName = displayName;

    updateCollabStatus();
    updateEditorReadOnly();
    notifyCollabStateChange();
    connectWebSocket();
    setupMonacoCollaboration();
    showStatus(`Collaboration started! Room ID: ${roomId}`, false);
  }

  function joinCollaborationSession(displayName, roomId) {
    collabState.isActive = true;
    collabState.role = 'guest';
    collabState.myPermission = 'Viewer'; // default until server says otherwise
    collabState.roomId = roomId;
    collabState.displayName = displayName;

    // Lock editor immediately — server will grant edit via permission-changed if host allows
    updateEditorReadOnly();
    updateCollabStatus();
    notifyCollabStateChange();
    connectWebSocket();
    setupMonacoCollaboration();
    showStatus(`Joining room ${roomId}…`);
  }

  function endCollaboration(silent) {
    if (!collabState.isActive) return;

    collabState.isActive = false;
    collabState.role = null;
    collabState.myPermission = null;
    collabState.roomId = null;
    collabState.participants = [];

    disconnectWebSocket();
    updateCollabStatus();
    updateEditorReadOnly();
    notifyCollabStateChange();
    renderParticipants([]);
    toggleParticipantPanel(false);

    // Clear intruder log and join toasts
    const entriesEl = document.getElementById('collab-intruder-log-entries');
    if (entriesEl) entriesEl.innerHTML = '';
    const logEl = document.getElementById('collab-intruder-log');
    if (logEl) logEl.classList.add('collab-intruder-log-hidden');
    const container = document.getElementById('join-request-container');
    if (container) container.innerHTML = '';

    if (!silent) showStatus('Collaboration ended');
  }

  // ─── Collaboration Modal ───────────────────────────────────────────────────

  function initCollaboration() {
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

    if (!joinActionBtn) {
      console.error('[Collab] Join button not found.');
      return;
    }

    function showModal(mode) {
      modalBackdrop.classList.remove('collab-modal-hidden');
      modalBackdrop.setAttribute('aria-hidden', 'false');
      mode === 'join' ? switchToJoinMode() : switchToStartMode();
    }

    function hideModal() {
      modalBackdrop.classList.add('collab-modal-hidden');
      modalBackdrop.setAttribute('aria-hidden', 'true');
      displayNameStartInput.value = '';
      if (roomNameInput) roomNameInput.value = '';
      displayNameJoinInput.value = '';
      roomIdInput.value = '';
    }

    function switchToStartMode() {
      modeTabs.forEach(tab => {
        const active = tab.dataset.mode === 'start';
        tab.classList.toggle('collab-mode-tab-active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      startSection.style.display = 'flex';
      joinSection.style.display = 'none';
      startActionBtn.style.display = 'inline-block';
      joinActionBtn.style.display = 'none';
    }

    function switchToJoinMode() {
      modeTabs.forEach(tab => {
        const active = tab.dataset.mode === 'join';
        tab.classList.toggle('collab-mode-tab-active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      startSection.style.display = 'none';
      joinSection.style.display = 'flex';
      startActionBtn.style.display = 'none';
      joinActionBtn.style.display = 'inline-block';
    }

    function onStartCollaboration() {
      const displayName = displayNameStartInput.value.trim();
      if (!displayName) { showStatus('Please enter a display name', true); return; }
      hideModal();
      startCollaborationSession(displayName);
    }

    function onJoinRoom() {
      const displayName = displayNameJoinInput.value.trim();
      const roomId = roomIdInput.value.trim().toUpperCase();
      if (!displayName) { showStatus('Please enter a display name', true); return; }
      if (!roomId) { showStatus('Please enter a room ID', true); return; }
      if (roomId.length !== 8) { showStatus('Room ID must be 8 characters', true); return; }
      hideModal();
      joinCollaborationSession(displayName, roomId);
    }

    startCollabBtn?.addEventListener('click', () => showModal('start'));
    joinRoomBtn?.addEventListener('click', () => showModal('join'));
    modalCloseBtn?.addEventListener('click', hideModal);
    cancelBtn?.addEventListener('click', hideModal);
    modalBackdrop?.addEventListener('click', e => { if (e.target === modalBackdrop) hideModal(); });

    modeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tab.dataset.mode === 'start' ? switchToStartMode() : switchToJoinMode();
      });
    });

    startActionBtn?.addEventListener('click', onStartCollaboration);
    joinActionBtn?.addEventListener('click', onJoinRoom);

    [displayNameStartInput, roomNameInput, displayNameJoinInput, roomIdInput].forEach(input => {
      input?.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        startSection.style.display !== 'none' ? startActionBtn.click() : joinActionBtn.click();
      });
    });
  }

  initCollaboration();

  if (window.monacoEditor) {
    setupMonacoCollaboration();
  } else {
    window.addEventListener('monaco-ready', setupMonacoCollaboration);
  }

  // ─── File Tree & Editor Plumbing (unchanged from original) ─────────────────

  let currentFolderRoot = null;
  let explorerTreeRoot = null;

  function buildExplorerNode(backendNode, isRoot) {
    const isFolder = backendNode.type === 'folder';
    return {
      name: backendNode.name,
      path: backendNode.path,
      type: backendNode.type,
      expanded: isRoot,
      children: isFolder && Array.isArray(backendNode.children)
        ? backendNode.children.map(child => buildExplorerNode(child, false))
        : [],
    };
  }

  function setExplorerTreeFromBackendTree(backendRoot) {
    if (!backendRoot) {
      explorerTreeRoot = null;
      folderTree.innerHTML = '';
      folderTreeEmpty.hidden = false;
      folderTree.hidden = true;
      return;
    }
    explorerTreeRoot = buildExplorerNode(backendRoot, true);
    renderTree(explorerTreeRoot);
  }

  function renderRecentProjects(paths) {
    recentProjectsList.innerHTML = '';
    if (!paths || paths.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'recent-projects-empty';
      empty.textContent = 'No recent projects';
      recentProjectsList.appendChild(empty);
      return;
    }
    paths.forEach(folderPath => {
      const name = folderPath.replace(/^.*[/\\]/, '') || folderPath;
      const el = document.createElement('div');
      el.className = 'recent-project-item';
      el.dataset.path = folderPath;
      el.textContent = name;
      el.title = folderPath;
      el.addEventListener('click', async () => {
        const result = await window.editorAPI.openRecentProject(folderPath);
        if (result.error) {
          showStatus(result.error, true);
          renderRecentProjects(await window.editorAPI.getRecentProjects());
          return;
        }
        currentFolderRoot = result.tree.path;
        setExplorerTreeFromBackendTree(result.tree);
        renderRecentProjects(await window.editorAPI.getRecentProjects());
      });
      recentProjectsList.appendChild(el);
    });
  }

  function showStatus(text, isError) {
    statusMessage.textContent = text;
    statusMessage.className = 'status-item' + (isError ? ' status-error' : '');
    clearTimeout(showStatus._timer);
    showStatus._timer = setTimeout(() => {
      statusMessage.textContent = '';
      statusMessage.className = 'status-item';
    }, 3000);
  }

  function setActiveFile(filePath) {
    folderTree.querySelectorAll('.tree-file').forEach(el => {
      el.classList.toggle('active', el.dataset.path === filePath);
    });
  }

  function renderTreeNode(node, depth) {
    if (node.type === 'file') {
      const el = document.createElement('div');
      el.className = 'tree-file';
      el.dataset.path = node.path;
      el.style.paddingLeft = (12 + depth * 12) + 'px';
      el.textContent = node.name;
      el.addEventListener('click', async () => {
        const result = await window.editorAPI.readFile(node.path);
        if (result.error) { showStatus('Error: ' + result.error, true); return; }
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
    const icon = document.createElement('span');
    icon.className = 'tree-folder-icon';
    icon.textContent = node.expanded ? '\u25BE' : '\u25B8';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tree-folder-name';
    nameSpan.textContent = node.name;
    label.appendChild(icon);
    label.appendChild(nameSpan);
    label.addEventListener('click', () => { node.expanded = !node.expanded; renderTree(explorerTreeRoot); });
    folder.appendChild(label);
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    childrenContainer.style.display = node.expanded ? '' : 'none';
    (node.children || []).forEach(child => childrenContainer.appendChild(renderTreeNode(child, depth + 1)));
    folder.appendChild(childrenContainer);
    return folder;
  }

  function renderTree(root) {
    folderTree.innerHTML = '';
    if (!root) {
      folderTreeEmpty.hidden = false;
      folderTree.hidden = true;
      return;
    }
    if (root.children && root.children.length) {
      root.children.forEach(child => folderTree.appendChild(renderTreeNode(child, 0)));
    }
    folderTreeEmpty.hidden = true;
    folderTree.hidden = false;
  }

  const sidebarEl = document.querySelector('.sidebar');
  const terminalPanelEl = document.querySelector('.terminal-panel');
  let isExplorerVisible = true;
  let isTerminalVisible = true;

  function toggleExplorerVisibility() {
    if (!sidebarEl) return;
    isExplorerVisible = !isExplorerVisible;
    sidebarEl.style.display = isExplorerVisible ? '' : 'none';
  }

  function toggleTerminalVisibility() {
    if (!terminalPanelEl) return;
    isTerminalVisible = !isTerminalVisible;
    terminalPanelEl.style.display = isTerminalVisible ? '' : 'none';
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
    setExplorerTreeFromBackendTree(tree);
    renderRecentProjects(await window.editorAPI.getRecentProjects());
  });

  if (!newFileBtn) console.error('[initApp] newFileBtn not found');
  newFileBtn?.addEventListener('click', async function () {
    if (!currentFolderRoot) { showStatus('Open a folder first', true); return; }
    const fileName = window.prompt('File name (e.g. script.js):', 'untitled.js');
    if (fileName === null) return;
    const trimmed = fileName.trim();
    if (!trimmed) { showStatus('File name cannot be empty', true); return; }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') {
      showStatus('Invalid file name', true); return;
    }
    const result = await window.editorAPI.createFile(currentFolderRoot, trimmed);
    if (result.error) { showStatus(result.error, true); return; }
    const tree = await window.editorAPI.getFolderTree(currentFolderRoot);
    if (tree) setExplorerTreeFromBackendTree(tree);
    const openResult = await window.editorAPI.readFile(result.filePath);
    if (openResult.error) { showStatus('Created but could not open: ' + openResult.error, true); return; }
    setEditorContent(openResult.content, getLanguageFromPath(result.filePath));
    currentTab.textContent = trimmed;
    currentTab.dataset.filePath = result.filePath;
    setActiveFile(result.filePath);
    showStatus('Created ' + trimmed);
  });

  saveBtn.addEventListener('click', async function () {
    const filePath = currentTab.dataset.filePath;
    if (!filePath) { showStatus('No file open', true); return; }
    const result = await window.editorAPI.saveFile(filePath, getEditorContent());
    result.success ? showStatus('Saved') : showStatus('Error: ' + (result.error || 'Save failed'), true);
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
    if (!filePath) { showStatus('No file open', true); return; }
    const dotIdx = filePath.lastIndexOf('.');
    const ext = dotIdx >= 0 ? filePath.substring(dotIdx).toLowerCase() : '(no extension)';
    if (!['.js', '.py'].includes(ext)) {
      showStatus('Unsupported file type. Supported: .js, .py', true); return;
    }
    const saveResult = await window.editorAPI.saveFile(filePath, getEditorContent());
    if (!saveResult.success) { showStatus('Save failed: ' + (saveResult.error || 'Unknown error'), true); return; }
    const result = await window.editorAPI.runCurrentFile(filePath);
    if (result.error) { showStatus(result.error, true); return; }
    showStatus('Running ' + currentTab.textContent);
  });

  saveAsBtn.addEventListener('click', async function () {
    const result = await window.editorAPI.saveFileAs(getEditorContent());
    if (result.cancelled) return;
    if (result.error) { showStatus('Error: ' + result.error, true); return; }
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
      event.shiftKey ? saveAsBtn.click() : saveBtn.click();
      return;
    }
    if (event.key === 'o') { event.preventDefault(); openFileBtn.click(); }
  });

  if (window.editorAPI && typeof window.editorAPI.onMenuCommand === 'function') {
    window.editorAPI.onMenuCommand(function (command) {
      switch (command) {
        case 'open-file': openFileBtn?.click(); break;
        case 'open-folder': openFolderBtn?.click(); break;
        case 'save': saveBtn?.click(); break;
        case 'save-as': saveAsBtn?.click(); break;
        case 'toggle-explorer': toggleExplorerVisibility(); break;
        case 'toggle-terminal': toggleTerminalVisibility(); break;
        case 'toggle-participants': toggleParticipantPanel(); break;
        case 'collab-start': document.querySelector('.collab-btn-primary')?.click(); break;
        case 'collab-join': document.querySelector('.collab-btn:not(.collab-btn-primary)')?.click(); break;
        case 'collab-end': endCollaboration(false); break;
        default: break;
      }
    });
  }
}

// ─── Injected Styles ───────────────────────────────────────────────────────────

function injectCollabStyles() {
  if (document.getElementById('collab-permission-styles')) return;
  const style = document.createElement('style');
  style.id = 'collab-permission-styles';
  style.textContent = `
    /* ── Participant Panel ── */
    .collab-panel {
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      width: 320px;
      background: #1e1e2e;
      border-left: 1px solid #3a3a5c;
      display: flex;
      flex-direction: column;
      z-index: 1000;
      box-shadow: -4px 0 24px rgba(0,0,0,0.5);
      font-family: 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #cdd6f4;
      transition: transform 0.2s ease;
    }
    .collab-panel-hidden {
      transform: translateX(100%);
      pointer-events: none;
    }
    .collab-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: #181825;
      border-bottom: 1px solid #3a3a5c;
      flex-shrink: 0;
    }
    .collab-panel-title {
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.04em;
      color: #cba6f7;
    }
    .collab-panel-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .collab-panel-room-id {
      font-size: 11px;
      background: #313244;
      border-radius: 4px;
      padding: 2px 8px;
      cursor: pointer;
      color: #89b4fa;
      white-space: nowrap;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .collab-panel-room-id:hover { background: #45475a; }
    .collab-panel-close {
      background: none;
      border: none;
      color: #6c7086;
      font-size: 16px;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    .collab-panel-close:hover { background: #313244; color: #f38ba8; }
    .collab-panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 10px 0;
    }
    .collab-panel-empty {
      color: #6c7086;
      text-align: center;
      margin-top: 32px;
      font-size: 12px;
    }

    /* ── Participant Row ── */
    .collab-participant-row {
      padding: 10px 14px;
      border-bottom: 1px solid #313244;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .collab-participant-row:last-child { border-bottom: none; }
    .collab-participant-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .collab-participant-name {
      flex: 1;
      font-weight: 500;
      color: #cdd6f4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .collab-me-label {
      color: #6c7086;
      font-weight: 400;
      font-size: 11px;
    }
    .role-badge {
      font-size: 10px;
      font-weight: 700;
      border-radius: 4px;
      padding: 2px 7px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      flex-shrink: 0;
    }
    .role-host   { background: #cba6f7; color: #1e1e2e; }
    .role-editor { background: #a6e3a1; color: #1e1e2e; }
    .role-viewer { background: #45475a; color: #cdd6f4; }

    .collab-participant-controls {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .collab-ctrl-btn {
      font-size: 11px;
      padding: 3px 9px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-weight: 500;
      transition: opacity 0.15s;
    }
    .collab-ctrl-btn:hover { opacity: 0.85; }
    .collab-ctrl-edit   { background: #89b4fa; color: #1e1e2e; }
    .collab-ctrl-remove { background: #f38ba8; color: #1e1e2e; }

    /* ── Join Request Toasts ── */
    .join-request-container {
      position: fixed;
      top: 48px;
      right: 16px;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 340px;
    }
    .join-request-toast {
      background: #1e1e2e;
      border: 1px solid #cba6f7;
      border-radius: 8px;
      padding: 12px 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      animation: slideIn 0.2s ease;
      color: #cdd6f4;
      font-family: 'Segoe UI', sans-serif;
      font-size: 13px;
    }
    @keyframes slideIn {
      from { transform: translateX(120%); opacity: 0; }
      to   { transform: translateX(0);   opacity: 1; }
    }
    .join-request-info {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 10px;
    }
    .join-request-icon { font-size: 18px; flex-shrink: 0; }
    .join-request-time { font-size: 11px; color: #6c7086; margin-top: 2px; }
    .join-request-btns { display: flex; gap: 8px; }
    .join-approve-btn, .join-reject-btn {
      flex: 1;
      padding: 5px 0;
      border: none;
      border-radius: 5px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .join-approve-btn { background: #a6e3a1; color: #1e1e2e; }
    .join-reject-btn  { background: #f38ba8; color: #1e1e2e; }
    .join-approve-btn:hover, .join-reject-btn:hover { opacity: 0.85; }

    /* ── Intruder Log ── */
    .collab-intruder-log {
      border-top: 1px solid #f38ba8;
      background: #1e1010;
      padding: 8px 14px;
      flex-shrink: 0;
      max-height: 180px;
      overflow-y: auto;
    }
    .collab-intruder-log-hidden { display: none; }
    .collab-intruder-log-header {
      font-weight: 700;
      font-size: 11px;
      color: #f38ba8;
      margin-bottom: 6px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .intruder-entry {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      font-size: 11px;
      color: #f38ba8;
      margin-bottom: 4px;
      line-height: 1.4;
    }
    .intruder-icon { flex-shrink: 0; }
    .intruder-time {
      display: block;
      color: #6c7086;
      font-size: 10px;
    }
  `;
  document.head.appendChild(style);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    if (window.monacoEditor) {
      initApp();
    } else {
      window.addEventListener('monaco-ready', initApp);
    }
  });
} else {
  if (window.monacoEditor) {
    initApp();
  } else {
    window.addEventListener('monaco-ready', initApp);
  }
}