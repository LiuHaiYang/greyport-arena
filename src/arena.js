/* Greyport arenas. Scenery and surface materials are generated locally. */
window.Arena = (() => {
  'use strict';
  const dockProps = [
    [-8,-7.4,9,3.1,3.25,'red'], [10.8,-7.0,3.1,8.4,3.25,'teal'],
    [-13,5.6,3.1,8,3.25,'teal'], [4.8,7.8,8.4,3.1,3.25,'red'],
    [-3.4,-.3,3.15,2.5,2.65,'crate'], [1.15,-1.3,2.9,2.2,1.6,'crate'],
    [15.8,5.7,3.2,2.8,2.45,'crate'], [-15,-11.8,2.85,2.85,2.45,'crate'],
    [-3,10.4,2.8,2.5,2.1,'crate'], [5.6,-13.5,3.0,2.6,2.3,'crate'],
    [-19.5,-4.5,4.3,1.2,1.28,'barrier'], [15,-1.3,4.6,1.2,1.28,'barrier']
  ];
  const railProps = [
    [-11,-6.5,12,3.05,3.55,'boxcar'],[9.5,-6.5,9.8,3.05,3.15,'hopper'],
    [1.1,5.8,13,3.05,3.55,'boxcar'],[-16.4,10.4,5.4,4.2,3.5,'cabin'],
    [17.5,10,4.1,3.2,2.45,'ties'],[-4,-13.5,4.5,2.2,1.32,'ties'],
    [14,-13.8,4.5,2.2,1.32,'ties'],[-13,.7,4.3,2.1,1.32,'ties'],
    [7.7,-.1,4.4,1.2,1.28,'barrier'],[-3.5,14,4.4,1.2,1.28,'barrier']
  ];
  const yardProps = [
    [-12.4,-3.1,6.8,12.8,5.3,'shed'],[1.1,-10,12,5.0,5.9,'shed'],
    [13.1,3.4,6.8,11.6,5.1,'shed'],[1.4,4.9,4.1,4.8,3.12,'generator'],
    [-7.6,10.3,4.2,2.7,2.1,'crate'],[-16.2,11.4,3.7,1.2,1.28,'barrier'],
    [10.3,13.8,4.5,1.2,1.28,'barrier'],[15.5,-10,3.6,2.7,2.35,'crate'],
    [-2.5,-.1,3.5,1.35,1.22,'barrier'],[-17,-13.7,3.9,2.6,2.0,'crate']
  ];
  const layouts = {dock:dockProps,rail:railProps,warehouse:yardProps};
  function makeMap(id,name,en,description,points,heights){
    const bounds=[[-24.4,0,.8,41],[24.4,0,.8,41],[0,-20.4,49,.8],[0,20.4,49,.8]];
    const shapes=layouts[id].concat(bounds.map((b,i)=>b.concat(heights[i])));
    return {id,name,en,description,width:48,depth:40,
      walls:shapes.map(([x,z,w,d,h])=>({x,z,w,d,h})),
      spawns:points.map(([x,z])=>({x,z,yaw:Math.atan2(-x,z)}))};
  }
  const maps=[
    makeMap('dock','灰港码头','Greyport Dock','沿岸集装箱与木箱分隔出交错的装卸通道。',
      [[16,16],[-19,-15],[19,-15],[-19,14],[1,-16],[-1,16],[-19,2],[20,3],[-8,2],[5,-4]],
      [3.1,1.25,3.3,3.2]),
    makeMap('rail','铁路编组场','Rail Depot','横穿两条铁道，利用错位的货车与信号房掩护转移。',
      [[-19,-15],[18,16],[2,-15],[-8,16],[20,-8],[-20,5],[4,12],[-6,-1],[18,-2],[-10,-12]],
      [2.5,2.5,2.3,2.3]),
    makeMap('warehouse','仓储中庭','Warehouse Yard','三座库房围合出中庭，沿外围巷道通往装卸区。',
      [[19,16],[-20,-16],[-19,6],[17,-16],[-2,15],[1,-16],[20,-1],[-6,5],[7.1,0],[-12,15.5]],
      [3.5,3.3,3.7,3.0])
  ];
  let map=maps[0];

  let gl,canvas,program,sky,shadowProgram,staticMesh,actorMesh,skyBuf,terrain,decals,occlusionMap,shadowTex,shadowFB,shadowSize;
  let skyMap,skyMapReady=false;
  // One calibration aligns the sun disk, directional light, shadow map and water reflection.
  const skyPhoto={sunU:.680,sunV:.391,horizonV:.557,azimuth:-17*Math.PI/180,elevation:21*Math.PI/180};
  const sunDirection=Object.freeze([Math.sin(skyPhoto.azimuth)*Math.cos(skyPhoto.elevation),
    Math.sin(skyPhoto.elevation),-Math.cos(skyPhoto.azimuth)*Math.cos(skyPhoto.elevation)]);
  const solarLight='const vec3 lightDir=vec3('+sunDirection.map(v=>v.toFixed(7)).join(',')+');';
  const sunProbeSize=192;
  const sunDepthPixels=new Uint8Array(sunProbeSize*sunProbeSize*4);
  const viewLight={exposure:1,glare:0,stamp:0};

  // Reuse the static shadow pass to include roofs, cranes and distant buildings in the sun test.
  // The small depth image is read once when a map loads, never during camera movement.
  function captureSunVisibility(){
    gl.viewport(0,0,sunProbeSize,sunProbeSize);
    gl.drawArrays(gl.TRIANGLES,0,staticCount);
    gl.readPixels(0,0,sunProbeSize,sunProbeSize,gl.RGBA,gl.UNSIGNED_BYTE,sunDepthPixels);
    gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,sunProbeSize,sunProbeSize);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0,0,shadowSize,shadowSize);
    viewLight.stamp=0;
  }
  function sunAtEye(x,y,z){
    const [sx,sy,sz]=sunDirection, horizontal=Math.hypot(sx,sz);
    const side=(sz*x-sx*z)/horizontal;
    const up=horizontal*(y-4)-sy*(sx*x+sz*z)/horizontal;
    const u=(.5+side/102)*sunProbeSize-.5,v=(.5+up/90)*sunProbeSize-.5;
    const ix=Math.floor(u),iy=Math.floor(v);
    if(ix<0||iy<0||ix+1>=sunProbeSize||iy+1>=sunProbeSize)return 1;
    const depth=.5-(x*sx+y*sy+z*sz)/176-.0024;
    let light=0;
    for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const offset=4*((iy+j)*sunProbeSize+ix+i);
      const surface=(sunDepthPixels[offset]+sunDepthPixels[offset+1]/255)/255;
      if(depth<=surface)light+=(i?u-ix:1-u+ix)*(j?v-iy:1-v+iy);
    }
    return light;
  }
  function updateViewLighting(s,forward){
    const now=performance.now(), elapsed=Math.max(0,(now-viewLight.stamp)*.001);
    const visible=sunAtEye(s.x||0,s.y??1.64,s.z||0);
    const facing=forward.reduce((sum,v,i)=>sum+v*sunDirection[i],0);
    const angle=Math.min(1,Math.max(0,(facing-.43)/.57));
    const glare=visible*angle*angle*(3-2*angle);
    const target=1.055+.065*(1-visible)-.195*glare-.035*Math.max(0,forward[1]);
    const adapt=viewLight.stamp?1-Math.exp(-elapsed*(target<viewLight.exposure?3.8:1.9)):1;
    viewLight.exposure+=(target-viewLight.exposure)*adapt;
    viewLight.glare+=(glare-viewLight.glare)*(viewLight.stamp?1-Math.exp(-elapsed*14):1);
    viewLight.stamp=now;
  }
  const skyImage=new Image();
  const skyImageSource='__GREYPORT_SKY_DATA__';
  if(skyImageSource.startsWith('data:image/')) skyImage.src=skyImageSource;
  let mesh=[], staticCount=0,seed=65723;
  const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const c=s=>[parseInt(s.slice(0,2),16)/255,parseInt(s.slice(2,4),16)/255,parseInt(s.slice(4,6),16)/255];
  const concrete=c('b4aba0'), grey=c('88908a'), iron=c('58625d'), dark=c('344444'), orange=c('b56c32'), yellow=c('d0a34c'), teal=c('497c7c'), red=c('a3553b'), wood=c('af9674'),white=c('e7e1c9'),black=c('272e2d'),glass=c('68878a');
  // Materials: 0 cast metal, 1 concrete, 2 steel corrugation, 3 timber, 4 pavement, 5 glazing, 6 water, 7 glow.
  function vertex(p,n,col,u,v,m){
    mesh.push(...p,...n,...col,u,v,m);
  }
  function quad(a,b,d,e,n,col,m=0,uv){
    const U=uv||[a,b,d,e].map(p=>Math.abs(n[1])>.7?[p[0],p[2]]:(Math.abs(n[0])>.7?[p[2],p[1]]:[p[0],p[1]]));
    const pts=[a,b,d,e];for(const i of [0,1,2,0,2,3]) vertex(pts[i],n,col,U[i][0],U[i][1],m);
  }
  function box(x,y,z,w,h,d,col,m=0){
    const l=x-w/2,r=x+w/2,b=y-h/2,t=y+h/2,f=z+d/2,k=z-d/2;
    quad([l,b,f],[r,b,f],[r,t,f],[l,t,f],[0,0,1],col,m);
    quad([r,b,k],[l,b,k],[l,t,k],[r,t,k],[0,0,-1],col,m);
    quad([r,b,f],[r,b,k],[r,t,k],[r,t,f],[1,0,0],col,m);
    quad([l,b,k],[l,b,f],[l,t,f],[l,t,k],[-1,0,0],col,m);
    quad([l,t,f],[r,t,f],[r,t,k],[l,t,k],[0,1,0],col,m);
    quad([l,b,k],[r,b,k],[r,b,f],[l,b,f],[0,-1,0],col,m);
  }
  const add=(a,b)=>a.map((v,i)=>v+b[i]), sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,v)=>a.map(q=>q*v);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm=a=>mul(a,1/(Math.hypot(...a)||1));
  function bar(a,b,r,col,sides=4){
    const t=norm(sub(b,a)),u=norm(cross(t,Math.abs(t[1])>.96?[0,0,1]:[0,1,0])),v=cross(t,u);
    const ring=i=>add(mul(u,r*Math.cos(i*2*Math.PI/sides+Math.PI/4)),mul(v,r*Math.sin(i*2*Math.PI/sides+Math.PI/4)));
    for(let i=0;i<sides;i++){
      const lo=ring(i),hi=ring(i+1);quad(add(a,lo),add(b,lo),add(b,hi),add(a,hi),norm(add(lo,hi)),col,0);
    }
  }
  const sign=(x,y,z,w,h,face,id)=>{ // upright sign plane, stencils printed against existing surfaces
    const dx=face==='e'||face==='w'?0:w/2,dz=face==='e'? -w/2:face==='w'?w/2:0,sg=face==='n'?-1:1;
    const u=(id%4)/4,v=Math.floor(id/4)/4,g=.0008;
    quad([x-dx*sg,y-h/2,z-dz],[x+dx*sg,y-h/2,z+dz],[x+dx*sg,y+h/2,z+dz],[x-dx*sg,y+h/2,z-dz],
    face==='s'?[0,0,1]:face==='n'?[0,0,-1]:face==='e'?[1,0,0]:[-1,0,0],white,10,[[u+g,v+.25-g],[u+.25-g,v+.25-g],[u+.25-g,v+g],[u+g,v+g]]);
  };
  const beam=(x,y,z,w,h,d,col)=>box(x,y,z,w,h,d,col);
  function cargo(x,z,w,d,h,color){
    box(x,h/2,z,w,h,d,color,2);
    for(const y of [.10,h-.10]){
      box(x,y,z,w+.08,.17,d+.08,color);
    }
    for(const xx of [-1,1]) for(const zz of [-1,1]){
      box(x+xx*(w/2-.06),h/2,z+zz*(d/2-.06),.21,h+.05,.22,color);
      for(const yy of [.16,h-.16])box(x+xx*(w/2-.065),yy,z+zz*(d/2-.06),.24,.23,.25,iron);
    }
    const long=w>d;
    for(const side of [-1,1]){
      const front=long?'s':'e';
      if(long){
        sign(x-.5,h*.56,z+side*(d/2+.015),w*.64,.9,side===1?front:'n',color===red?1:2);
        sign(x+w*.33,h*.30,z+side*(d/2+.018),.72,.66,side===1?'s':'n',3);
      } else {
        sign(x+side*(w/2+.014),h*.56,z,d*.62,.87,side===1?front:'w',2);
        sign(x+side*(w/2+.017),h*.3,z+d*.32,.7,.64,side===1?'e':'w',3);
      }
      const end=side*(long?w:d)/2;
      for(const q of [-.95,-.32,.32,.95]){
        const xx=x+(long?end:q), zz=z+(long?q:end);
        box(xx,h/2,zz,long?.13:.065,h-.45,long?.065:.13,grey);
        for(const yy of [.52,1.48,2.74])box(xx,yy,zz,long?.18:.19,.08,long?.19:.18,grey);
      }
    }
  }
  function crate(x,z,w,d,h){
    box(x,h*.5,z,w,h,d,wood,3);
    for(const yy of [.13,h-.13]) box(x,yy,z,w+.08,.22,d+.08,wood,3);
    for(const i of [-1,1])for(const j of [-1,1])box(x+i*(w/2-.09),h/2,z+j*(d/2-.09),.24,h,.24,wood,3);
    for(const i of [-.25,.25]){
      for(const side of [-1,1])box(x+w*i,h/2,z+side*(d/2+.035),.045,h+.02,.05,iron);
      box(x+w*i,h+.014,z,.045,.028,d+.04,iron);
    }
    // Metal corner shoes and rivet plates interrupt the bare timber surface.
    for(const a of [-1,1])for(const b of [-1,1]){
      for(const yy of [.20,h-.20]){
        box(x+a*(w/2-.115),yy,z+b*(d/2+.042),.28,.24,.035,iron);
        box(x+a*(w/2+.042),yy,z+b*(d/2-.115),.035,.24,.28,iron);
        box(x+a*(w/2-.15),yy,z+b*(d/2+.068),.045,.045,.022,grey);
      }
    }
    for(const side of [-1,1]){
      bar([x-w*.42,.32,z+side*(d/2+.04)],[x+w*.42,h-.32,z+side*(d/2+.04)],.105,wood);
      sign(x+w*.28,h*.63,z+side*(d/2+.045),.49,.43,side===1?'s':'n',12);
    }
  }
  function barrier(x,z,w,d,h){
    box(x,.27,z,w,.54,d,concrete,1);
    box(x,h/2,z,w-.12,h,d*.65,concrete,1);
    for(const s of [-1,1])sign(x,.89,z+s*(d*.325+.012),w*.82,.32,s===1?'s':'n',8);
  }
  function warehouse(x,z,w,h,d){
    box(x,h/2,z,w,h,d,concrete,1);
    const front=z+d/2;
    box(x,h-.2,z,w+.55,.3,d+.55,iron);
    // Glazed clerestory with individual steel mullions and aged panes.
    for(let xx=x-w/2+.8;xx<x+w/2-.3;xx+=1.25){
      box(xx,h-1.55,front+.025,1.15,1.72,.09,mul(glass,.70+rng()*.31),5);
      box(xx,h-1.56,front+.095,1.21,.046,.06,iron);
    }
    box(x,h-2.48,front+.13,w+.14,.16,.27,grey);
    for(const a of [-.27,.16]){
      const xx=x+w*a;
      box(xx,2.8,front+.12,5.8,5.6,.18,dark);
      box(xx,2.55,front+.225,5.15,5,.08,grey);
      for(let y=.3;y<5;y+=.26)box(xx,y,front+.28,5.16,.035,.06,iron);
      box(xx,5.85,front+.6,6.4,.14,1.35,iron);
      for(const s of [-1,1]){
        const b=xx+s*2.78;box(b,1.4,front+.3,.25,2.8,.23,yellow);
        for(let n=0;n<3;n++)box(b,.28+n*.75,front+.433,.25,.23,.03,black);
      }
    }
    for(let xx=x-w/2+.15;xx<x+w/2;xx+=5.6)box(xx,h/2,front+.11,.23,h,.28,grey,1);
    for(let i=0;i<4;i++){
      const xx=x-w*.35+i*w*.22;box(xx,h+.4,z,2,.8,1.4,iron);
      for(let u=0;u<6;u++)box(xx-.69+u*.27,h+.43,z+.71,.1,.51,.045,dark);
    }
    sign(x+w*.35,3.35,front+.19,4.05,3.2,'s',4);
    box(x-w*.21,h+.86,front-.15,w*.48,1.9,.22,dark);
    sign(x-w*.21,h+.86,front-.025,w*.46,1.64,'s',0);
  }
  function crane(kx,kz,scale=1){
    const p=(x,y,z)=>[kx+x*scale,y*scale,kz+z*scale];
    const b=(a,q,r,col,s)=>bar(p(...a),p(...q),r*scale,col,s);
    const C=(x,y,z,w,h,d,col)=>box(...p(x,y,z),w*scale,h*scale,d*scale,col);
    // Dockside luffing crane with a tapered leg frame and a trussed boom.
    for(const sx of [-1,1]) for(const sz of [-1,1]){
      b([sx*2.4,0,sz*2.4],[sx*.9,10.5,sz*.9],.42,orange);
      C(sx*2.4,.44,sz*2.4,1.3,.88,1.35,dark);
      b([sx*1.85,4,sz*1.85],[-sx*1.2,8,sz*1.2],.14,orange);
    }
    C(0,10.6,0,4.5,.65,4.1,iron);C(-.75,11.65,0,3.5,1.8,2.5,orange);
    C(1.63,11.05,1.2,1.32,2,1.52,yellow);
    C(1.63,11.5,2.01,1.13,.72,.09,glass);C(2.32,11.5,1.2,.08,.72,1.3,glass);
    for(const s of [-1,1]){
      for(const sy of [0,1])b([0,11.9+sy*1.55,s*.77],[15.4,19.2+sy*.45,s*.3],.16,orange);
      b([-1.15,12.1,s*.9],[-3.5,17.4,s*.6],.19,orange);
      b([-3.5,17.4,s*.6],[14.9,19.15,s*.28],.046,dark,5);
      for(let i=0;i<10;i++){
        const X=t=>15.4*t,Y=t=>11.9+7.3*t,W=t=>.77-.47*t,H=t=>1.55-1.1*t;
        let t=i/10,u=(i+1)/10;
        b([X(t),Y(t)+(i%2)*H(t),s*W(t)],[X(u),Y(u)+(1-i%2)*H(u),s*W(u)],.105,orange);
        b([X(t),Y(t),s*W(t)],[X(t),Y(t)+H(t),s*W(t)],.08,orange);
      }
    }
    for(const s of [-1,1])b([15.32,19.24,s*.26],[15.32,8.25,s*.26],.034,dark,5);
    C(15.32,8.1,0,.64,.65,.52,yellow);
    b([15.32,7.96,0],[15.32,7.48,0],.07,dark,6);
  }
  function lamp(x,z,h,j){
    bar([x,0,z],[x,h,z],.09,grey,7);
    bar([x,h,z],[x+j*1.5,h+.28,z],.09,grey,6);
    box(x+j*1.56,h+.18,z,.77,.18,.40,dark);
    box(x+j*1.56,h+.075,z,.65,.035,.33,white,7);
  }
  function groundStripe(x,z,w,d,col){
    quad([x-w/2,.016,z+d/2],[x+w/2,.016,z+d/2],[x+w/2,.016,z-d/2],[x-w/2,.016,z-d/2],[0,1,0],col,9);
  }
  function drawPerimeter(material){
    for(const w of map.walls.slice(layouts[map.id].length)){
      box(w.x,w.h/2,w.z,w.w,w.h,w.d,material,1);
      box(w.x,w.h-.1,w.z,w.w+.12,.2,w.d+.12,grey,1);
    }
  }
  function drawDock(){
    box(0,-.38,0,49,.76,41,c('9e998c'),4);
    box(0,-1.9,0,49,2.8,42,concrete,1);
    quad([-180,-1.65,120],[180,-1.65,120],[180,-1.65,-160],[-180,-1.65,-160],[0,1,0],c('648c91'),6);
    drawPerimeter(concrete);
    for(let x=-23;x<24;x+=4){
      for(const z of [-19.975,19.975]){
        box(x,1.55,z,.21,3.1,.22,grey,1);
        if(x%8===1)box(x+1.4,.35,z,.9,.33,.06,dark,0);
      }
    }
    for(let z=-18;z<20;z+=3.1){
      box(24,1.64,z,.075,1.05,.075,iron);
      box(-24,1.55,z,.14,3.1,.2,grey,1);
    }
    for(const yy of [1.64,2.06])box(24,yy,0,.06,.065,40.5,iron);
    // Striped routing paint, loading bays and long drainage grilles.
    for(const x of [-17.5,18.8]){
      for(let z=-18;z<18;z+=3.8)groundStripe(x,z,.12,2.25,yellow);
    }
    for(const z of [-14.7,12.5])groundStripe(0,z,32,.12,yellow);
    for(const z of [-5,3.25])for(let x=-22;x<24;x+=3.25)groundStripe(x,z,1.4,.085,white);
    for(const [x,z,w,d,h,t] of dockProps){
      if(t==='red'||t==='teal'){
        cargo(x,z,w,d,h,t==='red'?red:teal);
        for(const s of [-1,1])for(const a of [-1,1]){
          groundStripe(x+s*(w/2+.35),z+a*(d/2+.24),.12,.81,white);
          groundStripe(x+s*(w/2+.11),z+a*(d/2+.59),.57,.11,white);
        }
      }else if(t==='crate')crate(x,z,w,d,h);
      else barrier(x,z,w,d,h);
    }
    for(const x of [-20.8,20.8]){
      for(let z=-16;z<18;z+=4.3){
        box(x,.014,z,.37,.027,4.02,dark);
        for(let d=-1.92;d<2;d+=.19)box(x,.031,z+d,.35,.023,.067,grey);
      }
    }
    for(const x of [-8.3,9.2]){
      const z=x<0?-12.1:12.9,w=3.35,h=1.15,u=.75,v=.25;
      quad([x-w/2,.026,z+h/2],[x+w/2,.026,z+h/2],[x+w/2,.026,z-h/2],[x-w/2,.026,z-h/2],[0,1,0],white,10,
        [[u+.001,v+.249],[u+.249,v+.249],[u+.249,v+.001],[u+.001,v+.001]]);
    }
    // Worn diagonal stops mark the rail crossings.
    for(const x of [-17.1,17.7])for(let i=-2;i<=2;i++){
      const z=-13.8+i*.39;
      quad([x-.61,.023,z],[x-.49,.023,z-.13],[x+.53,.023,z+.80],[x+.41,.023,z+.94],[0,1,0],yellow,9);
    }
    // Railroad embedded at the north end, bright, worn running edges.
    for(const z of [-18.25,-16.95]){
      box(0,.012,z,47,.022,.13,dark);
      box(0,.027,z+.017,47,.02,.052,grey);
    }
    warehouse(-6.1,-24.8,28,8.4,8);
    warehouse(-32.8,3.2,16,7.8,28);
    for(let i=0;i<11;i++){
      const z=-17+i*3.15;box(-24.75,4.65,z,.14,2.6,2.8,i%4===1?glass:iron,i%4===1?5:2);
      box(-24.65,6.3,z,.22,.17,2.98,dark);
    }
    // Wall identification, warning enamel signs and low surface piping.
    sign(-12.2,2.15,-19.968,5.3,1.52,'s',5);
    sign(8.1,2.05,-19.968,5.4,1.35,'s',6);
    sign(-23.978,1.8,1.1,5.0,1.8,'e',9);
    sign(7.7,1.8,19.971,4.9,1.6,'n',5);
    for(const z of [-16.6,-.5,16.7]) sign(-23.97,2.25,z,1.65,.85,'e',11);
    for(const z of [-15,-4,12]) sign(23.98,.7,z,2.9,.4,'w',8);
    for(const y of [.43,.73])bar([-23.64,y,-18],[-23.64,y,17.5],.085,orange,7);
    for(let z=-17;z<18;z+=2.4) box(-23.66,.6,z,.22,.58,.078,dark);
    // The crane stands beyond the northern wall. An unobstructed, low eastern parapet opens to the bay.
    crane(9,-24.5,1.12);
    for(const [x,z,j] of [[-22,-16,1],[23,18,-1],[23,-18,-1],[-21,18,1]]) lamp(x,z,7.5,j);
    for(const [x,z] of [[-12,-32],[-16,-34],[-20,-33],[-22,-40]]) {
      const h=8+rng()*4;
      bar([x,0,z],[x,h,z],2.1,grey,16);
      for(const yy of [1,h*.45,h-.1])bar([x,yy-.1,z],[x,yy+.1,z],2.19,iron,16);
      box(x,h+.1,z,2.4,.25,2.4,dark);
      bar([x,h,z],[x,h+1.5,z],.27,iron,10);
    }
    // Across the basin the distant wharves and their cranes are part of the panorama.
    // Elevated pipe bridge connecting north warehouses.
    for(const y of [5.36,5.9])bar([-26,y,-23],[31,y,-23],.22,iron,9);
    for(let x=-25;x<32;x+=6.5){box(x,2.6,-23,.23,5.2,.24,iron);box(x,5.13,-23,.94,.19,1.7,iron);}
  }
  function track(z){
    box(0,-.003,z,48,.025,3.6,c('736c5f'),4);
    for(let x=-23.6;x<24;x+=.82){
      box(x,.034,z,.23,.065,2.45,c('625444'),3);
      for(const side of [-1,1])box(x,.078,z+side*.77,.23,.04,.25,iron);
    }
    for(const side of [-1,1]){
      box(0,.092,z+.77*side,48,.12,.10,dark);
      box(0,.158,z+.77*side,48,.042,.13,c('bab8a8'));
    }
  }
  function railCar(x,z,w,d,h,hopper){
    const body=hopper?c('758378'):c('924e38'), trim=hopper?c('536457'):c('623a30');
    box(x,.72,z,w-.45,.36,d-.52,dark);
    box(x,1.04,z,w,.30,d,trim);
    for(const end of [-1,1]){
      const axle=x+end*(w*.5-1.52);
      box(axle,.53,z,2,.61,d*.56,black);
      for(const wheel of [-.65,.65])for(const side of [-1,1]){
        const zz=z+side*(d*.5-.25);
        bar([axle+wheel,.48,zz-side*.23],[axle+wheel,.48,zz],.38,dark,12);
        box(axle+wheel,.47,zz,.33,.30,.16,iron);
      }
    }
    const zFront=d*.5;
    box(x,(h+1.14)*.5,z,w-.16,h-1.14,d-.1,body,hopper?0:2);
    box(x,h-.065,z,w,.13,d,trim);
    for(const side of [-1,1]){
      const zz=z+zFront*side;
      if(hopper){
        for(let i=0;i<5;i++){
          const x1=x-w*.48+i*w*.193;
          bar([x1,1.23,zz],[x1+w*.168,h-.11,zz],.091,trim);
          box(x1,(1.22+h)*.5,zz,.12,h-1.20,.105,trim);
        }
      }else{
        for(let i=0;i<8;i++)box(x-w*.48+i*w*.137,(h+1.16)*.5,zz,.10,h-1.16,.09,trim);
        box(x,h*.64,zz,2.72,h*.62,.11,iron,2);
        for(const y of [1.28,h-.17])box(x,y,zz+side*.08,3.15,.10,.09,dark);
      }
      sign(x-w*.28,h*.66,zz+side*.073,1.85,.85,side===1?'s':'n',13);
      for(const k of [-.40,-.16,.16,.40])box(x+w*k,1.02,zz+side*.025,.38,.10,.05,yellow);
      const endx=x+w*.45;
      for(const xx of [-.18,.18])box(endx+xx,h*.55,zz+side*.085,.045,h*.73,.045,grey);
      for(let yy=.78;yy<h*.91;yy+=.32)box(endx,yy,zz+side*.105,.40,.039,.045,grey);
    }
  }
  function sleeperStack(x,z,w,d,h){
    const layers=Math.ceil(h/.32), pieces=4, color=c('746353');
    for(let i=0;i<layers;i++){
      const y=(i+.5)*h/layers;
      for(let j=0;j<pieces;j++){
        const zz=z-d*.5+(j+.5)*d/pieces;
        box(x,y,zz,w,h/layers-.018,d/pieces-.03,mul(color,.84+.2*rng()),3);
      }
    }
    for(const s of [-1,1]){
      const xx=x+s*w*.29;
      box(xx,h+.008,z,.066,.022,d+.01,iron);
      for(const side of [-1,1])box(xx,h*.5,z+side*d*.5,.066,h,.035,iron);
    }
  }
  function signalCabin(x,z,w,d,h){
    box(x,h*.5,z,w,h,d,c('a49880'),1);
    box(x,h*.35,z,w+.08,.16,d+.08,iron);
    for(const s of [-1,1]){
      const zz=z+s*d*.5;
      for(let i=0;i<4;i++){
        const xx=x+((i+.5)/4-.5)*w*.91;
        box(xx,h*.72,zz,w*.203,.95,.09,dark);
        box(xx,h*.72,zz+s*.06,w*.178,.81,.035,glass,5);
      }
      sign(x,h*.29,zz+s*.025,2.05,.66,s===1?'s':'n',13);
    }
    box(x,h-.06,z,w+.30,.16,d+.30,iron);
    bar([x-w*.36,h,z],[x-w*.36,h+1.45,z],.035,grey);
  }
  function signalBridge(z){
    const steel=c('576363');
    for(const x of [-25,25]){
      for(const zz of [z-.57,z+.57])box(x,4.3,zz,.24,8.6,.23,steel);
      for(let y=.3;y<8;y+=.43)box(x,y,z,.09,.06,1.12,grey);
    }
    for(const zz of [z-.54,z+.54]){
      for(const y of [7.6,8.63])box(0,y,zz,50,.13,.13,steel);
      for(let x=-25;x<25;x+=2.5){
        box(x,8.1,zz,.083,1.02,.083,steel);
        bar([x,7.65,zz],[x+2.5,8.57,zz],.063,steel);
      }
    }
    for(const x of [-11,0,10.4]){
      box(x,7.5,z,.13,1.3,.12,grey);
      box(x,6.65,z,.48,1.32,.32,black);
      for(let i=0;i<3;i++){
        const yy=6.28+i*.35;
        bar([x,yy,z+.16],[x,yy,z+.205],.112,i===(x===0?1:2)?(x===0?yellow:red):dark,10);
        box(x,yy+.13,z+.22,.32,.065,.18,black);
      }
    }
  }
  function drawRail(){
    box(0,-.25,0,49,.5,41,c('938e81'),4);
    box(0,-1.05,0,310,1.5,290,c('7c7e70'),1);
    drawPerimeter(c('9a998a'));
    for(const z of [-6.5,5.8])track(z);
    for(const z of [-8.55,-4.46,3.74,7.85]){
      for(let x=-22.7;x<23.4;x+=3.35)groundStripe(x,z,1.67,.09,yellow);
    }
    for(const x of [-20.1,20]){
      for(let z=-9.3;z<9.5;z+=.77)groundStripe(x,z,2.3,.27,white);
    }
    for(const [x,z,w,d,h,type] of railProps){
      if(type==='boxcar'||type==='hopper')railCar(x,z,w,d,h,type==='hopper');
      else if(type==='cabin')signalCabin(x,z,w,d,h);
      else if(type==='ties')sleeperStack(x,z,w,d,h);
      else barrier(x,z,w,d,h);
    }
    signalBridge(-16.6);
    warehouse(-13,-27,23,7.7,11);
    for(const z of [-11,5,16])lamp(25,z,8.4,-1);
    for(const z of [-13,1])lamp(-25,z,7.5,1);
    // Silos, a stack and distant freight suggest a working depot beyond the trackside wall.
    for(const x of [8,12.7,17.4]){
      bar([x,0,-29],[x,9,-29],2.25,c('a19e8c'),18);
      for(const y of [2.6,5.5,8.75])bar([x,y,-29],[x,y+.10,-29],2.28,grey,18);
      box(x,9.12,-29,2.8,.23,2.8,grey);
    }
    bar([27,0,-38],[27,16,-38],1.04,c('856956'),14);
    for(const y of [11.3,14.4])bar([27,y,-38],[27,y+.97,-38],1.06,concrete,14);
    railCar(-13,25.4,13,3,3.55,false);railCar(2,25.4,12.7,3,3.18,true);
    for(const z of [-10,9])sign(-23.976,1.43,z,3.2,.9,'e',13);
  }
  function shed(x,z,w,d,h){
    const plaster=c('afac97'), cladding=c('5b7772'), frame=c('485854');
    box(x,h*.5,z,w,h,d,plaster,1);
    box(x,h*.71,z,w+.045,h*.54,d+.045,cladding,2);
    box(x,h-.08,z,w+.21,.18,d+.21,frame);
    // Closed roller doors and high ribbon windows identify individual loading bays.
    const ww=Math.min(w*.67,5.65), doorHeight=Math.min(3.32,h*.61);
    for(const s of [-1,1]){
      const zz=z+s*d*.5;
      box(x,doorHeight*.5,zz+s*.055,ww,doorHeight,.10,frame);
      box(x,doorHeight*.49,zz+s*.122,ww-.23,doorHeight-.15,.042,c('8c9182'));
      for(let yy=.28;yy<doorHeight-.10;yy+=.255)box(x,yy,zz+s*.15,ww-.23,.04,.04,iron);
      box(x,doorHeight+.06,zz+s*.15,ww+.38,.17,.36,frame);
      for(const j of [-1,1]){
        const xx=x+j*(ww*.5+.23);
        box(xx,.72,zz+s*.17,.17,1.44,.22,yellow);
        for(const yy of [.39,.83,1.26])box(xx,yy,zz+s*.29,.17,.16,.027,black);
      }
      for(let i=0;i<Math.floor(w/1.6);i++){
        const xx=x-w*.5+.88+i*1.6;
        box(xx,h-.68,zz+s*.057,1.34,.60,.075,frame);
        box(xx,h-.68,zz+s*.108,1.23,.51,.036,glass,5);
      }
    }
    for(const s of [-1,1]){
      const xx=x+s*w*.5;
      for(let i=0;i<Math.floor(d/1.6);i++){
        const zz=z-d*.5+.86+i*1.6;
        box(xx+s*.055,h-.83,zz,.075,.91,1.38,frame);
        box(xx+s*.10,h-.83,zz,.036,.78,1.24,glass,5);
      }
      sign(xx+s*.065,h*.37,z,2.6,1.06,s===1?'e':'w',14);
      const pipeZ=z+d*.37;
      bar([xx+s*.075,.1,pipeZ],[xx+s*.075,h-.18,pipeZ],.084,grey,7);
    }
    box(x,h+.21,z,1.75,.44,.98,iron);
    for(let i=0;i<6;i++)box(x-.64+i*.25,h+.23,z+.5,.085,.26,.035,black);
  }
  function generator(x,z,w,d,h){
    const body=c('8b925f');
    box(x,.14,z,w,.28,d,iron);
    box(x,(h+.25)*.5,z,w-.14,h-.25,d-.14,body,2);
    box(x,h-.075,z,w,.15,d,iron);
    for(const s of [-1,1]){
      const xx=x+s*(w*.5-.05);
      box(xx,h*.53,z,.065,h*.63,d*.69,dark);
      for(let i=0;i<10;i++)box(xx+s*.041,h*.26+i*h*.059,z,.085,.061,d*.67,iron);
    }
    sign(x,h*.62,z+d*.5-.052,w*.68,.71,'s',15);
  }
  function sawtoothHall(){
    const x=-2,z=-31,w=48,d=13,base=7.6;
    box(x,base*.5,z,w,base,d,c('a69d89'),1);
    const z1=z+d*.5,z2=z-d*.5,step=6;
    for(let lo=x-w*.5;lo<x+w*.5;lo+=step){
      const hi=lo+step,top=base+2.25;
      quad([lo,base,z1],[hi,top,z1],[hi,top,z2],[lo,base,z2],norm([-2.25,step,0]),iron,2);
      quad([hi,base,z1],[hi,base,z2],[hi,top,z2],[hi,top,z1],[1,0,0],glass,5);
      // Extruded end of the sawtooth roof, with a row of glazed sashes underneath.
      quad([lo,base,z1],[hi,base,z1],[hi,top,z1],[lo,base,z1],[0,0,1],c('677c77'),2);
      for(let i=0;i<4;i++)box(lo+.8+i*1.45,base-1.1,z1+.06,1.30,1.45,.11,glass,5);
      box(hi,base*.5,z1+.11,.23,base,.21,iron);
    }
    box(7,4.95,z1+.19,9.0,2,.22,iron);
    sign(7,4.95,z1+.315,8.55,1.68,'s',14);
  }
  function drawYard(){
    box(0,-.25,0,49,.5,41,c('aba497'),4);
    box(0,-.95,0,280,1.35,275,c('81887d'),1);
    drawPerimeter(c('b2ad9b'));
    for(const [x,z,w,d,h,type] of yardProps){
      if(type==='shed')shed(x,z,w,d,h);
      else if(type==='generator')generator(x,z,w,d,h);
      else if(type==='crate')crate(x,z,w,d,h);
      else barrier(x,z,w,d,h);
    }
    for(const [x,z,w,d] of yardProps.slice(0,3)){
      for(const s of [-1,1]){
        const front=z+s*(d*.5+1.2);
        groundStripe(x,front,w*.80,.10,yellow);
        for(const j of [-1,1])groundStripe(x+j*w*.40,front-s*.35,.10,.74,yellow);
      }
    }
    for(let x=-21;x<22;x+=2.6)groundStripe(x,16.8,1.32,.13,white);
    for(let z=-17;z<18;z+=2.9)groundStripe(19.6,z,.12,1.35,white);
    for(let i=0;i<7;i++)groundStripe(-3.9+i*.41,-6.0,.22,1.26,yellow);
    sawtoothHall();shed(35,-3,16,26,8.4);warehouse(-31,3,11,8.5,34);
    // Brick utility stacks and an elevated insulated pipe run frame the southern skyline.
    for(const x of [-19,-15]){
      bar([x,0,29],[x,14+(x+19)*.5,29],.91,c('9a7762'),14);
      for(const y of [6,9,12])bar([x,y,29],[x,y+.23,29],.94,iron,14);
    }
    for(const y of [5.6,6.35])bar([-28,y,23],[28,y,23],.28,c('7e8a83'),10);
    for(let x=-25;x<=25;x+=8){
      box(x,2.68,23,.25,5.36,.24,iron);box(x,5.34,23,.28,.2,1.5,iron);
    }
    for(const x of [-18,18])lamp(x,20.8,7.25,x<0?1:-1);
    for(const x of [-14,12])sign(x,2.08,19.969,3.8,1.0,'n',14);
    for(const z of [-14,14])sign(23.967,1.85,z,2.6,.72,'w',15);
  }
  function makeScene(){
    seed=65723;mesh=[];
    if(map.id==='dock')drawDock();
    else if(map.id==='rail')drawRail();
    else drawYard();
    return new Float32Array(mesh);
  }
  function makeNoise(){
    const size=256,img=new Uint8Array(size*size*4), tiled=[];
    for(const n of [4,8,16,32,64,128]){
      const v=Array.from({length:n*n},rng);tiled.push((x,y)=>{
        const sx=x/size*n, sy=y/size*n, ax=Math.floor(sx),ay=Math.floor(sy);
        const U=sx-ax,V=sy-ay,u=U*U*(3-2*U),v2=V*V*(3-2*V),at=(i,j)=>v[((ay+j)%n)*n+(ax+i)%n];
        return (at(0,0)*(1-u)+at(1,0)*u)*(1-v2)+(at(0,1)*(1-u)+at(1,1)*u)*v2;
      });
    }
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const k=4*(y*size+x);
      img[k]=255*(tiled[0](x,y)*.4+tiled[1](x,y)*.28+tiled[2](x,y)*.18+tiled[3](x,y)*.14);
      img[k+1]=255*(tiled[3](x,y)*.4+tiled[4](x,y)*.35+tiled[5](x,y)*.25);
      img[k+2]=255*rng();img[k+3]=255;
    }
    const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,img);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);return t;
  }
  function makeOcclusion(){
    // Static contact shadow and dirt mask, sampled by the arena pavement.
    const N=256,bytes=new Uint8Array(N*N*4);
    for(let j=0;j<N;j++)for(let i=0;i<N;i++){
      const x=(i+.5)/N*50-25,z=(j+.5)/N*42-21;
      let ao=1;
      for(const b of map.walls){
        const dx=Math.max(0,Math.abs(x-b.x)-b.w*.5),dz=Math.max(0,Math.abs(z-b.z)-b.d*.5);
        const d=Math.sqrt(dx*dx+dz*dz),amp=Math.min(.39,.19+b.h*.055);
        ao=Math.min(ao,1-amp*Math.exp(-d*(1.46+.4/b.h)));
      }
      const k=4*(j*N+i);bytes[k]=bytes[k+1]=bytes[k+2]=Math.round(ao*255);bytes[k+3]=255;
    }
    const t=occlusionMap||gl.createTexture();gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,N,N,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;
  }
  function makeDecals(){
    const atlas=document.createElement('canvas');atlas.width=2048;atlas.height=1024;
    const ctx=atlas.getContext('2d');
    const draw=(id,fn)=>{ctx.save();ctx.translate((id%4)*512,Math.floor(id/4)*256);ctx.beginPath();ctx.rect(0,0,512,256);ctx.clip();fn();ctx.restore();};
    function label(s,x,y,size,w,fill='#e4e4cd',font='bold'){
      ctx.fillStyle=fill;ctx.textAlign='center';ctx.font=font+' '+size+'px Arial, sans-serif';
      ctx.fillText(s,x,y,w);
    }
    draw(0,()=>{label('GREYPORT',256,182,172,495);label('INDUSTRIAL TERMINAL',256,229,38,466,'#dcb269');});
    draw(1,()=>{label('◩   MERIDIAN',256,175,156,492);label('INTERMODAL  /  FREIGHT SYSTEM',255,233,42,428);});
    draw(2,()=>{label('▰   NORDLINE',256,168,156,495);label('MARITIME LOGISTICS',260,228,43,406);});
    draw(3,()=>{ctx.strokeStyle='#e1dcc0';ctx.lineWidth=8;ctx.strokeRect(18,15,476,223);label('GPHU  307216  5',255,83,60,446);label('MAX GROSS  30 480 KG',255,149,43,446);label('TARE   2 300 KG     22G1',255,210,42,440);});
    draw(4,()=>{label('03',256,182,220,380,'#565e57');label('SERVICE HALL',256,230,36,410,'#555d57');});
    draw(5,()=>{label('A  ←',256,206,236,473,'#80432c');});
    draw(6,()=>{label('B  →',256,207,236,476,'#405c62');});
    draw(7,()=>{label('DOCK  /  03',256,188,188,501,'#d6bb79');});
    draw(8,()=>{ctx.fillStyle='#c7a04f';ctx.fillRect(0,0,512,256);ctx.fillStyle='#383a33';for(let x=-160;x<520;x+=125){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+64,0);ctx.lineTo(x+191,256);ctx.lineTo(x+127,256);ctx.fill();}});
    draw(9,()=>{label('GATE 02',255,180,177,492,'#46544f');label('WEST ACCESS',256,234,48,415,'#565b51');});
    draw(11,()=>{ctx.fillStyle='#d0ad59';ctx.fillRect(0,0,512,256);ctx.strokeStyle='#514b38';ctx.lineWidth=14;ctx.strokeRect(13,13,486,230);label('CAUTION',256,153,108,423,'#393b36');label('DOCK OPERATIONS',256,209,40,427,'#393b36');});
    draw(12,()=>{ctx.fillStyle='#c4b89c';ctx.fillRect(14,20,482,217);label('↑ ↑',256,138,142,345,'#3f453e');label('HANDLE WITH CARE',256,203,47,436,'#3f453e');});
    draw(13,()=>{ctx.fillStyle='#33483e';ctx.fillRect(9,8,494,240);label('G P R',256,167,130,418);label('GREYPORT RAILWAY',256,220,37,415,'#d8bb80');});
    draw(14,()=>{ctx.fillStyle='#37534f';ctx.fillRect(9,10,494,236);label('STORES',256,167,125,454);label('RECEIVING   /   04',256,218,39,427,'#dbbe82');});
    draw(15,()=>{ctx.fillStyle='#daaf60';ctx.fillRect(8,21,496,214);label('SERVICE',256,153,108,454,'#433c30');label('ELECTRICAL  YARD',256,208,37,426,'#433c30');});
    const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    return t;
  }
  function makeSkyTexture(){
    const texture=gl.createTexture(),context=gl;
    skyMapReady=false;
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([156,186,206]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    function upload(){
      if(context!==gl||gl.isContextLost())return;
      const previousUnit=gl.getParameter(gl.ACTIVE_TEXTURE);
      gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,skyImage);
      const pot=n=>n>0&&(n&(n-1))===0;
      if(pot(skyImage.naturalWidth)&&pot(skyImage.naturalHeight)){
        // The longitude discontinuity has no valid screen derivative for choosing a mip.
        // Bilinear sampling here keeps the panorama seam clear even at a grazing view angle.
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
      }
      skyMapReady=true;gl.activeTexture(previousUnit);
    }
    if(skyImage.complete&&skyImage.naturalWidth)upload();
    else skyImage.addEventListener('load',upload,{once:true});
    gl.activeTexture(gl.TEXTURE0);return texture;
  }
  const diskLatitude=skyPhoto.elevation/(Math.PI/2);
  const imageLatitude=(skyPhoto.horizonV-skyPhoto.sunV)/skyPhoto.horizonV;
  const latitudeScale=imageLatitude*(1-diskLatitude)/(diskLatitude*(1-imageLatitude));
  const sampleSkyGLSL=solarLight+`
    uniform sampler2D skyMap;uniform float skyReady;
    uniform float exposure,glare;
    vec3 cameraColor(vec3 color,vec3 ray){
      float towards=max(0.,dot(ray,lightDir));
      float halo=glare*(.015*pow(towards,3.)+.055*pow(towards,26.));
      float peak=max(color.r,max(color.g,color.b));
      float gain=mix(exposure,1.,.92*smoothstep(.68,1.,peak));
      vec3 adapted=color*gain/(1.+max(gain-1.,0.)*color*.65);
      return adapted+(1.-clamp(adapted,0.,1.))*halo*vec3(1.,.85,.61);
    }
    const float horizonRow=`+skyPhoto.horizonV.toFixed(6)+`;
    const float latitudeScale=`+latitudeScale.toFixed(6)+`;
    const float longitudeOffset=`+(skyPhoto.sunU-skyPhoto.azimuth/(2*Math.PI)).toFixed(6)+`;
    vec3 skyRadiance(vec3 ray){
      if(skyReady<.5){
        float sunDot=clamp(dot(ray,lightDir),0.,1.);
        float zenith=pow(max(ray.y,0.),.43);
        return mix(vec3(.82,.84,.83),vec3(.27,.51,.73),zenith)+
          vec3(.24,.15,.075)*pow(sunDot,48.)+vec3(1.,.93,.72)*smoothstep(.999974,.999993,sunDot);
      }
      float azimuth=atan(ray.x,-ray.z+1e-7);
      float lat=asin(clamp(ray.y,-1.,1.))*.636619772;
      float v=lat<0.?horizonRow-(1.-horizonRow)*lat:
        horizonRow*(1.-latitudeScale*lat/(1.+(latitudeScale-1.)*lat));
      float u=fract(longitudeOffset+azimuth*.159154943);
      vec3 col=texture2D(skyMap,vec2(u,v)).rgb;
      float seam=min(u,1.-u);
      if(seam<.016)col=mix(col,texture2D(skyMap,vec2(1.-u,v)).rgb,.5*(1.-smoothstep(0.,.016,seam)));
      if(lat>.90){
        vec3 pole=.5*(texture2D(skyMap,vec2(.26,.003)).rgb+texture2D(skyMap,vec2(.76,.003)).rgb);
        col=mix(col,pole,smoothstep(.90,.997,lat));
      }
      return col;
    }`;
  const shadowCoords=solarLight+`
    vec3 lightSpace(vec3 p){
      vec3 side=normalize(cross(vec3(0.,1.,0.),lightDir));
      vec3 up=normalize(cross(lightDir,side));
      return vec3(dot(p,side)/51.,dot(p-vec3(0.,4.,0.),up)/45.,-dot(p,lightDir)/88.);
    }`;
  const vert=`precision highp float;
    attribute vec3 aP,aN,aC;attribute vec2 aU;attribute float aM;
    uniform vec3 eye,rightV,upV,forwardV;uniform vec2 proj;
    varying vec3 pos,nor,col,sc;varying vec2 uv;varying float mat;
    `+shadowCoords+`
    void main(){
      pos=aP;nor=aN;col=aC;uv=aU;mat=aM;sc=lightSpace(aP)*.5+.5;
      vec3 delta=aP-eye;float z=dot(delta,forwardV);
      gl_Position=vec4(dot(delta,rightV)*proj.x,dot(delta,upV)*proj.y,z*1.00072-.13005,z);
    }`;
  const frag=`precision highp float;
    uniform sampler2D grain,atlas,depthTex,aoMap;uniform vec3 eye;
    uniform float clock,texel;
    varying vec3 pos,nor,col,sc;varying vec2 uv;varying float mat;
    float depthAt(vec2 t){return dot(texture2D(depthTex,t).rg,vec2(1.,1./255.));}
    `+sampleSkyGLSL+`
    float inside(vec2 u){return step(0.,u.x)*step(0.,u.y)*step(u.x,1.)*step(u.y,1.);}
    float occlusion(float N){
      if(inside(sc.xy)<.5||sc.z<0.||sc.z>1.)return 1.;
      float d=sc.z-max(.0019,.0028*(1.-N));vec2 t=vec2(texel*1.2,texel*1.2);
      return .25*(step(d,depthAt(sc.xy+t*vec2(-.81,-.35)))+step(d,depthAt(sc.xy+t*vec2(.65,-.93)))+
        step(d,depthAt(sc.xy+t*vec2(.87,.57)))+step(d,depthAt(sc.xy+t*vec2(-.44,.92))));
    }
    float hash(vec2 n){return fract(sin(dot(n,vec2(17.13,47.81)))*3795.34);}
    void main(){
      vec4 gg=texture2D(grain,uv*.086);vec3 fine=texture2D(grain,uv*.68).rgb;
      vec3 base=col,n=normalize(nor);float N=max(dot(n,lightDir),0.);
      float shade=occlusion(N),dist=length(pos-eye);
      float wear=1.;vec3 light=vec3(1.);
      if(mat<.5){
        wear=.88+.17*gg.r+.14*fine.b;
      }else if(mat<1.5){
        wear=.72+.31*gg.r+.18*fine.g+.06*fine.b;
        float streak=texture2D(grain,uv*vec2(.53,.037)).r;
        wear-=.19*smoothstep(.54,.8,streak);
        if(abs(n.y)<.3){
          vec2 seams=min(fract(uv/vec2(3.7,1.55)),1.-fract(uv/vec2(3.7,1.55)));
          float line=min(seams.x*3.7,seams.y*1.55);wear*=.86+.14*smoothstep(.003,.018,line);
          wear*=.76+.24*smoothstep(.02,1.35,pos.y+gg.r*.4);
        }
      }else if(mat<2.5){
        float rib=fract((abs(n.y)>.6?uv.y:uv.x)*3.65);float fold=smoothstep(.09,.24,rib)-smoothstep(.68,.82,rib);
        float edge=smoothstep(.05,.12,rib)-smoothstep(.16,.23,rib);
        wear=(.79+.27*fold+edge*.16)*(.76+.32*gg.r+.15*fine.g);
        float rust=smoothstep(.62,.84,texture2D(grain,uv*vec2(.29,.053)).r+max(.0,.8-pos.y)*.14);
        base=mix(base,vec3(.34,.22,.14),rust*.75);
        float patina=smoothstep(.51,.72,gg.r)*smoothstep(.42,.71,texture2D(grain,uv*vec2(1.6,.19)).r);
        base=mix(base,vec3(.55,.43,.32),.38*patina);
        wear*=.76+.24*smoothstep(-.17,.66,pos.y+.28*fine.r);
      }else if(mat<3.5){
        float streak=texture2D(grain,uv*vec2(1.83,.12)).g;
        float seam=abs(fract(uv.x*3.)-.5);
        wear=(.60+.50*streak+.20*gg.r)*(.66+.34*smoothstep(.003,.025,seam));
        wear*=.85+.15*smoothstep(-.2,.9,pos.y+fine.g*.27);
      }else if(mat<4.5){
        vec2 cell=uv/vec2(4.8,4.0);vec2 b=min(fract(cell),1.-fract(cell));
        float seams=min(b.x*4.8,b.y*4.);wear=.7+.38*gg.r+.17*fine.g+.11*fine.b;
        wear*=.77+.23*smoothstep(.007,.024,seams+.005*fine.r);
        wear+=.046*(hash(floor(cell))-.5);
        float track=(1.-smoothstep(.035,.18,abs(abs(uv.x+sin(uv.y*.075)*1.2)-8.4)))*smoothstep(.2,.72,gg.r);
        wear-=track*.15;
        float ao=texture2D(aoMap,(pos.xz+vec2(25.,21.))/vec2(50.,42.)).r;
        wear*=ao-.07*(1.-ao)*gg.g;
        float aggregate=texture2D(grain,uv*2.2).b;
        wear-=.14*smoothstep(.73,.94,aggregate);
        wear-=.20*smoothstep(.54,.77,gg.r)*smoothstep(.39,.63,fine.r);
      }else if(mat<5.5){
        float glint=pow(max(0.,dot(reflect(normalize(pos-eye),n),lightDir)),8.);
        base+=vec3(.28,.23,.15)*glint;wear=.82+.25*gg.r;
      }else if(mat<6.5){
        vec2 swell=texture2D(grain,pos.xz*vec2(.024,.099)+vec2(clock*.0018,-clock*.0024)).rg-.5;
        vec2 ripple=texture2D(grain,pos.zx*vec2(.24,.078)+vec2(clock*.004,-clock*.002)).rg-.5;
        vec3 wn=normalize(vec3(swell.x*.23+ripple.x*.13,1.,swell.y*.25+ripple.y*.15));
        vec3 look=normalize(pos-eye),mirror=reflect(look,wn);
        mirror=normalize(vec3(mirror.x,max(mirror.y,-.003),mirror.z));
        float fresnel=.08+.82*pow(1.-clamp(dot(-look,wn),0.,1.),4.);
        vec3 water=mix(vec3(.21,.32,.33)*(1.+swell.x*.35),skyRadiance(mirror),fresnel);
        float sparkle=pow(max(dot(mirror,lightDir),0.),640.);
        water+=vec3(.45,.35,.21)*sparkle;
        gl_FragColor=vec4(cameraColor(mix(water,skyRadiance(look),smoothstep(62.,125.,dist)),look),1.);return;
      }else if(mat<7.5){
        light=vec3(1.);wear=1.;
      }else if(mat<9.5){
        wear=.83+.24*gg.r;if(fine.b>.93&&fine.r>.5)discard;
      }else if(mat<10.5){
        vec4 s=texture2D(atlas,uv);if(s.a<.44)discard;
        base=s.rgb;wear=.93+.07*texture2D(grain,pos.xy*.32).g;
      }else{
        float chipped=texture2D(grain,uv*.31).g;
        float radius=length(uv)+.23*(chipped-.5);
        if(radius>.90)discard;
        float rim=smoothstep(.43,.77,radius);
        base=mix(vec3(.095,.089,.082),vec3(.45,.42,.36),rim*(.70+.22*uv.y+.12*chipped));
      }
      if(abs(mat-7.)>.1){
        vec3 ambient=mix(vec3(.54,.63,.69),vec3(.66,.72,.76),.5+.5*n.y);
        light=ambient+vec3(.71,.55,.33)*N*shade;
        light*=1.-.069*(1.-shade);
      }
      vec3 lit=base*light*wear;
      vec3 look=normalize(pos-eye);
      if(mat>4.5&&mat<5.5){
        vec3 mirror=reflect(look,n);
        float grazing=pow(1.-clamp(dot(n,-look),0.,1.),3.);
        vec3 reflected=skyRadiance(mirror)*vec3(.81,.88,.91);
        lit=mix(lit,reflected,(.15+.39*grazing)*(.74+.26*gg.r));
      }else if(mat<.5||(mat>1.5&&mat<2.5)){
        vec3 halfVector=normalize(lightDir-look);
        float sheen=pow(max(dot(n,halfVector),0.),mat<.5?30.:15.);
        lit+=vec3(.14,.115,.077)*sheen*shade*(.5+.5*gg.g);
      }
      float haze=1.-exp(-dist*.0022-max(dist-30.,0.)*.007);
      float forwardScatter=pow(max(dot(normalize(pos-eye),lightDir),0.),4.);
      vec3 fog=mix(vec3(.70,.77,.82),vec3(.92,.84,.72),forwardScatter);
      lit=mix(lit,fog,haze);
      gl_FragColor=vec4(cameraColor(lit,look),1.);
    }`;
  const skyVert=`attribute vec2 vert;varying vec2 coord;void main(){coord=vert;gl_Position=vec4(vert,1.,1.);}`;
  const skyFrag=`precision highp float;
    varying vec2 coord;uniform vec3 rightV,upV,forwardV;uniform vec2 proj;
    `+sampleSkyGLSL+`
    void main(){
      vec3 ray=normalize(forwardV+rightV*coord.x/proj.x+upV*coord.y/proj.y);
      gl_FragColor=vec4(cameraColor(skyRadiance(ray),ray),1.);
    }`;
  function shaderProgram(vs,fs){
    const p=gl.createProgram();
    for(const [source,type] of [[vs,gl.VERTEX_SHADER],[fs,gl.FRAGMENT_SHADER]]){
      const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p,s);gl.deleteShader(s);
    }
    gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;
  }
  function locations(p,attrs,uniforms){
    const obj={program:p};for(const a of attrs)obj[a]=gl.getAttribLocation(p,a);
    for(const u of uniforms)obj[u]=gl.getUniformLocation(p,u);return obj;
  }
  const common=['rightV','upV','forwardV','proj','clock','grain','exposure','glare'];
  function init(cvs){
    if(gl&&canvas===cvs&&!gl.isContextLost())return true;
    canvas=cvs;gl=cvs.getContext('webgl',{antialias:true,alpha:false,depth:true,stencil:true,preserveDrawingBuffer:false,powerPreference:'high-performance'});
    if(!gl)throw new Error('此浏览器无法建立 WebGL 图形上下文');
    program=locations(shaderProgram(vert,frag),['aP','aN','aC','aU','aM'],[...common,'eye','atlas','depthTex','texel','aoMap','skyMap','skyReady']);
    sky=locations(shaderProgram(skyVert,skyFrag),['vert'],[...common,'skyMap','skyReady']);
    shadowProgram=locations(shaderProgram('attribute vec3 aP;'+shadowCoords+'void main(){gl_Position=vec4(lightSpace(aP),1.);}',
      'precision highp float;void main(){float d=gl_FragCoord.z;vec2 p=fract(d*vec2(1.,255.));p.x-=p.y/255.;gl_FragColor=vec4(p,0.,1.);}'),['aP'],[]);
    skyBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,skyBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    staticMesh=gl.createBuffer();actorMesh=gl.createBuffer();occlusionMap=null;
    terrain=makeNoise();decals=makeDecals();skyMap=makeSkyTexture();shadowSize=Math.min(2048,gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    shadowTex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,shadowTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,shadowSize,shadowSize,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    shadowFB=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFB);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,shadowTex,0);
    const depth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,shadowSize,shadowSize);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('阴影缓冲初始化失败');
    uploadMap();initOperators();return true;
  }
  function uploadMap(){
    const data=makeScene();
    staticCount=data.length/12;mesh=[];
    gl.bindBuffer(gl.ARRAY_BUFFER,staticMesh);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    occlusionMap=makeOcclusion();gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFB);gl.disable(gl.DITHER);
    gl.viewport(0,0,shadowSize,shadowSize);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(shadowProgram.program);gl.enable(gl.DEPTH_TEST);gl.bindBuffer(gl.ARRAY_BUFFER,staticMesh);
    gl.enableVertexAttribArray(shadowProgram.aP);gl.vertexAttribPointer(shadowProgram.aP,3,gl.FLOAT,false,48,0);
    captureSunVisibility();gl.drawArrays(gl.TRIANGLES,0,staticCount);
    gl.disableVertexAttribArray(shadowProgram.aP);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  function selectMap(id){
    const next=maps.find(m=>m.id===id);
    if(!next)return false;
    if(map!==next){
      map=next;operatorMotion.clear();
      if(gl&&staticMesh&&!gl.isContextLost())uploadMap();
    }
    return map;
  }
  // Character geometry and animation.
  const sparks=c('ffd795');
