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

  // ─── Chat Box ──────────────────────────────────────────────────────────────
  // A floating panel docked to the bottom-right (above the status bar).
  // Visible only when a collaboration session is active.

  function injectChatBox() {
    if (document.getElementById('collab-chat')) return;

    const chat = document.createElement('div');
    chat.id = 'collab-chat';
    chat.className = 'collab-chat collab-chat-hidden';
    chat.setAttribute('aria-label', 'Collaboration Chat');
    chat.innerHTML = `
      <div class="chat-header" id="chat-header">
        <span class="chat-title">💬 Room Chat</span>
        <div class="chat-header-actions">
          <span class="chat-unread-badge" id="chat-unread-badge" hidden>0</span>
          <button type="button" class="chat-toggle-btn" id="chat-toggle-btn" title="Minimise chat">─</button>
          <button type="button" class="chat-close-btn" id="chat-close-btn" title="Close chat">✕</button>
        </div>
      </div>
      <div class="chat-body" id="chat-body">
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-row">
          <textarea
            id="chat-input"
            class="chat-input"
            rows="1"
            placeholder="Message the room… (Enter to send)"
            maxlength="2000"
            autocomplete="off"
            spellcheck="true"
          ></textarea>
          <button type="button" class="chat-send-btn" id="chat-send-btn" title="Send">➤</button>
        </div>
      </div>
    `;
    document.body.appendChild(chat);

    // ── Toggle minimise ──
    let chatMinimised = false;
    const chatBody = chat.querySelector('#chat-body');
    const toggleBtn = chat.querySelector('#chat-toggle-btn');
    toggleBtn.addEventListener('click', () => {
      chatMinimised = !chatMinimised;
      chatBody.style.display = chatMinimised ? 'none' : '';
      toggleBtn.textContent = chatMinimised ? '▲' : '─';
      if (!chatMinimised) clearUnreadBadge();
    });

    // ── Close hides the chat (doesn't end session) ──
    chat.querySelector('#chat-close-btn').addEventListener('click', () => {
      chat.classList.add('collab-chat-hidden');
    });

    // ── Send message ──
    const chatInput = chat.querySelector('#chat-input');
    const sendBtn = chat.querySelector('#chat-send-btn');

    function sendChatMessage() {
      if (!collabState.isActive) return;
      const text = chatInput.value.trim();
      if (!text) return;
      sendWs({ type: 'chat-message', text });
      chatInput.value = '';
      chatInput.style.height = 'auto';
    }

    sendBtn.addEventListener('click', sendChatMessage);

    // Enter sends, Shift+Enter inserts newline
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    // Auto-grow textarea up to 5 lines
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
    });
  }

  // Unread badge — shown when chat is minimised and new messages arrive
  let unreadCount = 0;
  function clearUnreadBadge() {
    unreadCount = 0;
    const badge = document.getElementById('chat-unread-badge');
    if (badge) { badge.textContent = '0'; badge.hidden = true; }
  }
  function incrementUnreadBadge() {
    unreadCount++;
    const badge = document.getElementById('chat-unread-badge');
    if (badge) { badge.textContent = unreadCount; badge.hidden = false; }
  }

  // Append a single chat message bubble to the messages list
  function appendChatMessage(msg, isHistory) {
    const messagesEl = document.getElementById('chat-messages');
    if (!messagesEl) return;

    const isMe = msg.userId === undefined
      ? msg.displayName === collabState.displayName  // fallback for history
      : msg.displayName === collabState.displayName;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isMe ? 'chat-bubble-me' : 'chat-bubble-them'}`;
    bubble.dataset.msgId = msg.id;

    bubble.innerHTML = `
      ${!isMe ? `<span class="chat-sender">${escHtml(msg.displayName)}</span>` : ''}
      <div class="chat-text">${escHtml(msg.text)}</div>
      <span class="chat-time">${formatTime(msg.sentAt)}</span>
    `;

    messagesEl.appendChild(bubble);

    // Auto-scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // If not history and chat is minimised → show unread badge
    const chatEl = document.getElementById('collab-chat');
    const chatBody = document.getElementById('chat-body');
    if (!isHistory && chatBody && chatBody.style.display === 'none') {
      incrementUnreadBadge();
    }
    // If chat is hidden entirely (closed), re-show it with a badge
    if (!isHistory && chatEl && chatEl.classList.contains('collab-chat-hidden')) {
      chatEl.classList.remove('collab-chat-hidden');
      incrementUnreadBadge();
    }
  }

  // Show/hide the chat box when collab starts/ends
  function setChatVisible(visible) {
    const chatEl = document.getElementById('collab-chat');
    if (!chatEl) return;
    if (visible) {
      chatEl.classList.remove('collab-chat-hidden');
      clearUnreadBadge();
    } else {
      chatEl.classList.add('collab-chat-hidden');
      // Clear messages on session end
      const msgs = document.getElementById('chat-messages');
      if (msgs) msgs.innerHTML = '';
    }
  }

  // ─── Inline Comments ───────────────────────────────────────────────────────
  // Anchor small floating popover-style threads to editor line numbers.
  // Uses Monaco's ViewZone API so the thread appears inline below the
  // commented line without overlapping the code.

  // commentId → { domNode, viewZoneId, data }
  const inlineCommentWidgets = new Map();

  function injectInlineCommentStyles() {
    // Styles are included in the main injectCollabStyles() call below
  }

  // Render the full HTML for a comment thread
  function buildCommentThreadHTML(comment) {
    const repliesHTML = (comment.replies || []).map(r => `
      <div class="ic-reply">
        <span class="ic-reply-author">${escHtml(r.displayName)}</span>
        <span class="ic-reply-text">${escHtml(r.text)}</span>
        <span class="ic-reply-time">${formatTime(r.sentAt)}</span>
      </div>
    `).join('');

    const canResolve = collabState.role === 'host' || comment.userId === collabState.displayName;
    const resolvedCls = comment.resolved ? ' ic-resolved' : '';

    return `
      <div class="ic-thread${resolvedCls}" data-comment-id="${escHtml(comment.id)}">
        <div class="ic-thread-header">
          <span class="ic-line-label">Line ${comment.lineNumber}</span>
          <span class="ic-author">${escHtml(comment.displayName)}</span>
          <span class="ic-time">${formatTime(comment.createdAt)}</span>
          <div class="ic-thread-actions">
            ${canResolve && !comment.resolved
              ? `<button class="ic-resolve-btn" data-comment-id="${escHtml(comment.id)}" title="Mark resolved">✔ Resolve</button>`
              : ''}
            <button class="ic-collapse-btn" title="Collapse">▲</button>
          </div>
        </div>
        <div class="ic-body">
          <div class="ic-root-text">${escHtml(comment.text)}</div>
          <div class="ic-replies" id="ic-replies-${escHtml(comment.id)}">${repliesHTML}</div>
          ${!comment.resolved ? `
            <div class="ic-reply-row">
              <textarea class="ic-reply-input" placeholder="Reply…" rows="1" maxlength="1000" data-comment-id="${escHtml(comment.id)}"></textarea>
              <button class="ic-reply-send-btn" data-comment-id="${escHtml(comment.id)}" title="Send reply">➤</button>
            </div>
          ` : '<div class="ic-resolved-label">✔ Resolved</div>'}
        </div>
      </div>
    `;
  }

  // Wire up event handlers inside a rendered comment widget DOM node
  function wireCommentWidgetEvents(domNode, comment) {
    // Collapse / expand toggle
    const collapseBtn = domNode.querySelector('.ic-collapse-btn');
    const body = domNode.querySelector('.ic-body');
    if (collapseBtn && body) {
      collapseBtn.addEventListener('click', () => {
        const collapsed = body.style.display === 'none';
        body.style.display = collapsed ? '' : 'none';
        collapseBtn.textContent = collapsed ? '▲' : '▼';
      });
    }

    // Resolve button
    const resolveBtn = domNode.querySelector('.ic-resolve-btn');
    if (resolveBtn) {
      resolveBtn.addEventListener('click', () => {
        sendWs({ type: 'inline-comment-resolve', commentId: comment.id });
      });
    }

    // Reply send button
    const replyBtn = domNode.querySelector('.ic-reply-send-btn');
    if (replyBtn) {
      replyBtn.addEventListener('click', () => {
        const input = domNode.querySelector(`.ic-reply-input[data-comment-id="${comment.id}"]`);
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        sendWs({ type: 'inline-comment-reply', commentId: comment.id, text });
        input.value = '';
      });
    }

    // Enter in reply textarea sends (Shift+Enter = newline)
    const replyInput = domNode.querySelector('.ic-reply-input');
    if (replyInput) {
      replyInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          domNode.querySelector('.ic-reply-send-btn')?.click();
        }
      });
    }
  }

  // Add a new inline comment as a Monaco ViewZone below the target line
  function addInlineCommentWidget(comment) {
    if (!window.monacoEditor) return;
    if (inlineCommentWidgets.has(comment.id)) return; // already rendered

    const editor = window.monacoEditor;

    const domNode = document.createElement('div');
    domNode.className = 'ic-widget';
    domNode.innerHTML = buildCommentThreadHTML(comment);
    wireCommentWidgetEvents(domNode, comment);

    // Add a gutter decoration (colored marker on the line number margin)
    const decorations = editor.deltaDecorations([], [{
      range: new monaco.Range(comment.lineNumber, 1, comment.lineNumber, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: 'ic-gutter-icon',
        glyphMarginHoverMessage: { value: `💬 Comment by ${comment.displayName}` },
      },
    }]);

    // Insert as a ViewZone so the widget pushes code down (doesn't overlap)
    let viewZoneId = null;
    editor.changeViewZones(accessor => {
      viewZoneId = accessor.addZone({
        afterLineNumber: comment.lineNumber,
        heightInLines: Math.max(3, 2 + (comment.replies || []).length),
        domNode,
        suppressMouseDown: false,
      });
    });

    inlineCommentWidgets.set(comment.id, { domNode, viewZoneId, decorationIds: decorations, data: comment });
  }

  // Append a reply to an existing inline comment widget
  function appendCommentReply(commentId, reply) {
    const widget = inlineCommentWidgets.get(commentId);
    if (!widget) return;

    const repliesEl = widget.domNode.querySelector(`#ic-replies-${commentId}`);
    if (!repliesEl) return;

    const replyEl = document.createElement('div');
    replyEl.className = 'ic-reply';
    replyEl.innerHTML = `
      <span class="ic-reply-author">${escHtml(reply.displayName)}</span>
      <span class="ic-reply-text">${escHtml(reply.text)}</span>
      <span class="ic-reply-time">${formatTime(reply.sentAt)}</span>
    `;
    repliesEl.appendChild(replyEl);

    // Grow the view zone by one line for the new reply
    widget.data.replies = widget.data.replies || [];
    widget.data.replies.push(reply);
    if (window.monacoEditor) {
      window.monacoEditor.changeViewZones(accessor => {
        accessor.layoutZone(widget.viewZoneId);
      });
    }
  }

  // Mark a comment thread as resolved — grey it out in the widget
  function resolveInlineCommentWidget(commentId, resolvedBy) {
    const widget = inlineCommentWidgets.get(commentId);
    if (!widget) return;

    widget.data.resolved = true;
    const thread = widget.domNode.querySelector('.ic-thread');
    if (thread) thread.classList.add('ic-resolved');

    // Replace reply row with resolved label
    const replyRow = widget.domNode.querySelector('.ic-reply-row');
    if (replyRow) replyRow.outerHTML = `<div class="ic-resolved-label">✔ Resolved by ${escHtml(resolvedBy)}</div>`;

    // Remove resolve button
    widget.domNode.querySelector('.ic-resolve-btn')?.remove();
  }

  // Clear all inline comment widgets from the editor (called on session end)
  function clearAllInlineComments() {
    if (!window.monacoEditor) return;
    window.monacoEditor.changeViewZones(accessor => {
      inlineCommentWidgets.forEach(({ viewZoneId, decorationIds }) => {
        accessor.removeZone(viewZoneId);
        if (decorationIds) window.monacoEditor.deltaDecorations(decorationIds, []);
      });
    });
    inlineCommentWidgets.clear();
  }

  // Add a new inline comment from THIS user triggered by clicking the gutter icon
  // or pressing a keyboard shortcut (Ctrl+Alt+M)
  function promptNewInlineComment(lineNumber) {
    if (!collabState.isActive) {
      showStatus('Start a collaboration session first', true);
      return;
    }

    // Show a small inline prompt widget at that line
    const editor = window.monacoEditor;
    if (!editor) return;

    // Prevent duplicate prompt at same line
    const existingPromptId = `prompt-${lineNumber}`;
    if (inlineCommentWidgets.has(existingPromptId)) return;

    const promptDom = document.createElement('div');
    promptDom.className = 'ic-widget ic-prompt';
    promptDom.innerHTML = `
      <div class="ic-prompt-inner">
        <span class="ic-line-label">Line ${lineNumber}</span>
        <textarea class="ic-prompt-input" rows="2" placeholder="Add a comment on line ${lineNumber}…" maxlength="1000" autofocus></textarea>
        <div class="ic-prompt-btns">
          <button class="ic-prompt-submit" title="Post comment">Post</button>
          <button class="ic-prompt-cancel" title="Cancel">Cancel</button>
        </div>
      </div>
    `;

    let promptZoneId = null;
    editor.changeViewZones(accessor => {
      promptZoneId = accessor.addZone({
        afterLineNumber: lineNumber,
        heightInLines: 4,
        domNode: promptDom,
        suppressMouseDown: false,
      });
    });

    inlineCommentWidgets.set(existingPromptId, { domNode: promptDom, viewZoneId: promptZoneId, data: { lineNumber } });

    // Focus the textarea after the zone renders
    setTimeout(() => promptDom.querySelector('.ic-prompt-input')?.focus(), 50);

    promptDom.querySelector('.ic-prompt-submit').addEventListener('click', () => {
      const text = promptDom.querySelector('.ic-prompt-input').value.trim();
      if (!text) return;
      sendWs({ type: 'inline-comment', lineNumber, text });
      // Remove the prompt zone
      editor.changeViewZones(accessor => accessor.removeZone(promptZoneId));
      inlineCommentWidgets.delete(existingPromptId);
    });

    promptDom.querySelector('.ic-prompt-cancel').addEventListener('click', () => {
      editor.changeViewZones(accessor => accessor.removeZone(promptZoneId));
      inlineCommentWidgets.delete(existingPromptId);
    });

    promptDom.querySelector('.ic-prompt-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        promptDom.querySelector('.ic-prompt-submit').click();
      }
      if (e.key === 'Escape') {
        promptDom.querySelector('.ic-prompt-cancel').click();
      }
    });
  }

  // Wire the gutter click: clicking the glyph margin on any line opens the comment prompt
  function setupInlineCommentGutterClick() {
    if (!window.monacoEditor) return;
    window.monacoEditor.onMouseDown(e => {
      // GUTTER_GLYPH_MARGIN = 2
      if (e.target.type !== 2) return;
      if (!collabState.isActive) return;
      const lineNumber = e.target.position?.lineNumber;
      if (lineNumber) promptNewInlineComment(lineNumber);
    });

    // Also support Ctrl+Alt+M shortcut to add comment on current cursor line
    window.monacoEditor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM,
      () => {
        if (!collabState.isActive) return;
        const line = window.monacoEditor.getPosition()?.lineNumber;
        if (line) promptNewInlineComment(line);
      }
    );
  }

  injectPermissionPanel();
  injectJoinRequestToast();
  injectChatBox();
  injectInlineCommentStyles();

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
          sendWs({
            type: 'set-permission',
            roomId: collabState.roomId,
            targetUserId: user.userId,
            permission: newPerm,
          });
        });

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'collab-ctrl-btn collab-ctrl-remove';
        removeBtn.title = 'Remove from room';
        removeBtn.textContent = '🚫 Remove';
        removeBtn.addEventListener('click', () => {
          if (confirm(`Remove "${user.displayName}" from the room?`)) {
            sendWs({
              type: 'remove-participant',
              roomId: collabState.roomId,
              targetUserId: user.userId,
            });
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

      // ── Chat ──────────────────────────────────────────────────────────────
      case 'chat-message':
        // A single new message broadcast to everyone in the room
        appendChatMessage(message.message, false);
        break;

      case 'chat-history':
        // Full history delivered to a newly joined participant
        (message.messages || []).forEach(m => appendChatMessage(m, true));
        break;

      // ── Inline Comments ───────────────────────────────────────────────────
      case 'inline-comment-new':
        // A new comment was added anchored to a line number
        addInlineCommentWidget(message.comment);
        break;

      case 'inline-comment-reply':
        // A reply was added to an existing comment thread
        appendCommentReply(message.commentId, message.reply);
        break;

      case 'inline-comment-resolved':
        // A thread was resolved — collapse/grey it in the editor
        resolveInlineCommentWidget(message.commentId, message.resolvedBy);
        break;

      case 'inline-comments-dump':
        // Full set of open comments sent to a newly joined participant
        (message.comments || []).forEach(c => addInlineCommentWidget(c));
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
    setupInlineCommentGutterClick();
    setChatVisible(true);
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
    setupInlineCommentGutterClick();
    setChatVisible(true);
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
    setChatVisible(false);
    clearAllInlineComments();

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
    setupInlineCommentGutterClick();
  } else {
    window.addEventListener('monaco-ready', () => {
      setupMonacoCollaboration();
      setupInlineCommentGutterClick();
    });
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

    /* ════════════════════════════════════════════════
       Chat Box
    ════════════════════════════════════════════════ */
    .collab-chat {
      position: fixed;
      bottom: 28px; /* sit just above the status bar */
      right: 16px;
      width: 300px;
      max-height: 420px;
      background: #1e1e2e;
      border: 1px solid #3a3a5c;
      border-radius: 10px;
      box-shadow: 0 6px 28px rgba(0,0,0,0.55);
      display: flex;
      flex-direction: column;
      z-index: 1100;
      font-family: 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #cdd6f4;
      transition: transform 0.2s ease, opacity 0.2s ease;
      overflow: hidden;
    }
    .collab-chat-hidden {
      transform: translateY(20px);
      opacity: 0;
      pointer-events: none;
    }
    .chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 12px;
      background: #181825;
      border-bottom: 1px solid #313244;
      cursor: default;
      flex-shrink: 0;
      user-select: none;
    }
    .chat-title {
      font-weight: 700;
      font-size: 12px;
      color: #89b4fa;
      letter-spacing: 0.04em;
    }
    .chat-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .chat-unread-badge {
      background: #f38ba8;
      color: #1e1e2e;
      font-size: 10px;
      font-weight: 700;
      border-radius: 999px;
      padding: 1px 6px;
      min-width: 18px;
      text-align: center;
    }
    .chat-toggle-btn, .chat-close-btn {
      background: none;
      border: none;
      color: #6c7086;
      cursor: pointer;
      font-size: 13px;
      padding: 2px 5px;
      border-radius: 4px;
      line-height: 1;
    }
    .chat-toggle-btn:hover, .chat-close-btn:hover {
      background: #313244;
      color: #cdd6f4;
    }
    .chat-body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px 10px 4px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 100px;
      max-height: 290px;
    }
    .chat-bubble {
      max-width: 88%;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .chat-bubble-me {
      align-self: flex-end;
      align-items: flex-end;
    }
    .chat-bubble-them {
      align-self: flex-start;
      align-items: flex-start;
    }
    .chat-sender {
      font-size: 10px;
      color: #89b4fa;
      font-weight: 600;
      margin-bottom: 1px;
    }
    .chat-text {
      background: #313244;
      border-radius: 10px;
      padding: 6px 10px;
      line-height: 1.45;
      word-break: break-word;
      white-space: pre-wrap;
      font-size: 12.5px;
    }
    .chat-bubble-me .chat-text {
      background: #4c7899;
      color: #e0f0ff;
      border-bottom-right-radius: 3px;
    }
    .chat-bubble-them .chat-text {
      border-bottom-left-radius: 3px;
    }
    .chat-time {
      font-size: 10px;
      color: #45475a;
      margin-top: 1px;
    }
    .chat-input-row {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      padding: 8px 10px;
      border-top: 1px solid #313244;
      flex-shrink: 0;
    }
    .chat-input {
      flex: 1;
      background: #313244;
      border: 1px solid #45475a;
      border-radius: 8px;
      color: #cdd6f4;
      font-family: inherit;
      font-size: 12px;
      padding: 6px 10px;
      resize: none;
      outline: none;
      line-height: 1.4;
      max-height: 100px;
      overflow-y: auto;
    }
    .chat-input:focus { border-color: #89b4fa; }
    .chat-send-btn {
      background: #89b4fa;
      color: #1e1e2e;
      border: none;
      border-radius: 8px;
      width: 32px;
      height: 32px;
      cursor: pointer;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: opacity 0.15s;
    }
    .chat-send-btn:hover { opacity: 0.85; }

    /* ════════════════════════════════════════════════
       Inline Comment Widgets
    ════════════════════════════════════════════════ */
    .ic-widget {
      font-family: 'Segoe UI', sans-serif;
      font-size: 12px;
      color: #cdd6f4;
      background: transparent;
      padding: 2px 8px;
      box-sizing: border-box;
      width: 100%;
    }
    .ic-thread {
      background: #1e1e2e;
      border: 1px solid #89b4fa;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 12px rgba(0,0,0,0.4);
      margin: 2px 0 4px;
      transition: border-color 0.2s;
    }
    .ic-thread.ic-resolved {
      border-color: #45475a;
      opacity: 0.7;
    }
    .ic-thread-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: #181825;
      border-bottom: 1px solid #313244;
      flex-wrap: wrap;
    }
    .ic-line-label {
      font-size: 10px;
      background: #313244;
      border-radius: 3px;
      padding: 1px 6px;
      color: #89b4fa;
      font-weight: 700;
      flex-shrink: 0;
    }
    .ic-author {
      font-weight: 600;
      font-size: 11px;
      color: #cba6f7;
      flex: 1;
    }
    .ic-time {
      font-size: 10px;
      color: #45475a;
    }
    .ic-thread-actions {
      display: flex;
      gap: 4px;
      align-items: center;
      margin-left: auto;
    }
    .ic-resolve-btn, .ic-collapse-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 11px;
      color: #6c7086;
      padding: 1px 5px;
      border-radius: 3px;
    }
    .ic-resolve-btn:hover { color: #a6e3a1; background: #1e2b1e; }
    .ic-collapse-btn:hover { color: #cdd6f4; background: #313244; }
    .ic-body {
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .ic-root-text {
      color: #cdd6f4;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .ic-replies {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-left: 8px;
      border-left: 2px solid #313244;
    }
    .ic-reply {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .ic-reply-author {
      font-size: 10px;
      font-weight: 700;
      color: #89b4fa;
    }
    .ic-reply-text {
      font-size: 12px;
      color: #cdd6f4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .ic-reply-time {
      font-size: 10px;
      color: #45475a;
    }
    .ic-reply-row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
    }
    .ic-reply-input {
      flex: 1;
      background: #313244;
      border: 1px solid #45475a;
      border-radius: 6px;
      color: #cdd6f4;
      font-family: inherit;
      font-size: 11px;
      padding: 4px 8px;
      resize: none;
      outline: none;
    }
    .ic-reply-input:focus { border-color: #89b4fa; }
    .ic-reply-send-btn {
      background: #89b4fa;
      color: #1e1e2e;
      border: none;
      border-radius: 6px;
      width: 26px;
      height: 26px;
      font-size: 11px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .ic-resolved-label {
      font-size: 11px;
      color: #a6e3a1;
      font-weight: 600;
    }
    /* Inline comment prompt widget */
    .ic-prompt { padding: 4px 8px; }
    .ic-prompt-inner {
      background: #1e1e2e;
      border: 1px dashed #cba6f7;
      border-radius: 8px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .ic-prompt-input {
      background: #313244;
      border: 1px solid #45475a;
      border-radius: 6px;
      color: #cdd6f4;
      font-family: inherit;
      font-size: 12px;
      padding: 5px 8px;
      resize: none;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }
    .ic-prompt-input:focus { border-color: #cba6f7; }
    .ic-prompt-btns { display: flex; gap: 6px; }
    .ic-prompt-submit {
      background: #cba6f7;
      color: #1e1e2e;
      border: none;
      border-radius: 5px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
    }
    .ic-prompt-cancel {
      background: #45475a;
      color: #cdd6f4;
      border: none;
      border-radius: 5px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
    }
    /* Gutter icon shown in the Monaco line number margin */
    .ic-gutter-icon {
      background: #cba6f7;
      width: 6px !important;
      border-radius: 3px;
      cursor: pointer;
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