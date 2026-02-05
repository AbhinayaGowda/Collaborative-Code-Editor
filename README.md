# Collaborative Code Editor

An Electron-based collaborative code editor with Monaco Editor and WebSocket-based real-time synchronization.

## Project Structure

### `/frontend`
Client-side application: UI, editor components, and real-time collaboration views. Contains the Electron renderer process code.

### `/backend`
Server-side application: API, authentication, real-time sync (e.g. WebSockets), and persistence. Will handle sessions, document state, and communication between clients.

### `/docs`
Project documentation: architecture decisions, API specs, setup guides, and contribution guidelines.

## Getting Started

### Installation

```bash
npm install
```

### Running the Application

1. **Start the collaboration server** (in a separate terminal):
   ```bash
   npm run collab-server
   ```
   Or directly:
   ```bash
   node collab-server.js
   ```
   The server runs on `ws://localhost:8080` by default.

2. **Start the Electron app**:
   ```bash
   npm start
   ```

### Collaboration Features

- **Start Collaboration**: Creates a new room with a random 8-character room ID
- **Join Room**: Join an existing room using a room ID
- **Real-time Sync**: Editor changes are synchronized across all participants in real-time
- **Role-based Editing**: Hosts can edit, guests are read-only (configurable)

### Architecture

- **Client**: Electron renderer process with Monaco Editor
- **Server**: Separate Node.js WebSocket server (`collab-server.js`)
- **Protocol**: Simple JSON messages over WebSocket
- **Sync Strategy**: Full document replacement (minimal implementation, ready for CRDT upgrade)
