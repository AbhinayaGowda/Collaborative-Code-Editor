const WebSocket = require('ws');

const PORT = process.argv[2] ? parseInt(process.argv[2], 10) : 8080;

// roomId → Set<ws>
const rooms = new Map();
// ws → { roomId, displayName, role, userId, joinedAt }
const userInfo = new Map();
// socketId → { ws, roomId, displayName, requestedAt }
const waitingUsers = new Map();
// roomId → ws (host socket)
const roomHosts = new Map();
// roomId → Map<ws, { displayName, role, userId, joinedAt }>
const roomUsers = new Map();

// Intruder log: roomId → Array<{ userId, displayName, attemptedAt, reason }>
const intruderLog = new Map();

let nextUserId = 1;

const wss = new WebSocket.Server({ port: PORT });

console.log(`[Collab Server] Starting on port ${PORT}...`);

wss.on('connection', function connection(ws) {
  const userId = `user-${nextUserId++}`;
  ws.userId = userId;

  ws.on('message', function incoming(message) {
    try {
      const data = JSON.parse(message.toString());
      handleMessage(ws, userId, data);
    } catch {
      sendError(ws, 'Invalid message format');
    }
  });

  ws.on('close', function () {
    handleDisconnect(ws, userId);
  });

  ws.send(JSON.stringify({ type: 'connected', userId }));
});

// ─── Message Router ───────────────────────────────────────────────────────────

function handleMessage(ws, userId, data) {
  const { type, roomId, displayName, content, targetUserId, permission } = data;

  switch (type) {
    case 'join':
      handleJoin(ws, userId, roomId, displayName);
      break;
    case 'approve':
      approveUser(ws, data.socketId);
      break;
    case 'reject':
      rejectUser(ws, data.socketId);
      break;
    case 'leave':
      handleLeave(ws);
      break;
    case 'editor-change':
      handleEditorChange(ws, roomId, content);
      break;
    case 'remove-participant':
      handleRemoveParticipant(ws, targetUserId);
      break;
    case 'set-permission':
      handleSetPermission(ws, targetUserId, permission); // 'edit' | 'view'
      break;
    case 'bypass-attempt':
      // Client reports an attempted bypass (e.g. unapproved WS reconnect trick)
      logIntruder(ws, userId, displayName || 'Unknown', 'client-reported bypass');
      break;
    case 'chat-message':
      // Live chat message from any participant inside the room
      handleChatMessage(ws, data);
      break;
    case 'inline-comment':
      // Inline code comment: anchored to a specific line number in the editor
      handleInlineComment(ws, data);
      break;
    case 'inline-comment-reply':
      // Reply to an existing inline comment thread
      handleInlineCommentReply(ws, data);
      break;
    case 'inline-comment-resolve':
      // Host or comment author marks a thread resolved
      handleInlineCommentResolve(ws, data);
      break;
    default:
      console.warn(`[Server] Unknown message type: ${type} from ${userId}`);
  }
}

// ─── Join / Approval Flow ─────────────────────────────────────────────────────

function handleJoin(ws, userId, roomId, displayName) {
  if (!roomId) return sendError(ws, 'roomId is required');

  // ── Room does not exist → this user becomes Host ──
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
    roomUsers.set(roomId, new Map());
    roomHosts.set(roomId, ws);
    intruderLog.set(roomId, []);

    addUserToRoom(ws, roomId, displayName, 'Host', userId);

    ws.send(JSON.stringify({ type: 'joined', role: 'Host' }));
    sendParticipants(roomId);
    return;
  }

  // ── Room exists → send join-request to host ──
  const hostWs = roomHosts.get(roomId);

  // Guard: if room has no connected host, reject immediately
  if (!hostWs || hostWs.readyState !== WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'join-rejected',
      reason: 'Host is currently unavailable. Try again later.',
    }));
    return;
  }

  // Guard: already in room (duplicate join)
  if (userInfo.has(ws)) {
    const info = userInfo.get(ws);
    if (info.roomId === roomId) {
      return; // Silently ignore duplicate join
    }
    // Joining a different room counts as intrusion
    logAndNotifyIntruder(roomId, userId, displayName, 'attempted to join a different room while already connected');
    sendError(ws, 'Already in a different room');
    return;
  }

  // Guard: already waiting
  if (waitingUsers.has(userId)) {
    ws.send(JSON.stringify({ type: 'waiting', message: 'Your request is already pending.' }));
    return;
  }

  waitingUsers.set(userId, {
    ws,
    socketId: userId,
    roomId,
    displayName,
    requestedAt: new Date().toISOString(),
  });

  // Fix 3: clean up waiting entry if viewer disconnects before approval (ghost socket prevention)
  ws.once('close', () => {
    if (waitingUsers.has(userId)) {
      waitingUsers.delete(userId);
      // Notify host the pending request is now void
      if (hostWs.readyState === WebSocket.OPEN) {
        hostWs.send(JSON.stringify({
          type: 'request-expired',
          socketId: userId,
          reason: 'User disconnected while waiting',
        }));
      }
    }
  });

  // Fix 1: delay 300ms so host frontend has time to process its own 'joined'
  // message and set collabState.role = 'host' before receiving join-request
  setTimeout(() => {
    if (hostWs.readyState === WebSocket.OPEN && waitingUsers.has(userId)) {
      hostWs.send(JSON.stringify({
        type: 'join-request',
        socketId: userId,
        displayName,
        requestedAt: new Date().toISOString(),
      }));
    }
  }, 300);

  ws.send(JSON.stringify({ type: 'waiting', message: 'Waiting for host approval…' }));
}

