import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const hosts = blocks.filter(([, attr]) => attr.includes('id="greyport-lobby"') && attr.includes('type="text/plain"'));
assert.equal(hosts.length, 1, 'expected one embedded LAN host');
assert(hosts[0][2].includes('OpenPage') && hosts[0][2].includes('/api/rooms'));

const scripts = blocks.filter(block => block !== hosts[0]);
assert.equal(scripts.length, 5);
for (const [index, [, attributes, code]] of scripts.entries()) {
  assert(!/\bsrc\s*=/i.test(attributes), 'external script found');
  new Script(code, { filename: 'embedded-' + index + '.js' });
}
for (const [, url] of html.matchAll(/\burl\(([^)]+)\)/g)) {
  assert(url.startsWith('data:'), 'external CSS dependency found');
}
assert(!/<(?:img|audio|video|source|link|iframe)\b[^>]*?(?:src|href)\s*=\s*["'](?!data:)/i.test(html));
assert((html.match(/data:image\/webp;base64,/g) || []).length >= 3);
assert(html.includes('data:font/ttf;base64,'));
console.log('Verified five inline JavaScript modules, embedded art and font, and the embedded LAN host.');
