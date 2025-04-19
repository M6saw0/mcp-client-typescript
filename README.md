# MCP Typescript Client Sample

This is a TypeScript code sample for a client that utilizes multiple MCPs. Based on [mcp-use](https://github.com/pietrozullo/mcp-use), the MCP client portion is implemented in TypeScript. Multiple MCPs can be defined in a JSON file, enabling the tool name to determine the server name for invocation.

## Quick Start

1. Install required packages
```bash
npm install
```

2. Create the MCP configuration file
Configure the MCPs in `mcp_config.json`.
For command execution:
```json
{
  "mcpServers": {
    "tool_studio": {
        "command": "tool_studio",
        "args": ["arg1", "arg2"]
    }
  }
}
```
For SSE:
```json
{
  "mcpServers": {
    "tool_sse": {
        "type": "sse",
        "url": "http://localhost:8000/sse"
    }
  }
}
```
You can also configure multiple servers.

3. Run the sample code
```bash
npx tsx mcp_client_use_sample.ts
```


## Reference
- [mcp-use](https://github.com/pietrozullo/mcp-use)
- [MCP Typescript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Fetch MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch)
- [file-system](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem)