// Rest-pose garment and equipment meshes, authored in metres around the operator rig.
function buildOperatorBody(b, look) {
  const {cloth, clothLight, clothDark, vest, web, leather, hardware, accent} = look;
  const fabric = 11, nylon = 12, hard = 13;
  const seam = b.tone(cloth, .76), binding = b.tone(web, .73);
  const vestEdge = b.tone(vest, .79), strapLight = b.tone(web, 1.14);
  const bootRubber = b.tone(leather, .66), bootGrain = b.tone(leather, 1.19);
  const buckle = b.tone(hardware, .86);
  const sideAngle = Math.PI * .5;

  // Panel coordinate (u,v,n) maps to horizontal, vertical, and forward depth.
  // Bevelled fabric panels have a soft bound rim and a flat face for sewn details.
  function panel(x, y, z, shape, depth, angle, color, material = nylon, bevel = .10) {
    const cs = Math.cos(angle), sn = Math.sin(angle);
    const pt = (u,v,n) => [x+u*cs-n*sn, y+v, z-u*sn-n*cs];
    const back = shape.map(([u,v]) => pt(u*.92,v*.96,0));
    const edge = shape.map(([u,v]) => pt(u,v,depth*.68));
    const face = shape.map(([u,v]) => pt(u*(1-bevel),v*(1-bevel),depth));
    const wallColor = b.tone(color,.83);
    b.patch(back.slice().reverse(), wallColor, material);
    b.patch(face, color, material);
    for(let i=0; i<shape.length; i++) {
      const j=(i+1)%shape.length;
      b.patch([back[i],back[j],edge[j],edge[i]],wallColor,material);
      b.patch([edge[i],edge[j],face[j],face[i]],color,material);
    }
  }

  function pocket(x,y,z,w,h,depth,angle,color,flapColor) {
    const cs=Math.cos(angle), sn=Math.sin(angle);
    const project = (u,v,n) => [x+u*cs-n*sn,y+v,z-u*sn-n*cs];
    const bag=[[-.48*w,.32*h],[-.38*w,.49*h],[.37*w,.49*h],[.49*w,.35*h],
      [.50*w,-.28*h],[.38*w,-.48*h],[-.38*w,-.48*h],[-.5*w,-.30*h]];
    panel(x,y,z,bag,depth,angle,color);
    const flap=[[-.46*w,.08*h],[-.42*w,.21*h],[.42*w,.21*h],[.46*w,.08*h],
      [.36*w,-.11*h],[0,-.19*h],[-.36*w,-.11*h]];
    panel(...project(0,.24*h,depth*.87),flap,depth*.22+.002,angle,flapColor);
    const pull = [project(-.09*w,.12*h,depth*1.11+.003),project(.09*w,.12*h,depth*1.11+.003),
      project(.085*w,-.012*h,depth*1.11+.003),project(-.085*w,-.012*h,depth*1.11+.003)];
    b.patch(pull,binding,nylon);
  }

  // A broad harness strap follows the shoulder contour from sternum to back.
  function shoulderStrap(side) {
    const path=[
      [.115,1.306,-.146,.061],[.136,1.381,-.133,.063],
      [.142,1.438,-.095,.068],[.150,1.466,-.044,.068],
      [.151,1.475,.015,.064],[.145,1.451,.087,.064],
      [.130,1.396,.128,.063],[.120,1.332,.146,.061]
    ];
    for(let i=0;i<path.length-1;i++){
      const [x,y,z,w]=path[i],[u,v,n,d]=path[i+1];
      const p=[[x*side-w/2,y,z],[u*side-d/2,v,n],[u*side+d/2,v,n],[x*side+w/2,y,z]];
      b.patch(p,web,nylon);
      const trim=p.map((point,j)=>[point[0]+(j<2?.004:-.004),point[1]+.0008,point[2]+(i<3?-.001:.001)]);
      b.patch(trim,strapLight,nylon);
    }
    b.box(side*.135,1.383,-.130,.069,.036,.020,buckle,hard);
    b.box(side*.135,1.385,-.143,.048,.011,.006,web,nylon);
  }

  b.bone('pelvis');
  b.loft([[0,.823,.012,.120,.082],[0,.855,.016,.167,.125],
    [0,.928,.016,.182,.132],[0,.990,.009,.164,.118],
    [0,1.053,.009,.147,.110]],cloth,16,fabric);
  b.loft([[0,.946,.011,.178,.124],[0,.954,.011,.184,.131],
    [0,.986,.011,.182,.131],[0,.996,.011,.169,.122]],binding,16,nylon);
  b.box(0,.973,-.123,.073,.044,.017,buckle,hard);
  b.box(0,.973,-.133,.048,.026,.006,bootRubber,hard);
  b.box(.008,.974,-.137,.010,.021,.005,hardware,hard);
  for(const s of [-1,1]) {
    b.box(s*.09,.975,-.103,.021,.055,.020,clothDark,fabric);
    b.box(s*.095,.972,.120,.022,.053,.014,clothDark,fabric);
  }

  b.bone('chest');
  // Fitted torso under a separate waistcoat. The shoulder yoke slopes to the neck.
  b.loft([[0,.981,.012,.152,.105],[0,1.035,.012,.164,.116],
    [0,1.116,.012,.158,.123],[0,1.241,.004,.187,.130],
    [0,1.342,-.003,.209,.129],[0,1.398,.002,.225,.107],
    [0,1.433,.012,.194,.085],[0,1.477,.013,.090,.066]],
    cloth,18,fabric);
  b.loft([[0,1.445,.012,.095,.077],[0,1.466,.014,.088,.074],
    [0,1.493,.011,.079,.072],[0,1.518,.008,.075,.069]],clothDark,14,fabric);
  // A dark overlapping neck gaiter sits inside a raised, open-front field collar.
  // Its front is pulled lower on one side so it doesn't form a rigid circular tube.
  const scarf = b.tone(look.index===1?vest:clothDark,look.index===1?.72:1.04);
  b.loft([[0,1.439,.008,.104,.092],[0,1.467,.009,.093,.084,.008,-.007],
    [0,1.477,.007,.096,.088,.008,-.008],[0,1.491,.008,.084,.079,-.003,.002],
    [0,1.506,.007,.089,.082,-.006,.005],[0,1.526,.009,.073,.072,-.006,.004]],
    scarf,18,fabric);
  const collarAt=(angle,level) => {
    const cs=Math.cos(angle),sn=Math.sin(angle),notch=Math.max(0,cs)**4;
    const [rx,rz,y,drop]=[[.137,.114,1.452,.024],[.118,.104,1.487,.035],
      [.106,.095,1.526,.048],[.092,.082,1.530,.047]][level];
    return [rx*sn,y-drop*notch+.006*sn,.012-rz*cs];
  };
  for(const s of [-1,1])for(let j=0;j<11;j++){
    const a=s*(.20+(Math.PI-.20)*j/11),d=s*(.20+(Math.PI-.20)*(j+1)/11);
    for(let level=0;level<3;level++){
      const pts=[collarAt(a,level),collarAt(a,level+1),collarAt(d,level+1),collarAt(d,level)];
      b.patch(pts,level===2?clothDark:level===1?clothLight:cloth,fabric);
    }
  }
  for(const s of [-1,1]){
    b.patch([[s*.014,1.429,-.106],[s*.025,1.480,-.081],[s*.085,1.504,-.050],
      [s*.105,1.464,-.055],[s*.052,1.431,-.091]],clothLight,fabric);
    b.beam([s*.024,1.476,-.087],[s*.056,1.487,-.081],.0027,seam,fabric,5);
  }
  b.loft([[0,1.037,.01,.160,.130],[0,1.056,.009,.178,.138],
    [0,1.181,.002,.193,.142],[0,1.290,.002,.195,.145],
    [0,1.332,.003,.183,.140]],vestEdge,18,nylon);
  const carrier=[[-.172,.029],[-.128,.119],[-.087,.163],[.087,.163],
    [.128,.119],[.172,.029],[.161,-.131],[.135,-.164],
    [-.134,-.164],[-.163,-.131]];
  panel(0,1.218,-.108,carrier,.051,0,vest);
  // A raised admin panel and segmented binding loops retain their relief in side light.
  const bib=[[-.103,.053],[.103,.053],[.114,.036],[.111,-.044],
    [.085,-.055],[-.093,-.055],[-.111,-.038],[-.112,.034]];
  panel(0,1.305,-.151,bib,.018,0,b.tone(vest,1.08));
  for(const y of [1.288,1.311,1.334]){
    b.box(0,y,-.172,.190,.011,.009,web,nylon);
    for(const x of [-.062,-.021,.021,.062]) b.box(x,y,-.177,.004,.012,.004,binding,nylon);
  }
  // Narrow chest identifier, using original woven bars rather than a team insignia.
  b.box(.034,1.362,-.153,.082,.022,.013,binding,nylon);
  for(const x of [.008,.023,.038]) b.box(x,1.362,-.161,.009,.008,.002,b.tone(accent,.85),nylon);
  for(const s of [-1,1]) {
    shoulderStrap(s);
    for(const y of [1.096,1.140,1.184])
      b.box(s*.184,y,.003,.010,.019,.112,web,nylon);
  }
  for(const s of [-1,0,1])
    pocket(s*.091,1.141,-.149+Math.abs(s)*.013,.089,.158,.042,s*-.18,
      s===0?b.tone(vest,.94):vest,web);

  // Short radio and the shoulder-mounted microphone break the rig's symmetry.
  pocket(-.145,1.245,-.092,.056,.118,.052,.58,web,binding);
  b.box(-.156,1.317,-.134,.048,.048,.032,bootRubber,hard);
  b.beam([-.169,1.336,-.129],[-.171,1.409,-.101],.0048,leather,hard,6);
  b.box(-.128,1.384,-.151,.039,.043,.019,buckle,hard);
  for(const y of [1.377,1.385,1.393]) b.box(-.128,y,-.162,.028,.003,.002,bootRubber,hard);

  // Close-fitting patrol pack with a separate top lid, back pocket and compression straps.
  const pack=[[-.124,.110],[-.102,.161],[-.055,.181],[.067,.175],
    [.115,.152],[.133,.095],[.127,-.108],[.098,-.162],
    [-.094,-.166],[-.126,-.121]];
  panel(0,1.245,.104,pack,.123,Math.PI,b.tone(vest,.89),nylon,.18);
  pocket(0,1.207,.221,.187,.162,.037,Math.PI,vest,web);
  for(const s of [-1,1]){
    const x=.103*s;
    b.beam([x,1.105,.202],[x*1.02,1.300,.223],.008,binding,nylon,6);
    b.box(x,1.211,.229,.025,.029,.008,buckle,hard);
  }
  b.beam([-.047,1.402,.167],[-.039,1.434,.168],.009,binding,nylon,6);
  b.beam([-.039,1.434,.168],[.040,1.434,.168],.009,binding,nylon,6);
  b.beam([.040,1.434,.168],[.048,1.402,.167],.009,binding,nylon,6);
  b.bone('pelvis');
  pocket(-.153,.954,.034,.077,.116,.046,sideAngle,binding,web);
  pocket(.133,.967,.081,.094,.095,.044,-2.23,web,binding);

  for(const s of [-1,1]){
    const side=s<0?'L':'R', outward=-s*sideAngle;
    b.bone('upperArm'+side);
    b.loft([[.245*s,1.118,.009,.058,.058],[.242*s,1.153,.013,.070,.069],
      [.239*s,1.179,.010,.073,.077,.014*s,-.010],[.239*s,1.202,.004,.066,.066,.011*s,-.012],
      [.242*s,1.236,-.001,.075,.079,-.008*s,.014],[.236*s,1.304,.002,.084,.088],
      [.226*s,1.368,-.001,.091,.095],[.217*s,1.418,0,.086,.087],
      [.209*s,1.452,.003,.066,.067],[.204*s,1.465,.004,.037,.040]],
      cloth,14,fabric);
    // The outer sleeve pocket wraps around the deltoid just below the shoulder cap.
    if(s===-1){
      // Outer-front sleeve badge: an original harbour beacon on a shield.
      // Place it high and angle it forward so the mark stays visible in the firing pose.
      const theta=.85, xx=-.283, yy=1.384, zz=-.061;
      const proj=(u,v,n)=>[xx+u*Math.cos(theta)-n*Math.sin(theta),yy+v,
        zz-u*Math.sin(theta)-n*Math.cos(theta)];
      const shield=[[-.042,.037],[-.029,.044],[.032,.044],[.043,.033],
        [.039,-.013],[.024,-.034],[.001,-.047],[-.026,-.035],[-.041,-.014]];
      panel(xx,yy,zz,shield,.006,theta,web,nylon,.05);
      panel(...proj(0,0,.005),shield.map(([x,y])=>[x*.86,y*.86]),.003,theta,binding,nylon,.04);
      const thread=b.tone(accent,1.13);
      for(const mark of [
        [[-.026,-.013],[-.017,.004],[-.007,.009],[-.007,-.009],[-.016,-.019]],
        [[-.004,-.018],[-.004,.017],[.003,.030],[.010,.016],[.010,-.018]],
        [[.013,-.008],[.013,.008],[.024,.003],[.029,-.012],[.022,-.018]]
      ]) b.patch(mark.map(([u,v])=>proj(u,v,.0095)),thread,nylon);
      pocket(s*.301,1.282,.007,.085,.098,.014,outward,cloth,clothDark);
    }else{
      // Narrower zipped sleeve pouch with a folded top and a side pull.
      const theta=-.99;
      pocket(.292,1.326,-.043,.092,.131,.022,theta,clothDark,web);
      b.beam([.296,1.377,-.085],[.333,1.377,-.032],.0035,binding,nylon,5);
      b.beam([.299,1.377,-.081],[.300,1.357,-.084],.0028,hardware,hard,5);
    }

    b.bone('forearm'+side);
    b.loft([[.247*s,.906,-.028,.046,.049],[.246*s,.928,-.026,.054,.055],
      [.250*s,.948,-.019,.061,.064,-.010*s,.005],[.251*s,.974,-.012,.056,.059,-.011*s,.006],
      [.250*s,.995,-.011,.065,.063,.005*s,.008],[.251*s,1.042,-.003,.071,.073],
      [.248*s,1.095,.006,.071,.074],[.246*s,1.129,.008,.062,.067],
      [.245*s,1.151,.008,.049,.049]],cloth,13,fabric);
    b.loft([[.247*s,.908,-.028,.050,.050],[.247*s,.918,-.027,.053,.053],
      [.247*s,.939,-.024,.055,.056]],clothDark,12,nylon);
    b.ell(.248*s,1.105,.066,.044,.075,.016,seam,fabric,10,5);

    b.bone('thigh'+side);
    b.loft([[s*.117,.470,-.028,.066,.066],[s*.120,.505,-.019,.077,.085],
      [s*.128,.536,-.019,.085,.094,-.013*s,.013],[s*.126,.558,-.024,.077,.080,-.010*s,.011],
      [s*.124,.600,-.018,.089,.094,.026*s,-.008],[s*.121,.675,-.005,.096,.108],
      [s*.116,.774,.004,.108,.122],[s*.109,.841,.009,.105,.125],
      [s*.104,.902,.012,.095,.116],[s*.105,.929,.009,.082,.095]],
      cloth,16,fabric);
    // Bellows-style cargo pockets mounted low on each outer thigh.
    pocket(s*.202,.713,.001,.123,.157,.029,outward,cloth,clothLight);
    // Swept seam folds follow the fabric around the pocket instead of rigid leg armour.
    b.beam([s*.169,.611,-.091],[s*.191,.637,-.059],.0035,seam,fabric,5);
    b.beam([s*.191,.637,-.059],[s*.202,.642,-.018],.0035,seam,fabric,5);
    // A soft knee band and moulded front cap articulate with the femur.
    b.loft([[s*.120,.518,-.022,.079,.084],[s*.120,.524,-.022,.084,.089],
      [s*.122,.546,-.020,.085,.091]],binding,12,nylon);
    const knee=[[-.064,.044],[-.043,.081],[.036,.084],[.062,.061],
      [.071,.008],[.055,-.053],[.031,-.076],[-.035,-.073],[-.063,-.045]];
    panel(s*.119,.521,-.088,knee,.043,0,b.tone(leather,1.37),hard,.19);
    const kneeCup=[[-.043,.031],[-.024,.048],[.029,.046],[.045,.028],
      [.038,-.021],[.016,-.044],[-.023,-.038],[-.038,-.020]];
    panel(s*.119,.523,-.123,kneeCup,.012,0,b.tone(hardware,.89),hard,.17);
    for(const y of [.514,.528]) b.box(s*.119,y,-.1355,.050,.003,.003,bootRubber,hard);

    b.bone('shin'+side);
    b.loft([[s*.126,.173,.019,.056,.060],[s*.125,.187,.021,.070,.075],
      [s*.127,.206,.013,.078,.082,-.012*s,-.005],[s*.129,.225,.018,.071,.073,-.010*s,-.008],
      [s*.126,.247,.014,.079,.083,.006*s,.008],[s*.127,.282,.020,.074,.080,.015*s,.005],
      [s*.124,.348,.025,.080,.090],[s*.121,.408,.014,.083,.090],
      [s*.120,.463,-.005,.072,.080],[s*.117,.504,-.024,.069,.072],
      [s*.117,.522,-.026,.062,.068]],cloth,14,fabric);
    b.loft([[s*.126,.168,.013,.064,.066],[s*.126,.181,.014,.066,.072],
      [s*.126,.194,.013,.069,.073]],seam,12,fabric);
    // Boot shaft. Its overlap over the ankle joint stays closed throughout the gait.
    b.loft([[s*.126,.086,.016,.059,.067],[s*.126,.108,.017,.061,.072],
      [s*.127,.151,.019,.064,.069],[s*.126,.186,.017,.061,.063],
      [s*.126,.202,.016,.058,.059]],bootGrain,12,nylon);
    b.box(s*.126,.145,-.049,.057,.086,.012,leather,nylon);
    for(const yy of [.122,.141,.160,.179]){
      b.beam([s*.126-.023,yy-.006,-.058],[s*.126+.022,yy+.008,-.057],
        .0035,bootRubber,nylon,5);
      b.beam([s*.126+.023,yy-.006,-.060],[s*.126-.022,yy+.008,-.059],
        .0035,bootRubber,nylon,5);
    }
    b.bone('foot'+side);
    // One broad toe, a narrow heel and a defined sole remain visible at distance.
    b.loft([[s*.126,.008,-.037,.069,.146],[s*.126,.015,-.038,.078,.157],
      [s*.126,.034,-.039,.080,.157],[s*.126,.042,-.037,.079,.155]],
      bootRubber,16,hard);
    b.loft([[s*.126,.039,-.038,.077,.150],[s*.126,.055,-.040,.080,.148],
      [s*.126,.072,-.036,.077,.138],[s*.126,.088,-.024,.073,.117],
      [s*.126,.109,-.002,.065,.091],[s*.126,.143,.016,.058,.068]],
      leather,16,nylon);
    b.loft([[s*.126,.042,-.108,.063,.080],[s*.126,.056,-.107,.071,.084],
      [s*.126,.068,-.102,.063,.074],[s*.126,.077,-.093,.049,.065]],
      bootGrain,14,nylon);
    for(const zz of [-.112,-.060,.007,.062]){
      const width=zz<-.1?.122:zz>.05?.108:.146;
      b.box(s*.126,.008,zz,width,.013,.023,bootRubber,hard);
    }
  }
}

