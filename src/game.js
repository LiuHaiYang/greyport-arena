(() => {
  'use strict';

  const guns = [
    {name:'AR-24',cap:30,reserve:120,damage:27,delay:.105,semiDelay:.155,load:1.55,emptyLoad:1.92,spread:.009,kick:21},
    {name:'P-12',cap:12,reserve:60,damage:34,delay:.205,semiDelay:.205,load:1.04,emptyLoad:1.30,spread:.007,kick:24},
    {name:'战术刀',melee:true,cap:0,reserve:0,damage:55,range:1.8,delay:.55,duration:.42,contact:.10}
  ];
  const respawnSeconds = 15;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const now = () => performance.now() / 1000;
  const radius = .34, eyes = 1.54, duration = 300;
  const crouchDrop=.52, crouchSeconds=.18;
  const hipFov=72, hipHalfTangent=Math.tan(hipFov*Math.PI/360);
  const scopePowers=[2,4,8], scopeTransitionSeconds=.18;
  let scopeZoom=scopePowers[0], scopeScale=1, scopeFrom=1, scopeTo=1, scopeStarted=0;
  let scopeBlend=0, scopeBlendFrom=0;
  const keys = new Set();
  const wheelGesture={at:-1,direction:0,pixels:0,switched:false};
  let round = null, self = null, players = new Map(), effects = [], listeners = [];
  let phase = 'menu', canvas, overlay, ready = false, frame = 0, ticker = 0;
  let lastDraw = 0, lastTick = 0, lastHUD = 0, nextSync = 0, nextHello = 0;
  let lastMovement=0;
  let fireHeld = false, aimHeld = false, jumpPressed = false;
  let muzzle = 0, hurt = 0, hit = 0, killConfirm = 0, aim = 0, bob = 0, walking = false, running = false;
  let clientReady = false, clientShot = 0, handoff = false, drag = null, audio, noise, muted = false;
  let controlsEngaged = false;
  let targetFeedback = null;
  let shotSerial = 0, stride = 0, markSeed = 0, marks = [];
  const ui = (method, ...args) => window.UI?.[method]?.(...args);
  const map = () => window.Arena.map;
  const authority = () => round?.mode === 'host';
  const connected = () => round && window.LAN?.active;
  const send = (obj, to) => { if (connected()) window.LAN.send(obj, to); };
  function currentTarget() {
    return self?.hp>0 && phase==='playing' && targetFeedback && now()<targetFeedback.until ? targetFeedback : null;
  }
  function refreshVitals() {
    ui('vitals',self.hp,self.kills,self.deaths,currentTarget());
  }
  function screen(next) {
    if (phase === next) return;
    phase = next;
    ui('screen', next);
  }
  function scopeActive() {
    return phase==='playing' && self?.weapon===0 && self.hp>0 && !self.reloadAt && aimHeld;
  }
  function resetScope() {
    scopeScale=scopeFrom=scopeTo=1;
    scopeBlend=scopeBlendFrom=0;
    if (round) {round.presentedKick=null; round.presentedEye=null;}
  }
  function updateScope(time) {
    const progress=clamp((time-scopeStarted)/scopeTransitionSeconds,0,1);
    const ease=progress*progress*(3-2*progress);
    scopeScale=progress===1 ? scopeTo : scopeFrom*Math.pow(scopeTo/scopeFrom,ease);
    const blendTarget=scopeTo>1?1:0;
    scopeBlend=scopeBlendFrom+(blendTarget-scopeBlendFrom)*ease;
    const target=scopeActive()?scopeZoom:1;
    if (target!==scopeTo) {
      scopeFrom=scopeScale; scopeBlendFrom=scopeBlend; scopeTo=target; scopeStarted=time;
    }
  }
  function fieldOfView() {
    if (self.weapon===1) return hipFov-16*aim;
    // Perspective projection scales by cot(fov / 2). Dividing the angle itself
    // would not produce the magnification engraved on the optic.
    return 360/Math.PI*Math.atan(hipHalfTangent/scopeScale);
  }
  function clearInput() {
    keys.clear();
    wheelGesture.at=-1;
    if (self?.triggerHeld) setTrigger(self,false);
    if (self) self.pressUntil=-1;
    fireHeld = aimHeld = jumpPressed = false;
    aim=0; resetScope();
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
    const t = audio.currentTime, tail = [.13, .105][weapon];
    src.buffer = noise;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime([6200, 5200][weapon], t);
    filter.frequency.exponentialRampToValueAtTime(440, t + tail);
    gain.gain.setValueAtTime(.24 * volume, t);
    gain.gain.exponentialRampToValueAtTime(.0001, t + tail);
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start(t,Math.random()*.09); src.stop(t + tail);
    tone([170,150][weapon], 40, tail * .9, .19 * volume);
    surfaceNoise([2200,1700][weapon],.032,.09*volume,.016);
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
      x:0,z:0,feet:0,yaw:0,pitch:0,crouch:0,grounded:true,
      velocityX:0,velocityZ:0,verticalSpeed:0,landing:0,equippedAt:-10,hurtAt:-10,
      weapon: 0, previousWeapon:1, mags: guns.map(g => g.cap), stock: guns.map(g => g.reserve),
      hp: 100, kills: 0, deaths: 0, respawnAt: 0, safeUntil: 0, nextShot: 0,
      reloadAt:0,reloadEmpty:false,reloadCue:-1,flashUntil:0,
      modes:['auto','semi','melee'],triggerHeld:false,pressUntil:-1,lastShotAt:-10,shotsFired:0,chain:0,
      lastSwingAt:-10,swings:0,pendingSwing:null,
      kickUp:0,kickUpSpeed:0,kickSide:0,kickSideSpeed:0,kickTime:0,deathYaw:0,deathFloor:0,
      poses:[],poseAt:null,movedAt:null,moveBudget:0,spawnNo:0
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
    p.x=s.x; p.z=s.z; p.feet=p.crouch=p.verticalSpeed=p.velocityX=p.velocityZ=p.landing=0;
    p.grounded=true; p.equippedAt=p.hurtAt=-10;
    p.yaw = s.yaw ?? (first ? -.55 : Math.atan2(-p.x, p.z));
    p.pitch = 0; p.hp = 100; p.respawnAt = p.reloadAt = 0; p.spawnNo++;
    p.poses.length=0;p.poseAt=p.movedAt=null;p.moveBudget=0;
    p.pendingSwing=null; p.lastSwingAt=-10; p.swings=0;
    if (p.spawnNo===1 || p.previousWeapon===p.weapon) p.previousWeapon=p.weapon===0?1:0;
    rememberPose(p,round.time);
    p.reloadCue=-1; p.reloadEmpty=false; p.triggerHeld=false; p.pressUntil=-1; p.lastShotAt=-10; p.shotsFired=0;
    resetKick(p);
    p.mags = guns.map(g => g.cap); p.stock = guns.map(g => g.reserve);
    p.nextShot = round.time + .26; p.safeUntil = round.time + 2.2;
    if (p === self) { lastMovement=now();hurt = muzzle = aim = stride = 0; targetFeedback = null; clearInput(); refreshVitals(); }
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
    const floor=floorBelow(p), wasGrounded=p.grounded;
    p.landing=Math.max(0,p.landing-dt/.18);
    p.verticalSpeed -= 18.5 * dt;
    p.feet += p.verticalSpeed * dt;
    p.grounded = p.feet <= floor;
    if (p.grounded) {
      if (!wasGrounded) p.landing=clamp(-p.verticalSpeed/5.7,0,1);
      p.feet=floor; p.verticalSpeed=0;
    }
  }
  function walkLocal(dt) {
    let right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
      (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
      (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const length = Math.hypot(right, forward);
    const crouching=keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    self.crouch+=clamp((crouching?1:0)-self.crouch,-dt/crouchSeconds,dt/crouchSeconds);
    self.velocityX=self.velocityZ=0;
    walking = length > 0;
    running = walking && !crouching && self.crouch<.01 &&
      (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !aimHeld && !fireHeld;
    if (length) {
      const standingSpeed=running?6.4:aimHeld?2.5:4.25;
      const speed=standingSpeed+(2-standingSpeed)*self.crouch;
      forward *= speed * dt / length; right *= speed * dt / length;
      const s = Math.sin(self.yaw), c = Math.cos(self.yaw);
      const oldX=self.x, oldZ=self.z;
      move(self, right * c + forward * s, right * s - forward * c);
      self.velocityX=(self.x-oldX)/dt; self.velocityZ=(self.z-oldZ)/dt;
      walking=Math.hypot(self.velocityX,self.velocityZ)>.02;
      running=running && walking;
      if (self.grounded && !jumpPressed) {
        stride+=Math.hypot(self.x-oldX,self.z-oldZ);
        const stepLength=running?1.92:aimHeld?1.34:1.72;
        if (stride>=stepLength) { stride-=stepLength; footfall(running); }
      }
      if (walking) bob+=dt*(running?13:9-3*self.crouch);
    } else stride=Math.min(stride,.3);
    if (jumpPressed && self.grounded) { self.verticalSpeed=5.7; self.grounded=false; }
    jumpPressed = false;
    vertical(self, dt);
  }
  function advanceLocalMovement(time) {
    // Physics runs even if no frame is painted. A frame between ticks consumes only
    // the remaining elapsed time, so a high-refresh local camera stays smooth.
    const elapsed=clamp(time-lastMovement,0,.10);
    lastMovement=time;
    // An open menu releases input but gravity and a released stance still settle
    // in the live match, including when a player pauses halfway through a jump.
    if ((phase!=='playing' && phase!=='paused') || !clientReady || self.hp<=0 || !elapsed)return;
    const steps=Math.ceil(elapsed*60);
    for(let i=0;i<steps;i++)walkLocal(elapsed/steps);
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
  // In the operator's own coordinates the front of the vest and the support
  // hand face -Z. Separating the shoulders from the head also keeps a shot
  // through the top of the vest at ordinary body damage.
  const bodyRegions = [
    [[-.27,.76,-.23],[.28,1.48,.28]],    // vest, pack and belt
    [[-.31,1.04,-.28],[.36,1.46,.13]],   // shoulders, upper arms
    [[-.14,1.12,-.50],[.18,1.40,-.18]]   // forearms and support hand
  ];
  const headRegion = [[-.145,1.47,-.21],[.20,1.82,.13]];
  function hitOperator(origin, direction, pose, limit) {
    const cs=Math.cos(pose.yaw), sn=Math.sin(pose.yaw);
    const x=origin[0]-pose.x, z=origin[2]-pose.z;
    const localOrigin=[x*cs+z*sn,origin[1]-pose.feet,z*cs-x*sn];
    const localRay=[direction[0]*cs+direction[2]*sn,direction[1],direction[2]*cs-direction[0]*sn];
    const stance=pose.crouch??0, drop=stance*crouchDrop;
    // Boots stay planted as the legs fold. The vest, arms and head keep their
    // dimensions and descend with the pelvis, as in the visible operator rig.
    let body=rayBox(localOrigin,localRay,[-.28,0,-.30-.14*stance],[.28,.90-drop,.26],limit);
    localOrigin[1]+=drop;
    const head=rayBox(localOrigin,localRay,headRegion[0],headRegion[1],limit);
    for (const [lo,hi] of bodyRegions) {
      body=Math.min(body,rayBox(localOrigin,localRay,lo,hi,Math.min(body,limit)));
    }
    return {distance:Math.min(head,body),critical:head<body};
  }
  function eyeBob(p) {
    return p===self ? (walking && p.grounded ? Math.sin(bob)*(.024-.012*p.crouch) : 0) : p.eyeBob || 0;
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
      const fallen=players.get(e.target), killer=players.get(e.source);
      if (!fallen || fallen.spawnNo!==e.spawn) return;
      if (killer && Number.isInteger(e.kills)) killer.kills=e.kills;
      if (Number.isInteger(e.deaths)) fallen.deaths=e.deaths;
      ui('feed', e.killer + '  ▸  ' + e.victim);
      if (e.source === self.id) {
        killConfirm=.48; ui('elimination',e.victim);
        tone(620,920,.07,.055,'triangle'); tone(920,1380,.12,.038,'sine',.045);
      }
      fallen.hp=0; fallen.respawnAt=e.at+respawnSeconds; fallen.deathYaw=e.yaw;
      fallen.x=e.x; fallen.z=e.z; fallen.feet=e.feet; fallen.poses.length=0;
      fallen.velocityX=fallen.velocityZ=fallen.verticalSpeed=fallen.landing=0;
      fallen.equippedAt=-10;fallen.deathFloor=e.floor;
      fallen.reloadAt=0; fallen.triggerHeld=false; fallen.pressUntil=-1;
      checkLife();refreshVitals();
    }
    if (e.kind === 'swing') {
      const actor=players.get(e.source);
      if (actor && actor!==self && actor.spawnNo===e.spawn && e.serial>=actor.swings) {
        actor.swings=e.serial; actor.lastSwingAt=e.at;
        surfaceNoise(1300,.12,.12/(1+Math.hypot(actor.x-self.x,actor.z-self.z)*.22));
      }
    }
    if (e.kind === 'shot' || e.kind === 'slash') {
      const shooter = players.get(e.source);
      if (!shooter) return;
      if (e.kind === 'shot') {
        shooter.flashUntil = Math.max(round.time,e.at) + .075;
        if (shooter !== self) {
          shooter.lastShotAt=e.at; shooter.shotsFired=e.serial;
          const distance = Math.hypot(shooter.x-self.x, shooter.z-self.z);
          const weapon=e.weapon??shooter.weapon;
          if (guns[weapon] && !guns[weapon].melee) blast(weapon, .48 / (1 + distance*.12));
        }
      }
      const struck = players.get(e.victim || e.protectedId);
      if (struck && struck.spawnNo === e.victimSpawn && Number.isFinite(e.hpAfter)) {
        // A shot and its final health arrive together, before the next periodic snapshot.
        const damage=Number.isFinite(e.damage)?e.damage:Math.max(0,struck.hp-e.hpAfter);
        if (!authority() && e.victim) struck.hp = Math.min(struck.hp, e.hpAfter);
        if (e.victim && damage>0) {
          struck.hurtAt=round.time;
          if (struck===self) {
            hurt=.38; tone(95,48,.11,.11); ui('damage',damage);
          }
          if (shooter===self) {hit=.19; tone(900,650,.045,.065);}
        }
        if (shooter === self) targetFeedback = {
          name:struck.name,hp:e.hpAfter,damage,protected:Boolean(e.protectedId),until:now()+1.15
        };
        if (struck === self || shooter === self) refreshVitals();
      }
      if (e.kind==='slash') {
        if (e.impact && (shooter===self || struck===self)) surfaceNoise(struck?370:1900,.055,.17);
        return;
      }
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
    if (guns[i].melee || p.hp <= 0 || p.reloadAt || p.mags[i] >= guns[i].cap || !p.stock[i]) return;
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
    p.previousWeapon=p.weapon; p.weapon=i; p.reloadAt=0; p.reloadEmpty=false; p.reloadCue=-1; p.pressUntil=-1;
    p.pendingSwing=null; p.lastSwingAt=-10; p.flashUntil=0;
    p.equippedAt=round.time;
    p.nextShot = Math.max(p.nextShot, round.time + .22);
    resetKick(p);
    if (p === self) {
      muzzle=0; fireHeld=false; aimHeld=false; aim=0;
      resetScope();
      tone(420, 140, .06, .038, 'triangle');
      if (!authority()) send({t:'weapon',i,seq:++clientShot,spawn:p.spawnNo}, window.LAN.hostId);
      ui('hud',viewState());
    }
  }
  function changeFireMode(p,mode) {
    if (p.weapon!==0 || !['semi','auto'].includes(mode) || p.modes[p.weapon]===mode || !p.hp) return;
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
  function cameraKick(p) {
    return [p.kickSide*.020,p.kickUp*.022];
  }
  function eyePosition(p) {
    return [p.x,p.feet+eyes-crouchDrop*p.crouch+eyeBob(p),p.z];
  }
  function scopedEye(p) {
    const actual=eyePosition(p), displayed=p===self?round.presentedEye:p.scopedEye;
    if (!displayed) return actual;
    const delta=displayed.map((v,i)=>v-actual[i]), distance=Math.hypot(...delta);
    // Only reconcile sub-frame travel. A delayed position cannot move a shot to
    // the other side of cover or back to the previous spawn.
    if (distance>.30 || distance<.00001) return actual;
    return wallDistance(actual,delta.map(v=>v/distance),distance)>=distance ? displayed : actual;
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
    if (guns[p.weapon].melee) beginSwing(p,time);
    else discharge(p,time,auto&&!pressed);
  }
  function attackViewTime(p) {
    return p===self ? localShotTime() : round.time-(p.sightDelay??interpolationDelay);
  }
  function beginSwing(p,time) {
    const knife=guns[p.weapon];
    p.lastSwingAt=time; p.nextShot=time+knife.delay; p.swings++; p.safeUntil=0;
    if (p===self) surfaceNoise(1300,.12,.20);
    if (!authority()) return;
    p.pendingSwing={at:time+knife.contact,origin:eyePosition(p),
      yaw:p.yaw,pitch:p.pitch,seenAt:attackViewTime(p)};
    echo({kind:'swing',source:p.id,spawn:p.spawnNo,at:time,serial:p.swings});
  }
  function swingProgress(p,time) {
    const knife=guns[p.weapon];
    if (!knife.melee || p.hp<=0 || p.swings===0) return -1;
    const progress=(time-p.lastSwingAt)/knife.duration;
    return progress<1 ? Math.max(0,progress) : -1;
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
    const ads=p===self?aimHeld:p.ads;
    const scoped=p.weapon===0 && ads;
    // At 8× even one tick of spring decay is visible. Use the recoil offset
    // that was on the shooter's screen, plus the latest mouse input.
    const displayedKick=p===self?round.presentedKick:p.scopedKick;
    const [yawKick,pitchKick]=scoped && displayedKick ? displayedKick : cameraKick(p);
    const force=gun.kick*(ads ? .68 : 1)*(1+p.chain*.045);
    p.kickUp+=.085; p.kickUpSpeed=Math.min(49,p.kickUpSpeed+force);
    const sway=Math.sin(p.shotsFired*2.12+p.weapon)*.62+Math.sin(p.shotsFired*.77)*.38;
    p.kickSideSpeed+=sway*force*.38;
    if (p === self) {
      shotSerial++; muzzle=.065; blast(i,1);
      if (!authority()) return;
    }
    // An isolated tap follows the sight. Spread builds during an uninterrupted burst.
    const jitter=gun.spread*(ads ? .33 : 1)*Math.min(1,p.chain/3);
    const yaw=p.yaw+yawKick+(Math.random()-.5)*jitter*2;
    const pitch=p.pitch+pitchKick+(Math.random()-.5)*jitter*2;
    const origin=scoped?scopedEye(p):eyePosition(p);
    resolveImpact(p,time,traceAttack(p,origin,yaw,pitch,80,attackViewTime(p)));
  }
  function finishSwing(p,time) {
    const swing=p.pendingSwing;
    if (!swing || time<swing.at) return;
    p.pendingSwing=null;
    // Each part of the short arc has its own wall test. Pick one contact for the entire swing.
    const range=guns[p.weapon].range;
    let contact=traceAttack(p,swing.origin,swing.yaw,swing.pitch,range,swing.seenAt);
    for (const offset of [-.15,.15,-.30,.30]) {
      const next=traceAttack(p,swing.origin,swing.yaw+offset,swing.pitch,range,swing.seenAt);
      if (next.victim && (!contact.victim || next.distance<contact.distance)) contact=next;
      else if (!contact.victim && next.distance<contact.distance) contact=next;
    }
    resolveImpact(p,time,contact);
  }
  function traceAttack(p,o,yaw,pitch,range,seenAt) {
    const cp = Math.cos(pitch), d = [Math.sin(yaw)*cp,Math.sin(pitch),-Math.cos(yaw)*cp];
    const surface = {}, barrier = wallDistance(o, d, range, surface);
    // Use the same history as the remote actor renderer. The shooter reports the
    // host-clock instant it was displaying, never a victim or a damage value.
    let distance = barrier, victim = null, critical = false;
    for (const target of players.values()) {
      if (target === p || target.hp <= 0) continue;
      const impact=hitOperator(o,d,visiblePoseAt(target,seenAt),distance);
      if (impact.distance < distance) {
        distance=impact.distance; victim=target; critical=impact.critical;
      }
    }
    return {o,d,yaw,distance,range,victim,critical,wall:surface.wall};
  }
  function resolveImpact(p,time,{o,d,yaw,distance,range,victim,critical,wall}) {
    const gun=guns[p.weapon], melee=!!gun.melee;
    const damaged = victim && victim.safeUntil <= round.time;
    const hpBefore=victim?.hp??0;
    if (damaged) {
      const damage = Math.round(gun.damage * (critical && !melee ? 1.7 : 1));
      victim.hp = Math.max(0,victim.hp-damage);
    }
    const from = [o[0]+d[0]*.45+Math.cos(yaw)*.13,o[1]-.13,o[2]+d[2]*.45+Math.sin(yaw)*.13];
    const to=o.map((v,j)=>v+d[j]*distance);
    echo({kind:melee?'slash':'shot',weapon:p.weapon,at:time,serial:melee?p.swings:p.shotsFired,
      source:p.id,victim:damaged ? victim.id : null,from,to,
      protectedId:victim && !damaged ? victim.id : null,victimSpawn:victim?.spawnNo,hpAfter:victim?.hp,
      damage:damaged?hpBefore-victim.hp:0,
      impact:distance<range,normal:!melee && !victim && distance<range ? impactNormal(to,wall) : null});
    if (damaged && !victim.hp) {
      const deathTime = round.time + Math.max(0, now() - lastTick);
      p.kills++; victim.deaths++; victim.respawnAt = deathTime + respawnSeconds; victim.reloadAt = 0;
      victim.deathYaw=Math.atan2(d[0],-d[2]);
      victim.deathFloor=floorBelow(victim);
      victim.pendingSwing=null;
      echo({kind:'frag',source:p.id,killer:p.name,kills:p.kills,victim:victim.name,target:victim.id,deaths:victim.deaths,
        at:deathTime,yaw:victim.deathYaw,spawn:victim.spawnNo,x:victim.x,z:victim.z,feet:victim.feet,floor:victim.deathFloor});
    }
  }

  const interpolationDelay=.10;
  const maxRewind=.35;
  function localShotTime() {
    const visibleFrame=round.presentedAt ?? renderTime();
    return Math.max(visibleFrame,renderTime()+interpolationDelay-maxRewind);
  }
  function renderTime() {
    const clock=authority() ? round.time+Math.max(0,now()-lastTick) :
      (round.hostOffset==null ? round.time : now()+round.hostOffset);
    return Math.max(0,clock-interpolationDelay);
  }
  function motion(p) {
    return {crouch:p.crouch,grounded:p.grounded,velocityX:p.velocityX,velocityZ:p.velocityZ,
      verticalSpeed:p.verticalSpeed,landing:p.landing};
  }
  function readMotion(p,m) {
    const bounded=(n,low,high)=>Number.isFinite(n)?clamp(n,low,high):0;
    p.crouch=bounded(m.crouch,0,1); p.landing=bounded(m.landing,0,1);
    p.velocityX=bounded(m.velocityX,-6.4,6.4);p.velocityZ=bounded(m.velocityZ,-6.4,6.4);
    p.verticalSpeed=bounded(m.verticalSpeed,-20,5.7);
    p.grounded=typeof m.grounded==='boolean'?m.grounded:p.feet<=floorBelow(p)+.015;
  }
  function rememberPose(p,stamp) {
    const history=p.poses;
    let last=history[history.length-1];
    if(!Number.isFinite(stamp) || (last && stamp<last.stamp))return;
    const sample={stamp,time:stamp,x:p.x,z:p.z,feet:p.feet,yaw:p.yaw,pitch:p.pitch,...motion(p)};
    if(last && stamp===last.stamp){
      if (Object.keys(sample).every(key=>key==='time' || sample[key]===last[key])) return;
      history.pop();last=history[history.length-1];
    }
    if(last){
      let start=last.time;
      // After a long interruption the previous pose has already been shown at rest.
      // Start the recovery at that held pose and cap its visual catch-up speed.
      const playhead=renderTime();
      if(playhead>start+.025) {
        start=playhead;
        history.push({...last,time:start});
      }
      sample.time=Math.max(stamp,start+Math.hypot(p.x-last.x,p.z-last.z)/12);
    }
    history.push(sample);
    while(history.length>2 && history[1].time<stamp-1.2)history.shift();
  }
  function visiblePoseAt(p,time) {
    const history=p.poses,n=history.length;
    if(!n || !Number.isFinite(time))return p;
    if(time<=history[0].time)return history[0];
    if(time>=history[n-1].time)return history[n-1];
    let lo=0,hi=n-1;
    while(hi-lo>1){
      const mid=(lo+hi)>>1;
      if(history[mid].time<=time)lo=mid;else hi=mid;
    }
    const a=history[lo],b=history[hi],f=(time-a.time)/(b.time-a.time);
    const angle=b.yaw-a.yaw;
    const blend=key=>a[key]+(b[key]-a[key])*f;
    return {x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f,feet:a.feet+(b.feet-a.feet)*f,
      yaw:a.yaw+Math.atan2(Math.sin(angle),Math.cos(angle))*f,pitch:blend('pitch'),
      crouch:blend('crouch'),velocityX:blend('velocityX'),velocityZ:blend('velocityZ'),
      verticalSpeed:blend('verticalSpeed'),landing:blend('landing'),grounded:f<.5?a.grounded:b.grounded};
  }
  function pack(p) {
    return {id:p.id,name:p.name,x:p.x,z:p.z,f:p.feet,a:p.yaw,b:p.pitch,w:p.weapon,...motion(p),equip:p.equippedAt,
      mt:p.poses.length?p.poses[p.poses.length-1].stamp:round.time,
      hp:p.hp,k:p.kills,d:p.deaths,spawn:p.spawnNo,safe:p.safeUntil,resp:p.respawnAt,
      reload:p.reloadAt,empty:p.reloadEmpty,modes:p.modes,shot:p.lastShotAt,serial:p.shotsFired,
      swing:p.lastSwingAt,swings:p.swings,
      fall:p.deathYaw,floor:p.deathFloor,ammo:p.mags,stock:p.stock,ack:p.ack||0};
  }
  function snapshot(to) {
    if (!to && !round.ended && window.LAN.peers.length===1) return;
    send({t:'state',time:round.time,remaining:round.remaining,end:round.ended,actors:[...players.values()].map(pack)},to);
  }
  function applySnapshot(msg) {
    // A buffered room snapshot may still mention someone who already left.
    const members=new Set(window.LAN.peers.map(peer=>peer.id));
    const actors=msg.actors.filter(a=>members.has(a.id)),listed=new Set(actors.map(a=>a.id));
    if (!listed.has(self.id) || !Number.isFinite(msg.time) || msg.time<round.lastSnapshot) return;
    const received=now(),offset=msg.time-received;
    if(round.hostOffset==null)round.hostOffset=offset;
    else{
      // A batch of late snapshots must not rewind the clock driving already-displayed movement.
      const elapsed=Math.max(0,received-round.snapshotReceived);
      round.hostOffset+=clamp(offset-round.hostOffset,-elapsed*.01,elapsed*.1);
    }
    round.lastSnapshot=msg.time;round.snapshotReceived=received;
    round.time=Math.max(round.time,msg.time); round.remaining=msg.remaining; lastTick=received;
    for (const a of actors) {
      let p=players.get(a.id);
      if (!p) { p=makePlayer(a.id,a.name); players.set(p.id,p); }
      if(clientReady && a.spawn<p.spawnNo)continue;
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
      if (fresh || p!==self) {p.lastSwingAt=a.swing??-10;p.swings=a.swings??0;}
      if (p!==self) {
        p.x=a.x;p.z=a.z;p.feet=a.f;p.yaw=a.a;p.pitch=a.b;
        readMotion(p,a);p.equippedAt=a.equip??-10;
        if(fresh || !p.hp)p.poses.length=0;
        if(p.hp)rememberPose(p,a.mt??msg.time);
        p.lastShotAt=a.shot; p.shotsFired=a.serial; p.flashUntil=Math.max(fresh?0:p.flashUntil,a.shot+.075);
      }
      if (fresh) {
        p.x=a.x; p.z=a.z; p.yaw=a.a; p.pitch=a.b; p.feet=a.f; p.hurtAt=-10;
        if (p===self) {
          readMotion(p,a);p.equippedAt=-10;
          p.triggerHeld=false; resetKick(p); p.shotsFired=a.serial; p.lastShotAt=a.shot;
          lastMovement=now();muzzle=hurt=0; targetFeedback=null; clearInput();
        }
      }
    }
    for (const id of players.keys()) if (!listed.has(id)) players.delete(id);
    clientReady=true;
    if (msg.end) endRound();
    else checkLife();
    refreshVitals();
  }
  function pose(p,m) {
    if (!p.hp || ![m.x,m.z,m.yaw,m.pitch,m.feet].every(Number.isFinite)) return;
    if (Number.isFinite(m.seenAt)) p.sightDelay=clamp(round.time-m.seenAt,0,maxRewind);
    if (Number.isFinite(m.eyeBob)) p.eyeBob=clamp(m.eyeBob,-.024,.024);
    p.scopedKick=m.ads && Array.isArray(m.kick) && m.kick.length===2 && m.kick.every(Number.isFinite)
      ? [clamp(m.kick[0],-.12,.12),clamp(m.kick[1],0,.18)] : null;
    p.scopedEye=m.ads && Array.isArray(m.eye) && m.eye.length===3 && m.eye.every(Number.isFinite) ? m.eye : null;
    const received=now(), elapsed=clamp(received-(p.poseAt??received),0,.8);
    const movedAt=Number.isFinite(m.movedAt)?m.movedAt:null;
    // A group of delayed inputs often arrives within a single host tick. Retain
    // the elapsed host time and spend it according to the sender's sample deltas.
    const sampleDt=movedAt!==null && p.movedAt!==null?clamp(movedAt-p.movedAt,0,.8):elapsed;
    p.moveBudget=Math.min(.8,p.moveBudget+elapsed);
    const dt=Math.min(sampleDt,p.moveBudget);
    p.moveBudget-=dt; p.movedAt=movedAt;
    const dx=m.x-p.x, dz=m.z-p.z, len=Math.hypot(dx,dz);
    const step=Math.min(1, (7*dt+.10)/(len || 1));
    // Apply streamed movement in short substeps so a missed packet cannot cross a wall.
    p.feet=clamp(m.feet,p.feet-8*dt-.2,p.feet+6*dt+.15);
    p.feet=clamp(p.feet,0,3.5);
    move(p,dx*step,dz*step);
    readMotion(p,m);
    p.yaw=m.yaw; p.pitch=clamp(m.pitch,-1.3,1.3); p.ads=!!m.ads; p.poseAt=received;
    rememberPose(p,round.time+Math.max(0,p.poseAt-lastTick));
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
          if (!peer) return;
          p=makePlayer(from,peer.name);
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
      if (!round) return;
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
    return {x:self.x,z:self.z,yaw:self.yaw,pitch:self.pitch,feet:self.feet,ads:aimHeld,spawn:self.spawnNo,movedAt:lastMovement,...motion(self),
      seenAt:localShotTime(),eyeBob:eyeBob(self),kick:scopeActive()?round.presentedKick??cameraKick(self):undefined,
      eye:scopeActive()?round.presentedEye:undefined};
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
    advanceLocalMovement(n);
    if(authority() && self.hp>0)rememberPose(self,round.time);
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
      if (p.pendingSwing) finishSwing(p,round.time);
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
  function viewState(displayTime=renderTime()) {
    const g=guns[self.weapon], time=round.time;
    const reload=reloadProgress(self,time);
    const alive=self.hp>0, secondsToSpawn=alive ? 0 : clamp(self.respawnAt-time,0,respawnSeconds);
    const deathAge=alive?-1:Math.max(0,respawnSeconds-secondsToSpawn);
    const fall=clamp(deathAge/.70,0,1),deathDrop=fall*fall*(3-2*fall)*.95;
    const actors=[];
    for(const p of players.values()){
      if(p===self)continue;
      const age=p.hp>0?-1:Math.max(0,time-p.respawnAt+respawnSeconds);
      const pose=p.hp>0?visiblePoseAt(p,displayTime):p;
      actors.push({id:p.id,name:p.name,x:pose.x,y:p.hp>0?pose.feet:actorFeet(p,age),z:pose.z,yaw:pose.yaw,pitch:pose.pitch,team:'enemy',alive:p.hp>0,
        ...motion(pose),switchProgress:clamp(1-(time-p.equippedAt)/.22,0,1),hurt:clamp(1-(time-p.hurtAt)/.28,0,1),
        flash:p.hp>0 && !guns[p.weapon].melee && p.flashUntil>time,hp:p.hp,weapon:p.weapon,spawnNo:p.spawnNo,fireMode:p.modes[p.weapon],
        swingProgress:swingProgress(p,time),swingSerial:p.swings,
        reload:reloadProgress(p,time),reloadEmpty:p.reloadEmpty,shotSerial:p.shotsFired,shotAge:Math.max(0,time-p.lastShotAt),
        deathAge:age,deathYaw:p.deathYaw});
    }
    const [yawKick,pitchKick]=cameraKick(self), fov=fieldOfView();
    return {x:self.x,z:self.z,y:actorFeet(self,deathAge)+eyes-crouchDrop*self.crouch-deathDrop+eyeBob(self),
      feet:self.feet,...motion(self),
      yaw:self.yaw+yawKick,pitch:self.pitch+pitchKick-deathDrop*.095,weapon:self.weapon,weaponName:g.name,ammo:self.mags[self.weapon],
      fov,scopeZoom,scopeActive:scopeActive(),scopeBlend:self.weapon===0 && phase==='playing' ? scopeBlend : 0,
      scopeMagnification:self.weapon===1?hipHalfTangent/Math.tan(fov*Math.PI/360):scopeScale,
      reserve:self.stock[self.weapon],maxAmmo:g.cap,hp:self.hp,kills:self.kills,deaths:self.deaths,
      secondsLeft:Math.max(0,Math.ceil(round.remaining)),respawnLeft:Math.ceil(secondsToSpawn),
      invulnerable:self.safeUntil>time,time,recoil:clamp(self.kickUp,0,1.5),recoilSide:clamp(self.kickSide,-1,1),
      flash:muzzle>0?muzzle/.065:0,hit,hurt,aim,killConfirm:clamp(killConfirm/.48,0,1),deathAge,
      targetFeedback:currentTarget(),
      fireMode:self.modes[self.weapon],canToggleFireMode:self.weapon===0,reloadEmpty:self.reloadEmpty,
      melee:!!g.melee,swingProgress:swingProgress(self,time),swingSerial:self.swings,
      reloadStage:reload<0?'':reload<.47?'取匣':reload<.86?'装匣':'就绪',
      bob,moving:walking,sprinting:running,reload,shotSerial,switchProgress:clamp(1-(time-self.equippedAt)/.22,0,1),
      actors,fx:effects.concat(marks),name:self.name,mode:round.mode,map:round.map,phase,controlsEngaged};
  }
  function render() {
    if (!round) return;
    frame=requestAnimationFrame(render);
    const n=now(), dt=clamp(n-lastDraw,0,.065);
    lastDraw=n;
    advanceLocalMovement(n);
    for (const fx of effects) fx.life-=dt;
    if(effects.length)effects=effects.filter(fx=>fx.life>0);
    for (const m of marks) m.life=Math.max(0,m.maxLife-(round.time-m.born));
    if(marks.length)marks=marks.filter(m=>m.life>0);
    advanceKick(self,round.time+Math.max(0,n-lastTick)); muzzle=Math.max(0,muzzle-dt);
    killConfirm=Math.max(0,killConfirm-dt);
    hurt=Math.max(0,hurt-dt); hit=Math.max(0,hit-dt);
    aim+=((aimHeld && self.hp>0 && !self.reloadAt ? 1 : 0)-aim)*(1-Math.exp(-dt*15));
    updateScope(n);
    const displayTime=renderTime(), state=viewState(displayTime);
    window.Arena.draw(state);
    round.presentedAt=displayTime;
    round.presentedKick=cameraKick(self);
    round.presentedEye=[state.x,state.y,state.z];
    if (window.Weapon) window.Weapon.draw(overlay,state);
    ui('scope',state);
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
    const sensitivity=.0021*(self.weapon===0 ? 1/scopeScale : 1-aim*.45);
    self.yaw+=dx*sensitivity;
    self.pitch=clamp(self.pitch-dy*sensitivity,-1.3,1.3);
  }
  function resume() {
    if (!round || round.ended) return;
    clearInput(); lastDraw=lastMovement=now();
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
    frame=ticker=0; clearInput(); controlsEngaged=handoff=false; clientShot=shotSerial=0;
    muzzle=hurt=hit=killConfirm=aim=bob=0;
    targetFeedback=null;
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
    nextSync=0; lastTick=lastDraw=lastMovement=now(); lastHUD=0;
    wireNetwork();
    if (mode==='join') hello();
    const startPaused = mode === 'host' && options.startPaused === true;
    screen(startPaused ? 'paused' : 'playing');
    ticker=setInterval(tick,1000/40); render();
    return true;
  }
  document.addEventListener('keydown',e=>{
    if (!round || document.querySelector('dialog[open]') || e.target?.matches?.('input,textarea,[contenteditable=true]')) return;
    if (e.code==='Escape') {
      if (phase==='paused') resume(); else pause();
      return;
    }
    if (phase!=='playing' || !clientReady) return;
    if (e.ctrlKey || ['ControlLeft','ControlRight','Space','ArrowUp','ArrowDown','ArrowRight','ArrowLeft','Tab'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code==='Space') jumpPressed=true;
    if (e.code==='KeyR') beginReload(self);
    if (e.code==='KeyV' && self.weapon===0) {
      scopeZoom=scopePowers[(scopePowers.indexOf(scopeZoom)+1)%scopePowers.length];
      updateScope(now());
      ui('hud',viewState());
    }
    if (e.code==='KeyQ') changeWeapon(self,self.previousWeapon);
    if (e.code==='KeyB') {
      if (self.weapon===0) changeFireMode(self,self.modes[0]==='auto'?'semi':'auto');
      else if (self.weapon===1) ui('notify','这把手枪使用单发模式');
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
    if (!controlsEngaged) { controlsEngaged=true; ui('hud',viewState()); if (e.button===0) return; }
    if (e.button===0) { fireHeld=true; setTrigger(self,true); }
    if (e.button===2) { aimHeld=!guns[self.weapon].melee; updateScope(now()); e.preventDefault(); }
  });
  document.addEventListener('mouseup',e=>{
    if (!e.buttons) drag=null;
    if (e.button===0 && self) {fireHeld=false;setTrigger(self,false);}
    if (e.button===2) { aimHeld=false; if (round) updateScope(now()); }
  });
  document.addEventListener('mousemove',e=>{
    if (phase!=='playing') return;
    if (document.pointerLockElement===canvas) look(e.movementX,e.movementY);
    else if (drag) { look(e.clientX-drag.x,e.clientY-drag.y); drag={x:e.clientX,y:e.clientY}; }
  });
  document.addEventListener('wheel',e=>{
    if (phase!=='playing' || !self || !clientReady || !e.deltaY || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    const direction=Math.sign(e.deltaY), amount=Math.abs(e.deltaY), time=now();
    // Browsers deliver wheel notches as lines/pages or coarse pixel multiples.
    // A trackpad streams many small pixel deltas, including momentum after lift.
    const notch=e.deltaMode===1 || e.deltaMode===2 || amount%100===0 || amount%120===0;
    if (!notch) {
      if (time-wheelGesture.at>.15 || direction!==wheelGesture.direction) {
        wheelGesture.pixels=0; wheelGesture.switched=false;
      }
      wheelGesture.at=time; wheelGesture.direction=direction; wheelGesture.pixels+=amount;
      if (wheelGesture.pixels<36 || wheelGesture.switched) return;
      wheelGesture.switched=true;
    } else wheelGesture.at=-1;
    changeWeapon(self,(self.weapon+direction+guns.length)%guns.length);
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
  window.Game={start,resume,pause,quit,respawnSeconds,
    selectWeapon(i){ if (self && clientReady && phase==='playing') changeWeapon(self,i); },
    toggleSound(){ muted=!muted; if (!muted) wakeAudio(); return !muted; },
    setSound(enabled){ muted=!enabled; if (enabled) wakeAudio(); },
    get soundEnabled(){ return !muted; },
    get state(){
      if(!round)return null;
      const state=viewState();
      state.leaderboard=[...players.values()].map(p=>({id:p.id,name:p.name,kills:p.kills,deaths:p.deaths,isMe:p===self}))
        .sort((a,b)=>b.kills-a.kills || a.deaths-b.deaths || a.name.localeCompare(b.name));
      return state;
    },
    guns
  };
})();
