import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const server = new McpServer({ name: 'hub-fixture', version: '1.0.0', description: '本地 MCP 预览服务：提供一个用于验证连接的示例工具。' });
server.registerTool('fixture', { description: 'Integration fixture; tests only list this tool.' }, async () => ({ content: [{ type: 'text', text: 'fixture' }] }));
await server.connect(new StdioServerTransport());
