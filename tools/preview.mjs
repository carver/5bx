#!/usr/bin/env node
/*
 * Serves the app, plus a page that jumps straight to a hard-to-reach state,
 * for screenshotting a change with web-shot:
 *
 *   npm run preview                     # prints a URL per scenario
 *   web-shot --size 390x844 http://localhost:8765/__preview.html?scenario=summary
 *
 * The preview page is generated in memory from index.html, so nothing is ever
 * written into the tree. Scenarios live in tools/preview-scenarios.js.
 *
 * Zero dependencies, like everything else in tools/.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const PREVIEW_PATH = '/__preview.html';
const APP_SCRIPT = '<script type="module" src="./js/app.js"></script>';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

/** index.html with the app's entry point swapped for the scenario runner. */
export async function previewPage() {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  if (!html.includes(APP_SCRIPT)) {
    throw new Error(`index.html no longer loads the app with: ${APP_SCRIPT}`);
  }
  return html.replace(APP_SCRIPT, `<script type="module">
  import { scenarios } from './tools/preview-scenarios.js';
  // Scripted taps are not user gestures, so Chrome logs every vibrate call as
  // an error, and web-shot would report a healthy page as broken.
  navigator.vibrate = () => true;
  const name = new URLSearchParams(location.search).get('scenario');
  const run = scenarios[name];
  if (!run) throw new Error(\`Unknown scenario "\${name}". Known: \${Object.keys(scenarios).join(', ')}\`);
  run(document.getElementById('app'));
</script>`);
}

async function respond(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === PREVIEW_PATH) {
    res.writeHead(200, { 'content-type': 'text/html' }).end(await previewPage());
    return;
  }
  const path = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (path !== ROOT && !path.startsWith(ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  const file = pathname.endsWith('/') ? join(path, 'index.html') : path;
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
}

export function serve(port) {
  const server = createServer((req, res) => {
    respond(req, res).catch((err) => res.writeHead(500).end(String(err)));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const USAGE = `usage: node tools/preview.mjs [--port N]   (npm run preview)

Serves the app on http://localhost:N/ (default 8765) and prints a preview URL
for each scenario in tools/preview-scenarios.js. Runs until stopped.`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(USAGE);
    process.exit(0);
  }
  const portFlag = args.indexOf('--port');
  const port = portFlag === -1 ? 8765 : Number(args[portFlag + 1]);
  const { scenarios } = await import('./preview-scenarios.js');
  await serve(port);
  console.log(`app: http://localhost:${port}/`);
  for (const name of Object.keys(scenarios)) {
    console.log(`${name}: http://localhost:${port}${PREVIEW_PATH}?scenario=${name}`);
  }
}
