const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context=vm.createContext({window:{},Image:class {},console});
const arena=fs.readFileSync(__dirname+'/../src/arena.js','utf8').replace('return {maps,get map()',`
  function captureModel(){
    let vertices;
    gl={createBuffer(){return {}},bindBuffer(){},bufferData(t,v){if(v instanceof Float32Array)vertices=v;}};
    const builder=operatorBuilder(false),look=operatorLooks[0];
    buildOperatorBody(builder,look);buildOperatorHead(builder,look);buildOperatorHands(builder,look);
    characterBuffers[0]=builder.upload();
    return vertices;
  }
  return {captureModel,sampleMotion,maps,get map()`);
vm.runInContext(arena,context);
const A=context.window.Arena,verts=A.captureModel();
function envelope(m){
  let low=99,high=-99;
  for(let i=0;i<verts.length;i+=11){
    const j=verts[i+10]*12+4, b=m.bones,h=b[j]*verts[i]+b[j+1]*verts[i+1]+b[j+2]*verts[i+2]+b[j+3]+m.height;
    low=Math.min(low,h);high=Math.max(high,h);
  }
  return [low,high];
}
for(let dir=0;dir<8;dir++){
  const actor={id:'pose-'+dir,look:0,x:0,y:.23,z:8.5,yaw:.19,pitch:0,weapon:dir%3,spawnNo:1};
  const standing=A.sampleMotion({...actor,alive:true,shotSerial:1,reload:-1},2);
  assert(envelope(standing)[1]>1.7);
  for(const age of [0,.12,.28,.40,.52,.62,.73,1.45,1.8,2.19]){
    const body=A.sampleMotion({...actor,y:0,alive:false,deathAge:age,deathYaw:dir*Math.PI/4,shotSerial:1,reload:-1},2+age);
    const [min,max]=envelope(body);
    assert(body.bones.every(Number.isFinite));assert(min>=-.002);
    if(age>=.62){assert(max<1,JSON.stringify({dir,age,min,max}));assert(min<.135,JSON.stringify({dir,age,min,max}));}
    if(age===1.45)assert.equal(body.coverage,1);
    if(age===2.19)assert(body.coverage<.005);
  }
  const spawned=A.sampleMotion({...actor,y:0,spawnNo:2,alive:true,reload:.44},18);
  assert.equal(spawned.coverage,1);assert.equal(spawned.fallYaw,null);
  if(actor.weapon===2) assert(spawned.magShift.every(v=>v===0),'knife has no third-person magazine motion');
  else assert(spawned.magShift[1]<-.16);
}
const source=fs.readFileSync(__dirname+'/../src/weapon.js','utf8').replace('window.Weapon={draw,preview}', 'window.Weapon={draw,preview,reloadPose,knifePose,models}');
vm.runInContext(source,context);
const W=context.window.Weapon;
assert.equal(W.models.length,3);
for(const model of W.models.slice(0,2)){
  assert(model.faces.some(f=>f.group==='action'));assert(model.faces.some(f=>f.group==='mag'));
  for(const empty of [true,false]){
    const poses=Array.from({length:101},(_,i)=>W.reloadPose(i*.01,model.index,empty));
    for(const p of poses)assert([...p.hand,...p.mag,p.finish,p.seat,p.lift].every(Number.isFinite));
    assert(poses[12].mag.every(v=>Math.abs(v)<1e-7));assert(poses[16].hand.some(v=>v<-.035));
    assert(poses[44].mag[1]<-.7);assert(poses[72].mag[1]>0);
    assert(poses[100].hand.every(v=>v===0));
  }
  assert(W.reloadPose(.84,model.index,true).finish>3*W.reloadPose(.84,model.index,false).finish);
}
const knife=W.models[2];
assert(!knife.faces.some(f=>f.group==='action'||f.group==='mag'));
for (const empty of [false,true]) for(const t of [.16,.44,.84]) {
  const pose=W.reloadPose(t,2,empty);
  assert([...pose.mag,...pose.hand,pose.lift,pose.seat,pose.finish].every(v=>v===0));
}
function transform(m,pos,point) {
  return pos.map((v,i)=>v+m[i*3]*point[0]+m[i*3+1]*point[1]+m[i*3+2]*point[2]);
}
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const cameraTip=(progress,serial,equip=0)=>{
  const pose=W.knifePose({swingProgress:progress,swingSerial:serial,switchProgress:equip});
  assert([...pose.m,...pose.pos].every(Number.isFinite));
  return transform(pose.m,pose.pos,[0,.99,-.115]);
};
const rest=cameraTip(-1,1);
for (const serial of [1,2]) {
  const samples=Array.from({length:51},(_,i)=>cameraTip(i/50,serial));
  assert(distance(samples[0],rest)<.001 && distance(samples[50],rest)<.001,'return to the resting guard');
  assert(Math.max(...samples.map(tip=>distance(tip,rest)))>.45,'first-person blade must visibly swing');
  for(let i=1;i<samples.length;i++) assert(distance(samples[i],samples[i-1])<.45,'continuous first-person knife motion');
}
assert(distance(cameraTip(.40,1),cameraTip(.40,2))>.20,'successive slashes use distinct arcs');
assert(distance(rest,cameraTip(-1,1,1))>.20,'drawing the knife starts away from the resting pose');

