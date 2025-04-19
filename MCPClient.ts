import fs from 'fs';
import path from 'path';
import { Client as MCPClientSDK } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * Configuration for a single MCP server.
 */
export interface MCPServerConfig {
  /** Transport type: 'stdio', 'streamable-http', or 'sse' */
  type?: 'stdio' | 'streamable-http' | 'sse';
  /** Command to launch for stdio transport */
  command?: string;
  /** Arguments for stdio transport */
  args?: string[];
  /** Environment variables for stdio transport */
  env?: Record<string, string>;
  /** Base URL or SSE URL for HTTP transport */
  url?: string;
  /** WebSocket for streaming transport */
  ws_url?: string;
}

/**
 * Global MCP configuration containing multiple servers.
 */
export interface MCPConfig {
  mcpServers?: Record<string, MCPServerConfig>;
}

/**
 * Client for managing multiple MCP server sessions.
 */
export class MCPClient {
  private config: MCPConfig;
  private sessions: Map<string, MCPClientSDK> = new Map();
  private activeSessions: string[] = [];
  private toolServerMap: Map<string, string> = new Map();
  private maxToolTimeout = 10000;

  constructor(configPathOrObject?: string | MCPConfig, maxToolTimeout?: number) {
    if (!configPathOrObject) {
      this.config = {};
    } else if (typeof configPathOrObject === 'string') {
      const fullPath = path.resolve(configPathOrObject);
      const raw = fs.readFileSync(fullPath, 'utf-8');
      this.config = JSON.parse(raw) as MCPConfig;
    } else {
      this.config = configPathOrObject;
    }
    if (maxToolTimeout) {
      this.maxToolTimeout = maxToolTimeout;
    }
  }

  /** Create a new MCPClient from a configuration object */
  static fromObject(config: MCPConfig): MCPClient {
    return new MCPClient(config);
  }

  /** 
   * Create a new MCPClient from a JSON file on disk.
   */
  static fromConfigFile(filepath: string): MCPClient {
    return new MCPClient(filepath);
  }

  /** Add or update a server configuration by name */
  addServer(name: string, serverConfig: MCPServerConfig): void {
    if (!this.config.mcpServers) {
      this.config.mcpServers = {};
    }
    this.config.mcpServers[name] = serverConfig;
  }

  /** Remove a server from config and active sessions */
  removeServer(name: string): void {
    if (this.config.mcpServers && this.config.mcpServers[name]) {
      delete this.config.mcpServers[name];
    }
    const idx = this.activeSessions.indexOf(name);
    if (idx !== -1) {
      this.activeSessions.splice(idx, 1);
    }
  }

  /** List all configured server names */
  getServerNames(): string[] {
    return Object.keys(this.config.mcpServers || {});
  }

  /** Persist the current configuration to a JSON file */
  saveConfig(filepath: string): void {
    const data = JSON.stringify(this.config, null, 2);
    fs.writeFileSync(filepath, data, 'utf-8');
  }

  /**
   * Create and optionally initialize a session for the named server.
   */
  async createSession(serverName: string): Promise<MCPClientSDK> {
    const servers = this.config.mcpServers;
    if (!servers || Object.keys(servers).length === 0) {
      throw new Error('No MCP servers defined in config');
    }
    if (!servers[serverName]) {
      throw new Error(`Server '${serverName}' not found in config`);
    }
    const cfg = servers[serverName];
    const transport = this.createTransport(cfg);

    const client = new MCPClientSDK({ name: serverName, version: '1.0.0' });
    await client.connect(transport);

    this.sessions.set(serverName, client);
    if (!this.activeSessions.includes(serverName)) {
      this.activeSessions.push(serverName);
    }

    return client;
  }

  /**
   * Create (and initialize) sessions for all configured servers.
   */
  async createAllSessions(): Promise<Map<string, MCPClientSDK>> {
    const servers = this.config.mcpServers;
    if (!servers || Object.keys(servers).length === 0) {
      throw new Error('No MCP servers defined in config');
    }
    for (const name of Object.keys(servers)) {
      await this.createSession(name);
    }
    this.toolServerMap = await this.getToolServerMap();
    return this.sessions;
  }

