// Exercise the shipped simulation and its host/guest messages with a deterministic clock.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function readModule(file,assignment) {
  if (!process.argv.includes('--html')) return fs.readFileSync(__dirname + '/../src/'+file,'utf8');
  const html = fs.readFileSync(__dirname + '/../index.html','utf8');
  const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const modules = blocks.filter(([,code])=>assignment.test(code));
  assert.equal(modules.length,1,'single-file build must expose one '+file+' module');
  return modules[0][1];
}
const script = readModule('game.js',/window\.Game\s*=\s*\{/);

function scenario(shooterId, mapId, extraChecks) {
  const clients = new Map();
  const packets = [];
  let clock = 100000;
  let oneWayDelay = 0;
  let peers=[{id:'H',name:'Host'},{id:'G',name:'Guest'}];
  function make(id) {
    const dom = {};
    const win = {};
    const order = [];
    const canvases = {scene:{}, weapon:{}};
    const client = {id, order, feed:[], damage:[], frames:0, lockRequests:0, audioRequests:0, random:.5};
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
      active:true, id, hostId:'H', map:mapId, peers,
      send(body,to) {
        const message=structuredClone(body);
        if (id==='H' && message.t==='state') client.broadcast=message;
        if (id==='H' && message.t==='event' && message.e.kind==='shot') client.lastShot=message.e;
        if (message.t==='hello') client.hello=message;
        packets.push({id,body:message,to,arrival:clock+oneWayDelay});
      },
      onMessage(fn) { client.receive=fn; return ()=>{client.receive=null}; },
      onClose() {}, onPeers(fn){client.peersChanged=fn;return ()=>{client.peersChanged=null;};},
      leave(){this.active=false;}
    };
    const ui = {
      feed(line){client.feed.push(line);},
      damage(amount){client.damage.push(amount);},
      vitals(hp,kills,deaths,target){client.vitals={hp,kills,deaths,target};}
    };
    const document = {
      addEventListener(event,fn) {dom[event]=fn;}, getElementById:id=>canvases[id],
      querySelector(){return null;}, pointerLockElement: null
    };
    const window = {Arena, LAN, UI:ui, addEventListener(event,fn){win[event]=fn;},
      AudioContext:class {constructor(){client.audioRequests++;throw Error('No audio device in test');}}};
    const math = Object.create(Math);
    math.random = () => client.random;
    const context = vm.createContext({window, document, performance:{now:()=>clock}, Math:math,
      requestAnimationFrame(fn){client.render=fn;return 1;}, cancelAnimationFrame(){},
      setInterval(fn){client.tick=fn;return 1;}, clearInterval(){}, console
    });
    vm.runInContext(script,context);
    client.game = window.Game;
    client.lan = LAN;
    client.arena = Arena;
    client.press = down=>dom[down?'mousedown':'mouseup']({button:0,buttons:down?1:0,target:canvases.scene});
    client.right = down=>dom[down?'mousedown':'mouseup']({button:2,buttons:down?2:0,target:canvases.scene,preventDefault(){}});
    client.moveMouse = (movementX,movementY)=>dom.mousemove({movementX,movementY});
    client.look = (yaw,pitch)=>{
      assert.equal(document.pointerLockElement,canvases.scene);
      const state=client.game.state;
      const yawDelta=Math.atan2(Math.sin(yaw-state.yaw),Math.cos(yaw-state.yaw));
      dom.mousemove({movementX:yawDelta/.0021,movementY:(state.pitch-pitch)/.0021});
    };
    client.blur = ()=>win.blur();
    client.key = (down,code,repeat=false)=>dom[down?'keydown':'keyup']({code,repeat,target:canvases.scene,preventDefault(){}});
    client.wheel = deltaY=>dom.wheel({deltaY,target:canvases.scene,preventDefault(){}});
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
  function publishRoster(list) {
    peers=list;
    for(const c of clients.values()) {c.lan.peers=peers;c.peersChanged?.(peers);}
  }
  function joinThird() {
    const c=make('J');
    publishRoster([...peers,{id:c.id,name:c.id}]);
    assert(c.game.start({map:mapId,name:c.id}));
    for(const participant of clients.values()) {
      const spots=participant.arena.map.spawns;
      spots.push({x:spots[0].x+12,z:spots[0].z-3,yaw:0});
    }
    advance(400);
    return c;
  }
  function disconnect(c) {
    c.game.quit(); clients.delete(c.id);
    publishRoster(peers.filter(peer=>peer.id!==c.id));
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
  if (extraChecks) {
    oneWayDelay=50;
    extraChecks({shooter,target,clients,advance,aimAtTarget,bothSeeHp,tap,joinThird,disconnect});
    return;
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

function verifyLoadout({shooter,target,clients,advance,aimAtTarget,bothSeeHp,tap}) {
  const state=()=>shooter.game.state;
  const remote=()=>target.view.actors.find(a=>a.id===shooter.id);
  const key=code=>{shooter.key(true,code); shooter.key(false,code);};
  function slot(index) {
    advance(300);
    assert.equal(state().weapon,index,'local selected weapon');
    assert.equal(remote().weapon,index,'remote equipped model');
  }
  function approach(stopAt=1.45) {
    const actor=shooter.view.actors[0];
    shooter.look(Math.atan2(actor.x-state().x,state().z-actor.z),0);
    const distance=()=>Math.hypot(actor.x-state().x,actor.z-state().z);
    shooter.key(true,'KeyW');
    for(let i=0;i<80 && distance()>stopAt;i++) advance(25);
    shooter.key(false,'KeyW');
    advance(175);
    assert(distance()>stopAt-.15 && distance()<=stopAt,'approach a stationary opponent through movement input');
    aimAtTarget(0,1.12,0);
  }

  key('Digit1'); slot(0);
  assert.equal(state().weaponName,'AR-24');
  shooter.look(Math.PI/2,0);
  tap();
  const rifleAmmo=state().ammo, rifleReserve=state().reserve;
  assert.equal(rifleAmmo,29);
  key('KeyR'); advance(250);
  assert(state().reload>0 && remote().reload>0,'rifle reload starts on both clients');
  key('Digit2'); slot(1);
  assert.equal(state().weaponName,'P-12');
  assert.equal(state().reload,-1);
  assert.equal(remote().reload,-1);
  key('KeyB'); advance(150);
  assert.equal(state().fireMode,'semi');
  assert.equal(state().canToggleFireMode,false);
  shooter.press(true); advance(750); shooter.press(false); advance(200);
  assert.equal(state().ammo,11,'holding the pistol trigger consumes a single round');
  const pistolReserve=state().reserve;
  key('KeyQ'); slot(0);
  advance(1750);
  assert.equal(state().ammo,rifleAmmo,'cancelled reload must not refill the rifle in the background');
  assert.equal(state().reserve,rifleReserve);
  key('KeyQ'); slot(1);
  assert.equal(state().ammo,11);
  key('KeyR'); advance(250);
  assert(state().reload>0 && remote().reload>0,'pistol reload starts on both clients');
  key('Digit3'); slot(2);
  assert.equal(state().weaponName,'战术刀');
  key('KeyR'); key('KeyB'); advance(150);
  assert.equal(state().reload,-1);
  assert.equal(state().canToggleFireMode,false);
  shooter.wheel(-120); slot(1);
  advance(1250);
  assert.equal(state().ammo,11,'switching to the knife cancelled the pistol reload');
  assert.equal(state().reserve,pistolReserve);
  shooter.wheel(120); slot(2);
  shooter.wheel(120); slot(0);
  shooter.wheel(-120); slot(2);

  aimAtTarget(0,1.12,0);
  const initialSwing=state().swingSerial;
  const shots=state().shotSerial;
  shooter.press(true);
  advance(200);
  assert(state().swingProgress>=0 && state().swingProgress<1,'local swing animation');
  assert(remote().swingProgress>=0 && remote().swingProgress<1,'remote swing animation');
  advance(950);
  shooter.press(false); advance(150);
  bothSeeHp(100);
  assert.equal(state().swingSerial,initialSwing+1,'holding the knife must start a single swing');
  assert.equal(remote().swingSerial,state().swingSerial,'remote observes the same swing');
  assert.equal(state().swingProgress,-1);
  assert.equal(state().shotSerial,shots,'knife did not discharge a firearm');
  assert(!shooter.view.fx.some(e=>e.type==='trace'));

  approach(2.55); // The nearest body surface is still beyond the 1.8 m blade reach.
  tap(); advance(450); bothSeeHp(100);
  approach();
  shooter.look(state().yaw+Math.PI,0);
  tap(); advance(450); bothSeeHp(100);
  aimAtTarget(0,1.12,0);
  const wall={x:(state().x+target.game.state.x)/2,z:(state().z+target.game.state.z)/2,w:2,d:.12,h:2};
  for(const c of clients.values()) c.arena.map.walls.push(wall);
  tap(); advance(550); bothSeeHp(100);
  for(const c of clients.values()) c.arena.map.walls.pop();
  shooter.press(true); advance(50);
  bothSeeHp(100); // Still winding up the swing.
  shooter.press(false); advance(200);
  bothSeeHp(45);
  const firstHit=state().swingSerial;
  tap(); advance(200);
  bothSeeHp(45);
  assert.equal(state().swingSerial,firstHit,'a click during cooldown must not start a second swing');
  tap(); advance(100);
  bothSeeHp(0);
  assert.equal(state().kills,1);
  assert.equal(target.game.state.deaths,1);
  assert.equal(target.game.state.phase,'dead');
  advance(15200);
  bothSeeHp(100);
  approach();
  assert.equal(target.game.state.invulnerable,true);
  tap(); advance(100);
  bothSeeHp(100);
  assert.equal(state().targetFeedback?.protected,true);
  advance(2350);
  key('Digit2'); slot(1);
  aimAtTarget(0,1.12,0); tap();
  bothSeeHp(66);
  assert.equal(state().ammo,10);
  key('KeyR'); advance(1700);
  assert.equal(state().ammo,12,'a completed pistol reload restores the two missing rounds');
  assert.equal(state().reserve,pistolReserve-2);
  console.log(shooter.id+' loadout: rifle/pistol/knife, number keys, Q, wheel, cancelled reloads, networked swings, cover, reach, cooldown and respawn shield passed.');
}

if (require.main===module) {
  scenario('H','rail');
  scenario('G','warehouse');
  scenario('H','dock',verifyLoadout);
  scenario('G','rail',verifyLoadout);
}
module.exports={scenario,readModule};
