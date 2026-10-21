const fs = require('node:fs'),path = require('node:path');
const pkg = '/Users/mima1234/Documents/aimy/aimy-app/node_modules/.pnpm';
const name = fs.readdirSync(pkg).find(x => /^esbuild@/.test(x));
const esbuild = require(path.join(pkg,name,'node_modules/esbuild'));
esbuild.buildSync({entryPoints:[path.join(__dirname,'airi-default-context.ts')],outfile:path.join(__dirname,'airi-default-context.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