// Greyport operators. Heads are authored in metres, with the face toward -Z.
function buildOperatorHead(b, look) {
  b.bone('head');
  const style = look.index % 3;
  const skin = look.skin;
  const cloth = style === 0 ? [.115,.138,.145] : style === 1 ? look.cloth : [.255,.275,.191];
  const edge = b.tone(cloth,.76), stitch = b.tone(cloth,1.27);
  const rubber = [.105,.113,.109];
  const shell = style === 0 ? [.274,.301,.300] : [.400,.417,.305];
  const skinShadow = b.tone(skin,.81);
  const pt = (x,y,z) => [x,y,z];
  const pipe = (points,r,col,mat=12) => {
    for(let k=1;k<points.length;k++) b.beam(points[k-1],points[k],r,col,mat,6);
  };
  b.loft([
    [0,1.452,.008,.067,.071],[0,1.486,.005,.066,.069],
    [0,1.527,.002,.056,.061],[0,1.570,.004,.057,.060]
  ],style === 1 ? skinShadow : cloth,16,style === 1 ? 14 : 11);
  // Chin, jaw, cheekbones, temples and occiput follow different cross sections.
  b.loft([
    [0,1.537,-.025,.034,.044],[0,1.547,-.013,.055,.067],
    [0,1.562,-.004,.074,.082],[0,1.584,.004,.083,.093],
    [0,1.615,.006,.090,.096],[0,1.642,.004,.092,.099],
    [0,1.666,.006,.089,.092],[0,1.694,.006,.090,.103],
    [0,1.722,.009,.091,.099],[0,1.748,.013,.080,.088],
    [0,style===1?1.759:1.778,.015,style===1?.054:.063,style===1?.062:.071],
    [0,style===1?1.772:1.792,.014,.018,.023]
  ],skin,24,16);
  for (const s of [-1,1]) {
    // Subtle brow relief shares the face albedo so the eyes remain aligned at any distance.
    b.ell(s*.034,1.685,-.078,.035,.009,.014,skin,16,14,6);
    b.ell(s*.088,1.633,.012,.013,.029,.019,skinShadow,14,12,6);
    b.ell(s*.098,1.637,.012,.004,.016,.010,b.tone(skin,.62),14,8,5);
  }
  if (style===1) {
    b.loft([
      [0,1.619,-.100,.014,.007],[0,1.627,-.103,.019,.015],
      [0,1.638,-.106,.013,.016],[0,1.654,-.098,.010,.011],
      [0,1.674,-.090,.009,.007],[0,1.686,-.090,.012,.005]
    ],skin,16,16);
    for(const sign of [-1,1])b.ell(sign*.014,1.627,-.100,.010,.007,.011,skin,16,12,6);
  } else {
    // The wrap rises over the bridge and slopes below the eyes at both cheeks.
    const seamPoint=(angle,level)=>{
      const f=Math.cos(angle), side=Math.sin(angle),front=Math.max(0,f);
      const rings=[
        [1.494,.066,.071,.008],[1.520,.068,.075,.008],[1.545,.078,.088,.006],
        [1.571,.086,.094,.005],[1.599,.093,.103,.003],[1.620,.095,.106,.003],
        [1.633,.096,.113,.003]
      ];
      const [y,rx,rz,cz]=rings[level], ridge=front**5;
      const offset=(style===0?.023:.012)*ridge*level/6;
      return [side*rx,y+offset,cz-f*rz-.018*ridge*level/6];
    };
    for(let l=0;l<6;l++){
      for(let i=0;i<24;i++){
        const u=i*Math.PI/12,v=(i+1)*Math.PI/12;
        b.patch([seamPoint(u,l),seamPoint(u,l+1),seamPoint(v,l+1),seamPoint(v,l)],b.tone(cloth,[.81,.92,1.03,.97,1,.97][l]),11);
      }
    }
    for(const s of [-1,1]){
      pipe([pt(s*.087,1.640,-.046),pt(s*.076,1.628,-.072),pt(s*.047,1.617,-.099),pt(s*.020,1.614,-.117)],.0017,edge);
      pipe([pt(s*.064,1.565,-.061),pt(s*.049,1.559,-.076),pt(s*.021,1.554,-.092)],.0018,stitch);
    }
  }
  if(style===1){
    // Six-panel cap with a curved fabric bill and a stitched rear adjuster.
    const cap=b.tone(look.cloth,.90);
    b.loft([[0,1.695,.010,.093,.101],[0,1.705,.009,.100,.107],[0,1.737,.008,.097,.103],
      [0,1.756,.012,.082,.093],[0,1.768,.014,.064,.070],[0,1.777,.016,.023,.026]],cap,22,11);
    for(let i=0;i<14;i++){
      const v=t=>{const a=-1.1+2.2*t/14,s=Math.sin(a),f=Math.cos(a);return [
        [s*.100,1.699-.004*s*s,-.004-.091*f],[s*.112,1.695-.010*s*s,-.025-.128*f],
        [s*.112,1.691-.010*s*s,-.025-.128*f]]};
      const a=v(i),d=v(i+1);
      b.patch([a[0],d[0],d[1],a[1]],b.tone(cap,1.12),11);
      b.patch([a[1],d[1],d[2],a[2]],b.tone(cap,.69),12);
    }
    for(const s of [-1,1])pipe([[s*.075,1.704,-.060],[s*.070,1.735,-.062],[s*.043,1.761,-.036],[s*.009,1.775,.005]],.0014,b.tone(cap,.79));
    b.box(0,1.703,.109,.060,.012,.006,look.web,12);
  }else{
    // A scalloped high-cut shell clears the headset without widening the jaw.
    const helmetPoint=(a,j)=>{
      const s=Math.sin(a),f=Math.cos(a),ear=Math.abs(s)**4,front=Math.max(0,f);
      const profile=[[1.678,.105,.112],[1.685,.111,.119],[1.710,.113,.120],
        [1.745,.108,.114],[1.774,.096,.100],[1.797,.070,.076],[1.808,.037,.044],[1.810,.004,.007]];
      const [y,rx,rz]=profile[j];
      return [s*rx,y+(ear*.024+front*.018)*(1-Math.min(j/3,1)),.011-f*rz-front**6*.008*(1-Math.min(j/2,1))];
    };
    for(let j=0;j<7;j++)for(let i=0;i<24;i++){
      const a=i*Math.PI/12,d=(i+1)*Math.PI/12;
      b.patch([helmetPoint(a,j),helmetPoint(a,j+1),helmetPoint(d,j+1),helmetPoint(d,j)],j===0?rubber:shell,13);
    }
    for(const s of [-1,1]){
      pipe([[s*.095,1.707,-.050],[s*.110,1.712,-.015],[s*.109,1.706,.037],[s*.092,1.692,.071]],.007,edge,13);
      pipe([[s*.091,1.688,-.027],[s*.091,1.629,-.037],[s*.070,1.575,-.059],[s*.041,1.549,-.069]],.006,edge);
    }
    if(style===0){
      // Two separate neutral smoke lenses with an articulated bridge, worn above the eyes.
      for(const s of [-1,1]){
        const lens=(scale,extra)=>[[.007,1.714],[.017,1.708],[.058,1.710],[.080,1.722],[.071,1.740],[.028,1.746],[.009,1.738]]
          .map(([x,y])=>{x=.040+(x-.040)*scale;return [s*x,1.726+(y-1.726)*scale,-.114+x*x*3.65-extra]});
        const rim=lens(1,0),glass=lens(.82,.0026);
        b.patch(s>0?rim.slice().reverse():rim,rubber,13);
        b.patch(s>0?glass.slice().reverse():glass,[.141,.170,.166],13);
        pipe([[s*.077,1.726,-.087],[s*.105,1.726,-.034],[s*.109,1.720,.030],[s*.090,1.710,.072]],.0064,edge);
      }
      b.box(0,1.731,-.113,.026,.008,.011,rubber,13);
    }else{
      b.box(0,1.742,-.108,.044,.034,.011,edge,13);
      b.box(0,1.750,-.116,.024,.013,.009,b.tone(shell,1.12),13);
      b.box(-.040,1.716,.119,.042,.019,.004,look.accent,12);
    }
  }
  // Low-profile headset shells, padded ear seals and boom microphone.
  for(const s of [-1,1]){
    b.ell(s*.101,1.642,.012,.023,.035,.030,rubber,13,12,6);
    b.ell(s*.116,1.643,.010,.013,.030,.025,b.tone(look.vest,.87),13,10,6);
    pipe([[s*.110,1.670,-.002],[s*.111,1.690,.005],[s*.099,1.711,.007]],.0035,rubber,13);
  }
  pipe([[-.121,1.639,-.006],[-.119,1.620,-.057],[-.094,1.607,-.095],[-.057,1.606,-.109]],.0035,rubber,13);
  b.ell(-.050,1.606,-.110,.012,.006,.006,rubber,13,8,4);
}

