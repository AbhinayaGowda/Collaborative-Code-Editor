/**
 * Collaboration WebSocket Server
 * 
 * Handles room-based collaboration for the Electron code editor.
 * Runs as a separate Node.js server (not integrated into Electron main process).
 * 
 * Usage: node collab-server.js [port]
 * Default port: 8080
 */

const WebSocket = require('ws');

const PORT = process.argv[2] ? parseInt(process.argv[2], 10) : 8080;

// Room management: roomId -> Set of WebSocket connections
const rooms = new Map();

// User info: WebSocket -> { roomId, displayName, userId }
const userInfo = new Map();

// Generate unique user ID for each connection
let nextUserId = 1;

const wss = new WebSocket.Server({ port: PORT });

console.log(`[Collab Server] Starting on port ${PORT}...`);

wss.on('connection', function connection(ws) {
  const userId = `user-${nextUserId++}`;
  console.log(`[Collab Server] Client connected: ${userId}`);

  ws.on('message', function incoming(message) {
    try {
      const data = JSON.parse(message.toString());
      handleMessage(ws, userId, data);
    } catch (error) {
      console.error(`[Collab Server] Invalid message from ${userId}:`, error.message);
      sendError(ws, 'Invalid message format');
    }
  });

  ws.on('close', function() {
    handleDisconnect(ws, userId);
  });

  ws.on('error', function(error) {
    console.error(`[Collab Server] WebSocket error for ${userId}:`, error.message);
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    userId: userId
  }));
});

function handleMessage(ws, userId, data) {
  const { type, roomId, displayName, content } = data;

  switch (type) {
    case 'join':
      handleJoin(ws, userId, roomId, displayName);
      break;

    case 'leave':
      handleLeave(ws, userId);
      break;

    case 'editor-change':
      handleEditorChange(ws, userId, roomId, content);
      break;

    default:
      console.warn(`[Collab Server] Unknown message type: ${type}`);
      sendError(ws, `Unknown message type: ${type}`);
  }
}

function handleJoin(ws, userId, roomId, displayName) {
  if (!roomId || typeof roomId !== 'string') {
    sendError(ws, 'Invalid roomId');
    return;
  }

  // Leave previous room if any
  handleLeave(ws, userId);

  // Add to room
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  rooms.get(roomId).add(ws);

  // Store user info
  userInfo.set(ws, { roomId, displayName: displayName || userId, userId });

  console.log(`[Collab Server] ${userId} (${displayName || userId}) joined room: ${roomId}`);

  // Notify user of successful join
  ws.send(JSON.stringify({
    type: 'joined',
    roomId: roomId,
    displayName: displayName || userId
  }));

  // Broadcast user joined to others in room
  broadcastToRoom(roomId, ws, {
    type: 'user-joined',
    userId: userId,
    displayName: displayName || userId
  });
}

function handleLeave(ws, userId) {
  const info = userInfo.get(ws);
  if (!info) return;

  const { roomId, displayName } = info;

  // Remove from room
  const room = rooms.get(roomId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) {
      rooms.delete(roomId);
      console.log(`[Collab Server] Room ${roomId} deleted (empty)`);
    }
  }

  // Remove user info
  userInfo.delete(ws);

  console.log(`[Collab Server] ${userId} (${displayName}) left room: ${roomId}`);

  // Broadcast user left to others in room
  if (room && room.size > 0) {
    broadcastToRoom(roomId, null, {
      type: 'user-left',
      userId: userId,
      displayName: displayName
    });
  }
}

function handleEditorChange(ws, userId, roomId, content) {
  const info = userInfo.get(ws);
  if (!info || info.roomId !== roomId) {
    sendError(ws, 'Not in room');
    return;
  }

  // Broadcast to all other clients in the room
  broadcastToRoom(roomId, ws, {
    type: 'editor-update',
    userId: userId,
    displayName: info.displayName,
    content: content
  });
}

function handleDisconnect(ws, userId) {
  console.log(`[Collab Server] Client disconnected: ${userId}`);
  handleLeave(ws, userId);
}

function broadcastToRoom(roomId, excludeWs, message) {
  const room = rooms.get(roomId);
  if (!room) return;

  const messageStr = JSON.stringify(message);
  let sentCount = 0;

  room.forEach(function(client) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
      sentCount++;
    }
  });

  if (sentCount > 0) {
    console.log(`[Collab Server] Broadcast to ${sentCount} client(s) in room ${roomId}: ${message.type}`);
  }
}

function sendError(ws, errorMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'error',
      message: errorMessage
    }));
  }
}

// Graceful shutdown
process.on('SIGINT', function() {
  console.log('\n[Collab Server] Shutting down...');
  wss.close(function() {
    console.log('[Collab Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', function() {
  console.log('\n[Collab Server] Shutting down...');
  wss.close(function() {
    console.log('[Collab Server] Server closed');
    process.exit(0);
  });
});
