import { MCPClient } from "./MCPClient";


async function main() {
  console.log("Creating client");
  // create mcp client from config file
  const client = MCPClient.fromConfigFile("mcp_config.json");
  console.log("Creating sessions");
  await client.createAllSessions();
  console.log("Printing sessions");
  for (const tool of await client.listTools()) {
    console.log(
      `name: ${tool.name}\n` +
      `description: ${tool.description}\n` +
      `input_schema: ${JSON.stringify(tool.inputSchema)}\n`
    );
  }
  console.log("Calling tool");
  const result = await client.callTool({ name: "fetch", args: { url: "https://js.langchain.com/v0.1/docs/modules/agents/tools/dynamic/" } });
  console.log("--------------------------------");
  console.log(result.content?.[0]?.text?.slice(0, 100));
  const result2 = await client.callTool({ name: "read_file", args: { path: "./test.py" } });
  console.log("--------------------------------");
  console.log(result2.content?.[0]?.text?.slice(0, 100));
  await client.closeAllSessions();
  console.log("--------------------------------");
  console.log("Closing sessions");
}

main().then(() => {
  console.log("Process finished, exiting.");
  process.exit(0);
}).catch((err) => {
  console.error("Error occurred in main:", err);
  process.exit(1);
});