function approveUser(hostWs, requestId) {
  // Verify sender is actually the host of that room
  const hostInfo = userInfo.get(hostWs);
  if (!hostInfo || hostInfo.role !== 'Host') {
    sendError(hostWs, 'Only the host can approve users');
    return;
  }

  const pending = waitingUsers.get(requestId);
  if (!pending) {
    hostWs.send(JSON.stringify({ type: 'request-expired', socketId: requestId }));
    return;
  }

  const { ws, roomId, displayName } = pending;

  // Verify the room matches
  if (roomId !== hostInfo.roomId) {
    logAndNotifyIntruder(hostInfo.roomId, requestId, displayName, 'approved for wrong room — possible intrusion');
    waitingUsers.delete(requestId);
    return;
  }

  // Check socket is still connected
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    hostWs.send(JSON.stringify({
      type: 'request-expired',
      socketId: requestId,
      reason: 'User disconnected before approval',
    }));
    waitingUsers.delete(requestId);
    return;
  }

  addUserToRoom(ws, roomId, displayName, 'Viewer', requestId);

  ws.send(JSON.stringify({ type: 'joined', role: 'Viewer' }));
  // Send existing chat history and inline comments to the newly joined user
  sendSessionHistory(ws, roomId);
  sendParticipants(roomId);
  waitingUsers.delete(requestId);
}

function rejectUser(hostWs, requestId) {
  const hostInfo = userInfo.get(hostWs);
  if (!hostInfo || hostInfo.role !== 'Host') {
    sendError(hostWs, 'Only the host can reject users');
    return;
  }

  const pending = waitingUsers.get(requestId);
  if (!pending) return;

  const { ws, displayName } = pending;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'join-rejected',
      reason: 'The host has declined your request.',
    }));
  }

  waitingUsers.delete(requestId);

  // Notify host the rejection was processed
  hostWs.send(JSON.stringify({
    type: 'request-handled',
    socketId: requestId,
    action: 'rejected',
    displayName,
  }));
}

// ─── Permission Control ───────────────────────────────────────────────────────

function handleSetPermission(hostWs, targetUserId, permission) {
  const hostInfo = userInfo.get(hostWs);
  if (!hostInfo || hostInfo.role !== 'Host') {
    sendError(hostWs, 'Only the host can change permissions');
    return;
  }

  const roomId = hostInfo.roomId;
  // Declare usersInRoom here — was missing previously causing a ReferenceError
  const usersInRoom = roomUsers.get(roomId);
  if (!usersInRoom) return;

  // Find the target ws
  let targetWs = null;
  usersInRoom.forEach((info, ws) => {
    if (info.userId === targetUserId) targetWs = ws;
  });

  if (!targetWs) {
    sendError(hostWs, 'User not found in room');
    return;
  }

  const targetInfo = usersInRoom.get(targetWs);
  if (!targetInfo) return;

  // Cannot change host's own permissions
  if (targetInfo.role === 'Host') {
    sendError(hostWs, 'Cannot change host permissions');
    return;
  }

  const newRole = permission === 'edit' ? 'Editor' : 'Viewer';
  targetInfo.role = newRole;
  // Fix 4: update both userInfo AND roomUsers so participants-update
  // broadcasts the correct role — prevents frontend from re-locking editor
  userInfo.get(targetWs).role = newRole;
  roomUsers.get(roomId).set(targetWs, targetInfo);

  // Notify the affected user
  targetWs.send(JSON.stringify({
    type: 'permission-changed',
    role: newRole,
  }));

  sendParticipants(roomId);
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

// roomId → Array<{ id, userId, displayName, text, sentAt }>
const chatHistory = new Map();

function handleChatMessage(ws, data) {
  const info = userInfo.get(ws);
  // Only participants who are fully inside the room can chat
  if (!info) return;

  const { text } = data;
  if (!text || typeof text !== 'string' || !text.trim()) return;

  const message = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: ws.userId,
    displayName: info.displayName,
    text: text.trim().slice(0, 2000), // hard cap at 2000 chars
    sentAt: new Date().toISOString(),
  };

  // Persist in memory for the session so late joiners can receive history
  if (!chatHistory.has(info.roomId)) chatHistory.set(info.roomId, []);
  const history = chatHistory.get(info.roomId);
  history.push(message);
  // Cap history at 200 messages to avoid unbounded growth
  if (history.length > 200) history.shift();

  // Broadcast to EVERYONE in the room including sender (so sender sees it confirmed)
  broadcastToRoom(info.roomId, null, {
    type: 'chat-message',
    message,
  });
}

