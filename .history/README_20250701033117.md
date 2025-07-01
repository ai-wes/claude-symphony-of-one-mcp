# Symphony of One MCP - Multi-Agent Orchestration System

A Model Context Protocol (MCP) server that enables multiple Claude instances to collaborate through a centralized hub with shared workspace and real-time communication.

## Architecture

```
User (Orchestrator) ← Central Hub Server → Shared Working Directory
         ↑                    ↓                        ↑
    Hub CLI Interface    Message Router           File Access
         ↑                    ↓                        ↓
Multiple Claude Code Instances via MCP Servers ← → Collaboration
```

## Components

### 1. Central Hub Server (`server.js`)

- Express + Socket.IO server for agent coordination
- Room-based chat system for agent communication
- Task management and delegation system
- File watching with real-time change notifications
- REST API for agent management and orchestration

### 2. User Orchestrator CLI (`cli.js`)

- Command & control interface for the user
- Agent monitoring and task assignment
- Broadcasting messages to agent groups
- Real-time system statistics and room management

### 3. Claude Agent MCP Server (`mcp-server.js`)

- MCP server that Claude Code instances connect to
- Shared file system access with security constraints
- Real-time chat participation with other agents
- Task execution and progress reporting
- File change notifications and collaboration sync

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Central Hub

```bash
npm run server
```

This starts the hub server on `http://localhost:3000` with a shared directory at `./shared`

### 3. Start User Orchestrator CLI

```bash
npm run cli
```

This opens the orchestrator interface for managing agents and tasks.

### 4. Connect Claude Agents

Each Claude Code instance connects via the MCP server:

```bash
node mcp-server.js
```

## Configuration

### Environment Variables

- `CHAT_SERVER_URL`: Hub server URL (default: `http://localhost:3000`)
- `SHARED_DIR`: Shared workspace directory (default: `./shared`)
- `AGENT_NAME`: Agent display name (default: auto-generated)
- `PORT`: Hub server port (default: `3000`)

### Claude Code Integration

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "claude-gateway": {
      "command": "node",
      "args": ["path/to/Symphony-of-One-MCP/mcp-server.js"],
      "env": {
        "CHAT_SERVER_URL": "http://localhost:3000",
        "SHARED_DIR": "/path/to/shared/workspace",
        "AGENT_NAME": "Claude-Agent-1"
      }
    }
  }
}
```

## Available Tools (MCP)

### Room Management

- `room_join` - Join a chat room for collaboration
- `room_send` - Send messages to other agents (supports @mentions)
- `room_history` - Get conversation history
- `room_list` - List all active rooms
- `room_leave` - Leave current room

### Task Coordination

- `task_create` - Create tasks for agent coordination
- `task_list` - View all room tasks
- Task assignment and status tracking

### File System (Shared Workspace)

- `file_read` - Read files from shared directory
- `file_write` - Write files to shared directory
- `file_list` - List directory contents
- `file_delete` - Remove files
- Automatic change notifications to all agents

### Agent Memory & Notifications

- `memory_store` - Store persistent information with optional expiration
- `memory_retrieve` - Retrieve stored memories by key or type
- `notifications_get` - Get mentions and alerts for this agent
- `notification_read` - Mark notifications as read

## Orchestrator Commands

### Room Management

- `/join <room>` - Join/create a room
- `/rooms` - List all rooms
- `/agents` - Show agents in current room
- `/history [n]` - Show recent messages

### Agent Orchestration

- `/broadcast <msg>` - Send message to all agents
- `/assign <agent> <task>` - Assign task to specific agent
- `/tag <agent> <msg>` - Send tagged message to specific agent (@mention)
- `/monitor [room]` - Monitor room activity
- `/stats` - Show system statistics

### Task Management

- `/task create` - Create new tasks
- `/task list` - View all tasks
- `/task update <id>` - Update task status

### Memory & Notifications

- `/memory list` - View system memory usage
- `/notifications` - View recent notifications and mentions
- `/logs [type]` - View system activity logs

## Use Cases

### Multi-Agent Development

- Multiple Claude instances work on different parts of a codebase
- Real-time file change notifications keep all agents synchronized
- Task delegation and progress tracking
- Shared workspace prevents conflicts

### Collaborative Analysis

- Agents can specialize in different analysis domains
- Chat-based coordination for complex problem solving
- Shared document editing and review
- Task assignment based on agent capabilities

### Orchestrated Workflows

- User defines high-level goals and delegates to agents
- Agents self-coordinate through chat and task system
- File-based deliverable sharing and review
- Progress monitoring and intervention capabilities

## API Endpoints

### Core Operations

- `POST /api/join/:room` - Agent joins room
- `POST /api/send` - Send chat message
- `GET /api/messages/:room` - Get message history
- `GET /api/rooms` - List all rooms

### Task Management

- `POST /api/tasks` - Create task
- `GET /api/tasks/:room` - Get room tasks
- `POST /api/tasks/:id/update` - Update task

### Memory & Notifications

- `POST /api/memory/:agentId` - Store agent memory
- `GET /api/memory/:agentId` - Retrieve agent memory
- `GET /api/notifications/:agentId` - Get agent notifications
- `POST /api/notifications/:id/read` - Mark notification as read

### Orchestration

- `GET /api/stats` - System statistics
- `POST /api/broadcast/:room` - Broadcast message
- `GET /api/agents/:room` - List room agents

## New Features Added

### 🏷️ Agent Tagging & Mentions

- Use `@agentName` in messages to tag specific agents
- Tagged agents receive real-time notifications
- Orchestrator can use `/tag <agent> <message>` for direct communication
- Persistent notification storage and management

### 💾 Persistent Storage & Memory

- SQLite database for all messages, tasks, and agent data
- Agent memory system with optional expiration
- Persistent notification system with read/unread status
- Comprehensive logging with Winston
- Data survives server restarts

### 📊 Enhanced Monitoring & Logging

- Real-time activity monitoring
- Persistent message and event logging
- System statistics and memory usage tracking
- Agent activity and performance metrics

## Security Features

- Path traversal protection for file operations
- Sandboxed shared directory access
- Agent capability declarations and validation
- WebSocket authentication and room isolation
- Secure memory storage with expiration
- Audit trail for all agent actions

## Future Enhancements

- Agent authentication and permissions
- File locking for concurrent access
- Task dependencies and workflows
- Agent discovery and capability matching
- Advanced monitoring and analytics
- Memory cleanup and optimization
- Notification channels and routing
