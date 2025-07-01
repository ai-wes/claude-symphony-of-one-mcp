# 🎭 Symphony of One MCP - Setup Guide

Your MCP application is now correctly configured and ready for multi-agent collaboration!

## ✅ What Was Fixed

1. **Correct MCP SDK Implementation**: Updated to use proper `McpServer` and `registerTool` patterns
2. **Fixed Input Schemas**: Corrected zod schema usage to match MCP SDK requirements
3. **Added Missing Dependencies**: Added `sqlite3` to package.json
4. **Proper Tool Registration**: All 12 tools now register correctly with proper input validation
5. **Transport Configuration**: Correctly set up `StdioServerTransport` for Claude Desktop integration

## 🚀 Quick Setup

### 1. Automated Setup (Already Done)
```bash
npm run setup  # ✅ Completed
npm test      # ✅ All tests passed
```

### 2. Start the Hub Server
```bash
npm run server
```
Keep this running in a separate terminal.

### 3. Configure Claude Desktop

Add this exact configuration to your Claude Desktop config file:

**Location**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "claude-symphony-of-one": {
      "command": "node",
      "args": ["C:\\Users\\wes\\Desktop\\claude-symphony-of-one-mcp\\mcp-server.js"],
      "env": {
        "CHAT_SERVER_URL": "http://localhost:3000",
        "SHARED_DIR": "C:\\Users\\wes\\Desktop\\claude-symphony-of-one-mcp\\shared",
        "AGENT_NAME": "Claude-Agent-1"
      }
    }
  }
}
```

### 4. Restart Claude Desktop

Close and reopen Claude Desktop to load the MCP server.

## 🛠️ Available Tools in Claude

Once connected, you'll have these tools available:

### 🏠 Room Management
- **`room_join`** - Join collaboration rooms
- **`room_leave`** - Leave current room
- **`send_message`** - Chat with other agents (supports @mentions)
- **`get_messages`** - Read chat history

### 📋 Task Coordination
- **`create_task`** - Create tasks for agents
- **`get_tasks`** - View and filter tasks

### 🧠 Memory System
- **`memory_store`** - Store persistent information
- **`memory_retrieve`** - Retrieve stored memories

### 📁 Shared Workspace
- **`file_read`** - Read files from shared directory
- **`file_write`** - Write files to shared directory
- **`file_list`** - List files and directories

### 🔔 Notifications
- **`get_notifications`** - Check mentions and alerts

## 📝 Example Usage

1. **Join a room**: Use `room_join` with roomName "project-alpha"
2. **Send a message**: Use `send_message` with "@Agent-2 Let's collaborate on this feature"
3. **Create a task**: Use `create_task` to assign work to specific agents
4. **Share files**: Use `file_write` to create shared documents
5. **Check updates**: Use `get_notifications` to see mentions and alerts

## 🎯 Multi-Agent Workflow

1. **Start Hub Server**: `npm run server` (keep running)
2. **Configure Multiple Claude Instances**: Use different `AGENT_NAME` values
3. **Join Same Room**: All agents join the same room name
4. **Collaborate**: Agents can chat, share files, and coordinate tasks
5. **Monitor Progress**: Use the CLI orchestrator (`npm run cli`) for oversight

## 🔧 Optional: Start Orchestrator CLI
```bash
npm run cli
```
This provides a command-line interface for:
- Broadcasting messages to all agents
- Monitoring room activity
- Managing tasks and assignments
- Viewing system statistics

## ✨ Features Confirmed Working

- ✅ MCP server starts and connects properly
- ✅ All 12 tools register correctly
- ✅ Input validation with zod schemas
- ✅ File operations work in shared workspace
- ✅ Socket.IO communication ready for hub server
- ✅ Error handling and security checks
- ✅ Compatible with Claude Desktop

## 🎉 You're Ready!

Your Symphony of One MCP is now correctly set up for multi-agent collaboration. Simply restart Claude Desktop with the configuration above, and you'll be able to coordinate multiple Claude instances through chat rooms, shared files, and task management.

Happy collaborating! 🤖🤖🤖