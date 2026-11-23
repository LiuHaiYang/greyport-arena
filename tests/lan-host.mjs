import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

if (process.platform !== 'win32') {
  console.log('Skipped the LAN host integration test. It requires Windows PowerShell.');
  process.exit(0);
}

const index = new URL('../index.html', import.meta.url);
const scratch = await mkdtemp(fileURLToPath(new URL('.lan-test-', import.meta.url)));
const file = join(scratch, "主机 O'Brien (局域网)$ #.html");
let child;
try {
  await copyFile(index, file);
  const expected = await readFile(index);
  const sources = [...expected.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const app = sources.find(([, source]) => source.includes('window.SingleFileHost ='));
  assert(app);
  const window = { location: { href: pathToFileURL(file).href + '?revision=1#host' } };
  vm.runInNewContext(app[1], { window, URL, addEventListener() {} });
  const generated = window.SingleFileHost.command();
  assert(generated.includes('%27'));
  window.location.href = 'http://127.0.0.1/';
  assert.equal(window.SingleFileHost.command(), '');

  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  // Exercise the command printed by the HTML on loopback, without opening a browser.
  const launch = generated.replace("'0.0.0.0',8787,$true", "'127.0.0.1'," + port + ',$false');
  assert.notEqual(launch, generated);
  child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', launch], { windowsHide: true });
  const exit = once(child, 'exit');
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const url = 'http://127.0.0.1:' + port;
  for (let retry = 0; ; retry++) {
    try {
      assert((await fetch(url + '/api/rooms')).ok);
      break;
    } catch (error) {
      if (retry >= 90 || child.exitCode !== null) throw new Error(log || String(error));
      await delay(100);
    }
  }
  const served = Buffer.from(await (await fetch(url + '/')).arrayBuffer());
  assert(served.equals(expected), 'the host must serve the exact release file');
  async function action(route, body) {
    const response = await fetch(url + '/api/' + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return [response.status, await response.json()];
  }

  const room = '测试大厅';
  const [created, host] = await action('create', { room, name: 'Host', map: 'rail' });
  assert.equal(created, 200);
  assert.equal((await action('create', { room, name: 'Peer' }))[0], 409);
  const [joined, peer] = await action('join', { room, name: 'Peer' });
  assert.equal(joined, 200);
  assert.equal(peer.map, 'rail');
  const list = async () => (await (await fetch(url + '/api/rooms')).json()).rooms;
  assert.equal((await list())[0].count, 2);
  assert.equal((await action('leave', { token: host.token }))[0], 200);
  assert.equal((await list()).length, 0);
  child.stdin.end('\n');
  const [status] = await Promise.race([exit, delay(5000, [-1], {ref:false})]);
  assert.equal(status, 0);
  console.log('Verified the Windows host, exact HTML delivery, room creation, joining, duplicate rejection, and shutdown.');
} finally {
  if (child && child.exitCode === null) child.kill();
  await rm(file, { force: true });
  await rmdir(scratch);
}
