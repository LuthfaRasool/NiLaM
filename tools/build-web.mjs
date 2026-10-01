/**
 * NiLaM web build.
 *
 * Uses the esbuild **binary** rather than the npm `esbuild` package's JS API.
 * The JS API spawns its compiler as a child process with piped stdio, which the
 * sandbox refuses with `spawn EPERM`; invoking the binary directly and letting it
 * inherit our stdio works. This is the only reason the project does not use Vite's
 * build step — the React, the JSX and the bundling are all real.
 *
 * Usage: node tools/build-web.mjs [--watch]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'apps', 'web');
const OUT = path.join(WEB, 'dist');

function esbuildBinary() {
  const candidates = [
    path.join(ROOT, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
    path.join(ROOT, 'node_modules', '@esbuild', 'linux-x64', 'bin', 'esbuild'),
    path.join(ROOT, 'node_modules', '@esbuild', 'darwin-arm64', 'bin', 'esbuild'),
    path.join(ROOT, 'node_modules', '@esbuild', 'darwin-x64', 'bin', 'esbuild')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Fall back to a global install on PATH.
  return process.platform === 'win32' ? 'esbuild.exe' : 'esbuild';
}

/**
 * Runs the binary with inherited stdio.
 *
 * A promise is still returned so callers can sequence builds; the exit code is
 * what decides success, and esbuild's own diagnostics have already gone straight
 * to our stderr by then.
 */
function runEsbuild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(esbuildBinary(), args, {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`esbuild exited ${code}`))));
  });
}

function copyCss() {
  const src = path.join(ROOT, 'packages', 'ui', 'tokens.css');
  const assets = path.join(OUT, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.copyFileSync(src, path.join(assets, 'nilam.css'));
}

function writeHtml() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>NiLaM — National Integrated Land Acquisition Module</title>
<meta name="description" content="NiLaM: a unified land acquisition and management platform. SIH26016, Team CLANS." />
<!--
  Strict CSP, delivered as a meta element exactly as the previous iteration did.
  'unsafe-inline' is required in style-src because React sets style attributes.
  There is no inline <script> anywhere in the product, and no remote origin.

  Note: frame-ancestors is ignored when delivered this way (Chrome says so in the
  console) and must be set as a real response header by the reverse proxy in
  front of the deployment. That is recorded in the README rather than silently
  relied upon.
-->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'" />
<link rel="stylesheet" href="/assets/nilam.css" />
</head>
<body>
<div id="root"></div>
<noscript>NiLaM needs JavaScript enabled to run.</noscript>
<div id="boot-error" hidden style="padding:24px;font-family:system-ui,sans-serif">
  <h1 style="font-size:20px">NiLaM could not start</h1>
  <p id="boot-error-detail" style="color:#5b6878"></p>
</div>
<script src="/assets/app.js"></script>
</body>
</html>
`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');
}

async function build() {
  fs.mkdirSync(OUT, { recursive: true });
  copyCss();
  writeHtml();

  await runEsbuild([
    path.join(WEB, 'src', 'main.jsx'),
    '--bundle',
    '--outfile=' + path.join(OUT, 'assets', 'app.js'),
    '--loader:.jsx=jsx',
    '--loader:.js=jsx',
    '--format=iife',
    '--target=es2020',
    '--jsx=automatic',
    '--define:process.env.NODE_ENV="production"',
    '--minify',
    '--legal-comments=none',
    '--log-level=warning'
  ]);

  const appJs = path.join(OUT, 'assets', 'app.js');
  const css = path.join(OUT, 'assets', 'nilam.css');
  const size = (f) => (fs.existsSync(f) ? (fs.statSync(f).size / 1024).toFixed(1) + ' kB' : 'missing');

  console.log('NiLaM web build complete');
  console.log(`  index.html   ${size(path.join(OUT, 'index.html'))}`);
  console.log(`  app.js       ${size(appJs)}`);
  console.log(`  nilam.css    ${size(css)}`);
  console.log(`  output       ${OUT}`);
}

try {
  await build();
} catch (err) {
  console.error('');
  console.error('Build failed: ' + err.message);
  console.error('');
  console.error('If esbuild could not be found, the offline install has not been run:');
  console.error('  node tools/offline-install.mjs install .');
  process.exit(1);
}