function buildOperatorHands(b,look) {
  const knuckle=b.tone(look.leather,1.25), palm=b.tone(look.leather,.76);
  for(const side of [-1,1]){
    const x=side*.247,wristY=.912,wristZ=-.028;
    b.bone(side<0?'handL':'handR');
    const hand=(dx,dy,dz)=>[x+side*dx,wristY+dy,wristZ+dz];
    b.beam(hand(0,.002,.016),hand(0,-.002,-.014),.029,look.clothDark,12,10);
    b.ell(...hand(.007,-.005,-.034),.030,.038,.043,look.leather,11,12,6);
    b.ell(...hand(.026,-.005,-.033),.010,.026,.031,knuckle,13,10,5);
    b.beam(hand(-.008,.021,-.014),hand(-.024,.008,-.046),.0106,look.leather,11,7);
    for(let finger=0;finger<4;finger++){
      const y=.016-finger*.015, z=-.060+finger*.003;
      const joint=hand(.013,y,z), bent=hand(-.010,y-.002,z-.014), tip=hand(-.025,y-.005,z-.006);
      b.beam(joint,bent,.0093,look.leather,11,8);
      b.beam(bent,tip,.0084,palm,11,8);
    }
  }
}

// Compact, original side-view silhouettes for the three Greyport loadouts.
function buildOperatorGun(b,look,index) {
  b.bone('gun');
  const alloy=[.203,.226,.226], metal=[.140,.161,.165], dark=[.100,.117,.120];
  const grip=[.126,.137,.128], molded=index===0?[.345,.333,.262]:[.188,.207,.203];
  function profile(points,width,col,material=13){
    const area=points.reduce((v,[z,y],k)=>{const q=points[(k+1)%points.length];return v+y*q[0]-z*q[1]},0);
    const rim=area<0?points.slice().reverse():points;
    const right=rim.map(([z,y])=>[width/2,y,z]),left=rim.map(([z,y])=>[-width/2,y,z]);
    b.patch(right,col,material);b.patch(left.slice().reverse(),col,material);
    for(let i=0;i<rim.length;i++){const j=(i+1)%rim.length;b.patch([left[i],left[j],right[j],right[i]],col,material)}
  }
  if(index===2){
    const steel=[.54,.60,.60],bevel=[.82,.86,.85],spine=[.34,.42,.44],amber=[.84,.55,.20];
    b.beam([0,-.069,0],[0,.042,-.014],.018,grip,13,8);
    b.box(0,.045,-.014,.043,.013,.063,alloy,13);
    b.box(0,.053,-.014,.033,.005,.048,amber,13);
    b.box(0,-.070,0,.041,.013,.045,alloy,13);
    b.box(0,-.066,0,.042,.004,.043,amber,13);
    const rows=[[.054,.004,-.034,.007],[.073,.008,-.048,.007],[.178,.012,-.059,.006],[.210,.006,-.058,.004]];
    for(const s of [-1,1]){
      const sections=rows.map(([y,back,front,x])=>[
        [s*.001,y,back],[s*x,y,back+(front-back)*.29],[s*x*.82,y,back+(front-back)*.69],[0,y,front]]);
      for(let j=1;j<sections.length;j++)for(let k=0;k<3;k++){
        b.patch([sections[j-1][k],sections[j][k],sections[j][k+1],sections[j-1][k+1]],[steel,spine,bevel][k],13);
      }
      const last=sections.at(-1);
      for(let k=0;k<3;k++)b.patch([last[k],[0,.265,-.048],last[k+1]],[steel,spine,bevel][k],13);
    }
    return;
  }
  if(index===1){
    profile([[.057,.048],[.047,.088],[-.161,.088],[-.178,.078],[-.176,.054],[-.145,.044]],.029,metal);
    profile([[.054,.049],[.043,.059],[-.159,.057],[-.157,.030],[-.057,.028],[-.009,.040]],.028,grip);
    profile([[.036,.048],[-.003,.044],[-.014,.032],[.004,-.065],[.045,-.072],[.052,-.054]],.032,molded);
    profile([[.009,-.066],[.040,-.071],[.035,.008],[.003,.009]],.023,alloy,13.25);
    b.box(0,-.070,.025,.035,.009,.042,dark,13.25);
    b.beam([0,.073,-.164],[0,.073,-.184],.009,dark,13,10);
    b.beam([0,.034,-.057],[0,.005,-.052],.0045,dark,13,6);
    b.beam([0,.005,-.052],[0,-.007,.010],.0045,dark,13,6);
    b.box(0,.093,-.151,.006,.009,.009,alloy,13);
    b.box(0,.094,.034,.018,.010,.014,dark,13);
    for(let i=0;i<4;i++)b.box(0,.070,.014+i*.008,.030,.019,.0025,dark,13);
    return;
  }
  profile([[.064,.091],[-.146,.091],[-.157,.080],[-.152,.043],[-.110,.023],[-.023,.020],[.060,.042]],.046,alloy);
  profile([[.039,.047],[-.005,.034],[.004,-.056],[.040,-.067],[.050,-.055]],.034,grip);
  profile([[-.049,.025],[-.097,.027],[-.111,-.059],[-.117,-.092],[-.075,-.102],[-.055,-.064]],.036,metal,13.25);
  const last=.388;
  profile([[-.143,.089],[-last+.022,.089],[-last,.072],[-last,.050],[-last+.012,.030],[-.143,.030]],.048,molded);
  for(let i=0;i<6;i++)for(const side of [-1,1]){
    b.box(side*.024,.066,-.168-i*.030,.0025,.011,.016,dark,13);
  }
  b.box(0,.095,-last/2+.026,.033,.009,last+.038,metal,13);
  const tip=.59;
  b.beam([0,.075,-last],[0,.075,-tip+.045],.012,metal,13,10);
  b.beam([0,.075,-tip+.056],[0,.075,-tip],.018,dark,13,10);
  const rear=.225;
  b.beam([0,.071,.056],[0,.071,rear-.045],.020,dark,13,8);
  profile([[.081,.090],[rear-.010,.084],[rear,.072],[rear,.000],[rear-.022,-.006],[.095,.045]],.044,molded);
  b.box(0,.040,rear,.047,.094,.009,grip,13);
  b.beam([0,.031,-.043],[0,.001,-.039],.0047,dark,13,6);
  b.beam([0,.001,-.039],[0,-.005,.002],.0047,dark,13,6);
  // Open optical frame retains a readable sight silhouette at a distance.
  b.box(0,.102,-.066,.033,.011,.054,dark,13);
  for(const s of [-1,1])b.box(s*.015,.123,-.074,.006,.032,.033,metal,13);
  b.box(0,.141,-.074,.036,.006,.033,metal,13);
}

  const operatorBones = Object.freeze([
    'pelvis', 'chest', 'head',
    'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR',
    'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'gun'
  ]);

  // Rigid skinning matrices are in character space; the instance transform handles heading and position.
  const updateOperatorPose = (() => {
    const origin = [0,0,0], hips = [0,.91,0], chest = [0,.96,0], neck = [0,1.49,0];
    const gripOffset = [0,-.012,-.035];
    const support = [[0,.04,-.26],[-.035,-.01,-.045]];
    const dot3 = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    const sub3 = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
    const add3 = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
    const length3 = v => Math.hypot(v[0],v[1],v[2]);
    const mix3 = (a,b,w) => [a[0]+(b[0]-a[0])*w,a[1]+(b[1]-a[1])*w,a[2]+(b[2]-a[2])*w];
    const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
    function ease(lo,hi,v) {
      const t = clamp((v-lo)/(hi-lo),0,1);
      return t*t*(3-2*t);
    }
    function angles(pitch,yaw,roll) {
      const s=Math.sin(pitch), c=Math.cos(pitch), u=Math.sin(yaw), v=Math.cos(yaw);
      const q=Math.sin(roll), r=Math.cos(roll);
      return [v*r+u*s*q, -v*q+u*s*r, u*c,
              c*q, c*r, -s,
              -u*r+v*s*q, u*q+v*s*r, v*c];
    }
    function rotate(m,v) {
      return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2],
              m[3]*v[0]+m[4]*v[1]+m[5]*v[2],
              m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
    }
    function place(out,id,m,bind,dest) {
      const k=id*12;
      for(let row=0;row<3;row++){
        const p=row*3, q=k+row*4;
        out[q]=m[p]; out[q+1]=m[p+1]; out[q+2]=m[p+2];
        out[q+3]=dest[row]-m[p]*bind[0]-m[p+1]*bind[1]-m[p+2]*bind[2];
      }
    }
    function point(out,id,p) {
      const k=id*12, x=p[0], y=p[1], z=p[2];
      return [out[k]*x+out[k+1]*y+out[k+2]*z+out[k+3],
              out[k+4]*x+out[k+5]*y+out[k+6]*z+out[k+7],
              out[k+8]*x+out[k+9]*y+out[k+10]*z+out[k+11]];
    }
    function segment(a,b) {
      const delta=sub3(b,a), length=length3(delta);
      return {bind:a, axis:delta.map(v=>v/length), length};
    }
    const sides=[-1,1].map((s,i)=>{
      const shoulder=[s*.215,1.425,0], elbow=[s*.245,1.135,.008], wrist=[s*.247,.912,-.028];
      const hip=[s*.113,.91,0], knee=[s*.117,.50,-.027], ankle=[s*.126,.105,.015];
      return {s,arm:3+3*i,leg:9+3*i,shoulder,wrist,hip,ankle,
              upper:segment(shoulder,elbow), lower:segment(elbow,wrist),
              thigh:segment(hip,knee), shin:segment(knee,ankle)};
    });
    // Rotate a bind-pose segment to its posed endpoints. Axial extension only occurs at full reach.
    function aimSegment(out,id,seg,from,to) {
      const ab=sub3(to,from), len=Math.max(.00001,length3(ab)), u=seg.axis;
      const a=ab[0]/len,b=ab[1]/len,c=ab[2]/len;
      const x=u[1]*c-u[2]*b, y=u[2]*a-u[0]*c, z=u[0]*b-u[1]*a;
      const cos=u[0]*a+u[1]*b+u[2]*c, k=1/Math.max(.00001,1+cos);
      const m=[cos+x*x*k, x*y*k-z, x*z*k+y,
               y*x*k+z, cos+y*y*k, y*z*k-x,
               z*x*k-y, z*y*k+x, cos+z*z*k];
      const stretch=len/seg.length-1;
      if(Math.abs(stretch)>.002) {
        for(let col=0;col<3;col++){
          m[col]+=a*stretch*u[col]; m[3+col]+=b*stretch*u[col]; m[6+col]+=c*stretch*u[col];
        }
      }
      place(out,id,m,seg.bind,from);
    }
    // Elbows and knees are solved as two linked segments in the plane defined by the pole.
    function limb(out,id,upper,lower,base,end,pole) {
      const delta=sub3(end,base), distance=Math.max(.00001,length3(delta));
      const dir=delta.map(v=>v/distance), along=dot3(pole,dir);
      const bend=[pole[0]-dir[0]*along,pole[1]-dir[1]*along,pole[2]-dir[2]*along];
      const reach=Math.min(upper.length+lower.length-.00001,distance);
      const scale=distance/reach;
      const projected=(reach*reach+upper.length**2-lower.length**2)/(2*reach);
      const offset=scale*Math.sqrt(Math.max(0,upper.length**2-projected**2))/Math.max(.00001,length3(bend));
      const joint=base.map((v,i)=>v+dir[i]*projected*scale+bend[i]*offset);
      aimSegment(out,id,upper,base,joint);
      aimSegment(out,id+1,lower,joint,end);
    }
    function groundedPose(motion){
      const out=new Float32Array(15*12),theta=motion.fallYaw;
      const dx=Math.sin(theta),dz=-Math.cos(theta),C=.045,S=Math.sqrt(1-C*C),q=1-C;
      const rot=[C+dz*dz*q,dx*S,-dz*dx*q, -dx*S,C,-dz*S, -dz*dx*q,dz*S,C+dx*dx*q];
      const ground=(side,y,along)=>[-dz*side+dx*along,y,dx*side+dz*along];
      place(out,0,rot,hips,ground(0,.24,.74));
      place(out,1,rot,chest,point(out,0,chest));
      place(out,2,rot,neck,point(out,1,neck));
      for(const limbSide of sides){
        const s=limbSide.s,foot=ground(s*.14,.12,s*.092+.026),hand=ground(s*.34,.115,1.03+s*.15);
        const kneePole=ground(s*.72,.30,-.35),elbowPole=ground(s*.88,.16,-.25);
        limb(out,limbSide.leg,limbSide.thigh,limbSide.shin,point(out,0,limbSide.hip),foot,kneePole);
        place(out,limbSide.leg+2,rot,limbSide.ankle,foot);
        limb(out,limbSide.arm,limbSide.upper,limbSide.lower,point(out,1,limbSide.shoulder),hand,elbowPole);
        place(out,limbSide.arm+2,rot,limbSide.wrist,hand);
      }
      return out;
    }
    return function updateOperatorPose(a,time,motion,out) {
      const phase=motion.phase||0, stride=clamp(motion.stride||0,0,1);
      const forward=clamp(motion.forward||0,-1,1), side=clamp(motion.side||0,-1,1);
      const weapon=clamp(a.weapon|0,0,2),pistol=weapon===1,knife=weapon===2;
      const kick=knife?0:clamp(motion.kick||0,0,1), air=clamp(motion.air||0,0,1);
      const reload=knife?-1:(motion.reload??-1),lower=ease(0,.22,reload)*(1-ease(.75,1,reload));
      const age=a.alive===false?Math.max(0,a.deathAge||0):0;
      if(age>.29&&!motion.rest)motion.rest=groundedPose(motion);
      const buckle=ease(0,.37,age),release=ease(.10,.54,age);
      const seed=motion.seed||0, breath=Math.sin(time*2.05+seed*.83);
      const walk=Math.sin(phase), bounce=Math.cos(2*phase), aim=clamp(a.pitch||0,-1.12,1.06);
      const swing=knife&&a.alive!==false?(a.swingProgress??-1):-1;
      const wind=ease(0,.11,swing)*(1-ease(.11,.25,swing));
      const sweep=ease(.105,.39,swing)*(1-ease(.47,1,swing));
      const lift=ease(.10,.24,swing)*(1-ease(.24,.49,swing));
      const highSwing=(a.swingSerial||0)%2===0;

      const pelvis=[.016+walk*.025*stride, .866+(.013*bounce-.007)*stride+.002*breath-.027*air-.19*buckle,
                    .026+.011*stride];
      place(out,0,angles(-.045,-.06+walk*.077*stride,.021*walk*stride),hips,pelvis);
      const spine=point(out,0,chest);
      const lean=-.094-.065*stride*Math.max(0,forward)+aim*.105-.19*buckle-.045*kick;
      place(out,1,angles(lean,(pistol?-.085:-.155)-walk*.049*stride+.31*sweep-.12*wind,
                         .013-.035*side*stride-.017*walk*stride),chest,spine);
      const throat=point(out,1,neck);
      throat[0]+=.018; throat[2]-=.016;
      place(out,2,angles(aim*.62-.045-lower*.13-.18*buckle, .02+.022*Math.sin(time*1.1+seed)+.1*buckle,
                         -.075-.02*kick+.11*release),neck,throat);

      for(const leg of sides) {
        const s=leg.s, cycle=phase+(s>0?Math.PI:0);
        const sweep=Math.sin(cycle), swing=Math.max(0,-Math.cos(cycle));
        const lift=stride*swing*swing;
        const footPitch=forward*stride*(-sweep*.25-.08*swing)-air*.16;
        const soleRise=Math.max(.115*Math.sin(footPitch),-.17*Math.sin(footPitch),0);
        const ankle=[s*(.165+.08*buckle)-side*stride*sweep*.17,
                     .105+soleRise+lift*.115+air*(s<0?.11:.045),
                     .013+s*.088*(1-.64*stride)+forward*stride*sweep*.23+air*(s<0?-.035:.055)+s*.20*buckle];
        const root=point(out,0,leg.hip);
        limb(out,leg.leg,leg.thigh,leg.shin,root,ankle,[s*.18,-.04,-1]);
        place(out,leg.leg+2,angles(footPitch,-s*.09+side*stride*.08,0),leg.ankle,ankle);
      }

      const seat=ease(.66,.72,reload)*(1-ease(.72,.8,reload));
      const close=(a.reloadEmpty?1:.25)*ease(.76,.84,reload)*(1-ease(.84,.95,reload));
      const gunPitch=knife?aim*.41-.58+.27*wind-.49*sweep:aim-.045-stride*.045+kick*.155+lower*.32-.075*seat-.08*close;
      const gunRot=knife?angles(gunPitch,-.13+.56*wind-.75*sweep,.27-.35*wind+(highSwing?.67:1.2)*sweep):
        angles(gunPitch,.025+lower*.40,-.045-lower*.65);
      const shoulder=point(out,1,sides[1].shoulder);
      const grip=knife?add3(shoulder,[.038+.09*wind-.41*sweep,-.19+.13*lift+(highSwing?.065:-.055)*sweep,-.21+.10*wind-.14*lift]):
        add3(shoulder,rotate(angles(aim*.83,0,0),
        [pistol?-.158:-.115, -.088+.006*breath-.020*stride-lower*.095,
         (pistol?-.29:-.193)+kick*.060+lower*.027]));
      place(out,15,gunRot,origin,grip);
      const supportPalm=knife?point(out,1,[-.27-.043*sweep,1.23+.05*wind,-.24+.07*sweep]):
        add3(grip,rotate(gunRot,support[weapon]));
      const pocketReach=ease(.23,.44,reload)*(1-ease(.48,.71,reload));
      const magTouch=ease(.075,.235,reload)*(1-ease(.73,.90,reload));
      const offset=motion.magShift;
      offset[0]=-.067*pocketReach;offset[1]=-.196*pocketReach+.009*seat;offset[2]=.085*pocketReach;
      const magPalm=add3(grip,rotate(gunRot,[offset[0]-.027,offset[1]-.065,offset[2]+(pistol?.024:-.080)]));
      const leftPalm=mix3(supportPalm,magPalm,magTouch);
      for(const arm of sides) {
        const left=arm.s<0;
        const handRot=left
          ? knife?angles(-.30,.19,-.21):angles(gunPitch-.08-pocketReach*.64,.08+lower*.27,-.18-lower*.27)
          : gunRot;
        const rest=point(out,1,[arm.s*(left?.36:.29),left?1.03:.98,left?-.06:.10]);
        const palm=release?mix3(left?leftPalm:grip,rest,release):left?leftPalm:grip;
        const wrist=sub3(palm,rotate(handRot,gripOffset));
        const root=point(out,1,arm.shoulder);
        limb(out,arm.arm,arm.upper,arm.lower,root,wrist,[arm.s*(left?.70:.94),-1,.23]);
        place(out,arm.arm+2,handRot,arm.wrist,wrist);
      }
      return out;
    };
  })();

  const operatorLooks = [
    // Dark blue fatigues with charcoal equipment, sand with ranger green, and olive camouflage.
    ['394b5b','536776','2b3a48','414844','555b50','303235','656a62','ac8167','bb916b'],
    ['a09373','b7a987','776f58','5c6352','787d61','514a3b','656456','bb9170','a47654'],
    ['667159','829070','485645','575b46','70735a','423e34','626258','a37759','b09c6a']
  ].map((palette,index) => Object.fromEntries([
    ...['cloth','clothLight','clothDark','vest','web','leather','hardware','skin','accent'].map((key,i)=>[key,c(palette[i])]),
    ['index',index]
  ]));
  const operatorMotion = new Map();
  const characterBuffers = [], distantCharacters = [], firearmBuffers = [];
  let characterProgram,operatorPortraitTex,operatorStencil=false;
  const faceImage=new Image();
  faceImage.src='__GREYPORT_FACE_DATA__';

  // Shapes are tessellated once at startup. Adjacent fabric rings share vertices and normals.
  function operatorBuilder(distant=false) {
    const data=[], indices=[];
    let joint=0;
    function vertex(p,n,col,material) {
      const index=data.length/11;
      data.push(...p,...n,...col,material,joint);
      return index;
    }
    function polygon(points,col,material=11,normal) {
      if(points.length<3)return;
      const n=normal||norm(cross(sub(points[1],points[0]),sub(points[2],points[0])));
      const first=vertex(points[0],n,col,material);
      let prev=vertex(points[1],n,col,material);
      for(let i=2;i<points.length;i++){
        const next=vertex(points[i],n,col,material);indices.push(first,prev,next);prev=next;
      }
    }
    function loft(rings,col,sides=14,material=11) {
      if(distant)sides=Math.min(sides,9);
      const start=data.length/11;
      const cap0=[],cap1=[];
      for(let row=0;row<rings.length;row++){
        const [x,y,z,rx,rz,tiltX=0,tiltZ=0]=rings[row],lo=rings[Math.max(0,row-1)],hi=rings[Math.min(row+1,rings.length-1)];
        for(let i=0;i<sides;i++){
          const a=i*2*Math.PI/sides,cs=Math.cos(a),sn=Math.sin(a);
          const dy=hi[1]-lo[1]+cs*((hi[5]||0)-(lo[5]||0))+sn*((hi[6]||0)-(lo[6]||0));
          const normal=norm(cross([hi[0]-lo[0]+cs*(hi[3]-lo[3]),dy,hi[2]-lo[2]+sn*(hi[4]-lo[4])],[-rx*sn,-tiltX*sn+tiltZ*cs,rz*cs]));
          const p=[x+rx*cs,y+tiltX*cs+tiltZ*sn,z+rz*sn];vertex(p,normal,col,material);
          if(row===0)cap0.push(p);
          if(row===rings.length-1)cap1.push(p);
          if(row>0){
            const lower=start+(row-1)*sides+i,adj=start+(row-1)*sides+(i+1)%sides;
            indices.push(lower,lower+sides,adj+sides,lower,adj+sides,adj);
          }
        }
      }
      polygon(cap0,col,material,[0,-1,0]);polygon(cap1,col,material,[0,1,0]);
    }
    function ell(x,y,z,rx,ry,rz,col,material=11,sides=12,stacks=7) {
      if(distant&&Math.max(rx,ry,rz)<.010)return;
      if(distant)stacks=Math.min(stacks,4);
      const rings=[];
      for(let j=0;j<=stacks;j++){
        const lat=Math.PI*(j/stacks-.5),r=Math.max(.0001,Math.cos(lat));
        rings.push([x,y+ry*Math.sin(lat),z,rx*r,rz*r]);
      }
      loft(rings,col,sides,material);
    }
    function cuboid(x,y,z,w,h,d,col,material=11) {
      const points=[];
      for(let k=0;k<8;k++)points.push([x+(k&1?w:-w)/2,y+(k&2?h:-h)/2,z+(k&4?d:-d)/2]);
      for(const [is,n] of [[[0,1,3,2],[0,0,-1]],[[4,6,7,5],[0,0,1]],[[0,2,6,4],[-1,0,0]],[[1,5,7,3],[1,0,0]],[[0,4,5,1],[0,-1,0]],[[2,3,7,6],[0,1,0]]]){
        polygon(is.map(i=>points[i]),col,material,n);
      }
    }
    function cylinder(a,b,r,col,material=11,sides=8) {
      if(distant&&r<.0045)return;
      if(distant)sides=Math.min(sides,5);
      const axis=norm(sub(b,a)),u=norm(cross(axis,Math.abs(axis[1])>.9?[1,0,0]:[0,1,0])),v=cross(axis,u);
      const start=data.length/11,cap0=[],cap1=[];
      for(let i=0;i<sides;i++){
        const theta=i*2*Math.PI/sides,radial=add(mul(u,Math.cos(theta)),mul(v,Math.sin(theta)));
        const p=add(a,mul(radial,r)),q=add(b,mul(radial,r));
        vertex(p,radial,col,material);vertex(q,radial,col,material);cap0.push(p);cap1.push(q);
        const j=start+i*2,k=start+((i+1)%sides)*2;indices.push(j,k,k+1,j,k+1,j+1);
      }
      polygon(cap0,col,material,mul(axis,-1));polygon(cap1,col,material,axis);
    }
    return {loft,ell,box:cuboid,beam:cylinder,patch:polygon,tone:(col,f)=>col.map(v=>Math.min(1,v*f)),
      bone(name){joint=operatorBones.indexOf(name);if(joint<0) throw Error('Invalid character joint '+name)},
      upload(){
        if(data.length/11>=65536)throw Error('Operator mesh exceeds index budget');
        const vertices=gl.createBuffer(),elements=gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,elements);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);
        const bounds=Array.from({length:16},()=>[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]);
        for(let i=0;i<data.length;i+=11){
          const b=bounds[data[i+10]];
          for(let k=0;k<3;k++){b[k]=Math.min(b[k],data[i+k]);b[k+3]=Math.max(b[k+3],data[i+k]);}
        }
        return {vertices,elements,count:indices.length,bounds};
      }
    };
  }

  function initOperators(){
    const vs=`precision highp float;
      attribute vec3 aP,aN,aC;attribute float aM,aJoint;
      uniform vec4 bones[48];uniform vec3 origin,eye,rightV,upV,forwardV,magShift;
      uniform vec2 heading,proj;uniform float planar,floorY;
      varying vec3 localPos,world,nor,color,lightUV;varying float mat;
      `+shadowCoords+`
      vec3 orient(vec3 p){return vec3(heading.x*p.x-heading.y*p.z,p.y,heading.y*p.x+heading.x*p.z);}
      void main(){
        int j=int(aJoint+.2)*3;vec4 p=vec4(aP,1.);
        if(aM>13.2 && aM<13.3)p.xyz+=magShift;
        vec4 bx=bones[j],by=bones[j+1],bz=bones[j+2];
        world=origin+orient(vec3(dot(bx,p),dot(by,p),dot(bz,p)));
        nor=orient(vec3(dot(bx.xyz,aN),dot(by.xyz,aN),dot(bz.xyz,aN)));
        color=aC;mat=aM;localPos=aP;lightUV=lightSpace(world)*.5+.5;
        if(planar>.5){world.xz-=(world.y-floorY)*lightDir.xz/lightDir.y;world.y=floorY+.013;}
        vec3 delta=world-eye;float z=dot(delta,forwardV);
        gl_Position=vec4(dot(delta,rightV)*proj.x,dot(delta,upV)*proj.y,z*1.00072-.13005,z);
      }`;
    const fs=`precision highp float;
      uniform sampler2D grain,depthTex,portrait;uniform vec3 eye;uniform float planar,style,exposure,coverage;
      `+solarLight+`
      varying vec3 localPos,world,nor,color,lightUV;varying float mat;
      void main(){
        if(coverage<1. && fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))>=coverage)discard;
        if(planar>.5){gl_FragColor=vec4(.10,.13,.14,.30);return;}
        vec3 n=normalize(nor),v=normalize(eye-world);
        if(dot(n,v)<0.)n=-n;
        vec3 sun=lightDir;
        float nd=max(dot(n,sun),0.);
        vec2 depth=texture2D(depthTex,lightUV.xy).rg;
        float lit=step(lightUV.z-.0028,depth.x+depth.y/255.);
        vec2 surface=localPos.xy+vec2(.67,-.44)*localPos.z;
        vec3 field=texture2D(grain,surface*vec2(1.68,1.92)).rgb;
        vec3 pigment=color;
        float spec=.055, gloss=16.;
        if(mat<11.5){
          float patch=smoothstep(.51,.58,field.r+.23*(field.g-.5));
          float small=smoothstep(.53,.61,texture2D(grain,surface*3.8).r+.1*(field.g-.5));
          float camo=step(.5,style)*(1.-smoothstep(1.47,1.54,localPos.y));
          pigment*=1.+camo*(.20*small-.29*patch);
          // Short, diagonal creases gather at flexing joints and fade into the broader garment.
          float arm=step(.18,abs(localPos.x))*step(.88,localPos.y);
          float joint=mix(min(abs(localPos.y-.50),abs(localPos.y-.18)),abs(localPos.y-1.14),arm);
          float folds=(1.-smoothstep(.025,.18,joint))*(1.-smoothstep(1.4,1.5,localPos.y));
          float band=localPos.y*108.+localPos.x*(arm*2.-1.)*47.+localPos.z*35.+5.*field.r;
          float ridge=sin(band+1.5*sin(band*.34));
          pigment*=1.+folds*(.075*ridge-.14*smoothstep(.39,.9,-ridge))*(.35+.65*field.g);
          pigment*=.88+.21*field.g+.035*field.b;spec=.018;
        }else if(mat<12.5){
          pigment*=.88+.20*field.g;spec=.029;
        }else if(mat<13.5){
          pigment*=.97+.05*field.g;spec=.13;gloss=27.;
        }else if(mat<14.5){
          pigment*=.96+.075*field.g;spec=.032;
          pigment+=vec3(.022,.004,0.)*max(0.,1.-nd);
        }else if(mat<15.5){gl_FragColor=vec4(1.,.78,.26,1.);return;}
        else{
          vec2 uv=vec2(.501+localPos.x*4.84,.443-(localPos.y-1.668)*3.92);
          float blend=(1.-smoothstep(-.060,-.009,localPos.z))*(1.-smoothstep(.079,.097,abs(localPos.x)));
          vec3 skin=texture2D(portrait,clamp(uv,.001,.999)).rgb;
          pigment=mix(color,skin*(style<.5?vec3(.96,.95,.95):style>1.5?vec3(.88,.86,.84):vec3(1.)),blend);
          spec=.026;gloss=20.;
        }
        vec3 ambient=mix(vec3(.45,.48,.50),vec3(.71,.77,.82),.5+.5*n.y);
        vec3 shaded=pigment*(ambient+lit*nd*vec3(.66,.54,.37));
        shaded+=lit*spec*pow(max(0.,dot(n,normalize(sun+v))),gloss)*vec3(.9,.84,.72);
        shaded+=.020*pow(1.-max(dot(n,v),0.),3.);
        shaded=mix(shaded,vec3(.754,.777,.739),1.-exp(-length(eye-world)*.0048));
        gl_FragColor=vec4(shaded*exposure,1.);
      }`;
    characterProgram=locations(shaderProgram(vs,fs),['aP','aN','aC','aM','aJoint'],
      ['bones[0]','origin','eye','rightV','upV','forwardV','heading','proj','planar','floorY','style','grain','depthTex','portrait','exposure','coverage','magShift']);
    operatorStencil=!!gl.getContextAttributes().stencil;
    operatorPortraitTex=gl.createTexture();gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,operatorPortraitTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([174,132,105]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    for(const wrap of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,wrap,gl.CLAMP_TO_EDGE);
    function uploadPortrait(){
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,operatorPortraitTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,faceImage);
      gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.activeTexture(gl.TEXTURE0);
    }
    if(faceImage.complete&&faceImage.naturalWidth)uploadPortrait();else faceImage.onload=uploadPortrait;
    gl.activeTexture(gl.TEXTURE0);
    characterBuffers.length=distantCharacters.length=firearmBuffers.length=0;operatorMotion.clear();
    for(const look of operatorLooks){
      for(const distant of [false,true]){
        const builder=operatorBuilder(distant);
        buildOperatorBody(builder,look);buildOperatorHead(builder,look);buildOperatorHands(builder,look);
        (distant?distantCharacters:characterBuffers).push(builder.upload());
      }
    }
    for(let i=0;i<3;i++){
      const builder=operatorBuilder();buildOperatorGun(builder,operatorLooks[0],i);firearmBuffers.push(builder.upload());
    }
    const muzzleEnds=[-.59,-.184];
    for(let i=0;i<muzzleEnds.length;i++){
      const builder=operatorBuilder(),z=muzzleEnds[i],flare=c('ffe078');
      builder.bone('gun');
      for(let j=0;j<5;j++){
        const a=j*Math.PI*.4,r=.039+.011*(j%2),y=.074;
        const edge=[r*Math.cos(a),y+r*Math.sin(a),z-.027];
        builder.patch([[0,y,z],edge,[0,y,z-(i===1?.106:.177)]],flare,15);
      }
      firearmBuffers.push(builder.upload());
    }
  }

  function actorIdentity(id){
    let hash=2166136261;
    const text=String(id);
    for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
    return hash>>>0;
  }
  function fallHeading(a){
    const incoming=Number.isFinite(a.deathYaw)?a.deathYaw:a.yaw||0;
    let best=incoming,furthest=0;
    for(const offset of [0,.55,-.55,1.1,-1.1,1.65,-1.65,2.4,-2.4,Math.PI]){
      const yaw=incoming+offset,sn=Math.sin(yaw),cs=Math.cos(yaw);
      for(let i=1;i<=7;i++){
        const distance=i*.24,x=a.x+sn*distance,z=a.z-cs*distance;
        if(map.walls.some(w=>w.h>(a.y||0)+.035 && Math.abs(x-w.x)<w.w*.5+.23 && Math.abs(z-w.z)<w.d*.5+.23))break;
        if(i===7)return yaw;
        if(distance>furthest){best=yaw;furthest=distance;}
      }
    }
    return best;
  }
  function fallingPose(a,m){
    const age=Math.max(0,a.deathAge||0),bones=m.bones;
    const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
    const dx=Math.sin(m.fallYaw),dz=-Math.cos(m.fallYaw);
    const progress=smooth((age-.04)/.58),settle=Math.max(0,age-.62);
    const angle=progress*1.48-.063*Math.sin(Math.min(1,settle/.17)*Math.PI)*Math.exp(-settle*4);
    const C=Math.cos(angle),S=Math.sin(angle),q=1-C;
    const R=[C+dz*dz*q,dx*S,-dz*dx*q, -dx*S,C,-dz*S, -dz*dx*q,dz*S,C+dx*dx*q];
    const limits=characterBuffers[m.style].bounds;
    const resting=smooth((age-.29)/.43);
    let floor=0;
    for(let j=0;j<16;j++){
      const k=j*12;
      for(let col=0;col<4;col++){
        const i=k+col,x=bones[i],y=bones[i+4],z=bones[i+8];
        bones[i]=R[0]*x+R[1]*y+R[2]*z;
        bones[i+4]=R[3]*x+R[4]*y+R[5]*z;
        bones[i+8]=R[6]*x+R[7]*y+R[8]*z;
      }
      if(j===15)continue;
      if(resting&&m.rest){
        for(let i=k;i<k+12;i++)bones[i]+=(m.rest[i]-bones[i])*resting;
      }
      const b=limits[j];if(!Number.isFinite(b[0]))continue;
      const x=bones[k+4],y=bones[k+5],z=bones[k+6];
      floor=Math.min(floor,bones[k+7]+x*b[x>=0?0:3]+y*b[y>=0?1:4]+z*b[z>=0?2:5]);
    }
    for(let j=0;j<16;j++)bones[j*12+7]-=floor;
    // The dropped prop comes to rest just beside the torso, independently of the hands.
    const drop=smooth((age-.16)/.48);
    if(drop){
      const yaw=m.fallYaw+.39,sy=Math.sin(yaw),cy=Math.cos(yaw);
      const rest=[0,-cy,sy,dx*.74-dz*.37, 1,0,0,.065, 0,sy,cy,dz*.74+dx*.37];
      for(let i=0;i<12;i++)bones[180+i]+=drop*(rest[i]-bones[180+i]);
    }
    m.height=a.y||0;
  }
  function sampleMotion(a,t){
    const id=a.id??a.name??'operator',hash=actorIdentity(id);
    let m=operatorMotion.get(id);
    const displacement=m?Math.hypot(a.x-m.x,a.z-m.z):0;
    if(!m || t+.25<m.t || displacement>3.5||a.spawnNo!==m.spawnNo){
      const seed=(hash%8191)*.0176;
      m={x:a.x,z:a.z,t,seed,phase:seed,stride:0,forward:0,side:0,kick:0,flashed:false,air:0,
        shots:a.shotSerial,spawnNo:a.spawnNo,fallYaw:null,coverage:1,height:0,magShift:new Float32Array(3),
        style:a.look??(/^bot-[0-9]+$/.test(id)?Number(id.slice(4))%3:hash%3),bones:new Float32Array(16*12)};
      operatorMotion.set(id,m);
    }
    const dead=a.alive===false,age=dead?Math.max(0,a.deathAge||0):0;
    const fade=Math.min(1,Math.max(0,(age-1.45)/.75));
    m.coverage=1-fade*fade*(3-2*fade);
    if(dead&&age>=.83&&m.groundedPoseReady){
      m.height=a.y||0;m.t=t;
      return m;
    }
    const dt=Math.min(.16,Math.max(0,t-m.t)),yaw=a.yaw||0,cs=Math.cos(yaw),sn=Math.sin(yaw);
    if(dt>0){
      const dx=a.x-m.x,dz=a.z-m.z,distance=Math.hypot(dx,dz);
      const f=1-Math.exp(-dt*12),speed=Math.min(1,distance/(dt*3.4));
      m.stride+=(speed-m.stride)*f;
      if(distance>.0001){m.forward+=((dx*sn-dz*cs)/distance-m.forward)*f;m.side+=((dx*cs+dz*sn)/distance-m.side)*f;}
      m.phase+=Math.min(distance,.8)*4.45;
      m.kick*=Math.exp(-dt*15);
    }
    if(a.alive!==false&&((a.flash&&!m.flashed)||(m.shots!==a.shotSerial&&a.shotAge<.19)))m.kick=1;
    m.shots=a.shotSerial;
    m.flashed=!!a.flash;m.reload=a.reload??-1;m.air=Math.max(0,Math.min(1,(a.y||0)*2.6));
    m.x=a.x;m.z=a.z;m.t=t;
    if(dead&&m.fallYaw==null)m.fallYaw=fallHeading(a)-(a.yaw||0);
    updateOperatorPose(a,t-age,m,m.bones);
    if(dead)fallingPose(a,m);
    else{m.fallYaw=null;m.rest=null;m.height=a.y||0;m.coverage=1;}
    m.groundedPoseReady=dead&&age>=.83;
    return m;
  }
  function drawOperators(s,t,right,up,forward,proj){
    const roster=s.actors||[],live=[];
    for(const a of roster){
      if((a.alive===false&&(!Number.isFinite(a.deathAge)||a.deathAge>=2.2))||
        !Number.isFinite(a.x)||!Number.isFinite(a.z)){operatorMotion.delete(a.id);continue;}
      const dx=a.x-s.x,dz=a.z-s.z,dy=(a.y||0)+.9-s.y;
      const depth=dx*forward[0]+dy*forward[1]+dz*forward[2];
      const horizontal=Math.abs(dx*right[0]+dz*right[2]);
      const vertical=Math.abs(dx*up[0]+dy*up[1]+dz*up[2]);
      if(depth< -2.2 || horizontal>Math.max(0,depth)/proj[0]+2.2 || vertical>Math.max(0,depth)/proj[1]+2.2)continue;
      const pixels=canvas.height*proj[1]*.9/Math.max(1,depth);
      live.push([a,sampleMotion(a,t),pixels<115]);
    }
    for(const id of operatorMotion.keys())if(!roster.some(a=>(a.id??a.name??'operator')===id))operatorMotion.delete(id);
    if(!live.length)return;
    const p=characterProgram;
    gl.useProgram(p.program);
    gl.uniform3fv(p.rightV,right);gl.uniform3fv(p.upV,up);gl.uniform3fv(p.forwardV,forward);gl.uniform2fv(p.proj,proj);
    gl.uniform3f(p.eye,s.x,s.y,s.z);gl.uniform1i(p.grain,0);gl.uniform1i(p.depthTex,2);gl.uniform1i(p.portrait,4);
    gl.uniform1f(p.exposure,viewLight.exposure);
    const attributes=[[p.aP,3,0],[p.aN,3,12],[p.aC,3,24],[p.aM,1,36],[p.aJoint,1,40]];
    for(const [loc] of attributes)gl.enableVertexAttribArray(loc);
    function drawPart(part){
      gl.bindBuffer(gl.ARRAY_BUFFER,part.vertices);
      for(const [loc,size,offset] of attributes)gl.vertexAttribPointer(loc,size,gl.FLOAT,false,44,offset);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,part.elements);
      gl.drawElements(gl.TRIANGLES,part.count,gl.UNSIGNED_SHORT,0);
    }
    function pass(shadow){
      gl.uniform1f(p.planar,shadow?1:0);
      for(const [a,m,distant] of live){
        const yaw=a.yaw||0,weapon=a.weapon??0;
        gl.uniform3f(p.origin,a.x,m.height,a.z);gl.uniform2f(p.heading,Math.cos(yaw),Math.sin(yaw));
        gl.uniform1f(p.coverage,m.coverage);
        gl.uniform3fv(p.magShift,m.magShift);
        gl.uniform4fv(p['bones[0]'],m.bones);gl.uniform1f(p.style,m.style);
        if(shadow)gl.uniform1f(p.floorY,0.);
        drawPart((shadow||distant?distantCharacters:characterBuffers)[m.style]);drawPart(firearmBuffers[weapon]);
        if(!shadow && a.alive!==false&&weapon<2&&a.flash)drawPart(firearmBuffers[weapon+3]);
      }
    }
    if(operatorStencil){
      gl.enable(gl.STENCIL_TEST);gl.stencilMask(0xff);gl.stencilFunc(gl.EQUAL,0,0xff);gl.stencilOp(gl.KEEP,gl.KEEP,gl.INCR);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      pass(true);
      gl.depthMask(true);gl.disable(gl.BLEND);gl.disable(gl.STENCIL_TEST);
    }
    pass(false);
    for(const [loc] of attributes)gl.disableVertexAttribArray(loc);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,null);
  }

  function bindMesh(buf){
    gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    for(const [loc,size,offset] of [[program.aP,3,0],[program.aN,3,12],[program.aC,3,24],[program.aU,2,36],[program.aM,1,44]]){
      gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,48,offset);
    }
  }
  function drawEffects(s){
    mesh=[];
    for(const f of s.fx||[]){
      if(f.life<=0||!Number.isFinite(f.x)||!Number.isFinite(f.y)||!Number.isFinite(f.z))continue;
      if(f.type==='mark'){
        const center=[f.x,f.y,f.z],normal=[f.nx,f.ny,f.nz];
        const tangent=norm(cross(normal,Math.abs(f.ny)>.8?[0,0,1]:[0,1,0])),bitangent=cross(normal,tangent);
        const theta=(f.seed||0)*17.43,size=(.068+.013*Math.sin(theta))*Math.min(1,.2+f.life);
        const u=mul(add(mul(tangent,Math.cos(theta)),mul(bitangent,Math.sin(theta))),size);
        const v=mul(add(mul(tangent,-Math.sin(theta)),mul(bitangent,Math.cos(theta))),size*.91);
        quad(sub(sub(center,u),v),sub(add(center,u),v),add(add(center,u),v),add(sub(center,u),v),
          normal,white,11,[[-1,-1],[1,-1],[1,1],[-1,1]]);
      }else if(f.type==='trace'&&Number.isFinite(f.ax)&&Number.isFinite(f.ay)&&Number.isFinite(f.az)){
        const a=[f.ax,f.ay,f.az],b=[f.x,f.y,f.z],dir=sub(b,a);
        const start=add(a,mul(dir,.18));bar(start,b,.012,sparks,4);
      }else if(f.type==='impact'){
        const b=[f.x,f.y,f.z];
        for(let i=0;i<4;i++){
          const ang=i*2.4+f.x;const len=.046+.19*Math.min(1,f.life*4);
          bar(b,[f.x+len*Math.cos(ang),f.y+len*(.5+i*.22),f.z+len*Math.sin(ang)],.014,sparks,4);
        }
      }
    }
    if(mesh.length){
      const count=mesh.length/12;
      gl.bindBuffer(gl.ARRAY_BUFFER,actorMesh);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh),gl.DYNAMIC_DRAW);bindMesh(actorMesh);gl.drawArrays(gl.TRIANGLES,0,count);
    }
    mesh=[];
  }
  function draw(s){
    if(!gl||gl.isContextLost())return;
    const px=Math.min(1.65,window.devicePixelRatio||1,1750/Math.max(canvas.clientWidth,1));
    const w=Math.max(1,Math.round(canvas.clientWidth*px)),h=Math.max(1,Math.round(canvas.clientHeight*px));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    let fov=s.fov||(72-16*(s.aim||0));if(fov>3.14)fov*=Math.PI/180;
    const py=1/Math.tan(fov/2),pp=[py*h/w,py],yaw=s.yaw||0,pitch=s.pitch||0,t=s.time||0;
    const right=[Math.cos(yaw),0,Math.sin(yaw)],forward=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)],up=cross(right,forward);
    updateViewLighting(s,forward);
    const cam=(p)=>{
      gl.useProgram(p.program);gl.uniform3fv(p.rightV,right);gl.uniform3fv(p.forwardV,forward);
      gl.uniform3fv(p.upV,up);gl.uniform2fv(p.proj,pp);gl.uniform1f(p.clock,t);gl.uniform1i(p.grain,0);
      gl.uniform1i(p.skyMap,5);gl.uniform1f(p.skyReady,skyMapReady?1:0);
      gl.uniform1f(p.exposure,viewLight.exposure);gl.uniform1f(p.glare,viewLight.glare);
    };
    gl.viewport(0,0,w,h);gl.clear(gl.DEPTH_BUFFER_BIT|gl.STENCIL_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,terrain);
    gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,skyMap);
    cam(sky);gl.bindBuffer(gl.ARRAY_BUFFER,skyBuf);gl.enableVertexAttribArray(sky.vert);gl.vertexAttribPointer(sky.vert,2,gl.FLOAT,false,8,0);
    gl.drawArrays(gl.TRIANGLES,0,3);gl.disableVertexAttribArray(sky.vert);
    gl.enable(gl.DEPTH_TEST);cam(program);gl.uniform3f(program.eye,s.x||0,s.y??1.64,s.z||0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,decals);gl.uniform1i(program.atlas,1);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,shadowTex);gl.uniform1i(program.depthTex,2);gl.uniform1f(program.texel,1/shadowSize);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,occlusionMap);gl.uniform1i(program.aoMap,3);
    bindMesh(staticMesh);gl.drawArrays(gl.TRIANGLES,0,staticCount);drawEffects(s);
    for(const loc of [program.aP,program.aN,program.aC,program.aU,program.aM])gl.disableVertexAttribArray(loc);
    drawOperators(s,t,right,up,forward,pp);
  }
  return {maps,get map(){return map;},selectMap,init,draw,sunDirection,get viewExposure(){return viewLight.exposure;}};
})();

