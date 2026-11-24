const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const game = fs.readFileSync(__dirname + '/../src/game.js', 'utf8');

let frame = 0;
const now = () => frame * 1000 / 120;
const outgoing = [];
const clients = new Map();
function client(id) {
  const events = {}, canvas = {};
  const c = {id, key(type,code) { events[type]({code,target:canvas,preventDefault(){}}); }};
  const document = {
    getElementById:()=>canvas,querySelector:()=>null,
    addEventListener(type,cb) { events[type]=cb; }
  };
  const Arena = {
    map:{width:48,depth:40,walls:[],spawns:[{x:0,z:0,yaw:0},{x:0,z:-7,yaw:0}]},
    selectMap(){return this.map;},init(){return true;},draw(){}
  };
  const LAN = { id,hostId:'H',active:true,map:'dock',peers:[{id:'H',name:'H'},{id:'G',name:'G'}],
    onPeers(){},onClose(){},onMessage(cb){c.receive=cb;},
    send(body,to){outgoing.push({from:id,to,body:structuredClone(body)});} };
  const window={Arena,LAN,addEventListener(){}};
  vm.runInNewContext(game,{window,document,performance:{now},console,
    setInterval(cb){c.tick=cb;return 1;},requestAnimationFrame(cb){c.draw=cb;return 1;},
    clearInterval(){},cancelAnimationFrame(){}});
  c.game=window.Game; clients.set(id,c);
  assert(c.game.start({name:id}));
  return c;
}
const host=client('H'),guest=client('G');
let lastSnapshot;
function deliver() {
  while(outgoing.length){
    const msg=outgoing.shift();
    if(msg.from==='H'&&msg.body.t==='state')lastSnapshot=msg.body;
    for(const c of clients.values())if(c.id!==msg.from&&(!msg.to||msg.to===c.id))c.receive(msg.body,msg.from);
  }
}
function advance(frames,hold=false,drawEvery=2) {
  const samples=[];
  for(let i=0;i<frames;i++){
    frame++;
    if(frame%3===0)for(const c of clients.values())c.tick();
    if(!hold)deliver();
    if(frame%drawEvery===0){
      for(const c of clients.values())c.draw();
      samples.push([host.game.state.actors[0]?.x,guest.game.state.actors[0]?.x]);
    }
  }
  return samples;
}
deliver();advance(60);
host.key('keydown','KeyD');guest.key('keydown','KeyD');
advance(48); // Fill the 100 ms playout buffer for both renderers.
const moving=advance(120);
for(const [side,label] of ['host','guest'].entries()){
  const dx=moving.slice(1).map((p,i)=>p[side]-moving[i][side]);
  assert(Math.min(...dx)>.035 && Math.max(...dx)<.12,
    label+' should display continuous 60 Hz motion; step range '+Math.min(...dx)+' to '+Math.max(...dx));
  console.log(label+': min/max rendered movement per frame (m)',Math.min(...dx).toFixed(3),Math.max(...dx).toFixed(3));
}
const stalled=advance(48,true), recovered=advance(72);
for(const side of [0,1]){
  const positions=[stalled.at(-1),...recovered].map(p=>p[side]);
  const maxStep=Math.max(...positions.slice(1).map((x,i)=>Math.abs(x-positions[i])));
  assert(maxStep<.26,'buffered arrivals must not teleport on client '+side+': '+maxStep);
}
host.key('keyup','KeyD');guest.key('keyup','KeyD');advance(60);
// Packets carried across a spawn boundary must not pull an actor to the previous life.
const fixed=host.game.state.actors[0].x;
host.receive({t:'pose',x:19,z:18,feet:0,yaw:0,pitch:0,spawn:0},'G');
const before=guest.game.state.actors[0].x,stale=structuredClone(lastSnapshot);
const oldActor=stale.actors.find(a=>a.id==='H');
oldActor.spawn=0;oldActor.x=-20;
guest.receive(stale,'H');advance(48);
assert(Math.abs(host.game.state.actors[0].x-fixed)<1e-5);
assert(Math.abs(guest.game.state.actors[0].x-before)<1e-5);
const starts=[host.game.state.x,guest.game.state.x];
for(const c of clients.values())c.key('keydown','KeyD');
advance(120,false,40); // Three paints in one simulated second.
for(const [i,c] of [...clients.values()].entries()){
  assert(Math.abs(c.game.state.x-starts[i]-4.25)<.05,'low render FPS must not slow movement');
}
const start=host.game.state.x;
frame+=480; // Simulate four seconds of suspended timers and rendering.
host.tick();host.draw();
assert(host.game.state.x-start<.44,'a suspended tab must not replay four seconds of steps');
console.log('Verified grouped packet recovery, stale spawns, 3 FPS movement speed and bounded wake-up.');
