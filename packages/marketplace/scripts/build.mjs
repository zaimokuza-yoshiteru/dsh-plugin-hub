import { MARKET_PACKAGE, DEFAULT_BRAND } from '../src/identity.js';
import { build } from 'esbuild';
await build({
  entryPoints: ['src/client/index.jsx'], outfile: 'lib/client.js', bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'], loader: { '.css': 'text' }, sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"', __HUB_PACKAGE__: JSON.stringify(MARKET_PACKAGE), __HUB_ID__: '"hub"', __HUB_BRAND__: JSON.stringify(DEFAULT_BRAND) },
  banner: { js: 'window.__ModuleLoader__.load({ id: "@zaimokuza/dsh-plugin-hub", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
});
console.log('Built lib/client.js for the DSH client module loader.');
