// Exercise the shipped simulation and its host/guest messages with a deterministic clock.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(__dirname + '/../src/game.js', 'utf8');

function scenario(shooterId, mapId) {
  const clients = new Map();
  const packets = [];
  let clock = 100000;
  function make(id) {
    const dom = {};
    const win = {};
    const order = [];
    const canvases = {scene:{}, weapon:{}};
    const client = {id, order, feed:[], frames:0, lockRequests:0, audioRequests:0};
    canvases.scene.requestPointerLock = () => {client.lockRequests++;};
    const spots = {
      dock:[0,0], rail:[3,5], warehouse:[-4,-4]
    };
    const Arena = {
      selectMap(id) {
        order.push('select ' + id);
        if (!spots[id]) return false;
        const [x,z] = spots[id];
        this.map = {width:48, depth:40, walls:[], spawns:[
          {x,z,yaw:0}, {x,z:z-7,yaw:Math.PI}
        ]};
        return this.map;
      },
      init() { order.push('init'); return true; },
      draw() { client.frames++; }
    };
    const LAN = {
      active:true, id, hostId:'H', map:mapId, peers:[{id:'H',name:'Host'},{id:'G',name:'Guest'}],
      send(body,to) { packets.push({id,body:structuredClone(body),to}); },
      onMessage(fn) { client.receive=fn; return ()=>{client.receive=null}; },
      onClose() {}, onPeers() {}, leave(){ this.active=false; }
    };
    const ui = {feed(line){client.feed.push(line)}};
    const document = {
      addEventListener(event,fn) {dom[event]=fn;}, getElementById:id=>canvases[id],
      querySelector(){return null;}, pointerLockElement: null
    };
    const window = {Arena, LAN, UI:ui, addEventListener(event,fn){win[event]=fn;},
      AudioContext:class {constructor(){client.audioRequests++;throw Error('No audio device in test');}}};
    const math = Object.create(Math);
    math.random = () => .5;
    const context = vm.createContext({window, document, performance:{now:()=>clock}, Math:math,
      requestAnimationFrame(fn){client.render=fn;return 1;}, cancelAnimationFrame(){},
      setInterval(fn){client.tick=fn;return 1;}, clearInterval(){}, console
    });
    vm.runInContext(script,context);
    client.game = window.Game;
    client.lan = LAN;
    client.arena = Arena;
    client.press = down=>dom[down?'mousedown':'mouseup']({button:0,buttons:down?1:0,target:canvases.scene});
    client.blur = ()=>win.blur();
    client.key = (down,code)=>dom[down?'keydown':'keyup']({code,target:canvases.scene,preventDefault(){}});
    clients.set(id, client);
    return client;
  }
  function deliver() {
    while (packets.length) {
      const packet=packets.shift();
      for (const c of clients.values()) {
        if (c.id!==packet.id && (!packet.to || c.id===packet.to)) c.receive?.(packet.body,packet.id);
      }
    }
  }
  function advance(ms) {
    const end=clock+ms;
    while(clock<end) {
      clock=Math.min(end,clock+25);
      for (const c of clients.values()) c.tick?.();
      deliver();
      for (const c of clients.values()) c.render?.();
      deliver();
    }
  }
  const host=make('H'), guest=make('G');
  host.lan.active=false;
  assert.equal(host.game.start(),false);
  assert.equal(host.frames,0);
  host.lan.active=true;
  for (const client of [host,guest]) {
    assert.equal(client.game.start({mode:'solo'}),false);
    assert.equal(client.game.start({map:'untrusted-option',name:client.id}),true);
    assert.deepEqual(client.order.slice(0,2),['select '+mapId,'init']);
    assert.equal(client.game.respawnSeconds,15);
    assert.equal(client.game.state.map,mapId);
    assert.equal(client.game.state.phase,'playing');
    assert.equal(client.game.state.controlsEngaged,false);
    assert.equal(client.lockRequests,0);
    assert.equal(client.audioRequests,0);
    client.blur();
    assert.equal(client.game.state.phase,'playing');
    deliver();
    if (client===host) {
      const startZ=host.game.state.z;
      host.key(true,'KeyW');advance(250);host.key(false,'KeyW');
      assert(host.game.state.z<startZ);
      host.key(true,'KeyS');advance(250);host.key(false,'KeyS');
      advance(500);
      assert.equal(host.game.state.secondsLeft,300);
      assert.equal(host.game.state.actors.length,0);
    }
  }
  assert.equal(host.game.state.actors.length,1);
  assert.equal(guest.game.state.z,guest.arena.map.spawns[1].z);
  assert.equal(guest.game.state.z,host.game.state.actors[0].z);
  assert.equal(host.game.state.z,guest.game.state.actors[0].z);
  advance(2300);
  const shooter=clients.get(shooterId), target=clients.get(shooterId==='H'?'G':'H');
  const initialAmmo=shooter.game.state.ammo;
  shooter.press(true);advance(350);shooter.press(false);
  assert.equal(shooter.game.state.controlsEngaged,true);
  assert.equal(shooter.lockRequests,1);
  assert.equal(shooter.audioRequests,1);
  assert.equal(shooter.game.state.ammo,initialAmmo);
  function authoritativeHp() {
    return target===host ? host.game.state.hp : host.game.state.actors[0].hp;
  }
  shooter.press(true);
  while (authoritativeHp()>0 && clock<116000) advance(25);
  assert.equal(authoritativeHp(),0);
  const killedAt=clock;
  shooter.press(false);
  advance(100);
  assert.equal(target.game.state.phase,'dead');
  assert.equal(target.game.state.respawnLeft,15);
  advance(7400);
  host.game.pause();
  advance(7400);
  assert.equal(clock-killedAt,14900);
  assert.equal(authoritativeHp(),0);
  assert.equal(target.game.state.hp,0);
  assert.equal(target.game.state.respawnLeft,1);
  host.game.resume();
  advance(200);
  assert.equal(clock-killedAt,15100);
  assert.equal(authoritativeHp(),100);
  assert.equal(target.game.state.hp,100);
  assert.equal(target.game.state.phase,'playing');
  assert.equal(target.game.state.respawnLeft,0);
  assert.equal(target.game.state.deaths,1);
  assert.equal(shooter.game.state.kills,1);
  console.log(mapId + ', shooter ' + shooterId + ': host and guest both report HP=0 with 1s left at 14.900s; HP=100 at 15.100s (pause/resume included).');
}
scenario('H','rail');
scenario('G','warehouse');
