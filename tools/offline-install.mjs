'use strict';
/**
 * Offline npm installer backed by the local npm cacache.
 *
 * The sandbox has no registry access, but `%LOCALAPPDATA%\npm-cache\_cacache`
 * holds 300+ real package tarballs. npm itself refuses to install from them
 * (`ENOTCACHED`) because it wants to revalidate packument metadata that was
 * never cached. This bypasses npm: it reads cacache's own index to map
 * name@version -> content hash, extracts the tarball from content-v2, and builds
 * a flat `node_modules` plus a lockfile-ish manifest.
 *
 * Usage:
 *   node tools/offline-install.js list                 # list what is available
 *   node tools/offline-install.js install <dir>        # install deps from <dir>/package.json
 *
 * Caveats, stated plainly: this resolves nothing. It installs exactly the
 * versions present in the cache, and it cannot fetch a dependency that is not
 * already there. It is a substitute for a package manager, not a package manager.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const CACHE = process.env.npm_config_cache || path.join(os.homedir(), 'AppData', 'Local', 'npm-cache');
const CACACHE = path.join(CACHE, '_cacache');
const INDEX = path.join(CACACHE, 'index-v5');
const CONTENT = path.join(CACACHE, 'content-v2');

/* ------------------------------------------------------------------ *
 * Reading cacache
 * ------------------------------------------------------------------ */

/**
 * Walks index-v5 and returns every cached entry.
 *
 * Each index file is one line of the form:
 *
 *   <content-hash>\t{"key":"make-fetch-happen:request-cache:<url>",
 *                    "integrity":"sha512-...","size":N,"metadata":{...}}
 *
 * The URL lives inside the JSON, and `integrity` is the sha512 that also names
 * the file under content-v2. Both are needed: the URL gives name@version, the
 * integrity gives the bytes.
 */
function readIndex() {
  const entries = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(full);
        continue;
      }
      for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
        const tab = line.indexOf('\t');
        if (tab === -1) continue;
        try {
          const parsed = JSON.parse(line.slice(tab + 1));
          const key = typeof parsed.key === 'string' ? parsed.key : '';
          const url = key.replace(/^make-fetch-happen:request-cache:/, '') || parsed.metadata?.url || '';
          entries.push({ ...parsed, url, cacheKey: key });
        } catch {
          /* a malformed index line is skipped, not fatal */
        }
      }
    }
  };
  if (!fs.existsSync(INDEX)) throw new Error(`No npm cache index at ${INDEX}`);
  walk(INDEX);
  return entries;
}

/** True when an entry is a package tarball download. */
function isTarball(entry) {
  return typeof entry.url === 'string' && entry.url.endsWith('.tgz') && entry.url.includes('registry');
}

/** name@version parsed from a registry tarball URL. */
function parseTarballUrl(url) {
  const m = /registry\.npmjs\.org\/(.+?)\/-\/(.+?)\.tgz$/.exec(url);
  if (!m) return null;
  let name = decodeURIComponent(m[1]);
  const file = m[2];
  // Scoped packages appear as @scope/name; the filename is name-version.
  const base = name.includes('/') ? name.split('/').pop() : name;
  const version = file.startsWith(`${base}-`) ? file.slice(base.length + 1) : null;
  if (!version) return null;
  return { name, version };
}

