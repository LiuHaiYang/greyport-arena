// Exercise the shipped simulation and its host/guest messages with a deterministic clock.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function readGame() {
  if (!process.argv.includes('--html')) return fs.readFileSync(__dirname + '/../src/game.js','utf8');
  const html = fs.readFileSync(__dirname + '/../index.html','utf8');
  const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const games = blocks.filter(([,code])=>/window\.Game\s*=\s*\{/.test(code));
  assert.equal(games.length,1,'single-file build must expose one game entry point');
  return games[0][1];
}
const script = readGame();

function scenario(shooterId, mapId) {
  const clients = new Map();
  const packets = [];
  let clock = 100000;
  let oneWayDelay = 0;
  function make(id) {
    const dom = {};
    const win = {};
    const order = [];
    const canvases = {scene:{}, weapon:{}};
    const client = {id, order, feed:[], frames:0, lockRequests:0, audioRequests:0};
    canvases.scene.requestPointerLock = () => {
      client.lockRequests++;
      document.pointerLockElement=canvases.scene;
      dom.pointerlockchange();
    };
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
      draw(state) { client.frames++; client.view=state; }
    };
    const LAN = {
      active:true, id, hostId:'H', map:mapId, peers:[{id:'H',name:'Host'},{id:'G',name:'Guest'}],
      send(body,to) {
        const message=structuredClone(body);
        if (id==='H' && message.t==='state') client.broadcast=message;
        packets.push({id,body:message,to,arrival:clock+oneWayDelay});
      },
      onMessage(fn) { client.receive=fn; return ()=>{client.receive=null}; },
      onClose() {}, onPeers() {}, leave(){ this.active=false; }
    };
    const ui = {
      feed(line){client.feed.push(line);},
      vitals(hp,kills,deaths,target){client.vitals={hp,kills,deaths,target};}
    };
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
    client.look = (yaw,pitch)=>{
      assert.equal(document.pointerLockElement,canvases.scene);
      const state=client.game.state;
      const yawDelta=Math.atan2(Math.sin(yaw-state.yaw),Math.cos(yaw-state.yaw));
      dom.mousemove({movementX:yawDelta/.0021,movementY:(state.pitch-pitch)/.0021});
    };
    client.blur = ()=>win.blur();
    client.key = (down,code)=>dom[down?'keydown':'keyup']({code,target:canvases.scene,preventDefault(){}});
    clients.set(id, client);
    return client;
  }
  function deliver() {
    while (packets.length && packets[0].arrival<=clock) {
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
  function aimAtTarget(xOffset,height,zOffset) {
    // Aim at the opponent supplied to Arena.draw, as seen by this shooter.
    const view=shooter.view, actor=view.actors[0];
    const dx=actor.x+xOffset-view.x, dz=actor.z+zOffset-view.z;
    shooter.look(Math.atan2(dx,-dz),Math.atan2(actor.y+height-view.y,Math.hypot(dx,dz)));
  }
  function tap() {
    shooter.press(true); advance(25); shooter.press(false); advance(200);
  }
  function bothSeeHp(hp) {
    assert.equal(target.game.state.hp,hp,'target HUD health');
    assert.equal(target.vitals.hp,hp,'the victim’s health bar updates independently of painting a frame');
    assert.equal(shooter.view.actors[0].hp,hp,'shooter’s displayed opponent health');
    assert.equal(authoritativeHp(),hp,'host simulation health');
  }
  target.press(true); target.press(false);
  target.look(Math.PI/2,0);
  const initialZ=target.game.state.z;
  target.key(true,'KeyD'); advance(300); target.key(false,'KeyD');
  advance(450);
  assert(target.game.state.z>initialZ+1,'target must move through keyboard input');
  assert(Math.abs(shooter.view.actors[0].z-target.game.state.z)<.06,'remote model must reach its new position');
  shooter.key(true,'KeyB'); shooter.key(false,'KeyB'); advance(200);
  assert.equal(shooter.game.state.fireMode,'semi');

  const middle={
    x:(shooter.view.x+target.view.x)/2,z:(shooter.view.z+target.view.z)/2,
    w:2,d:.20,h:1.48
  };
  for (const c of clients.values()) c.arena.map.walls.push(middle);
  aimAtTarget(0,1.12,0); tap();
  bothSeeHp(100);
  assert.equal(shooter.game.state.ammo,initialAmmo-1,'the shot into cover must have fired');
  for (const c of clients.values()) c.arena.map.walls.pop();

  // A neutral rifle pose places the support wrist about 0.41 m ahead of the body.
  // With the target facing +X this is beyond the old world-aligned torso box.
  for (const [point,hp] of [[[0,1.12,0],73],[[0,.93,0],46],[[.41,1.33,.11],19]]) {
    advance(450); aimAtTarget(...point); tap();
    bothSeeHp(hp);
    assert.equal(shooter.game.state.targetFeedback?.hp,hp,'hit confirmation must show the post-hit HP');
    assert.equal(shooter.vitals.target?.hp,hp,'the shooter’s target bar must receive the confirmed HP');
  }
  aimAtTarget(0,1.12,0);
  const deathDeadline=clock+500;
  shooter.press(true);
  while (authoritativeHp()>0 && clock<deathDeadline) advance(25);
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
  advance(300);
  aimAtTarget(0,1.12,0); tap();
  bothSeeHp(100);
  assert.equal(shooter.game.state.targetFeedback?.protected,true,'a protected hit must explain the unchanged health');

  oneWayDelay=100;
  advance(12000);
  target.look(0,0);
  target.key(true,'KeyD'); target.key(true,'ShiftLeft');
  advance(550);
  for (const hp of [73,46,19]) {
    // Sample the transmitted authoritative coordinate independently of the rendered actor.
    // At this offset a hit on the displayed vest would miss the current torso entirely.
    const deadline=clock+500;
    function lead() {
      const authoritative=host.broadcast.actors.find(a=>a.id===target.id);
      return authoritative.x-shooter.view.actors[0].x;
    }
    while (clock<deadline && lead()<.40) advance(25);
    assert(lead()>=.40,'test must aim at a moving target at least 0.40 m behind its authoritative pose');
    aimAtTarget(0,1.12,0); tap(); advance(450);
    bothSeeHp(hp);
  }
  target.key(false,'KeyD'); target.key(false,'ShiftLeft');
  advance(650);
  shooter.key(true,'KeyB'); shooter.key(false,'KeyB'); advance(300);
  assert.equal(shooter.game.state.fireMode,'auto');
  const burstStart=shooter.game.state.ammo;
  aimAtTarget(0,1.12,0);
  shooter.press(true); advance(350); shooter.press(false); advance(350);
  assert(shooter.game.state.ammo<=burstStart-3,'holding the trigger must fire several rounds');
  bothSeeHp(0);
  assert.equal(target.game.state.deaths,2);
  assert.equal(shooter.game.state.kills,2);
  console.log(mapId + ', shooter ' + shooterId + ': covered, visible-body and protected shots verified; respawn crossed 15s. Three moving chest hits also matched both HUDs with 100 ms each way.');
}
scenario('H','rail');
scenario('G','warehouse');