const operator={id:'slash',x:0,y:0,z:0,yaw:0,pitch:0,spawnNo:1,weapon:2,alive:true,shotSerial:0,reload:-1,swingSerial:1};
function joint(pose,bone,point) {
  const b=pose.bones,offset=bone*12;
  return [0,1,2].map(i=>{
    const row=offset+i*4;
    return b[row]*point[0]+b[row+1]*point[1]+b[row+2]*point[2]+b[row+3];
  });
}
function remotePoints(progress) {
  const pose=A.sampleMotion({...operator,swingProgress:progress},22);
  return [joint(pose,8,[.247,.912,-.028]),joint(pose,15,[0,.14,-.32])];
}
const guard=remotePoints(-1);
const swinging=Array.from({length:21},(_,i)=>remotePoints(i/20));
for (const index of [0,1]) {
  assert(Math.max(...swinging.map(points=>distance(points[index],guard[index])))>.15,
    'the third-person right hand and weapon must both move during the slash');
  assert(distance(swinging[20][index],guard[index])<.01,'remote slash returns to guard');
}
function posture(options={},time=30) {
  const actor={...operator,id:'posture',weapon:0,swingProgress:-1,grounded:true,crouch:0,...options};
  const pose=A.sampleMotion(actor,time);
  return {
    head:joint(pose,2,[0,1.65,0]), chest:joint(pose,1,[0,1.33,0]),
    left:joint(pose,11,[-.12,.10,0]),right:joint(pose,14,[.12,.10,0])
  };
}
const upright=posture(), crouched=posture({crouch:1});
assert(upright.head[1]-crouched.head[1]>.43 && upright.head[1]-crouched.head[1]<.63);
assert(Math.abs(upright.left[1]-crouched.left[1])<.08,'crouching keeps the planted foot near the floor');
const onPlatform=posture({y:1});
const rising=posture({y:1,grounded:false,verticalSpeed:4.5});
const falling=posture({y:1,grounded:false,verticalSpeed:-4.5});
assert(distance(onPlatform.left,upright.left)<.02,'a stationary player on a crate stays grounded');
assert(distance(rising.left,onPlatform.left)>.1 && distance(rising.left,falling.left)>.08,'airborne legs tuck then extend');
assert(posture({landing:1}).chest[1]<upright.chest[1]-.035,'the torso absorbs the landing');
assert(distance(posture({hurt:1}).chest,upright.chest)>.015,'the torso reacts to confirmed injury');
const walking=[];
for(let i=1;i<=40;i++) {
  const pose=posture({velocityX:0,velocityZ:-4.25,z:-4.25*i/40},30+i/40);
  walking.push(pose.left[2]-pose.right[2]);
}
assert(Math.min(...walking)<-.13 && Math.max(...walking)>.13,'successive steps move opposite feet forward');
console.log('Verified weapon poses, crouch height, walking stride, airborne legs, landing and flinch, eight collapse directions, fade and respawn.');
