#!/usr/bin/env node

/**
 * Claude Desktop Configuration Generator
 * Generates the correct configuration for Windows or WSL environments
 */

import { platform } from "os";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Detect environment
function detectEnvironment() {
  const isWindows = platform() === "win32";
  const isWSL =
    process.env.WSL_DISTRO_NAME !== undefined ||
    process.env.WSLENV !== undefined ||
    (existsSync("/proc/version") &&
      readFileSync("/proc/version", "utf8")
        .toLowerCase()
        .includes("microsoft"));

  return { isWindows, isWSL };
}

// Convert Windows path to WSL path
function windowsToWSLPath(windowsPath) {
  return windowsPath
    .replace(/^([A-Z]):\\/, "/mnt/$1/")
    .replace(/\\/g, "/")
    .toLowerCase();
}

// Get current project directory in the correct format
function getProjectPaths() {
  const { isWindows, isWSL } = detectEnvironment();
  let projectDir = resolve(__dirname);

  if (isWSL && projectDir.includes(":\\")) {
    // Convert Windows path to WSL path
    projectDir = windowsToWSLPath(projectDir);
  }

  return {
    projectDir,
    serverPath: `${projectDir}/mcp-server-wrapper.js`,
    sharedDir: `${projectDir}/shared`,
    isWindows,
    isWSL,
  };
}

// Generate configuration for the current environment
function generateConfig() {
  const { projectDir, serverPath, sharedDir, isWindows, isWSL } =
    getProjectPaths();

  const config = {
    mcpServers: {
      "claude-symphony-of-one": {
        command: "node",
        args: [serverPath],
        env: {
          CHAT_SERVER_URL: "http://localhost:3000",
          SHARED_DIR: sharedDir,
          AGENT_NAME: `Claude-Agent-${
            isWSL ? "WSL" : isWindows ? "Windows" : "Unix"
          }`,
        },
      },
    },
  };

  return {
    config,
    environment: isWSL ? "WSL" : isWindows ? "Windows" : "Unix",
  };
}

// Main function
function main() {
  console.log("🎭 Symphony of One MCP - Configuration Generator\n");

  const { config, environment } = generateConfig();

  console.log(`Environment detected: ${environment}`);
  console.log(
    `Project directory: ${config.mcpServers["claude-symphony-of-one"].args[0]}`
  );
  console.log(
    `Shared directory: ${config.mcpServers["claude-symphony-of-one"].env.SHARED_DIR}`
  );

  // Generate filename based on environment
  const configFileName = `claude-config-${environment.toLowerCase()}.json`;
  const configContent = JSON.stringify(config, null, 2);

  // Write config file
  writeFileSync(configFileName, configContent);
  console.log(`\n✅ Configuration written to: ${configFileName}`);

  // Display usage instructions
  console.log("\n📋 Usage Instructions:");
  console.log(`1. Copy the contents of ${configFileName}`);

  if (environment === "WSL") {
    console.log("2. For Claude Code (WSL), use this config directly");
    console.log(
      "3. For Claude Desktop (Windows), use claude-config-windows.json instead"
    );

    // Also generate Windows version
    const windowsProjectDir = projectDir
      .replace(/^\/mnt\/([a-z])\//, "$1:\\")
      .replace(/\//g, "\\");
    const windowsConfig = {
      mcpServers: {
        "claude-symphony-of-one": {
          command: "node",
          args: [`${windowsProjectDir}\\mcp-server-wrapper.js`],
          env: {
            CHAT_SERVER_URL: "http://localhost:3000",
            SHARED_DIR: `${windowsProjectDir}\\shared`,
            AGENT_NAME: "Claude-Agent-Windows",
          },
        },
      },
    };

    writeFileSync(
      "claude-config-windows.json",
      JSON.stringify(windowsConfig, null, 2)
    );
    console.log(
      "   ✅ Also generated claude-config-windows.json for Claude Desktop"
    );
  } else {
    console.log("2. For Claude Desktop (Windows), use this config");
    console.log("3. For Claude Code (WSL), convert paths to /mnt/c/... format");
  }

  console.log("\n🔧 Configuration Details:");
  console.log(
    "   - Uses the smart wrapper script for cross-platform compatibility"
  );
  console.log(
    "   - Automatically detects and adjusts for Windows/WSL environments"
  );
  console.log("   - Sets appropriate agent names for easy identification");

  console.log("\n📖 To use with Claude Desktop:");
  console.log(
    `   Add the contents of ${configFileName} to your Claude Desktop config file`
  );
  console.log(`   Windows: %APPDATA%\\Claude\\claude_desktop_config.json`);
  console.log(
    `   macOS: ~/Library/Application Support/Claude/claude_desktop_config.json`
  );

  // Display the config for easy copying
  console.log("\n📄 Configuration to copy:");
  console.log("```json");
  console.log(configContent);
  console.log("```");
}

main();