// ─── Inline Comments ──────────────────────────────────────────────────────────

// roomId → Map<commentId, { id, userId, displayName, lineNumber, text, createdAt, resolved, replies[] }>
const inlineComments = new Map();

function handleInlineComment(ws, data) {
  const info = userInfo.get(ws);
  if (!info) return;

  const { lineNumber, text } = data;
  if (typeof lineNumber !== 'number' || lineNumber < 1) return;
  if (!text || typeof text !== 'string' || !text.trim()) return;

  const comment = {
    id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: ws.userId,
    displayName: info.displayName,
    lineNumber,
    text: text.trim().slice(0, 1000),
    createdAt: new Date().toISOString(),
    resolved: false,
    replies: [],
  };

  if (!inlineComments.has(info.roomId)) inlineComments.set(info.roomId, new Map());
  inlineComments.get(info.roomId).set(comment.id, comment);

  // Broadcast new comment to all participants including sender
  broadcastToRoom(info.roomId, null, {
    type: 'inline-comment-new',
    comment,
  });
}

function handleInlineCommentReply(ws, data) {
  const info = userInfo.get(ws);
  if (!info) return;

  const { commentId, text } = data;
  if (!commentId || !text || typeof text !== 'string' || !text.trim()) return;

  const roomComments = inlineComments.get(info.roomId);
  if (!roomComments) return;

  const comment = roomComments.get(commentId);
  if (!comment) return;
  if (comment.resolved) {
    // Don't allow replies on resolved threads
    sendError(ws, 'Cannot reply to a resolved comment thread');
    return;
  }

  const reply = {
    id: `rpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: ws.userId,
    displayName: info.displayName,
    text: text.trim().slice(0, 1000),
    sentAt: new Date().toISOString(),
  };

  comment.replies.push(reply);

  broadcastToRoom(info.roomId, null, {
    type: 'inline-comment-reply',
    commentId,
    reply,
  });
}

function handleInlineCommentResolve(ws, data) {
  const info = userInfo.get(ws);
  if (!info) return;

  const { commentId } = data;
  if (!commentId) return;

  const roomComments = inlineComments.get(info.roomId);
  if (!roomComments) return;

  const comment = roomComments.get(commentId);
  if (!comment) return;

  // Only the comment author or the host can resolve
  if (comment.userId !== ws.userId && info.role !== 'Host') {
    sendError(ws, 'Only the comment author or host can resolve this thread');
    return;
  }

  comment.resolved = true;

  broadcastToRoom(info.roomId, null, {
    type: 'inline-comment-resolved',
    commentId,
    resolvedBy: info.displayName,
  });
}

// Send full chat history + inline comments to a newly joined user
function sendSessionHistory(ws, roomId) {
  // Chat history
  const history = chatHistory.get(roomId) || [];
  if (history.length > 0) {
    ws.send(JSON.stringify({ type: 'chat-history', messages: history }));
  }

  // Inline comment dump (only unresolved ones)
  const roomComments = inlineComments.get(roomId);
  if (roomComments && roomComments.size > 0) {
    const comments = [...roomComments.values()].filter(c => !c.resolved);
    if (comments.length > 0) {
      ws.send(JSON.stringify({ type: 'inline-comments-dump', comments }));
    }
  }
}

function handleRemoveParticipant(hostWs, targetUserId) {
  const hostInfo = userInfo.get(hostWs);
  if (!hostInfo || hostInfo.role !== 'Host') {
    sendError(hostWs, 'Only the host can remove participants');
    return;
  }

  const roomId = hostInfo.roomId;
  const usersInRoom = roomUsers.get(roomId);
  if (!usersInRoom) return;
  let targetWs = null;
  usersInRoom.forEach((info, ws) => {
    if (info.userId === targetUserId) targetWs = ws;
  });

  if (!targetWs) {
    sendError(hostWs, 'User not found in room');
    return;
  }

  if (targetWs === hostWs) {
    sendError(hostWs, 'Host cannot remove themselves');
    return;
  }

  // Notify the kicked user
  targetWs.send(JSON.stringify({
    type: 'removed-from-room',
    reason: 'You have been removed from the room by the host.',
  }));

  removeUserFromRoom(targetWs);
  sendParticipants(roomId);
}

// ─── Editor Changes ───────────────────────────────────────────────────────────

function handleEditorChange(ws, roomId, content) {
  const info = userInfo.get(ws);
  if (!info) return;

  // Only Host and Editor roles can broadcast changes
  if (info.role !== 'Host' && info.role !== 'Editor') {
    // Intruder: someone with Viewer role tried to edit
    logAndNotifyIntruder(info.roomId, ws.userId, info.displayName, 'attempted unauthorized editor change');
    ws.send(JSON.stringify({
      type: 'permission-denied',
      message: 'You do not have edit permissions.',
    }));
    return;
  }

  broadcastToRoom(info.roomId, ws, {
    type: 'editor-update',
    content,
    senderId: ws.userId,
  });
}

// ─── Participants ─────────────────────────────────────────────────────────────

function sendParticipants(roomId) {
  const usersInRoom = roomUsers.get(roomId);
  if (!usersInRoom) return;

  const users = [];
  usersInRoom.forEach((info) => {
    users.push({
      userId: info.userId,
      displayName: info.displayName,
      role: info.role,
      joinedAt: info.joinedAt,
    });
  });

  broadcastToRoom(roomId, null, {
    type: 'participants-update',
    users,
    count: users.length,
  });
}

// ─── Leave / Disconnect ───────────────────────────────────────────────────────

function handleLeave(ws) {
  removeUserFromRoom(ws);
}

function handleDisconnect(ws) {
  // Cancel any pending join request
  if (waitingUsers.has(ws.userId)) {
    waitingUsers.delete(ws.userId);
  }
  removeUserFromRoom(ws);
}

// ─── Intruder Detection ───────────────────────────────────────────────────────

function logAndNotifyIntruder(roomId, userId, displayName, reason) {
  const entry = logIntruder(null, userId, displayName, reason);

  const hostWs = roomHosts.get(roomId);
  if (hostWs && hostWs.readyState === WebSocket.OPEN) {
    hostWs.send(JSON.stringify({
      type: 'intruder-alert',
      userId,
      displayName,
      reason,
      attemptedAt: entry.attemptedAt,
    }));
  }
}

function logIntruder(ws, userId, displayName, reason) {
  // Find roomId from ws if available
  let roomId = null;
  if (ws && userInfo.has(ws)) {
    roomId = userInfo.get(ws).roomId;
  }

  const entry = {
    userId,
    displayName: displayName || 'Unknown',
    reason,
    attemptedAt: new Date().toISOString(),
  };

  console.warn(`[INTRUDER] Room:${roomId || 'N/A'} | User:${userId} (${entry.displayName}) | Reason: ${reason} | At: ${entry.attemptedAt}`);

  if (roomId && intruderLog.has(roomId)) {
    intruderLog.get(roomId).push(entry);
  }

  return entry;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addUserToRoom(ws, roomId, displayName, role, userId) {
  const joinedAt = new Date().toISOString();

  rooms.get(roomId).add(ws);

  const info = { displayName, role, userId, joinedAt };
  userInfo.set(ws, { roomId, displayName, role, userId, joinedAt });
  roomUsers.get(roomId).set(ws, info);
}

function removeUserFromRoom(ws) {
  const info = userInfo.get(ws);
  if (!info) return;

  const { roomId, displayName, role } = info;

  rooms.get(roomId)?.delete(ws);
  roomUsers.get(roomId)?.delete(ws);
  userInfo.delete(ws);

  // If the host left, notify all and clean up
  if (role === 'Host') {
    broadcastToRoom(roomId, null, {
      type: 'host-left',
      message: 'The host has left the room. Session ended.',
    });
    rooms.delete(roomId);
    roomUsers.delete(roomId);
    roomHosts.delete(roomId);
    intruderLog.delete(roomId);
    chatHistory.delete(roomId);
    inlineComments.delete(roomId);
    return;
  }

  // Regular participant left — update participants list
  sendParticipants(roomId);
}

function broadcastToRoom(roomId, excludeWs, message) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(message);
  room.forEach(function (client) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function sendError(ws, errorMessage) {
  ws.send(JSON.stringify({ type: 'error', message: errorMessage }));
}