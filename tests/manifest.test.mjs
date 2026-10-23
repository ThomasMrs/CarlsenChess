import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDirectory = path.resolve(fileURLToPath(new URL('../extension/', import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(extensionDirectory, 'manifest.json'), 'utf8'));

async function assertExtensionFile(relativePath) {
  assert.equal(typeof relativePath, 'string', 'An extension entry point must have a local path.');
  assert.ok(relativePath.length > 0 && !/^[a-z][a-z\d+.-]*:/i.test(relativePath), `Remote entry point: ${relativePath}`);
  const absolutePath = path.resolve(extensionDirectory, relativePath);
  assert.ok(absolutePath.startsWith(`${extensionDirectory}${path.sep}`), `Entry point escapes the extension: ${relativePath}`);
  assert.ok((await stat(absolutePath)).isFile(), `Missing extension file: ${relativePath}`);
  return absolutePath;
}

function sourcesFor(directiveName, policy) {
  const directive = policy.split(';').map(value => value.trim()).find(value => value.split(/\s+/)[0] === directiveName);
  return directive ? directive.split(/\s+/).slice(1) : [];
}

test('Chrome receives an identifiable Manifest V3 extension', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'CarlsenChess');
  assert.match(manifest.version, /^\d+(?:\.\d+){0,3}$/);
  assert.ok(manifest.action && !manifest.action.default_popup, 'The toolbar action must activate the current tab.');
  assert.ok(Number.parseInt(manifest.minimum_chrome_version, 10) >= 116, 'This extension uses runtime.getContexts, available from Chrome 116.');
});

test('activation uses only the requested tab and local extension capabilities', () => {
  assert.deepEqual([...(manifest.permissions ?? [])].sort(), ['activeTab', 'offscreen', 'scripting', 'storage'].sort());
  assert.deepEqual(manifest.host_permissions ?? [], [], 'No permanent site access is needed.');
  assert.deepEqual(manifest.optional_host_permissions ?? [], [], 'No optional broad site access is needed.');
  assert.deepEqual(manifest.content_scripts ?? [], [], 'Injection must be initiated by the toolbar action.');
  assert.equal(manifest.externally_connectable, undefined, 'Web pages must not directly command the engine.');
});

test('the extension policy permits local WebAssembly without JavaScript eval or remote code', () => {
  const policy = manifest.content_security_policy?.extension_pages;
  assert.equal(typeof policy, 'string');
  const scriptSources = sourcesFor('script-src', policy);
  assert.ok(scriptSources.includes("'self'"));
  assert.ok(scriptSources.includes("'wasm-unsafe-eval'"), 'The local Stockfish WebAssembly module needs wasm-unsafe-eval.');
  assert.ok(!scriptSources.includes("'unsafe-eval'"));
  assert.ok(!scriptSources.includes("'unsafe-inline'"));
  assert.ok(scriptSources.every(value => value === "'self'" || value === "'wasm-unsafe-eval'"), 'Scripts must come from the extension package.');
  assert.ok(sourcesFor('object-src', policy).every(value => value === "'self'" || value === "'none'"));
});

test('manifest entry points and exposed styles are present in the source extension', async () => {
  assert.equal(manifest.background?.type, 'module');
  await assertExtensionFile(manifest.background?.service_worker);
  const iconPaths = new Set([
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(typeof manifest.action?.default_icon === 'object' ? manifest.action.default_icon : {}),
  ]);
  for (const iconPath of iconPaths) await assertExtensionFile(iconPath);
  const sourceFiles = (await readdir(extensionDirectory, { recursive: true })).map(value => value.split(path.sep).join('/'));
  for (const group of manifest.web_accessible_resources ?? []) {
    for (const resource of group.resources ?? []) {
      assert.ok(!resource.startsWith('/') && !resource.split('/').includes('..'), 'Exposed resources must stay in the extension.');
      if (resource.includes('*')) {
        assert.ok(resource.includes('/'), 'Do not expose the entire extension package.');
        const pattern = new RegExp(`^${resource.split('*').map(part => part.replace(/[|\\{}()[\]\^$+?.]/g, '\\$&')).join('[^/]*')}$`);
        const matches = sourceFiles.filter(file => pattern.test(file));
        assert.ok(matches.length > 0, `Exposed resource pattern does not match any packaged file: ${resource}`);
        for (const match of matches) await assertExtensionFile(match);
      } else await assertExtensionFile(resource);
    }
  }
});


test('the offscreen document loads local files without inline executable code', async () => {
  const offscreenPath = await assertExtensionFile('offscreen.html');
  const html = await readFile(offscreenPath, 'utf8');
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scriptTags.length > 0, 'The offscreen document must load the engine coordinator.');
  for (const [, attributes, inlineCode] of scriptTags) {
    assert.equal(inlineCode.trim(), '', 'MV3 extension pages cannot use inline executable scripts.');
    const source = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    assert.ok(source, 'Offscreen scripts need local src attributes.');
    await assertExtensionFile(source);
  }
});
