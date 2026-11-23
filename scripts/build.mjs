import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('index.html', root);
const src = new URL('src/', root);
const read = name => readFile(new URL(name, src), 'utf8');

async function inlineAsset(name, mime) {
  const data = await readFile(new URL('assets/' + name, src));
  return 'data:' + mime + ';base64,' + data.toString('base64');
}

const [page, style, poster, font, sky, face, fontLicense, weapon, arena,
  lan, game, icons, map, ui, hostSource, hostHelper] = await Promise.all([
  read('lobby.html'), read('style.css'), inlineAsset('greyport.webp', 'image/webp'),
  inlineAsset('barlow-condensed.ttf', 'font/ttf'), inlineAsset('harbor-sky.webp', 'image/webp'),
  inlineAsset('operator-face.webp', 'image/webp'), read('assets/OFL.txt'),
  read('weapon.js'), read('arena.js'), read('room-lan.js'), read('game.js'), read('icons.js'),
  read('map.js'), read('pure-ui.js'), read('room-server.cs'), read('single-file-host.js')
]);

// The generated type name allows two revisions to open in one PowerShell session.
const hostType = 'GreyportLobby_' + createHash('sha256').update(hostSource).digest('hex').slice(0, 12);
const lobby = hostSource.replace(/\bGreyportLobby\b/g, hostType);
if (/<\/script\b/i.test(lobby)) throw new Error('Unexpected HTML delimiter in host source');

const sections = {
  STYLE: style.replace('__POSTER__', () => poster).replace('__FONT__', () => font),
  WEAPON: weapon,
  ARENA: arena.replace('__GREYPORT_SKY_DATA__', () => sky).replace('__GREYPORT_FACE_DATA__', () => face),
  LAN: hostHelper.replace('__GREYPORT_HOST_TYPE__', hostType) + '\n' + lan,
  GAME: game,
  UI: [icons, map, ui].join('\n')
};
const html = page.replace(/\/\*__(\w+)__\*\//g, (_, key) => {
  if (!(key in sections)) throw new Error('Unknown template section: ' + key);
  return sections[key];
}).replace('</head>', () => '<!-- Barlow Condensed font license\n' + fontLicense +
  '\n-->\n<script id="greyport-lobby" type="text/plain">' + lobby + '</script>\n</head>');

if (/__POSTER__|__FONT__|__GREYPORT_\w+__|\/\*__\w+__\*\//.test(html)) {
  throw new Error('An asset or section is missing');
}
const result = Buffer.from(html, 'utf8');
if (process.argv.length === 2) {
  await writeFile(output, result);
} else if (process.argv.length === 3 && process.argv[2] === '--check') {
  if (!result.equals(await readFile(output))) throw new Error('index.html differs from the source build');
} else {
  throw new Error('Usage: node scripts/build.mjs [--check]');
}
const digest = createHash('sha256').update(result).digest('hex');
console.log('index.html | ' + result.length + ' bytes | SHA-256 ' + digest);
