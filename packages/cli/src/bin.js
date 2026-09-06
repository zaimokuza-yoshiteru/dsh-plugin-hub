#!/usr/bin/env node
import { generate } from '../src/generate.js';
import { parseArgs } from 'node:util';
const help = `create-dsh-plugin-hub <create-market|create-source> <directory> [options]
  --name <npm-name>          Generated package name (required)
  --market-id <id>           Unique market ID, or target market ID for a source
  --title <text>             Brand title or source tab label
  --sub-title <text>         Market subtitle
  --primary-color <color>    #RRGGBB or red/blue/green/purple/orange
  --datasource <npm:package|file:path>  Catalog source (required)
  --registry <https-url>     Registry for catalog metadata and installs
  --publish-registry <url>   Optional package publishConfig.registry
  --source-id <id>           Unique source ID (create-source)
  --help                    Show help
Generation is offline. Run npm install, npm run build, npm pack in the output directory.
No source repositories are downloaded. No package is installed or published by this command.`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(['name','market-id','title','sub-title','primary-color','datasource','registry','publish-registry','source-id'].map(key => [key, { type: 'string' }]).concat([['help', { type: 'boolean' }]])) });
  if (values.help) console.log(help);
  else { if (positionals.length !== 2) throw new Error(help); console.log(await generate(positionals[0], positionals[1], values)); }
} catch (error) { console.error(error.message); process.exitCode = 1; }
