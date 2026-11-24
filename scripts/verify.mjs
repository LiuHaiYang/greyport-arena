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
const textures = html.match(/data:image\/webp;base64,[A-Za-z0-9+/=]+/g) || [];
assert.equal(textures.length, 2, 'expected one sky and one face texture');
assert(textures[0] !== textures[1], 'duplicate texture payload');
assert(html.includes('data-screen="connecting"') && html.includes('enterRoom') && !html.includes('id="lobby"'));
const fonts = [...html.matchAll(/url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\('woff2'\)/g)];
assert.equal(fonts.length, 1, 'expected one embedded WOFF2 font');
assert.equal(Buffer.from(fonts[0][1], 'base64').toString('ascii', 0, 4), 'wOF2');
console.log('Verified five inline JavaScript modules, embedded art and font, and the embedded LAN host.');
