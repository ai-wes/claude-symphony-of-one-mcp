# Windows & WSL Setup Guide for Symphony of One MCP

This guide helps you set up Symphony of One MCP to work seamlessly across both Claude Desktop (Windows) and Claude Code (WSL).

## 🔍 **The Problem**

Claude Desktop runs on Windows and expects Windows paths (`C:\path\to\file`), but Claude Code runs in WSL which expects Unix paths (`/mnt/c/path/to/file`). This causes configuration mismatches when trying to use the same MCP server in both environments.

## ✅ **The Solution**

We've created multiple solutions to handle this automatically:

### **Option 1: Automatic Configuration Generator (Recommended)**

Use our smart configuration generator that detects your environment and creates the correct config:

```bash
# Generate environment-specific configuration
npm run config
```

This will:

- **Detect your environment** (Windows or WSL)
- **Generate the correct paths** for your platform
- **Create config files** for both environments
- **Use the smart wrapper script** for cross-platform compatibility

### **Option 2: Manual Configuration Files**

We've created pre-configured files for both environments:

#### **For Claude Desktop (Windows):**

Use `claude-config-windows.json`:

```json
{
  "mcpServers": {
    "claude-symphony-of-one": {
      "command": "node",
      "args": ["C:\\path\\to\\your\\project\\mcp-server-wrapper.js"],
      "env": {
        "CHAT_SERVER_URL": "http://localhost:3000",
        "SHARED_DIR": "C:\\path\\to\\your\\project\\shared",
        "AGENT_NAME": "Claude-Agent-Windows"
      }
    }
  }
}
```

#### **For Claude Code (WSL):**

Use `claude-config-wsl.json`:

```json
{
  "mcpServers": {
    "claude-symphony-of-one": {
      "command": "node",
      "args": ["/mnt/c/path/to/your/project/mcp-server-wrapper.js"],
      "env": {
        "CHAT_SERVER_URL": "http://localhost:3000",
        "SHARED_DIR": "/mnt/c/path/to/your/project/shared",
        "AGENT_NAME": "Claude-Agent-WSL"
      }
    }
  }
}
```

## 🛠️ **Step-by-Step Setup**

### **1. Generate Configurations**

From your project directory, run:

```bash
# In Windows PowerShell
npm run config

# Or in WSL
wsl npm run config
```

This creates environment-specific configuration files.

### **2. Set Up Claude Desktop (Windows)**

1. **Copy the Windows configuration:**

   ```bash
   # Copy contents of claude-config-windows.json
   ```

2. **Add to Claude Desktop config:**
   - Open: `%APPDATA%\Claude\claude_desktop_config.json`
   - Add the MCP server configuration
   - Restart Claude Desktop

### **3. Set Up Claude Code (WSL)**

1. **Copy the WSL configuration:**

   ```bash
   # Copy contents of claude-config-wsl.json
   ```

2. **Add to Claude Code:**
   - Use the MCP: Add Server command
   - Paste the WSL configuration
   - The paths will be correct for WSL environment

### **4. Start the Hub Server**

The hub server should be running for agents to communicate:

```bash
# Start in Windows or WSL (accessible from both)
npm run server
```

## 🔧 **Smart Wrapper Script**

The `mcp-server-wrapper.js` automatically:

- **Detects the environment** (Windows/WSL)
- **Adjusts paths dynamically**
- **Sets appropriate agent names**
- **Handles cross-platform differences**

You can also test it directly:

```bash
# Test the wrapper
npm run start-wrapper
```

## 🎯 **Environment Detection**

The system detects environments using:

```javascript
// Windows detection
const isWindows = platform() === "win32";

// WSL detection
const isWSL =
  process.env.WSL_DISTRO_NAME !== undefined ||
  process.env.WSLENV !== undefined ||
  (existsSync("/proc/version") &&
    readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft"));
```

## 🚀 **Quick Commands Reference**

| Command                 | Purpose                               |
| ----------------------- | ------------------------------------- |
| `npm run config`        | Generate environment-specific configs |
| `npm run start-wrapper` | Start MCP server with smart wrapper   |
| `npm run server`        | Start the central hub server          |
| `npm run cli`           | Start the enhanced orchestrator CLI   |
| `npm run test`          | Test MCP server functionality         |

## 💡 **Pro Tips**

### **Path Conversion Examples:**

```bash
# Windows → WSL
C:\path\to\your\project → /mnt/c/path/to/your/project

# WSL → Windows
/mnt/c/path/to/your/project → C:\path\to\your\project
```

### **Agent Identification:**

- **Windows agents:** `Claude-Agent-Windows`
- **WSL agents:** `Claude-Agent-WSL`
- **Makes it easy to see which environment agents are running in**

### **Network Considerations:**

- Hub server URL `http://localhost:3000` works from both Windows and WSL
- WSL can access Windows localhost
- All agents can communicate regardless of environment

## 🔍 **Troubleshooting**

### **Problem: "Module not found" errors**

**Solution:** Ensure you're using the wrapper script, not the direct MCP server

### **Problem: Path not found errors**

**Solution:** Run `npm run config` to regenerate correct paths for your environment

### **Problem: Hub server connection failed**

**Solution:** Make sure the hub server is running with `npm run server`

### **Problem: Agents can't see each other**

**Solution:** Check that all agents are using the same hub server URL

## 🎭 **Usage Example**

```bash
# 1. Generate configs for your environment
npm run config

# 2. Start the hub server
npm run server

# 3. Configure Claude Desktop with claude-config-windows.json
# 4. Configure Claude Code with claude-config-wsl.json

# 5. Start orchestrator CLI
npm run cli

# 6. Join a room and assign roles
🎭 > /join development-team
🎭 [development-team] > /role assign
# Select: Windows agent → Senior Developer
# Select: WSL agent → Backend Engineer

# 7. Create cross-platform collaboration!
🎭 [development-team] > /quick feature
# Details: Cross-platform authentication system
# Assigns to appropriate agent regardless of environment
```

## 🌟 **Benefits**

✅ **Seamless cross-platform operation**
✅ **Automatic environment detection**  
✅ **No manual path conversion needed**
✅ **Clear agent identification**
✅ **Unified collaboration experience**
✅ **Single codebase for all environments**

Your Symphony of One MCP now works perfectly across Windows and WSL! 🚀