  /**
   * Retrieve an existing session by name.
   */
  getSession(serverName: string): MCPClientSDK {
    const session = this.sessions.get(serverName);
    if (!session) {
      throw new Error(`No session exists for server '${serverName}'`);
    }
    return session;
  }

  /**
   * Retrieve all active (initialized) sessions.
   */
  getAllActiveSessions(): Map<string, MCPClientSDK> {
    const result = new Map<string, MCPClientSDK>();
    for (const name of this.activeSessions) {
      const sess = this.sessions.get(name);
      if (sess) {
        result.set(name, sess);
      }
    }
    return result;
  }

  /**
   * Close a session by name (disconnect and remove). Does nothing if not found.
   */
  async closeSession(serverName: string): Promise<void> {
    const client = this.sessions.get(serverName);
    if (!client) {
      console.warn(`No session exists for server '${serverName}', nothing to close`);
      return;
    }
    try {
      console.debug(`Closing session for server '${serverName}'`);
      await client.close();
    } catch (err) {
      console.error(`Error closing session for server '${serverName}':`, err);
    } finally {
      this.sessions.delete(serverName);
      // アクティブなセッションから削除
      const idx = this.activeSessions.indexOf(serverName);
      if (idx !== -1) this.activeSessions.splice(idx, 1);
    }
  }

  /**
   * Close all sessions, ignoring individual errors but logging them.
   */
  async closeAllSessions(): Promise<void> {
    const names = Array.from(this.sessions.keys());
    const errors: string[] = [];
    for (const name of names) {
      try {
        await this.closeSession(name);
      } catch (e) {
        const msg = `Failed to close session for server '${name}': ${e}`;
        console.error(msg);
        errors.push(msg);
      }
    }
    if (errors.length > 0) {
      console.error(`Encountered ${errors.length} errors while closing sessions`);
    } else {
      console.debug('All sessions closed successfully');
    }
  }

  /**
   * Helper to create the correct transport based on config
   */
  private createTransport(cfg: MCPServerConfig) {
    if (cfg.command && cfg.args) {
      return new StdioClientTransport({ command: cfg.command, args: cfg.args, env: cfg.env });
    } else if (cfg.url && cfg.type === "sse") {
      return new SSEClientTransport(new URL(cfg.url));
    } else if (cfg.url && cfg.type === "streamable-http") {
      return new StreamableHTTPClientTransport(new URL(cfg.url));
    } else if (cfg.ws_url) {
      return new WebSocketClientTransport(new URL(cfg.ws_url));
    } else {
      throw new Error('Cannot determine transport type from config: missing command+args, url, or ws_url');
    }
  }

  private async getToolServerMap() {
    const toolServerMap = new Map<string, string>();
    for (const [serverName, session] of this.sessions.entries()) {
      const { tools } = await session.listTools();
      for (const tool of tools) {
        toolServerMap.set(tool.name, serverName);
      }
    }
    return toolServerMap;
  }

  async listTools(): Promise<{ name: string; description: string; inputSchema: Record<string, unknown> }[]> {
    const allTools: { name: string, description: string, inputSchema: Record<string, unknown> }[] = [];
    for (const serverName of this.activeSessions) {
      const session = this.sessions.get(serverName);
      if (!session) {
        throw new Error(`No session found for server '${serverName}'`);
      }
      const { tools } = await session.listTools();
      for (const tool of tools) {
        allTools.push({ name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema });
      }
    }
    return allTools;
  }

  async callTool({ name, args }: { name: string, args: Record<string, unknown> }) {
    const serverName = this.toolServerMap.get(name);
    if (!serverName) {
      throw new Error(`No server found for tool '${name}'`);
    }
    const session = this.sessions.get(serverName);
    if (!session) {
      throw new Error(`No session found for server '${serverName}'`);
    }
    const result = await session.callTool(
      {
        name: name,
        arguments: args,
      },
      CallToolResultSchema,
      { timeout: this.maxToolTimeout },
    );
    return result;
  }
}
