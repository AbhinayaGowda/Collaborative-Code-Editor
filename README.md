# Collaborative Code Editor

A professional, minimal Electron-based collaborative code editor featuring a VS Code-inspired UI, high-performance editor integration, and a comprehensive real-time collaboration suite.

## 🚀 Key Features

### 🖥️ Professional & Minimal UI
- **VS Code Aesthetic**: A clean, distraction-free layout with a focus on code.
- **Native Menu Bar**: Full integration with the OS native menu bar for File, Edit, View, and Collaboration actions.
- **Dynamic Panels**: Collapsible Sidebar Explorer and Bottom Terminal for managing projects and running code.
- **Real-time Status Bar**: Live indicators for file encoding, language, cursor position, and collaboration status.

### 🤝 Real-time Collaboration Suite
- **Room-Based Sessions**: Start or join rooms instantly using unique 8-character Room IDs.
- **Live Cursor Presence**: See exactly where your teammates are working with colored cursor markers and floating username labels.
- **Threaded Inline Comments**: Add, reply to, and resolve comments anchored directly to specific lines of code.
- **Integrated Chat**: Real-time room chat for seamless team communication.
- **Participant Management**: 
    - **Role Control**: Hosts can promote/demote users between **Host**, **Editor**, and **Viewer** roles.
    - **Access Control**: Host approval workflow for new participants.
    - **Security**: Live intruder detection and logging for unauthorized access attempts.

### ⌨️ Core Editor Functionality
- **Monaco Editor Integration**: Powers the core editing experience with syntax highlighting, IntelliSense, and professional formatting.
- **Project Management**: Open individual files or entire folders to browse and edit.
- **Code Execution**: Run your current file directly from the editor and view output in the integrated terminal.

## 📁 Project Structure

### `/frontend`
The Electron renderer process containing the UI logic (`app.js`), styles (`style.css`), and Monaco initialization (`monaco-init.js`).

### `main.js`
The Electron main process handling window management, native menu construction, and IPC communication.

### `collab-server.js`
A standalone Node.js WebSocket server that manages room sessions, broadcasts changes, and relays collaboration events (cursors, chat, comments).

## 🛠️ Getting Started

### Installation
```bash
npm install
```

### Running the Application

1. **Start the Collaboration Server**:
   ```bash
   node collab-server.js
   ```
   *By default, the server runs on `ws://localhost:8080`.*

2. **Start the Electron App**:
   ```bash
   npm start
   ```

## 🏗️ Architecture
- **Rendering**: HTML5, Vanilla CSS, and JavaScript.
- **Communication**: Bi-directional JSON messaging over WebSockets for ultra-low latency.
- **State Management**: Ephemeral cursor and chat states; document synchronization via direct broadcast.
- **Security**: Context isolation and IPC-based bridging between the renderer and main processes.

