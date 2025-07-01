#!/usr/bin/env node

/**
 * Smart MCP Server Wrapper
 * Automatically detects Windows vs WSL environment and adjusts paths accordingly
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { platform } from "os";
import { existsSync, readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Detect environment
function detectEnvironment() {
  const isWindows = platform() === "win32";
  const isWSL =
    process.env.WSL_DISTRO_NAME !== undefined ||
    process.env.WSLENV !== undefined ||
    (existsSync("/proc/version") &&
      require("fs")
        .readFileSync("/proc/version", "utf8")
        .toLowerCase()
        .includes("microsoft"));

  return { isWindows, isWSL };
}

// Convert Windows path to WSL path
function windowsToWSLPath(windowsPath) {
  // Convert C:\path\to\file to /mnt/c/path/to/file
  return windowsPath
    .replace(/^([A-Z]):\\/, "/mnt/$1/")
    .replace(/\\/g, "/")
    .toLowerCase();
}

// Convert WSL path to Windows path
function wslToWindowsPath(wslPath) {
  // Convert /mnt/c/path/to/file to C:\path\to\file
  return wslPath
    .replace(/^\/mnt\/([a-z])\//, "$1:\\")
    .replace(/\//g, "\\")
    .replace(/^([a-z]):/, (match) => match.toUpperCase());
}

// Get correct paths for current environment
function getEnvironmentPaths() {
  const { isWindows, isWSL } = detectEnvironment();
  const currentDir = __dirname;

  let serverPath, sharedDir;

  if (isWSL) {
    // Running in WSL - use Unix paths
    serverPath = join(currentDir, "mcp-server.js");
    sharedDir = join(currentDir, "shared");

    // If paths look like Windows paths, convert them
    if (serverPath.includes(":\\")) {
      serverPath = windowsToWSLPath(serverPath);
      sharedDir = windowsToWSLPath(sharedDir);
    }
  } else {
    // Running in Windows - use Windows paths
    serverPath = join(currentDir, "mcp-server.js");
    sharedDir = join(currentDir, "shared");
  }

  return { serverPath, sharedDir, isWindows, isWSL };
}

// Main wrapper function
function main() {
  const { serverPath, sharedDir, isWindows, isWSL } = getEnvironmentPaths();

  console.log(`🎭 Symphony of One MCP Server Wrapper`);
  console.log(`Environment: ${isWSL ? "WSL" : isWindows ? "Windows" : "Unix"}`);
  console.log(`Server Path: ${serverPath}`);
  console.log(`Shared Directory: ${sharedDir}`);

  // Set environment variables
  const env = {
    ...process.env,
    CHAT_SERVER_URL: process.env.CHAT_SERVER_URL || "http://localhost:3000",
    SHARED_DIR: process.env.SHARED_DIR || sharedDir,
    AGENT_NAME:
      process.env.AGENT_NAME || `Claude-Agent-${isWSL ? "WSL" : "Windows"}`,
  };

  // Spawn the actual MCP server
  const child = spawn("node", [serverPath], {
    env,
    stdio: "inherit",
    shell: false,
  });

  child.on("error", (error) => {
    console.error(`❌ Failed to start MCP server: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`🛑 MCP server terminated by signal: ${signal}`);
    } else {
      console.log(`🔚 MCP server exited with code: ${code}`);
    }
    process.exit(code || 0);
  });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down MCP server...");
    child.kill("SIGINT");
  });

  process.on("SIGTERM", () => {
    console.log("\n🛑 Terminating MCP server...");
    child.kill("SIGTERM");
  });
}

// Add fs import for WSL detection
import fs from "fs";

main();
