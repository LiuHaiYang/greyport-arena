// Run with --html to exercise the game and arena scripts in the distributable.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {scenario,readModule}=require('./gameplay.cjs');

function cameraProbe() {
  const marker='return {maps,get map()';
  const arena=readModule('arena.js',/window\.Arena\s*=\s*\(\(\)/);
  assert(arena.includes(marker));
  // Supply a minimal WebGL driver. The math that constructs the camera and
  // uploads the world shader's uniforms remains the actual Arena.draw code.
  const hook=`function attachCamera(glDriver,surface) {
    gl=glDriver; canvas=surface; sky={}; viewportLimit=[4096,4096];
    program={program:'world',rightV:'right',upV:'up',forwardV:'forward',proj:'proj',eye:'eye'};
  }
  return {attachCamera,maps,get map()`;
  const context={window:{},Image:class {},performance:{now:()=>1000}};
  vm.runInNewContext(arena.replace(marker,hook),context);
  const renderer=context.window.Arena,done=Symbol('world camera uploaded');
  let world=false,uniforms;
  const surface={clientWidth:1280,clientHeight:720};
  const driver=new Proxy({
    isContextLost:()=>false,
    useProgram(program){world=program==='world';},
    uniform2fv(key,value){if(world) uniforms[key]=Array.from(value);},
    uniform3fv(key,value){if(world) uniforms[key]=Array.from(value);},
    uniform3f(key,...value){if(world && key==='eye'){uniforms.eye=value; throw done;}}
  },{get:(obj,key)=>obj[key]??(()=>{})});
  renderer.attachCamera(driver,surface);
  return (state,width=1280,height=720)=>{
    uniforms={}; surface.clientWidth=width; surface.clientHeight=height;
    try {renderer.draw(state);} catch(error) {if(error!==done) throw error;}
    for(const field of ['eye','forward','right','up','proj']) assert(uniforms[field]?.every(Number.isFinite),field);
    return uniforms;
  };
}
const camera=cameraProbe();
const near=(a,b,tolerance,message)=>assert(Math.abs(a-b)<=tolerance,message+' ('+a+' vs '+b+')');
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
function screenPoint(cam,point) {
  const v=point.map((x,i)=>x-cam.eye[i]),depth=dot(v,cam.forward);
  assert(depth>0,'the point is in front of the world camera');
  return [dot(v,cam.right)*cam.proj[0]*640/depth,dot(v,cam.up)*cam.proj[1]*360/depth];
}

function checkOptics({shooter,target,clients,advance,aimAtTarget,bothSeeHp}) {
  const host=clients.get('H');
  const state=()=>shooter.game.state;
  const key=code=>{shooter.key(true,code);shooter.key(false,code);};
  shooter.random=target.random=.98; // Surface an unintended random bullet offset.
  const base=shooter.view, tanHip=Math.tan(72*Math.PI/360);
  let maxCenterError=0;
  function projection(zoom) {
    const view=shooter.view;
    near(tanHip/Math.tan(view.fov*Math.PI/360),zoom,.0001,'optical FOV ratio');
    for(const [w,h] of [[1280,720],[900,900]]) {
      const hip=camera(base,w,h),scope=camera(view,w,h);
      near(scope.proj[0]/hip.proj[0],zoom,.0001,'horizontal world projection');
      near(scope.proj[1]/hip.proj[1],zoom,.0001,'vertical world projection');
    }
    near(view.scopeMagnification,zoom,.0001,'reported magnification');
  }
  function fireAtReticle(expectedHp) {
    const cam=camera(shooter.view),last=host.lastShot;
    shooter.press(true);advance(25);shooter.press(false);advance(125);
    const shot=host.lastShot;
    assert(shot!==last && shot.source===shooter.id,'a new authoritative shot arrived');
    const [dx,dy]=screenPoint(cam,shot.to);
    maxCenterError=Math.max(maxCenterError,Math.hypot(dx,dy));
    assert(maxCenterError<.6,'confirmed impact center error in pixels: '+maxCenterError);
    bothSeeHp(expectedHp);
  }
  assert.equal(base.scopeZoom,2);
  assert.equal(base.scopeActive,false);
  projection(1);
  shooter.key(true,'KeyV');shooter.key(true,'KeyV',true);shooter.key(false,'KeyV');
  assert.equal(state().scopeZoom,4,'a held V key cannot skip a level');
  key('KeyV');assert.equal(state().scopeZoom,8);
  key('KeyV');assert.equal(state().scopeZoom,2);
  advance(300); projection(1);
  aimAtTarget(0,1.12,0);
  shooter.right(true);
  for(const [zoom,hp] of [[2,73],[4,46],[8,19]]) {
    if(zoom!==2)key('KeyV');
    advance(75);
    const midScale=camera(shooter.view).proj[1]/camera(base).proj[1];
    assert(midScale>zoom/2 && midScale<zoom,'the world camera blends between optical settings');
    advance(325);
    assert.equal(state().scopeActive,true);
    assert.equal(state().scopeZoom,zoom);
    assert(state().scopeBlend>.98);
    projection(zoom);
    near(target.view.fov,72,1e-6,'one player scoping must not zoom the other player’s camera');
    const yaw=state().yaw,pitch=state().pitch;
    shooter.moveMouse(40,-16);
    near(state().yaw-yaw,40*.0021/zoom,1e-6,'horizontal scoped mouse sensitivity');
    near(state().pitch-pitch,16*.0021/zoom,1e-6,'vertical scoped mouse sensitivity');
    shooter.moveMouse(-40,16);advance(25);
    const actor=shooter.view.actors[0];
    const [x,y]=screenPoint(camera(shooter.view),[actor.x,actor.y+1.12,actor.z]);
    assert(Math.hypot(x,y)<.25,'center the rendered vest before firing');
    fireAtReticle(hp);
    if(zoom===8) {
      shooter.random=target.random=.5; // Isolate the displayed recoil from random burst spread.
      fireAtReticle(0);
    }
    advance(800);
  }
  shooter.right(false);advance(75);
  assert(shooter.view.scopeMagnification>1 && shooter.view.scopeMagnification<8,'gradual return to hip view');
  advance(275);projection(1);
  assert.equal(state().scopeActive,false);
  shooter.right(true);advance(350);projection(8);
  key('Digit2');advance(400);projection(1);
  assert.equal(state().scopeActive,false);
  key('KeyV');shooter.right(false);shooter.right(true);advance(800);
  near(shooter.view.fov,56,.01,'pistol iron sights');
  assert.equal(state().scopeActive,false);
  key('Digit3');advance(350);shooter.right(false);shooter.right(true);key('KeyV');advance(350);
  projection(1);assert.equal(state().scopeActive,false);
  key('Digit1');advance(350);projection(1);
  assert.equal(state().scopeZoom,8,'sidearm and knife input preserve the rifle setting');
  shooter.right(false);shooter.right(true);advance(350);projection(8);
  shooter.blur();advance(400);projection(1);
  assert.equal(state().phase,'paused');assert.equal(state().scopeActive,false);
  shooter.game.resume();advance(400);projection(1);

  advance(15300);
  target.press(true);target.press(false);
  target.look(Math.atan2(state().x-target.view.x,target.view.z-state().z),0);
  shooter.right(true);advance(350);projection(8);
  target.press(true);advance(1200);target.press(false);
  assert.equal(state().phase,'dead');
  assert.equal(state().scopeActive,false);projection(1);
  console.log(shooter.id+' scoped: 2x/4x/8x world projection, mouse scaling, recoil follow-up, release, loadout, blur and death passed; largest controlled impact offset '+maxCenterError.toFixed(3)+' px at 1280x720.');
}

scenario('H','rail',checkOptics);
scenario('G','warehouse',checkOptics);
