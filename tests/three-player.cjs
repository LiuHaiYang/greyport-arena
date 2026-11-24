// Three game instances exchange their normal room messages with a 50 ms one-way delay.
const assert=require('node:assert/strict');
const {scenario}=require('./gameplay.cjs');
const near=(a,b,epsilon,message)=>assert(Math.abs(a-b)<=epsilon,message+' ('+a+' vs '+b+')');

function verify({clients,shooter,target:firstTarget,advance,joinThird,disconnect}) {
  const third=joinThird(),host=clients.get('H');
  const target=shooter===host?firstTarget:third;
  const witness=shooter===host?third:host;
  const actor=(viewer,id)=>viewer.view.actors.find(a=>a.id===id);
  function roster() {
    const members=[...clients.keys()].sort();
    for(const c of clients.values()) {
      assert.deepEqual(Array.from(c.game.state.actors,a=>a.id).sort(),members.filter(id=>id!==c.id));
      assert.deepEqual(Array.from(c.game.state.leaderboard,p=>p.id).sort(),members);
    }
  }
  function aim(height) {
    const view=shooter.view,enemy=actor(shooter,target.id);
    const dx=enemy.x-view.x,dz=enemy.z-view.z;
    shooter.look(Math.atan2(dx,-dz),Math.atan2(height-view.y,Math.hypot(dx,dz)));
  }
  function choose(slot) {
    const key='Digit'+slot;
    shooter.key(true,key);shooter.key(false,key);advance(350);
    for(const c of [target,witness]) assert.equal(actor(c,shooter.id).weapon,slot-1);
  }
  function hp(value) {
    assert.equal(target.game.state.hp,value);assert.equal(target.vitals.hp,value);
    for(const c of [shooter,witness]) assert.equal(actor(c,target.id).hp,value);
    assert.equal(witness.game.state.hp,100);
    assert.equal(witness.damage.length,0);
  }
  function tap(elapsed=125) {shooter.press(true);advance(25);shooter.press(false);advance(elapsed-25);}
  function confirm(previous,expected,elapsed) {
    const before=target.damage.length;
    tap(elapsed);
    hp(expected);
    assert.equal(target.damage.length,before+1,'exactly one confirmed damage notification');
    assert.equal(target.damage.at(-1),previous-expected,'only remaining HP can count as damage');
    assert.equal(shooter.vitals.target?.damage,previous-expected);
    assert.equal(shooter.vitals.target?.hp,expected);
    assert(!witness.vitals.target,'a bystander must not see a personal hit confirmation');
    if(expected>0) {
      assert(target.game.state.hurt>0,'victim damage vignette');
      assert(actor(witness,target.id).hurt>0,'flinch on an uninvolved client');
    }
  }
  roster();
  target.press(true);target.press(false);target.look(0,0);
  advance(2450); // Let the new arrival's protection expire.
  const standingEye=target.view.y;
  target.key(true,'ControlLeft');advance(75);
  assert(target.view.crouch>0 && target.view.crouch<1,'gradual local crouch');
  advance(350);
  near(standingEye-target.view.y,.52,.035,'eye height follows the body');
  for(const c of [shooter,witness]) near(actor(c,target.id).crouch,1,.02,'remote crouch');
  target.key(true,'KeyC');target.key(false,'ControlLeft');
  target.key(true,'KeyW');target.key(true,'ShiftLeft');
  const startZ=target.view.z;
  advance(500);
  near(startZ-target.view.z,1,.08,'holding sprint must preserve crouch walking speed');
  target.key(false,'ShiftLeft');target.key(false,'KeyC');advance(400);
  const standZ=target.view.z;
  advance(400);
  near(standZ-target.view.z,4.25*.4,.07,'standing up must preserve a held forward input');
  target.key(false,'KeyW');advance(350);
  for(const c of [shooter,witness]) {
    near(actor(c,target.id).z,target.view.z,.05,'settled remote movement');
    near(actor(c,target.id).crouch,0,.01,'stood up on all clients');
  }

  target.key(true,'Space');target.key(false,'Space');
  let visibleJump=false;
  for(let i=0;i<18;i++) {
    advance(25);
    const a=actor(shooter,target.id);
    if(!a.grounded && a.y>.48) {visibleJump=true;break;}
  }
  assert(visibleJump,'shooter must see airborne feet');
  aim(.16);tap();hp(100); // Shoot under the visible player during the jump.
  let landed=false;
  for(let i=0;i<32;i++) {
    advance(25);
    if(target.view.grounded && target.view.landing>0) landed=true;
  }
  assert(landed,'landing produces a transient local reaction');
  near(target.view.feet,0,.02,'feet return to floor level');
  target.key(true,'ControlRight');advance(475);
  aim(1.62);tap();hp(100); // Former head position of a standing player.
  assert.equal(target.damage.length,0);
  advance(450);
  aim(.60);confirm(100,73,150);

  choose(2);
  const wall={x:(shooter.view.x+target.view.x)/2,z:(shooter.view.z+target.view.z)/2,w:.32,d:.32,h:1.22};
  for(const c of clients.values()) c.arena.map.walls.push(wall);
  aim(.60);tap();hp(73);
  assert.equal(target.damage.length,1,'crouched body remains protected by the low wall');
  target.key(false,'ControlRight');advance(550);
  aim(1.12);confirm(73,39,150); // Standing torso is visible above that same wall.
  for(const c of clients.values()) c.arena.map.walls.pop();

  choose(3);
  aim(1.12);
  shooter.key(true,'KeyW');
  for(let i=0;i<220 && Math.hypot(shooter.view.x-target.view.x,shooter.view.z-target.view.z)>1.45;i++) advance(25);
  shooter.key(false,'KeyW');advance(350);
  assert(Math.hypot(shooter.view.x-target.view.x,shooter.view.z-target.view.z)<1.46);
  target.key(true,'KeyC');advance(450);
  aim(.60);confirm(39,0,250);
  assert.equal(target.view.phase,'dead');
  advance(150); // Scoreboard counters arrive in the periodic authoritative snapshot.
  assert.equal(shooter.game.state.kills,1);assert.equal(witness.game.state.kills,0);
  const deadSpawn=actor(witness,target.id).spawnNo;
  advance(14600); hp(0);
  advance(650); hp(100);
  assert.equal(target.view.phase,'playing');assert.equal(target.view.deaths,1);
  assert.equal(target.view.crouch,0);assert.equal(target.view.hurt,0);
  assert.equal(target.view.landing,0);assert.equal(target.view.grounded,true);
  for(const c of [shooter,witness]) {
    const a=actor(c,target.id);
    assert(a.spawnNo>deadSpawn && a.alive);assert.equal(a.crouch,0);assert.equal(a.hurt,0);
  }
  assert.equal(shooter.game.state.targetFeedback,null);
  choose(1);aim(1.12);tap();hp(100);
  assert.equal(target.damage.length,3,'spawn protection cannot trigger an injury cue');
  assert(shooter.vitals.target.protected);
  roster();
  const oldRoster=host.broadcast;
  disconnect(third);
  host.receive(third.hello,third.id); // In-flight hello from the departed room member.
  for(const c of clients.values()) if(c!==host) c.receive(oldRoster,host.id);
  roster();
  advance(300);roster();
  console.log(shooter.id+' → '+target.id+': three genuine client instances, crouch/jump hit geometry, cover, rifle/pistol/knife damage, bystander, respawn and stale departure passed.');
}

scenario('H','rail',verify);
scenario('G','warehouse',verify);
