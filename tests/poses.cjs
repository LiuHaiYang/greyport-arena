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
  assert(spawned.magShift[1]<-.16);
}
const source=fs.readFileSync(__dirname+'/../src/weapon.js','utf8').replace('window.Weapon={draw,preview}', 'window.Weapon={draw,preview,reloadPose,models}');
vm.runInContext(source,context);
const W=context.window.Weapon;
for(const model of W.models){
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
console.log('Verified three first-person reloads, eight directions of third-person collapse, ground contact, fade, respawn, and remote magazine pose.');
