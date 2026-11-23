(() => {
  'use strict';

  const guns = [
    {name:'AR-24',cap:30,reserve:120,damage:27,delay:.105,semiDelay:.155,load:1.55,emptyLoad:1.92,spread:.009,kick:21},
    {name:'VX-9',cap:36,reserve:144,damage:19,delay:.080,semiDelay:.135,load:1.32,emptyLoad:1.66,spread:.016,kick:16},
    {name:'P-12',cap:12,reserve:60,damage:34,delay:.205,semiDelay:.205,load:1.04,emptyLoad:1.30,spread:.007,kick:24}
  ];
  const respawnSeconds = 15;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const now = () => performance.now() / 1000;
  const radius = .34, eyes = 1.54, duration = 300;
  const keys = new Set();
  let round = null, self = null, players = new Map(), effects = [], listeners = [];
  let phase = 'menu', canvas, overlay, ready = false, frame = 0, ticker = 0;
  let lastDraw = 0, lastTick = 0, lastHUD = 0, nextSync = 0, nextHello = 0;
  let fireHeld = false, aimHeld = false, jumpPressed = false;
  let muzzle = 0, hurt = 0, hit = 0, killConfirm = 0, aim = 0, bob = 0, walking = false, running = false;
  let clientReady = false, clientShot = 0, handoff = false, drag = null, audio, noise, muted = false;
  let controlsEngaged = false;
  let shotSerial = 0, switchedAt = -9, stride = 0, markSeed = 0, marks = [];
  const ui = (method, ...args) => window.UI?.[method]?.(...args);
  const map = () => window.Arena.map;
  const authority = () => round?.mode === 'host';
  const connected = () => round && window.LAN?.active;
  const send = (obj, to) => { if (connected()) window.LAN.send(obj, to); };
  function screen(next) {
    if (phase === next) return;
    phase = next;
    ui('screen', next);
  }
  function clearInput() {
    keys.clear();
    if (self?.triggerHeld) setTrigger(self,false);
    if (self) self.pressUntil=-1;
    fireHeld = aimHeld = jumpPressed = false;
    drag = null;
    walking = running = false;
  }

  function wakeAudio() {
    if (muted) return;
    try {
      if (!audio) {
        audio = new (window.AudioContext || window.webkitAudioContext)();
        noise = audio.createBuffer(1, audio.sampleRate * .28, audio.sampleRate);
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch { /* Audio is optional on devices without Web Audio. */ }
  }
  function tone(hz, end, seconds, volume, wave = 'sine', offset = 0) {
    if (muted || !audio || audio.state !== 'running') return;
    const src = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime + offset;
    src.type = wave;
    src.frequency.setValueAtTime(hz, t);
    src.frequency.exponentialRampToValueAtTime(end, t + seconds);
    gain.gain.setValueAtTime(Math.max(.0002, volume), t);
    gain.gain.exponentialRampToValueAtTime(.0001, t + seconds);
    src.connect(gain).connect(audio.destination);
    src.start(t); src.stop(t + seconds);
  }
  function blast(weapon, volume) {
    if (muted || !audio || audio.state !== 'running') return;
    const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
    const t = audio.currentTime, tail = [.13, .085, .105][weapon];
    src.buffer = noise;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime([6200, 7700, 5200][weapon], t);
    filter.frequency.exponentialRampToValueAtTime(440, t + tail);
    gain.gain.setValueAtTime(.24 * volume, t);
    gain.gain.exponentialRampToValueAtTime(.0001, t + tail);
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start(t,Math.random()*.09); src.stop(t + tail);
    tone([170, 230, 150][weapon], 40, tail * .9, .19 * volume);
    surfaceNoise([2200,3000,1700][weapon],.032,.09*volume,.016);
  }
  function surfaceNoise(hz, seconds, volume, delay=0) {
    if (muted || !audio || audio.state !== 'running') return;
    const src=audio.createBufferSource(), filter=audio.createBiquadFilter(), gain=audio.createGain();
    const t=audio.currentTime+delay;
    src.buffer=noise; filter.type='bandpass'; filter.frequency.value=hz;
    filter.Q.value=.85;
    gain.gain.setValueAtTime(volume,t);
    gain.gain.exponentialRampToValueAtTime(.0001,t+seconds);
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start(t,Math.random()*.09); src.stop(t+seconds);
  }
  function footfall(fast) {
    const variation=.9+Math.random()*.2;
    tone((fast ? 106 : 91)*variation,43,.095,fast ? .090 : .060);
    surfaceNoise(670*variation,.075,fast ? .105 : .065);
    surfaceNoise(1750*variation,.045,.036,.025);
  }
  function impactSound(distance) {
    const volume=1/(1+distance*.095), delay=Math.min(.12,distance*.003);
    surfaceNoise(2450+Math.random()*800,.075,.20*volume,delay);
    tone(745+Math.random()*440,310,.049,.038*volume,'triangle',delay);
  }

  function makePlayer(id, name) {
    return {
      id, name: String(name || 'PLAYER').slice(0, 20),
      x: 0, z: 0, feet: 0, vy: 0, yaw: 0, pitch: 0, grounded: true,
      weapon: 0, mags: guns.map(g => g.cap), stock: guns.map(g => g.reserve),
      hp: 100, kills: 0, deaths: 0, respawnAt: 0, safeUntil: 0, nextShot: 0,
      reloadAt:0,reloadEmpty:false,reloadCue:-1,flashUntil:0,
      modes:['auto','auto','semi'],triggerHeld:false,pressUntil:-1,lastShotAt:-10,shotsFired:0,chain:0,
      kickUp:0,kickUpSpeed:0,kickSide:0,kickSideSpeed:0,kickTime:0,deathYaw:0,deathFloor:0,
      destX: null, destZ: null, destYaw: 0, destFeet: 0, spawnNo: 0
    };
  }
  function spawn(p, first = false) {
    const living = [...players.values()].filter(a => a !== p && a.hp > 0);
    let spots = [...map().spawns];
    if (!first && living.length) {
      const score = s => Math.min(...living.map(a => Math.hypot(s.x - a.x, s.z - a.z)));
      spots.sort((a, b) => score(b) - score(a));
    }
    const s = spots[0];
    p.x = s.x; p.z = s.z; p.feet = p.vy = 0; p.grounded = true;
    p.yaw = s.yaw ?? (first ? -.55 : Math.atan2(-p.x, p.z));
    p.pitch = 0; p.hp = 100; p.respawnAt = p.reloadAt = 0; p.spawnNo++;
    p.reloadCue=-1; p.reloadEmpty=false; p.triggerHeld=false; p.pressUntil=-1; p.lastShotAt=-10; p.shotsFired=0;
    resetKick(p);
    p.mags = guns.map(g => g.cap); p.stock = guns.map(g => g.reserve);
    p.nextShot = round.time + .26; p.safeUntil = round.time + 2.2;
    if (p === self) { hurt = muzzle = aim = stride = 0; clearInput(); }
  }
  function overlaps(x, z, w, r = radius) {
    const dx = Math.max(Math.abs(x - w.x) - w.w / 2, 0);
    const dz = Math.max(Math.abs(z - w.z) - w.d / 2, 0);
    return dx * dx + dz * dz < r * r;
  }
  function canStand(x, z, feet = 0, r = radius) {
    const m = map();
    return Math.abs(x) <= m.width / 2 - r && Math.abs(z) <= m.depth / 2 - r &&
      !m.walls.some(w => w.h > feet + .03 && overlaps(x, z, w, r));
  }
  function move(p, dx, dz) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / .25));
    for (let i = 0; i < steps; i++) {
      if (canStand(p.x + dx / steps, p.z, p.feet)) p.x += dx / steps;
      if (canStand(p.x, p.z + dz / steps, p.feet)) p.z += dz / steps;
    }
  }
  function floorBelow(p) {
    let floor = 0;
    for (const w of map().walls) {
      if (w.h <= p.feet + .04 && overlaps(p.x, p.z, w)) floor = Math.max(floor, w.h);
    }
    return floor;
  }
  function vertical(p, dt) {
    const floor=floorBelow(p);
    p.vy -= 18.5 * dt;
    p.feet += p.vy * dt;
    p.grounded = p.feet <= floor;
    if (p.grounded) { p.feet = floor; p.vy = 0; }
  }
  function walkLocal(dt) {
    let right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
      (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
      (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const length = Math.hypot(right, forward);
    walking = length > 0;
    running = walking && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !aimHeld && !fireHeld;
    if (length) {
      const speed = running ? 6.4 : aimHeld ? 2.5 : 4.25;
      forward *= speed * dt / length; right *= speed * dt / length;
      const s = Math.sin(self.yaw), c = Math.cos(self.yaw);
      const oldX=self.x, oldZ=self.z;
      move(self, right * c + forward * s, right * s - forward * c);
      if (self.grounded && !jumpPressed) {
        stride+=Math.hypot(self.x-oldX,self.z-oldZ);
        const stepLength=running?1.92:aimHeld?1.34:1.72;
        if (stride>=stepLength) { stride-=stepLength; footfall(running); }
      }
      bob += dt * (running ? 13 : 9);
    } else stride=Math.min(stride,.3);
    if (jumpPressed && self.grounded) { self.vy = 5.7; self.grounded = false; }
    jumpPressed = false;
    vertical(self, dt);
  }

  // Slab intersection uses the same solid boxes as player collision.
  function rayBox(o, d, lo, hi, limit) {
    let near = 0, far = limit;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-6) {
        if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
        continue;
      }
      let a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a); far = Math.min(far, b);
      if (near > far) return Infinity;
    }
    return near;
  }
  function wallDistance(o, d, max, hitSurface) {
    let dist = max;
    for (const w of map().walls) {
      const entry=rayBox(o,d,[w.x-w.w/2,0,w.z-w.d/2],[w.x+w.w/2,w.h,w.z+w.d/2],dist);
      if (entry<dist) { dist=entry; if (hitSurface) hitSurface.wall=w; }
    }
    if (d[1]<-.0001 && -o[1]/d[1]<dist) {
      dist=-o[1]/d[1]; if (hitSurface) hitSurface.wall=null;
    }
    return dist;
  }
  function impactNormal(point,wall) {
    if (!wall) return [0,1,0];
    const local=[point[0]-wall.x,point[1]-wall.h/2,point[2]-wall.z];
    const half=[wall.w/2,wall.h/2,wall.d/2];
    const gaps=local.map((n,i)=>Math.abs(Math.abs(n)-half[i]));
    const axis=gaps.indexOf(Math.min(...gaps)), normal=[0,0,0];
    normal[axis]=Math.sign(local[axis])||1;
    return normal;
  }
  function echo(event) {
    receiveEvent(event);
    if (round.mode === 'host') send({t:'event', e:event});
  }
  function receiveEvent(e) {
    if (!e || !self) return;
    if (e.kind === 'frag') {
      ui('feed', e.killer + '  ▸  ' + e.victim);
      if (e.source === self.id) {
        killConfirm=.48; ui('elimination',e.victim);
        tone(620,920,.07,.055,'triangle'); tone(920,1380,.12,.038,'sine',.045);
      }
      const fallen=players.get(e.target);
      if (fallen && fallen.spawnNo===e.spawn) {
        fallen.hp=0; fallen.respawnAt=e.at+respawnSeconds; fallen.deathYaw=e.yaw;
        fallen.x=fallen.destX=e.x; fallen.z=fallen.destZ=e.z; fallen.feet=fallen.destFeet=e.feet;
        fallen.deathFloor=e.floor;
        fallen.reloadAt=0; fallen.triggerHeld=false; fallen.pressUntil=-1;
        checkLife();
      }
    }
    if (e.kind === 'shot') {
      const shooter = players.get(e.source);
      if (!shooter) return;
      shooter.flashUntil = Math.max(round.time,e.at) + .075;
      if (shooter !== self) {
        shooter.lastShotAt=e.at; shooter.shotsFired=e.serial;
        const distance = Math.hypot(shooter.x-self.x, shooter.z-self.z);
        blast(shooter.weapon, .48 / (1 + distance*.12));
      }
      if (e.victim === self.id) { hurt = .38; tone(95, 48, .11, .11); }
      if (e.victim && shooter === self) { hit = .19; tone(900, 650, .045, .065); }
      const [x,y,z] = e.to;
      effects.push({x,y,z,ax:e.from[0],ay:e.from[1],az:e.from[2],type:'trace',life:.075});
      if (e.impact && !e.victim) effects.push({x,y,z,type:'impact',life:.22});
      if (e.normal) {
        const [nx,ny,nz]=e.normal;
        marks.push({type:'mark',x:x+nx*.014,y:y+ny*.014,z:z+nz*.014,nx,ny,nz,
          life:10,maxLife:10,born:round.time,seed:++markSeed});
        if (marks.length>32) marks.shift();
        if (shooter===self) impactSound(Math.hypot(x-self.x,y-self.feet-eyes,z-self.z));
      }
    }
  }
  function reloadProgress(p,time) {
    if (!p.reloadAt) return -1;
    const g=guns[p.weapon],length=p.reloadEmpty?g.emptyLoad:g.load;
    return clamp(1-(p.reloadAt-time)/length,0,1);
  }
  function reloadCues(p,progress) {
    const cue=progress<.17?0:progress<.54?1:progress<.76?2:progress<.89?3:4;
    if (cue===p.reloadCue) return;
    p.reloadCue=cue;
    const volume=p===self?1:.30/(1+.16*Math.hypot(p.x-self.x,p.z-self.z));
    if (cue===0 || cue===1) surfaceNoise(cue===0?1050:2350,.075,.13*volume);
    if (cue===2) surfaceNoise(640,.095,.12*volume);
    if (cue===3) {tone(285,100,.047,.065*volume,'triangle');surfaceNoise(2800,.044,.16*volume);}
    if (cue===4 && p.reloadEmpty) surfaceNoise(1750,.062,.14*volume);
  }
  function beginReload(p, notifyHost=true) {
    const i = p.weapon;
    if (p.hp <= 0 || p.reloadAt || p.mags[i] >= guns[i].cap || !p.stock[i]) return;
    p.reloadEmpty=p.mags[i]===0; p.reloadCue=-1; p.pressUntil=-1;
    p.reloadAt=round.time+(p.reloadEmpty?guns[i].emptyLoad:guns[i].load);
    reloadCues(p,0);
    if (p === self) {
      ui('hud',viewState());
      if (!authority() && notifyHost) send({t:'reload',seq:++clientShot,spawn:p.spawnNo}, window.LAN.hostId);
    }
  }
  function changeWeapon(p, i) {
    if (!Number.isInteger(i) || !guns[i] || p.weapon === i || p.hp <= 0) return;
    if (p.triggerHeld) setTrigger(p,false);
    p.weapon = i; p.reloadAt = 0; p.reloadEmpty=false; p.reloadCue=-1; p.pressUntil=-1;
    p.nextShot = Math.max(p.nextShot, round.time + .22);
    resetKick(p);
    if (p === self) {
      muzzle = 0; fireHeld=false; switchedAt = round.time;
      tone(420, 140, .06, .038, 'triangle');
      if (!authority()) send({t:'weapon',i,seq:++clientShot,spawn:p.spawnNo}, window.LAN.hostId);
    }
  }
  function changeFireMode(p,mode) {
    if (p.weapon===2 || !['semi','auto'].includes(mode) || p.modes[p.weapon]===mode || !p.hp) return;
    if (p.triggerHeld) setTrigger(p,false);
    p.pressUntil=-1; p.modes[p.weapon]=mode;
    if (p===self) {
      fireHeld=false; surfaceNoise(2050,.037,.085);
      ui('hud',viewState());
      if (!authority()) send({t:'fireMode',mode,seq:++clientShot,spawn:p.spawnNo},window.LAN.hostId);
    }
  }
  function resetKick(p) {
    p.kickUp=p.kickUpSpeed=p.kickSide=p.kickSideSpeed=p.chain=0;
    p.kickTime=round.time;
  }
  function advanceKick(p,time) {
    const dt=Math.max(0,time-p.kickTime);
    if (!dt) return;
    p.kickTime=time;
    const rate=18, fall=Math.exp(-rate*dt);
    const up=p.kickUpSpeed+rate*p.kickUp, side=p.kickSideSpeed+rate*p.kickSide;
    p.kickUp=(p.kickUp+up*dt)*fall; p.kickUpSpeed=(p.kickUpSpeed-rate*up*dt)*fall;
    p.kickSide=(p.kickSide+side*dt)*fall; p.kickSideSpeed=(p.kickSideSpeed-rate*side*dt)*fall;
  }
  // Trigger edges are reliable room messages. Each machine schedules held fire on its
  // simulation clock so rendering frequency and packet batching cannot change the cadence.
  function setTrigger(p,down) {
    if (p.triggerHeld===down) return;
    p.triggerHeld=down;
    if (p===self && !authority()) {
      send({t:'trigger',down,ads:aimHeld,seq:++clientShot,...poseMessage()},window.LAN.hostId);
    }
    if (down) {
      p.pressUntil=round.time+.125;
      serviceTrigger(p,round.time);
    }
  }
  function serviceTrigger(p,time) {
    const pressed=p.pressUntil>=time,auto=p.modes[p.weapon]==='auto';
    if (!(pressed || (p.triggerHeld && auto)) || p.hp<=0 || p.reloadAt || time+.00001<p.nextShot || round.ended) return;
    p.pressUntil=-1;
    discharge(p,time,auto&&!pressed);
  }
  function discharge(p,time,held) {
    const i = p.weapon, gun = guns[i];
    if (!p.mags[i]) { if (authority()) beginReload(p,false); return; }
    const interval=p.modes[i]==='auto'?gun.delay:gun.semiDelay;
    const continuous=time-p.lastShotAt<interval*1.9;
    // Keep the phase of an ongoing burst. After a stalled tab, emit at most one shot.
    const next=held && continuous ? Math.max(time-.04,p.nextShot) : time;
    p.nextShot=next+interval; p.chain=continuous?Math.min(6,p.chain+1):0;
    p.lastShotAt=time; p.shotsFired++; p.mags[i]--; p.safeUntil=0;
    advanceKick(p,time);
    const yawKick=p.kickSide*.020,pitchKick=p.kickUp*.022;
    const ads=p===self?aimHeld:p.ads;
    const force=gun.kick*(ads ? .68 : 1)*(1+p.chain*.045);
    p.kickUp+=.085; p.kickUpSpeed=Math.min(49,p.kickUpSpeed+force);
    const sway=Math.sin(p.shotsFired*2.12+p.weapon)*.62+Math.sin(p.shotsFired*.77)*.38;
    p.kickSideSpeed+=sway*force*.38;
    if (p === self) {
      shotSerial++; muzzle=.065; blast(i,1);
      if (!authority()) return;
    }
    const jitter=gun.spread*(ads ? .33 : 1)*(1+p.chain*.11);
    const yaw=p.yaw+yawKick+(Math.random()-.5)*jitter*2;
    const pitch=p.pitch+pitchKick+(Math.random()-.5)*jitter*2;
    const cp = Math.cos(pitch), d = [Math.sin(yaw)*cp,Math.sin(pitch),-Math.cos(yaw)*cp];
    const o = [p.x,p.feet+eyes,p.z];
    const surface = {}, barrier = wallDistance(o, d, 80, surface);
    let distance = barrier, victim = null, critical = false;
    for (const target of players.values()) {
      if (target === p || target.hp <= 0) continue;
      const f = target.feet, x = target.x, z = target.z;
      const head = rayBox(o,d,[x-.225,f+1.37,z-.225],[x+.225,f+1.82,z+.225],distance);
      const body = rayBox(o,d,[x-.35,f+.06,z-.31],[x+.35,f+1.38,z+.31],distance);
      if (Math.min(head, body) < distance) {
        distance = Math.min(head,body); victim = target; critical = head < body;
      }
    }
    const damaged = victim && victim.safeUntil <= round.time;
    const from = [o[0]+d[0]*.45+Math.cos(yaw)*.13,o[1]-.13,o[2]+d[2]*.45+Math.sin(yaw)*.13];
    const to=o.map((v,j)=>v+d[j]*distance);
    echo({kind:'shot',at:time,serial:p.shotsFired,source:p.id,victim:damaged ? victim.id : null,from,to,
      impact:distance<80,normal:!victim && distance<80 ? impactNormal(to,surface.wall) : null});
    if (damaged) {
      const damage = Math.round(gun.damage * (critical ? 1.7 : 1));
      victim.hp = Math.max(0,victim.hp-damage);
      if (!victim.hp) {
        const deathTime = round.time + Math.max(0, now() - lastTick);
        p.kills++; victim.deaths++; victim.respawnAt = deathTime + respawnSeconds; victim.reloadAt = 0;
        victim.deathYaw=Math.atan2(d[0],-d[2]);
        victim.deathFloor=floorBelow(victim);
        echo({kind:'frag',source:p.id,killer:p.name,victim:victim.name,target:victim.id,
          at:deathTime,yaw:victim.deathYaw,spawn:victim.spawnNo,x:victim.x,z:victim.z,feet:victim.feet,floor:victim.deathFloor});
      }
    }
  }

  function pack(p) {
    return {id:p.id,name:p.name,x:p.x,z:p.z,f:p.feet,a:p.yaw,b:p.pitch,w:p.weapon,
      hp:p.hp,k:p.kills,d:p.deaths,spawn:p.spawnNo,safe:p.safeUntil,resp:p.respawnAt,
      reload:p.reloadAt,empty:p.reloadEmpty,modes:p.modes,shot:p.lastShotAt,serial:p.shotsFired,
      fall:p.deathYaw,floor:p.deathFloor,ammo:p.mags,stock:p.stock,ack:p.ack||0};
  }
  function snapshot(to) {
    send({t:'state',time:round.time,remaining:round.remaining,end:round.ended,actors:[...players.values()].map(pack)},to);
  }
  function applySnapshot(msg) {
    const listed=new Set(msg.actors.map(a=>a.id));
    if (!listed.has(self.id)) return;
    round.time=Math.max(round.time,msg.time); round.remaining=msg.remaining; lastTick=now();
    for (const a of msg.actors) {
      let p=players.get(a.id);
      if (!p) { p=makePlayer(a.id,a.name); players.set(p.id,p); }
      const fresh=!clientReady || p.spawnNo!==a.spawn;
      p.name=a.name; p.kills=a.k; p.deaths=a.d; p.safeUntil=a.safe;
      p.hp=a.hp; p.respawnAt=a.resp; p.spawnNo=a.spawn; p.deathYaw=a.fall; p.deathFloor=a.floor;
      if (fresh || p!==self || a.ack>=clientShot) {
        const predictedMagazine=p===self && !fresh && p.triggerHeld && !a.reload && !p.reloadAt && a.w===p.weapon;
        if (a.reload!==p.reloadAt && (!p.reloadAt || !a.reload)) p.reloadCue=-1;
        p.weapon=a.w; p.mags=a.ammo.slice(); p.stock=a.stock.slice(); p.reloadAt=a.reload;
        if (predictedMagazine) {
          const predictedShots=Math.max(0,p.shotsFired-a.serial);
          p.mags[p.weapon]=Math.max(0,p.mags[p.weapon]-predictedShots);
        } else if (!p.triggerHeld) p.shotsFired=a.serial;
        p.reloadEmpty=a.empty; p.modes=a.modes.slice();
      }
      if (p!==self) {
        p.destX=a.x; p.destZ=a.z; p.destFeet=a.f; p.destYaw=a.a; p.pitch=a.b;
        p.lastShotAt=a.shot; p.shotsFired=a.serial; p.flashUntil=Math.max(fresh?0:p.flashUntil,a.shot+.075);
      }
      if (fresh) {
        p.x=a.x; p.z=a.z; p.yaw=a.a; p.pitch=a.b; p.feet=a.f; p.vy=0;
        if (p===self) {
          p.triggerHeld=false; resetKick(p); p.shotsFired=a.serial; p.lastShotAt=a.shot;
          muzzle=hurt=0; clearInput();
        }
      }
    }
    for (const id of players.keys()) if (!listed.has(id)) players.delete(id);
    clientReady=true;
    if (msg.end) endRound();
    else checkLife();
  }
  function pose(p,m) {
    if (!p.hp || ![m.x,m.z,m.yaw,m.pitch,m.feet].every(Number.isFinite)) return;
    const dt=clamp(now()-(p.poseAt ?? now()),0,.8);
    const dx=m.x-p.x, dz=m.z-p.z, len=Math.hypot(dx,dz);
    const step=Math.min(1, (7*dt+.10)/(len || 1));
    // Apply streamed movement in short substeps so a missed packet cannot cross a wall.
    p.feet=clamp(m.feet,p.feet-8*dt-.2,p.feet+6*dt+.15);
    p.feet=clamp(p.feet,0,3.5);
    move(p,dx*step,dz*step);
    p.yaw=m.yaw; p.pitch=clamp(m.pitch,-1.3,1.3); p.ads=!!m.ads; p.poseAt=now();
  }
  function wireNetwork() {
    const lan=window.LAN;
    listeners.push(lan.onMessage((msg,from)=>{
      if (!round || !msg || typeof msg!=='object' || from===self.id) return;
      if (!authority()) {
        if (from!==lan.hostId) return;
        if (msg.t==='state' && Array.isArray(msg.actors)) applySnapshot(msg);
        if (msg.t==='event') receiveEvent(msg.e);
        return;
      }
      let p=players.get(from);
      if (msg.t==='hello') {
        if (!p) {
          const peer=lan.peers.find(a=>a.id===from);
          p=makePlayer(from,peer?.name || msg.name);
          players.set(from,p);
          p.weapon=Number.isInteger(msg.weapon) && guns[msg.weapon] ? msg.weapon : 0;
          spawn(p);
          round.started=true;
          ui('feed',p.name+' 已加入对局');
        }
        snapshot(from);
        return;
      }
      if (!p || round.ended || p.hp<=0) return;
      if (msg.spawn!==p.spawnNo) return;
      if (msg.t==='pose' || msg.t==='trigger') pose(p,msg);
      if (msg.t==='pose') return;
      if (!Number.isSafeInteger(msg.seq) || msg.seq<=(p.ack||0)) return;
      p.ack=msg.seq;
      if (msg.t==='weapon') changeWeapon(p,msg.i);
      if (msg.t==='reload') beginReload(p);
      if (msg.t==='fireMode') changeFireMode(p,msg.mode);
      if (msg.t==='trigger' && typeof msg.down==='boolean') setTrigger(p,msg.down);
    }));
    listeners.push(lan.onPeers(peers=>{
      if (!round || round.mode!=='host') return;
      const ids=new Set(peers.map(p=>p.id));
      for (const [id,p] of players) if (id!==self.id && !ids.has(id)) {
        players.delete(id); ui('feed',p.name+' 已离开对局');
      }
    }));
    listeners.push(lan.onClose(reason=>{
      if (!round) return;
      quit(); ui('notify',String(reason || '局域网连接已关闭'));
    }));
  }
  function poseMessage() {
    return {x:self.x,z:self.z,yaw:self.yaw,pitch:self.pitch,feet:self.feet,ads:aimHeld,spawn:self.spawnNo};
  }
  function hello() {
    send({t:'hello',name:self.name,weapon:self.weapon},window.LAN.hostId);
    nextHello=now()+.65;
  }
  function checkLife() {
    if (round.ended) return;
    if (self.hp<=0 && phase==='playing') { clearInput(); screen('dead'); }
    if (self.hp>0 && phase==='dead') { screen('playing'); ui('notify','已复活'); }
  }
  function endRound() {
    if (round.ended && phase==='ended') return;
    round.ended=true; round.remaining=0;
    clearInput();
    screen('ended'); releaseMouse();
    ui('hud',viewState());
    if (round.mode==='host') snapshot();
  }
  function tick() {
    if (!round) return;
    const n=now(), elapsed=Math.max(0,n-lastTick); lastTick=n;
    if (round.ended) return;
    if (authority() || clientReady) {
      round.time+=elapsed;
      if (round.started || round.mode==='join') round.remaining=Math.max(0,round.remaining-elapsed);
    }
    if (!round.remaining && authority()) { endRound(); return; }
    for (const p of players.values()) {
      if (p.hp<=0) {
        if (authority() && round.time>=p.respawnAt) spawn(p);
        else continue;
      }
      if (p.reloadAt) {
        reloadCues(p,reloadProgress(p,round.time));
        if (authority() && round.time>=p.reloadAt) {
          const i=p.weapon, amount=Math.min(guns[i].cap-p.mags[i],p.stock[i]);
          p.mags[i]+=amount; p.stock[i]-=amount; p.reloadAt=0; p.reloadCue=-1;
          if (p===self) tone(340,560,.045,.027,'triangle');
        }
      }
      if ((p===self && phase==='playing' && clientReady) || (authority() && p!==self)) serviceTrigger(p,round.time);
    }
    checkLife();
    if (round.mode==='join' && !clientReady && n>=nextHello) hello();
    if (n>=nextSync && connected()) {
      if (authority()) snapshot();
      else if (clientReady && self.hp>0) send({t:'pose',...poseMessage()},window.LAN.hostId);
      nextSync=n+1/15;
    }
  }

  function actorFeet(p,age) {
    return age<0?p.feet:Math.max(p.deathFloor,p.feet-9.25*age*age);
  }
  function viewState() {
    const g=guns[self.weapon], time=round.time;
    const reload=reloadProgress(self,time);
    const alive=self.hp>0, secondsToSpawn=alive ? 0 : clamp(self.respawnAt-time,0,respawnSeconds);
    const deathAge=alive?-1:Math.max(0,respawnSeconds-secondsToSpawn);
    const fall=clamp(deathAge/.70,0,1),deathDrop=fall*fall*(3-2*fall)*.95;
    const actors=[...players.values()].filter(p=>p!==self).map(p=>{
      const age=p.hp>0?-1:Math.max(0,time-p.respawnAt+respawnSeconds);
      return {id:p.id,name:p.name,x:p.x,y:actorFeet(p,age),z:p.z,yaw:p.yaw,pitch:p.pitch,team:'enemy',alive:p.hp>0,
        flash:p.hp>0 && p.flashUntil>time,hp:p.hp,weapon:p.weapon,spawnNo:p.spawnNo,fireMode:p.modes[p.weapon],
        reload:reloadProgress(p,time),reloadEmpty:p.reloadEmpty,shotSerial:p.shotsFired,shotAge:Math.max(0,time-p.lastShotAt),
        deathAge:age,deathYaw:p.deathYaw};
    });
    return {x:self.x,z:self.z,y:actorFeet(self,deathAge)+eyes-deathDrop+(walking?Math.sin(bob)*.024:0),
      yaw:self.yaw+self.kickSide*.020,pitch:self.pitch+self.kickUp*.022-deathDrop*.095,weapon:self.weapon,weaponName:g.name,ammo:self.mags[self.weapon],
      reserve:self.stock[self.weapon],maxAmmo:g.cap,hp:self.hp,kills:self.kills,deaths:self.deaths,
      secondsLeft:Math.max(0,Math.ceil(round.remaining)),respawnLeft:Math.ceil(secondsToSpawn),
      invulnerable:self.safeUntil>time,time,recoil:clamp(self.kickUp,0,1.5),recoilSide:clamp(self.kickSide,-1,1),
      flash:muzzle>0?muzzle/.065:0,hit,hurt,aim,killConfirm:clamp(killConfirm/.48,0,1),deathAge,
      fireMode:self.modes[self.weapon],canToggleFireMode:self.weapon!==2,reloadEmpty:self.reloadEmpty,
      reloadStage:reload<0?'':reload<.47?'取匣':reload<.86?'装匣':'就绪',
      bob,moving:walking,sprinting:running,reload,shotSerial,switchProgress:clamp(1-(time-switchedAt)/.22,0,1),
      actors,fx:effects.concat(marks),name:self.name,mode:round.mode,map:round.map,phase,controlsEngaged,
      leaderboard:[...players.values()].map(p=>({id:p.id,name:p.name,kills:p.kills,deaths:p.deaths,isMe:p===self}))
        .sort((a,b)=>b.kills-a.kills || a.deaths-b.deaths || a.name.localeCompare(b.name))};
  }
  function render() {
    if (!round) return;
    frame=requestAnimationFrame(render);
    const n=now(), dt=clamp(n-lastDraw,0,.065);
    lastDraw=n;
    if (phase==='playing' && self.hp>0 && clientReady) {
      walkLocal(dt);
    }
    if (!authority()) {
      for (const p of players.values()) if (p!==self && p.destX!==null) {
        const f=1-Math.exp(-dt*19);
        p.x+=(p.destX-p.x)*f; p.z+=(p.destZ-p.z)*f; p.feet+=(p.destFeet-p.feet)*f;
        p.yaw+=Math.atan2(Math.sin(p.destYaw-p.yaw),Math.cos(p.destYaw-p.yaw))*f;
      }
    }
    for (const fx of effects) fx.life-=dt;
    effects=effects.filter(fx=>fx.life>0);
    for (const m of marks) m.life=Math.max(0,m.maxLife-(round.time-m.born));
    marks=marks.filter(m=>m.life>0);
    advanceKick(self,round.time+Math.max(0,n-lastTick)); muzzle=Math.max(0,muzzle-dt);
    killConfirm=Math.max(0,killConfirm-dt);
    hurt=Math.max(0,hurt-dt); hit=Math.max(0,hit-dt);
    aim+=((aimHeld && self.hp>0 && !self.reloadAt ? 1 : 0)-aim)*(1-Math.exp(-dt*15));
    const state=viewState();
    window.Arena.draw(state);
    if (window.Weapon) window.Weapon.draw(overlay,state);
    if (n-lastHUD>1/30) { ui('hud',state); lastHUD=n; }
  }
  function ensureRenderer() {
    canvas=document.getElementById('scene'); overlay=document.getElementById('weapon');
    if (!ready) {
      if (!canvas || !overlay || !window.Arena) throw new Error('场景资源尚未就绪');
      if (window.Arena.init(canvas)===false) throw new Error('当前浏览器未启用 WebGL');
      ready=true;
    }
  }
  function requestMouse() {
    if (!canvas || document.pointerLockElement===canvas) return;
    try {
      const req=canvas.requestPointerLock?.();
      if (req?.catch) req.catch(()=>{});
    } catch { /* Drag-to-look remains available where capture is restricted. */ }
  }
  function releaseMouse() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }
  function look(dx,dy) {
    if (!self || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const sensitivity=(1-aim*.45)*.0021;
    self.yaw+=dx*sensitivity;
    self.pitch=clamp(self.pitch-dy*sensitivity,-1.3,1.3);
  }
  function resume() {
    if (!round || round.ended) return;
    clearInput(); lastDraw=now();
    screen(self.hp>0 ? 'playing' : 'dead');
    controlsEngaged=true;
    wakeAudio(); requestMouse();
  }
  function pause() {
    if (!round || !['playing','dead'].includes(phase)) return;
    clearInput(); controlsEngaged=false; screen('paused'); releaseMouse(); ui('hud',viewState());
  }
  function reset() {
    if (frame) cancelAnimationFrame(frame);
    if (ticker) clearInterval(ticker);
    for (const off of listeners) if (typeof off==='function') off();
    listeners=[]; players=new Map(); effects=[]; marks=[]; markSeed=stride=0; round=null; self=null;
    frame=ticker=0; clearInput(); controlsEngaged=handoff=false; clientShot=shotSerial=0; switchedAt=-9;
    muzzle=hurt=hit=killConfirm=aim=bob=0;
  }
  function quit() {
    const network=connected();
    reset(); screen('menu'); releaseMouse();
    if (network) {
      const result=window.LAN.leave?.();
      result?.catch?.(()=>{});
    }
  }
  function start(options={}) {
    const lan = window.LAN;
    if (!lan?.active || !lan.id || !lan.hostId) { ui('notify','请先连接局域网房间'); return false; }
    const mode = lan.id === lan.hostId ? 'host' : 'join';
    if (options.mode && options.mode !== mode) { ui('notify','当前身份与房间不符'); return false; }
    try {
      if (!window.Arena.selectMap(lan.map)) throw new Error('房间地图不可用');
      ensureRenderer();
    }
    catch (err) { ui('notify','场景加载失败 · '+err.message); return false; }
    reset();
    round={mode,map:lan.map,time:0,remaining:duration,started:false,ended:false};
    self=makePlayer(lan.id,options.name || 'PLAYER');
    self.weapon=Number.isInteger(options.weapon) && guns[options.weapon] ? options.weapon : 0;
    players.set(self.id,self); spawn(self,true);
    clientReady=mode!=='join';
    nextSync=0; lastTick=lastDraw=now(); lastHUD=0;
    wireNetwork();
    if (mode==='join') hello();
    const startPaused = mode === 'host' && options.startPaused === true;
    screen(startPaused ? 'paused' : 'playing');
    ticker=setInterval(tick,1000/40); render();
    return true;
  }
  function preview() {
    if (round) return;
    try {
      ensureRenderer();
      const s=map().spawns[0];
      window.Arena.draw({x:s.x,z:s.z,y:2.1,yaw:s.yaw??-.55,pitch:.05,time:0,aim:0,actors:[],fx:[]});
    } catch { /* The menu can be displayed independently of WebGL. */ }
  }

  document.addEventListener('keydown',e=>{
    if (!round || document.querySelector('dialog[open]') || e.target?.matches?.('input,textarea,[contenteditable=true]')) return;
    if (e.code==='Escape') {
      if (phase==='paused') resume(); else pause();
      return;
    }
    if (phase!=='playing' || !clientReady) return;
    if (['Space','ArrowUp','ArrowDown','ArrowRight','ArrowLeft','Tab'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code==='Space') jumpPressed=true;
    if (e.code==='KeyR') beginReload(self);
    if (e.code==='KeyB') {
      if (self.weapon===2) ui('notify','这把手枪使用单发模式');
      else changeFireMode(self,self.modes[self.weapon]==='auto'?'semi':'auto');
    }
    if (/^Digit[123]$/.test(e.code)) changeWeapon(self,Number(e.code.slice(-1))-1);
  });
  document.addEventListener('keyup',e=>keys.delete(e.code));
  function interactive(target) {
    return target?.closest?.('button,input,select,a,textarea,[role=button]');
  }
  document.addEventListener('mousedown',e=>{
    if (phase!=='playing' || !self || !clientReady || interactive(e.target) || document.querySelector('dialog[open]')) return;
    if (e.button!==0 && e.button!==2) return;
    wakeAudio();
    if (!document.pointerLockElement) {
      requestMouse();
      drag={x:e.clientX,y:e.clientY};
    }
    // The first click in an automatically opened match activates mouse look.
    // A restricted browser can still use click-and-drag if pointer lock was denied.
    if (!controlsEngaged) { controlsEngaged=true; ui('hud',viewState()); return; }
    if (e.button===0) { fireHeld=true; setTrigger(self,true); }
    if (e.button===2) { aimHeld=true; e.preventDefault(); }
  });
  document.addEventListener('mouseup',e=>{
    if (!e.buttons) drag=null;
    if (e.button===0 && self) {fireHeld=false;setTrigger(self,false);}
    if (e.button===2) aimHeld=false;
  });
  document.addEventListener('mousemove',e=>{
    if (phase!=='playing') return;
    if (document.pointerLockElement===canvas) look(e.movementX,e.movementY);
    else if (drag) { look(e.clientX-drag.x,e.clientY-drag.y); drag={x:e.clientX,y:e.clientY}; }
  });
  document.addEventListener('wheel',e=>{
    if (phase!=='playing' || !self || !e.deltaY || document.querySelector('dialog[open]')) return;
    e.preventDefault(); changeWeapon(self,(self.weapon+(e.deltaY>0 ? 1 : 2))%3);
  },{passive:false});
  document.addEventListener('contextmenu',e=>{ if (phase==='playing') e.preventDefault(); });
  document.addEventListener('pointerlockchange',()=>{
    const locked=document.pointerLockElement===canvas && !!canvas;
    if (!locked && handoff && (phase==='playing' || phase==='dead')) pause();
    handoff=locked;
    if (locked && (!round || phase === 'paused' || phase === 'ended')) releaseMouse();
  });
  function loseFocus() {
    if (phase!=='playing' && phase!=='dead') return;
    if (controlsEngaged) pause(); else clearInput();
  }
  window.addEventListener('blur',loseFocus);
  document.addEventListener('visibilitychange',()=>{ if (document.hidden) loseFocus(); });
  window.Game={start,preview,resume,pause,quit,respawnSeconds,
    selectWeapon(i){ if (self && phase==='playing') changeWeapon(self,i); },
    toggleSound(){ muted=!muted; if (!muted) wakeAudio(); return !muted; },
    setSound(enabled){ muted=!enabled; if (enabled) wakeAudio(); },
    get soundEnabled(){ return !muted; },
    get state(){ return round ? viewState() : null; },
    guns
  };
})();
