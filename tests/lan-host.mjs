import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
  vm.runInNewContext(app[1], { window, URL, URLSearchParams, addEventListener() {} });
  const room="白桦 O'Brien $ #";
  const generated = window.SingleFileHost.command(room,'rail');
  assert(generated.includes('%27'));
  assert(generated.includes(new URLSearchParams({room,map:'rail'}).toString()));
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
  assert(log.includes('map=rail'));
  const reuse=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-Command',launch],{
    windowsHide:true,timeout:10000,encoding:'utf8'
  });
  assert.equal(reuse.status,0,'rerunning the command should reuse the running service');
  assert(!reuse.stdout.includes('map=rail'),'a second listener must not start');
  const identity=await fetch(url+'/api/identity',{headers:{Origin:'null'}});
  assert.deepEqual(await identity.json(),{game:'greyport-arena',directPlay:2});
  assert.equal(identity.headers.get('access-control-allow-origin'),'null');
  assert.equal((await fetch(url+'/api/rooms',{headers:{Origin:'null'}})).headers.get('access-control-allow-origin'),null);
  assert.equal((await fetch(url+'/api/identity',{headers:{Origin:'https://example.org'}})).headers.get('access-control-allow-origin'),null);
  const cross=await fetch(url+'/api/enter',{method:'POST',headers:{Origin:'null','Content-Type':'application/json'},
    body:JSON.stringify({room:'test',name:'cross',map:'dock'})});
  assert.equal(cross.status,403);
  async function action(route, body) {
    const response = await fetch(url + '/api/' + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return [response.status, await response.json()];
  }

  // The browser adapter can enter the scene from disk without any HTTP request.
  const localRoute=new URL(pathToFileURL(file).href+'?'+new URLSearchParams({room,map:'rail'}));
  const localWindow={location:localRoute};
  vm.runInNewContext(app[1],{window:localWindow,location:localRoute,URL,URLSearchParams,addEventListener(){}});
  const local=localWindow.LAN;
  assert.equal(local.route().room,room);
  await local.enterRoom(room,'Player','rail');
  assert(local.localOnly && local.id===local.hostId && local.peers.length===1 && !local.shareUrl);
  await assert.rejects(local.createRoom(room,'Player','dock'));
  assert.equal(local.map,'rail');
  local.leave();assert(!local.active);

  // Drive the adapter with the real relay while retaining the browser's successful session
  // on a rejected room switch. No SSE messages are needed for this particular check.
  const sharedRoute=new URL('http://192.0.2.7:'+port+'/?room=A');
  const remoteWindow={location:sharedRoute};
  const departures=[];
  vm.runInNewContext(app[1],{window:remoteWindow,location:sharedRoute,URL,URLSearchParams,
    AbortController,setTimeout,clearTimeout,addEventListener(){},EventSource:class{close(){}},
    fetch:(path,options)=>fetch(url+path,options),
    navigator:{sendBeacon(path,data){departures.push(fetch(url+path,{method:'POST',body:data}));return true;}}});
  const lan=remoteWindow.LAN;
  await lan.enterRoom('Adapter','One','warehouse');
  const originalId=lan.id;
  await assert.rejects(lan.createRoom('Adapter','One','rail'));
  assert.equal(lan.id,originalId);assert.equal(lan.map,'warehouse');
  assert.equal(lan.shareUrl,sharedRoute.origin+'/?room=Adapter&map=warehouse');
  assert.equal((await lan.enterRoom('Adapter','One','dock')).id,originalId);
  await lan.createRoom('New Match','One','rail');assert.equal(lan.map,'rail');
  lan.leave();await Promise.all(departures);

  const [created, host] = await action('enter', { room, name: 'Host', map: 'rail' });
  assert.equal(created, 200);
  assert.equal((await action('create', { room, name: 'Peer' }))[0], 409);
  const [joined, peer] = await action('enter', { room, name: 'Peer', map: 'dock' });
  assert.equal(joined, 200);
  assert.equal(peer.map, 'rail');
  const list = async () => (await (await fetch(url + '/api/rooms')).json()).rooms;
  assert.equal((await list())[0].count, 2);
  // Eight simultaneous first arrivals create exactly one host and enter the same map.
  const arrivals=await Promise.all(Array.from({length:8},(_,i)=>action('enter',{room:'灰港',name:'player'+i,map:'dock'})));
  assert(arrivals.every(([status])=>status===200));
  const first=arrivals.map(([,p])=>p).filter(p=>p.role==='host');
  assert.equal(first.length,1);
  assert(arrivals.every(([,p])=>p.hostId===first[0].id && p.map==='dock'));
  assert.equal((await action('enter',{room:'灰港',name:'Ninth',map:'dock'}))[0],409);
  assert.equal((await action('leave',{token:first[0].token}))[0],200);
  assert.equal((await action('leave', { token: host.token }))[0], 200);
  assert.equal((await list()).length, 0);
  child.stdin.end('\n');
  const [status] = await Promise.race([exit, delay(5000, [-1], {ref:false})]);
  assert.equal(status, 0);
  console.log('Verified direct match links, isolated local discovery, eight concurrent arrivals, capacity, exact HTML, and shutdown.');
} finally {
  if (child && child.exitCode === null) child.kill();
  await rm(file, { force: true });
  await rmdir(scratch);
}