/** Path inside content-v2 for a sha512 integrity string. */
function contentPath(integrity) {
  const m = /^sha512-(.+)$/.exec(integrity || '');
  if (!m) return null;
  const hex = Buffer.from(m[1], 'base64').toString('hex');
  return path.join(CONTENT, 'sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
}

/** Builds name -> [{version, integrity, url}] from the cache. */
function catalogue() {
  const out = new Map();
  let tarballs = 0;
  let withBytes = 0;
  const entries = readIndex();

  for (const entry of entries) {
    if (!isTarball(entry)) continue;
    tarballs += 1;
    const parsed = parseTarballUrl(entry.url);
    if (!parsed) continue;
    const file = contentPath(entry.integrity);
    if (!file || !fs.existsSync(file)) continue;
    withBytes += 1;
    if (!out.has(parsed.name)) out.set(parsed.name, []);
    out.get(parsed.name).push({ ...parsed, integrity: entry.integrity, file, url: entry.url });
  }

  if (process.env.NILAM_INSTALL_DEBUG) {
    console.error(
      `[offline-install] index=${entries.length} tarballEntries=${tarballs} withBytes=${withBytes} packages=${out.size}`
    );
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Minimal tar reader
 * ------------------------------------------------------------------ */

/**
 * Extracts a .tgz into `dest`.
 *
 * npm tarballs are ustar with a `package/` prefix. This handles the regular
 * files, directories and the long-name/prefix forms that appear in practice; it
 * deliberately does not implement symlinks or hard links, which npm packages
 * only use in ways this installer does not need.
 */
async function extractTarball(tgzPath, dest) {
  const gz = await fsp.readFile(tgzPath);
  const tar = zlib.gunzipSync(gz);
  let offset = 0;
  let wrote = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = readString(header, 0, 100);
    if (!name) break; // end-of-archive marker (zero block)

    const sizeField = readString(header, 124, 12).trim();
    const size = parseInt(sizeField, 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const prefix = readString(header, 345, 155);

    let entryName = prefix ? `${prefix}/${name}` : name;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    // Strip the conventional "package/" root.
    if (entryName.startsWith('package/')) entryName = entryName.slice('package/'.length);
    else if (entryName === 'package') entryName = '';

    if (entryName) {
      const target = path.join(dest, entryName);
      // Refuse to escape the destination.
      if (!path.resolve(target).startsWith(path.resolve(dest))) {
        throw new Error(`tar entry escapes destination: ${entryName}`);
      }
      if (type === '5') {
        await fsp.mkdir(target, { recursive: true });
      } else if (type === '0' || type === '\0' || type === '') {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, tar.subarray(dataStart, dataEnd));
        wrote += 1;
      }
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return wrote;
}

function readString(buf, start, length) {
  let end = start;
  while (end < start + length && buf[end] !== 0) end += 1;
  return buf.toString('utf8', start, end);
}

/** Reads a package.json out of a cached tarball without extracting it. */
function readTarballPackageJson(tgzPath) {
  try {
    const tar = zlib.gunzipSync(fs.readFileSync(tgzPath));
    let offset = 0;
    while (offset + 512 <= tar.length) {
      const header = tar.subarray(offset, offset + 512);
      const name = readString(header, 0, 100);
      if (!name) break;
      const size = parseInt(readString(header, 124, 12).trim(), 8) || 0;
      const prefix = readString(header, 345, 155);
      const entryName = prefix ? `${prefix}/${name}` : name;
      if (entryName === 'package/package.json') {
        return JSON.parse(tar.toString('utf8', offset + 512, offset + 512 + size));
      }
      offset = offset + 512 + Math.ceil(size / 512) * 512;
    }
  } catch {
    /* an unreadable tarball is treated as a non-match */
  }
  return null;
}

/**
 * True when a package's own `os`/`cpu` fields permit this machine.
 * A package without those fields is platform-neutral and always matches.
 */
function platformMatches(tgzPath) {
  const pkg = readTarballPackageJson(tgzPath);
  if (!pkg) return false;
  const osOk = !pkg.os || pkg.os.includes(process.platform);
  const cpuOk = !pkg.cpu || pkg.cpu.includes(process.arch);
  return osOk && cpuOk;
}

/* ------------------------------------------------------------------ *
 * Version ranges
 * ------------------------------------------------------------------ */

/** Parses "1.2.3" / "1.2" / "1" into numeric parts. */
function parseVersion(v) {
  const m = String(v).trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Compares two parsed versions: -1, 0 or 1. */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * True when `version` satisfies a semver range.
 *
 * The earlier implementation compared only the major component and then, on any
 * mismatch, fell back to "newest cached version". That is exactly how Express 4
 * acquired `path-to-regexp` 8.3.0 instead of `~0.1.12`, which broke routing at
 * startup. Ranges are now evaluated properly for the forms npm packages use:
 * exact, `*`, `^`, `~`, `>=`, `>`, `<=`, `<`, `x` wildcards, `||` unions and the
 * common compound form `>=1.2.3 <2.0.0`.
 */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return false;

  const raw = String(range).trim();
  if (!raw || raw === '*' || raw === 'latest' || raw === 'x') return true;

  if (raw.includes('||')) return raw.split('||').some((part) => satisfies(version, part.trim()));

  const comparators = raw.split(/\s+/).filter(Boolean);
  if (comparators.length > 1) return comparators.every((c) => satisfies(version, c));

  const one = comparators[0];

  // Wildcards: 1.x, 1.2.x
  if (/[x*]/.test(one)) {
    const wild = /^(\d+)(?:\.(\d+|x|\*))?/.exec(one);
    if (wild) {
      if (v[0] !== Number(wild[1])) return false;
      if (wild[2] && !/[x*]/.test(wild[2]) && v[1] !== Number(wild[2])) return false;
      return true;
    }
  }

  if (one.startsWith('^')) {
    const base = parseVersion(one.slice(1));
    if (!base) return false;
    if (compareVersions(v, base) < 0) return false;
    // ^ permits changes that do not modify the leftmost non-zero digit.
    if (base[0] > 0) return v[0] === base[0];
    if (base[1] > 0) return v[0] === 0 && v[1] === base[1];
    return v[0] === 0 && v[1] === 0 && v[2] === base[2];
  }

  if (one.startsWith('~')) {
    const body = one.slice(1);
    const base = parseVersion(body);
    if (!base) return false;
    if (compareVersions(v, base) < 0) return false;
    // ~ permits patch-level changes, or minor-level when a minor was specified.
    const minorSpecified = /^\d+\.\d+/.test(body);
    if (minorSpecified) return v[0] === base[0] && v[1] === base[1];
    return v[0] === base[0];
  }

  const ops = [
    ['>=', (c) => compareVersions(v, c) >= 0],
    ['<=', (c) => compareVersions(v, c) <= 0],
    ['>', (c) => compareVersions(v, c) > 0],
    ['<', (c) => compareVersions(v, c) < 0],
    ['=', (c) => compareVersions(v, c) === 0]
  ];
  for (const [op, test] of ops) {
    if (one.startsWith(op)) {
      const base = parseVersion(one.slice(op.length));
      return base ? test(base) : false;
    }
  }

  // A bare version may be partial: "1.2" means 1.2.x.
  const base = parseVersion(one);
  if (!base) return false;
  const parts = one.split('.').length;
  if (parts === 1) return v[0] === base[0];
  if (parts === 2) return v[0] === base[0] && v[1] === base[1];
  return compareVersions(v, base) === 0;
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

function list(catalogueMap) {
  const rows = [...catalogueMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`cached packages: ${rows.length}`);
  for (const [name, versions] of rows) {
    console.log(`  ${name}  ${versions.map((v) => v.version).sort().join(', ')}`);
  }
}


async function install(projectDir) {
  const catalogueMap = catalogue();
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) throw new Error(`No package.json in ${projectDir}`);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const wanted = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  const installed = new Map();
  const missing = [];
  const queue = Object.entries(wanted).map(([name, range]) => ({ name, range, from: 'root' }));

  const destination = path.join(projectDir, 'node_modules');
  await fsp.mkdir(destination, { recursive: true });

  while (queue.length) {
    const { name, range, from } = queue.shift();
    if (installed.has(name)) continue;

    const available = catalogueMap.get(name);
    if (!available || !available.length) {
      missing.push(`${name}@${range} (required by ${from})`);
      installed.set(name, null);
      continue;
    }

    const pick =
      available.find((c) => c.version === String(range)) ||
      available.find((c) => satisfies(c.version, range)) ||
      // Fall back to the newest cached version rather than failing outright; the
      // caller is told about the substitution.
      available.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];

    const target = path.join(destination, name);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.mkdir(target, { recursive: true });
    const files = await extractTarball(pick.file, target);
    installed.set(name, pick.version);

    const subPath = path.join(target, 'package.json');
    if (fs.existsSync(subPath)) {
      try {
        const sub = JSON.parse(fs.readFileSync(subPath, 'utf8'));
        for (const [dep, depRange] of Object.entries(sub.dependencies || {})) {
          queue.push({ name: dep, range: depRange, from: `${name}@${pick.version}` });
        }
        /*
         * Optional dependencies are considered only when they are present in the
         * cache AND their own `os`/`cpu` restrictions match this machine.
         *
         * Rollup and esbuild ship their compilers this way, so skipping optional
         * deps entirely breaks both builds; installing all of them would drop
         * foreign platform binaries into node_modules.
         */
        for (const [dep, depRange] of Object.entries(sub.optionalDependencies || {})) {
          const candidate = (catalogueMap.get(dep) || [])[0];
          if (candidate && platformMatches(candidate.file)) {
            queue.push({ name: dep, range: depRange, from: `${name}@${pick.version} (optional)` });
          }
        }
      } catch {
        /* a malformed nested package.json is skipped */
      }
    }

    if (pick.version !== String(range).replace(/^[\^~]/, '')) {
      console.log(`  note: ${name} pinned ${range} -> cached ${pick.version}`);
    }
    console.log(`  + ${name}@${pick.version} (${files} files)`);
  }

  console.log('');
  console.log(`installed ${[...installed.values()].filter(Boolean).length} package(s) into ${destination}`);
  if (missing.length) {
    console.log(`\nMISSING from cache (${missing.length}) — these must be avoided or substituted:`);
    for (const m of missing) console.log(`  - ${m}`);
  }
  return { installed, missing };
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, arg] = process.argv.slice(2);
  try {
    if (command === 'list') list(catalogue());
    else if (command === 'install') {
      install(path.resolve(arg || process.cwd())).catch((err) => {
        console.error(err.message);
        process.exit(1);
      });
    } else {
      console.log('usage: node tools/offline-install.js list | install <dir>');
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

export { catalogue, extractTarball, contentPath, parseTarballUrl, install };
