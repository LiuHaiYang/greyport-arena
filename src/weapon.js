(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const mat = {
    iron: '#424c52', plate: '#677174', light: '#87908f', black: '#333b40',
    dark: '#242d33', grip: '#374145', stripe: '#eca83c', bone: '#b9c3be',
    blue: '#558d9c', glass: '#7acacf'
  };
  const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const unit = a => { const n = Math.hypot(...a) || 1; return a.map(v => v/n); };
  const clamp = (x,lo,hi) => Math.max(lo,Math.min(hi,x));
  const mix = (a,b,t) => a+(b-a)*t;
  const parsed = new Map();
  function color(base) {
    if (!parsed.has(base)) parsed.set(base,[1,3,5].map(i=>parseInt(base.slice(i,i+2),16)));
    return parsed.get(base);
  }
  function rig(index) {
    const faces=[];
    let group='gun';
    function face(vertices, outward, base, edge=false, label=null) {
      let n=unit(cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])));
      if(dot(n,outward)<0) n=n.map(k=>-k);
      faces.push({vertices,n,base:color(base),edge,group,label});
    }
    // A body section is a bevelled side profile extruded across the chassis.
    function profile(x,w,outline,base,edge=true) {
      const a=outline.map(([z,y])=>[x-w/2,y,z]), b=outline.map(([z,y])=>[x+w/2,y,z]);
      face(a,[-1,0,0],base,edge); face(b,[1,0,0],base,edge);
      const mid=outline.reduce((m,[z,y])=>[m[0]+z/outline.length,m[1]+y/outline.length],[0,0]);
      for(let i=0;i<a.length;i++){
        const j=(i+1)%a.length;
        face([a[i],a[j],b[j],b[i]], [0,(a[i][1]+a[j][1])/2-mid[1],(a[i][2]+a[j][2])/2-mid[0]],base,edge);
      }
    }
    function box(x,y,z,w,h,d,c,bevel=.015,edge=true) {
      const z0=z-d/2,z1=z+d/2,y0=y-h/2,y1=y+h/2,t=Math.min(bevel,h*.35,d*.35);
      const outline=t ? [[z0+t,y0],[z1-t,y0],[z1,y0+t],[z1,y1-t],[z1-t,y1],[z0+t,y1],[z0,y1-t],[z0,y0+t]] :
        [[z0,y0],[z1,y0],[z1,y1],[z0,y1]];
      profile(x,w,outline,c,edge);
    }
    // Tapered octagonal tubing also forms cuffs and padded sleeves.
    function tube(a,b,r1,r2,base,segments=8,edge=false) {
      const axis=unit(sub(b,a)), v=unit(cross(axis,Math.abs(axis[1])>.95?[1,0,0]:[0,1,0])), u=cross(axis,v);
      const start=[], end=[], normals=[];
      for(let i=0;i<segments;i++){
        const t=TAU*(i+.5)/segments, n=v.map((k,j)=>k*Math.cos(t)+u[j]*Math.sin(t));
        normals.push(n); start.push(a.map((k,j)=>k+n[j]*r1)); end.push(b.map((k,j)=>k+n[j]*r2));
      }
      face(start,axis.map(k=>-k),base,edge); face(end,axis,base,edge);
      for(let i=0;i<segments;i++){
        const j=(i+1)%segments;
        face([start[i],start[j],end[j],end[i]], normals[i].map((k,l)=>k+normals[j][l]),base,edge);
      }
    }
    function barrel(z0,z1,r,c,y=.055){tube([0,y,z0],[0,y,z1],r,r,c,10);}
    function sides(y,z,w,h,d,c){
      for(const s of [-1,1]) box(s*w/2,y,z,.009,h,d,c,0,false);
    }
    function text(x,y,z,h,d,str) {
      const s=Math.sign(x);
      const vertices=[[x,y+h/2,z-s*d/2],[x,y+h/2,z+s*d/2],[x,y-h/2,z+s*d/2],[x,y-h/2,z-s*d/2]];
      face(vertices,[s,0,0],mat.bone,false,str);
    }
    function bolt(y,z,w) {
      for(const s of [-1,1]){
        tube([s*w/2,y,z],[s*(w/2+.012),y,z],.026,.024,mat.dark,6);
        box(s*(w/2+.015),y,z,.004,.007,.030,mat.light,0,false);
      }
    }
    function optical(y,z){
      const center=y+.136;
      for(const offset of [-.11,.12]){
        box(0,y-.007,z+offset,.18,.102,.073,mat.iron,.011);
        tube([0,center,z+offset-.035],[0,center,z+offset+.035],.116,.116,mat.plate,16);
      }
      tube([0,center,z-.31],[0,center,z+.25],.103,.101,mat.black,20);
      tube([0,center,z-.38],[0,center,z-.29],.130,.106,mat.iron,20);
      tube([0,center,z+.19],[0,center,z+.31],.101,.135,mat.iron,20);
      for(const d of [-.38,.31]){
        const side=Math.sign(d),end=z+d;
        tube([0,center,end],[0,center,end+side*.018],.136,.136,mat.dark,24);
        tube([0,center,end+side*.018],[0,center,end+side*.020],.103,.103,'#324951',24);
      }
      tube([0,center+.074,z+.017],[0,center+.145,z+.017],.055,.061,mat.iron,12);
      return center;
    }
    let tip, eye, rear, supportZ;
    if(index===0){
      // Long, angular service rifle with a two-piece shoulder stock and enclosed reflex.
      rear=-1.57;tip=1.86;supportZ=.59;
      profile(0,.255,[[-1.54,-.39],[-1.35,-.34],[-.85,-.048],[-.70,-.012],[-.70,.145],[-1.4,.16],[-1.54,.105]],mat.iron);
      box(0,-.115,-1.52,.28,.57,.095,mat.grip,.045);
      box(0,.137,-1.16,.275,.115,.57,mat.black,.038);
      sides(-.065,-1.17,.261,.067,.31,mat.dark);
      barrel(-.91,-.49,.099,mat.dark,.03);
      profile(0,.305,[[-.73,-.13],[-.54,-.25],[.14,-.25],[.40,-.12],[.40,.19],[-.62,.21],[-.73,.13]],'#817e6d');
      box(0,.119,-.13,.326,.186,1.04,'#676b62',.04);
      box(0,.214,-.025,.30,.051,.96,mat.dark,.012);
      profile(0,.291,[[.33,-.117],[1.02,-.107],[1.17,-.013],[1.17,.111],[1.05,.17],[.33,.17]],'#938c76');
      for(let j=0;j<5;j++) sides(.032,.455+j*.125,.298,.070,.079,mat.dark);
      for(let j=0;j<6;j++) box(0,.194,.42+j*.11,.19,.033,.06,mat.black,.007);
      barrel(1.11,1.68,.066,mat.iron);
      barrel(1.19,1.29,.092,mat.dark);
      barrel(1.57,1.64,.092,mat.plate);
      barrel(1.63,tip,.106,mat.dark);
      for(let j=0;j<2;j++) sides(.063,1.69+.085*j,.197,.035,.043,mat.iron);
      sides(.115,.004,.334,.104,.29,mat.dark);
      group='action';sides(.115,.026,.344,.038,.116,mat.light);group='gun';
      sides(-.081,-.35,.314,.055,.31,mat.blue);
      for (const s of [-1,1]) text(.159*s,-.027,-.28,.061,.23,'AR–24');
      // Rear cheek pad with rubber ribs and a numbered inspection stripe.
      for(let j=0;j<6;j++)box(0,.197,-1.36+j*.077,.246,.013,.019,mat.grip,.003);
      for(let j=0;j<3;j++)sides(-.206,-1.420+j*.038,.261,.085,.019,mat.stripe);
      for(let j=0;j<4;j++)box(0,.248,.024+j*.077,.216,.027,.042,mat.iron,.006);
      for(const s of [-1,1])text(s*.144,.147,-1.14,.045,.22,'DOCK / 07');
      for(const [y,z,w] of [[-.103,.21,.31],[.13,-.54,.328],[-.16,-.49,.31]])bolt(y,z,w);
      eye=optical(.29,-.28);
      box(0,.253,-.28,.19,.10,.25,mat.black);
      group='mag';
      profile(0,.175,[[-.06,-.18],[.205,-.18],[.235,-.53],[.332,-.79],[.055,-.83],[-.029,-.53]],mat.black);
      for(let j=0;j<3;j++) sides(-.35-j*.12,.095+j*.023,.18,.035,.194,mat.plate);
      box(0,-.803,.194,.213,.068,.285,mat.grip,.013);
      group='gun';
    } else if(index===1){
      rear=-.57;tip=.814;supportZ=-.16;
      profile(0,.246,[[-.52,-.18],[-.27,-.238],[.25,-.205],[.65,-.11],[.68,.05],[-.48,.055]],mat.grip);
      group='action';
      profile(0,.28,[[-.55,.024],[.78,.024],[.814,.09],[.784,.228],[.64,.265],[-.45,.265],[-.57,.175]],mat.plate);
      box(0,.231,.057,.237,.071,.92,mat.iron,.025);
      for(let j=0;j<5;j++)sides(.134,-.46+j*.055,.287,.113,.022,mat.dark);
      sides(.141,.258,.286,.074,.244,mat.dark);
      for(const s of [-1,1])text(s*.143,.13,-.006,.059,.16,'P–12');
      box(0,.277,-.421,.2,.064,.093,mat.black);
      for(const s of [-1,1]){
        box(s*.073,.328,-.421,.052,.064,.094,mat.dark);
        box(s*.073,.329,-.47,.018,.019,.007,mat.glass,0);
      }
      eye=.326;
      box(0,.29,.68,.037,.073,.083,mat.dark);
      box(0,.322,.64,.025,.021,.013,mat.stripe,0);
      group='gun';barrel(.52,.819,.073,mat.dark,.12);
      sides(-.047,.366,.25,.046,.24,mat.stripe);
      group='mag';
      profile(0,.118,[[-.386,-.635],[-.281,-.635],[-.221,-.239],[-.32,-.232]],mat.dark);
      box(0,-.673,-.35,.203,.09,.253,mat.iron,.022);group='gun';
    } else {
      // Each cross-section catches the scene light separately along the blade's bevels.
      rear=-.43;tip=.04;eye=0;supportZ=0;
      const steel='#899b9e',ridge='#4f656c',bevel='#d3dddd',edge='#f3eee2';
      const sections=[[-.15,-.35,-.14,.036],[-.055,-.36,-.09,.045],
        [.47,-.36,-.065,.041],[.67,-.32,-.09,.032],[.78,-.255,-.11,.019]];
      for(const sign of [-1,1]){
        const rows=sections.map(([y,back,front,r])=>[
          [sign*.009,y,back],[sign*r,y,back+(front-back)*.28],[sign*r*.83,y,back+(front-back)*.70],
          [sign*.002,y,front]]);
        for(let j=1;j<rows.length;j++)for(let k=0;k<3;k++){
          face([rows[j-1][k],rows[j][k],rows[j][k+1],rows[j-1][k+1]],[sign,0,0],[steel,ridge,bevel][k]);
        }
        const last=rows.at(-1),point=[0,.99,-.115];
        for(let k=0;k<3;k++)face([last[k],point,last[k+1]],[sign,0,0],[steel,ridge,edge][k]);
        for(let i=0;i<3;i++)box(sign*.046,.005+i*.032,-.22,.002,.009,.038,mat.stripe,0,false);
      }
      for(let j=1;j<sections.length;j++){
        const [y0,b0]=sections[j-1],[y1,b1]=sections[j];
        face([[-.009,y0,b0],[.009,y0,b0],[.009,y1,b1],[-.009,y1,b1]],[0,0,-1],steel);
      }
      box(0,-.185,-.237,.19,.085,.43,mat.iron,.026);
      box(0,-.161,-.234,.15,.026,.30,mat.stripe,.009);
      profile(0,.166,[[-.33,-.22],[-.129,-.22],[-.116,-.34],[-.153,-.61],[-.13,-.699],
        [-.164,-.752],[-.312,-.754],[-.352,-.701],[-.321,-.561],[-.343,-.35]],'#454e4e');
      for(let j=0;j<6;j++)sides(-.275-j*.065,-.231,.169,.017,.157,mat.dark);
      bolt(-.31,-.23,.168);bolt(-.65,-.233,.168);
      box(0,-.745,-.24,.19,.068,.21,mat.iron,.018);
      box(0,-.729,-.24,.192,.017,.202,mat.stripe,.003);
    }
    const g=index===0?-.42:index===1?-.255:-.265;
    if(index!==2){
      profile(0,.185,[[g-.08,-.112],[g+.129,-.19],[g+.026,-.673],[g-.164,-.695],[g-.182,-.61]],mat.grip);
      for(let j=0;j<4;j++) sides(-.32-j*.079,g-.04-j*.012,.193,.025,.144,mat.dark);
      tube([0,-.28,g+.095],[0,-.428,g+.128],.018,.015,mat.light,6);
      tube([0,-.19,g+.35],[0,-.38,g+.291],.023,.022,mat.black,6);
      tube([0,-.38,g+.291],[0,-.403,g+.101],.022,.024,mat.black,6);
    }
    // The sleeves and gloves share the muted fabric and leather finishes of the field uniform.
    function hand(left) {
      group=left?'support':'firing';
      const s=left?-1:1, z=left?supportZ:g-.095;
      const wrist=[s*(left?.285:.234),left?-.524:-.53,z-.24];
      const elbow=[s*(left?1.02:.82),left?-1.53:-1.62,left?-.99:-1.2];
      const shell='#3c4c58',glove='#323532',suede='#514f46',binding='#444a46';
      function sweep(rings,base,sides=10){
        const points=[],radials=[],smooth=[];
        let across;
        for(let i=0;i<rings.length;i++){
          const [center,rx,ry,slant=0]=rings[i];
          const before=rings[Math.max(0,i-1)][0],after=rings[Math.min(i+1,rings.length-1)][0];
          const tangent=unit(sub(after,before));
          if(!across)across=unit(cross(tangent,Math.abs(tangent[2])<.88?[0,0,1]:[0,1,0]));
          across=unit(across.map((v,j)=>v-tangent[j]*dot(tangent,across)));
          const up=cross(tangent,across), pts=[],rays=[];
          for(let n=0;n<sides;n++){
            const angle=n*TAU/sides, cs=Math.cos(angle),sn=Math.sin(angle);
            const radial=across.map((v,j)=>v*cs*rx+up[j]*sn*ry);
            rays.push(radial);pts.push(center.map((v,j)=>v+radial[j]+tangent[j]*cs*slant));
          }
          points.push(pts);radials.push(rays);
        }
        for(let i=0;i<rings.length;i++){
          smooth.push(points[i].map((p,j)=>{
            const around=sub(points[i][(j+1)%sides],points[i][(j+sides-1)%sides]);
            const along=sub(points[Math.min(i+1,rings.length-1)][j],points[Math.max(0,i-1)][j]);
            let normal=unit(cross(around,along));
            return dot(normal,radials[i][j])<0?normal.map(v=>-v):normal;
          }));
        }
        face(points[0],sub(rings[0][0],rings[1][0]),base);
        face(points.at(-1),sub(rings.at(-1)[0],rings.at(-2)[0]),base);
        for(let i=0;i<rings.length-1;i++)for(let j=0;j<sides;j++){
          const k=(j+1)%sides;
          face([points[i][j],points[i][k],points[i+1][k],points[i+1][j]],radials[i][j],base);
          faces.at(-1).smooth=[smooth[i][j],smooth[i][k],smooth[i+1][k],smooth[i+1][j]];
        }
      }
      const arm=t=>elbow.map((v,j)=>mix(v,wrist[j],t));
      if(index===2)group='sleeve';
      sweep([[0,.31,.28,0],[.18,.302,.277,.025],[.34,.266,.258,-.055],
        [.40,.294,.275,-.047],[.49,.247,.229,.052],[.55,.263,.251,.033],
        [.68,.212,.203,-.060],[.74,.231,.218,-.036],[.82,.193,.193,.040],
        [.89,.207,.197,.019],[.96,.168,.159,0]].map(([t,a,b,d])=>[arm(t),a,b,d]),shell,14);
      sweep([[arm(.884),.188,.174],[arm(.900),.198,.180],
        [arm(.979),.164,.154],[arm(1.009),.141,.138]],'#384345',12);
      sweep([[arm(.916),.195,.180],[arm(.927),.192,.180],
        [arm(.957),.180,.168],[arm(.966),.172,.162]],binding,12);
      if(index===2)group='firing';
      const palm=[s*(left?.191:.134),left&&index===0?-.225:-.391,z+.019];
      const half=wrist.map((v,j)=>mix(v,palm[j],.54));
      sweep([[wrist,.137,.125],[half,.143,.142,-.012],[palm,.130,.155,.009],
        [[palm[0],palm[1]+.043,palm[2]+.02],.095,.105]],glove,13);
      const palmX=palm[0],palmY=palm[1],palmZ=palm[2];
      const padA=[s*(Math.abs(palmX)+.082),palmY-.098,palmZ-.059];
      const padB=[s*(Math.abs(palmX)+.100),palmY-.021,palmZ+.051];
      sweep([[padA,.043,.032],[padA.map((v,j)=>mix(v,padB[j],.44)),.076,.047],
        [padB,.046,.020]],suede,10);
      for(let i=0;i<4;i++){
        if(left&&index===0){
          const fz=z-.092+i*.071;
          const rise=Math.sin((i+.4)*.75)*.017;
          sweep([[[-.257,-.219,fz-.024],.040,.034],
            [[-.207,-.244+rise,fz],.052,.042], [[-.135,-.208+rise,fz+.015],.047,.039],
            [[-.080,-.130+rise,fz+.028],.043,.036],[[-.071,-.092+rise,fz+.026],.017,.024]],glove,9);
          sweep([[[-.259,-.225,fz-.017],.028,.022],
            [[-.239,-.239,fz],.044,.025],[[-.209,-.243,fz+.006],.025,.019]],suede,8);
        }else{
          const y=-.331-i*.068;
          sweep([[[palmX+s*.072,y,z+.035],.044,.037],
            [[s*.158,y+.005,z+.137],.049,.038],[[s*.082,y+.010,z+.198],.045,.036],
            [[s*.009,y+.012,z+.198],.039,.033],[[-s*.032,y+.004,z+.181],.021,.022]],glove,9);
          sweep([[[palmX+s*.072,y+.012,z+.053],.030,.021],
            [[s*.174,y+.019,z+.100],.041,.027],[[s*.151,y+.018,z+.141],.028,.020]],suede,8);
        }
      }
      const thumbRoot=[palmX+s*.022,palmY+.027,z-.10];
      const thumbEnd=left&&index===0?[-.149,-.032,z+.09]:[s*.115,palmY+.146,z+.056];
      sweep([[thumbRoot,.067,.066],[[palmX+s*.047,palmY+.078,z-.094],.067,.058],
        [[palmX+s*.022,palmY+.127,z-.018],.055,.049],[thumbEnd,.042,.040],
        [[thumbEnd[0]-s*.013,thumbEnd[1]+.008,thumbEnd[2]+.021],.020,.027]],suede,10);
    }
    hand(false);if(index!==2)hand(true);
    return {faces,tip,eye,rear,index};
  }
  const models=[0,1,2].map(rig);
  const activeModels=new WeakMap(), textures=new WeakMap();
  function finish(ctx){
    if(textures.has(ctx))return textures.get(ctx);
    const tile=document.createElement('canvas');tile.width=tile.height=96;
    const g=tile.getContext('2d'), img=g.createImageData(96,96);
    let seed=93481;
    const rand=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
    for(let i=0;i<img.data.length;i+=4){
      const shade=rand()>.52?230:12;
      img.data[i]=shade;img.data[i+1]=shade;img.data[i+2]=shade;
      img.data[i+3]=Math.floor(rand()*25);
    }
    g.putImageData(img,0,0);
    for(let i=0;i<34;i++){
      const x=rand()*96,y=rand()*96;
      g.strokeStyle=i%3?'rgba(224,231,219,.23)':'rgba(21,23,22,.42)';
      g.lineWidth=.35+rand()*.47;g.beginPath();g.moveTo(x,y);
      g.lineTo(x+1+rand()*6,y+rand()*2.3);g.stroke();
    }
    const pattern=ctx.createPattern(tile,'repeat');textures.set(ctx,pattern);return pattern;
  }
  function surface(canvas){
    const rect=canvas.getBoundingClientRect(), density=Math.min(window.devicePixelRatio||1,1.5);
    const w=Math.max(1,Math.round(rect.width*density)),h=Math.max(1,Math.round(rect.height*density));
    if(canvas.width!==w || canvas.height!==h){canvas.width=w;canvas.height=h;}
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,w,h);
    return {ctx,w,h};
  }
  function matrix(yaw,pitch,roll){
    const cy=Math.cos(yaw),sy=Math.sin(yaw), cp=Math.cos(pitch),sp=Math.sin(pitch), cr=Math.cos(roll),sr=Math.sin(roll);
    return [cr*cy-sr*sp*sy,-sr*cp,cr*sy+sr*sp*cy,sr*cy+cr*sp*sy,cr*cp,sr*sy-cr*sp*cy,-cp*sy,sp,cp*cy];
  }
  function rotate(p,m){
    return [p[0]*m[0]+p[1]*m[1]+p[2]*m[2],p[0]*m[3]+p[1]*m[4]+p[2]*m[5],p[0]*m[6]+p[1]*m[7]+p[2]*m[8]];
  }
  function ease(from,to,t){
    const v=clamp((t-from)/(to-from),0,1);
    return v*v*(3-2*v);
  }
  const atRest={lift:0,seat:0,finish:0,hand:[0,0,0],mag:[0,0,0]};
  function reloadPose(t,index,empty){
    if(index===2||!(t>0 && t<1))return atRest;
    const lift=ease(0,.19,t)*(1-ease(.76,1,t));
    const grasp=ease(.075,.235,t)*(1-ease(.73,.90,t));
    const lower=ease(.23,.44,t)*(1-ease(.48,.71,t));
    const sweep=Math.sin(Math.PI*lower);
    const seat=ease(.664,.714,t)*(1-ease(.714,.785,t));
    const finish=(empty?1:.24)*ease(.76,.842,t)*(1-ease(.842,.945,t));
    const mag=[-.37*lower-.07*sweep,-.81*lower+.035*seat,-.23*lower];
    const hand=[mag[0]-.036*grasp,mag[1]-(index===1?.22:.37)*grasp+.10*finish,
      mag[2]-(index===1?.18:.43)*grasp-.12*finish];
    return {lift,seat,finish,mag,hand};
  }
  function render(model,options){
    const {ctx,w,h,m,pos,f,cx,cy,preview,pose=atRest,slide=0}=options;
    const rendered=[], pat=finish(ctx);
    const modify=(p,group)=>{
      let [x,y,z]=p;
      if(group==='support'||group==='mag'){
        const offset=group==='mag'?pose.mag:pose.hand,weight=group==='mag'?1:ease(-1.52,-.54,y);
        x+=offset[0]*weight;y+=offset[1]*weight;z+=offset[2]*weight;
      }else if(group==='sleeve'&&pose.forearm){
        const arm=rotate(sub(p,knifeWrist),pose.forearm);
        [x,y,z]=arm.map((v,i)=>v+knifeWrist[i]);
      }else if(group==='action')z-=slide;
      const r=rotate([x,y,z],m);
      return [r[0]+pos[0],r[1]+pos[1],r[2]+pos[2]];
    };
    function project(p){
      return [cx+f*p[0]/p[2],cy-f*p[1]/p[2]];
    }
    for(const face of model.faces){
      if(preview&&(face.group==='firing'||face.group==='support'||face.group==='sleeve'))continue;
      const n=face.group==='sleeve'&&pose.forearm?unit(rotate(face.n,pose.forearm)):face.n;
      const first=modify(face.vertices[0],face.group),normal=rotate(n,m);
      if(dot(first,normal)>-.00001)continue;
      const coords=[first,...face.vertices.slice(1).map(p=>modify(p,face.group))];
      if(coords.some(p=>p[2]<.06))continue;
      const pts=coords.map(project);
      if(pts.every(p=>p[0]<0)||pts.every(p=>p[0]>w)||pts.every(p=>p[1]<0)||pts.every(p=>p[1]>h))continue;
      const depth=coords.reduce((n,p)=>n+p[2],0)/coords.length;
      rendered.push({face,normal,pts,depth});
    }
    rendered.sort((a,b)=>b.depth-a.depth);
    ctx.lineJoin='round';
    for(const {face,normal,pts,depth} of rendered){
      if(face.label){
        const [a,b,,d]=pts;
        ctx.save();
        ctx.transform((b[0]-a[0])/100,(b[1]-a[1])/100,(d[0]-a[0])/24,(d[1]-a[1])/24,a[0],a[1]);
        ctx.fillStyle='#dae1d8';ctx.font='bold 22px monospace';ctx.textBaseline='top';
        ctx.fillText(face.label,0,2,98);ctx.restore();continue;
      }
      const light=Math.max(0,dot(normal,options.key||studioLight));
      const sky=Math.max(0,normal[1]);
      const lum=.65+.50*light+.09*sky;
      const rgb=face.base.map((v,i)=>Math.round(clamp((v*lum+[11,7,0][i]*light+Math.max(0,normal[0])*[0,1,5][i])*(options.exposure??1),0,255)));
      ctx.beginPath();ctx.moveTo(...pts[0]);for(let j=1;j<pts.length;j++)ctx.lineTo(...pts[j]);
      ctx.closePath();ctx.fillStyle='rgb('+rgb.join(',')+')';ctx.fill();
      // Subpixel seams remain closed between adjacent facets.
      ctx.lineWidth=.52;ctx.strokeStyle=ctx.fillStyle;ctx.stroke();
      const major=pts.reduce((p,q)=>Math.hypot(q[0]-pts[0][0],q[1]-pts[0][1])>Math.hypot(p[0]-pts[0][0],p[1]-pts[0][1])?q:p,pts[0]);
      if(Math.abs(major[0]-pts[0][0])+Math.abs(major[1]-pts[0][1])>32){
        ctx.save();ctx.translate(pts[0][0],pts[0][1]);ctx.rotate(Math.atan2(major[1]-pts[0][1],major[0]-pts[0][0]));
        const scale=clamp(f/depth*.0025,.22,1.3);ctx.scale(scale,scale);ctx.fillStyle=pat;ctx.fill();ctx.restore();
      }
      if(face.edge&&pts.length>=4){
        ctx.strokeStyle='rgba(218,231,222,'+(light*.10+.035)+')';
        ctx.lineWidth=Math.max(.45,Math.min(1.05,h/940));ctx.stroke();
      }
    }
    return p=>project(modify(p,'gun'));
  }
  function preview(canvas,i=0) {
    if(!canvas)return;
    const target=surface(canvas), {w,h}=target;
    if(w<2||h<2)return;
    const model=models[i]||models[0];
    if(model.index===2){
      const m=matrix(-1.34,-.08,-1.24),depth=8;
      let left=Infinity,right=-Infinity,top=-Infinity,bottom=Infinity;
      for(const face of model.faces){
        if(face.group!=='gun')continue;
        for(const vertex of face.vertices){
          const [x,y,z]=rotate(vertex,m),u=x/(depth+z),v=y/(depth+z);
          left=Math.min(left,u);right=Math.max(right,u);top=Math.max(top,v);bottom=Math.min(bottom,v);
        }
      }
      const f=Math.min(w*.77/(right-left),h*.72/(top-bottom));
      render(model,{...target,m,pos:[0,0,depth],f,cx:w*.5-f*(right+left)*.5,cy:h*.5+f*(top+bottom)*.5,preview:true});
      return;
    }
    const m=matrix(-1.23,.075,.055);
    const mid=(model.tip+model.rear)*.5;
    const len=model.tip-model.rear,depth=8,f=depth*Math.min(w*.84/len,h*.79/(i===1?1.08:1.36));
    render(model,{...target,m,pos:[mid*.94,.215,depth],f,cx:w*.5,cy:h*.48,preview:true});
  }
  const accelerators=new WeakMap();
  function accelerator(canvas){
    if(accelerators.has(canvas))return accelerators.get(canvas);
    if(!canvas.parentNode){accelerators.set(canvas,null);return null;}
    const layer=document.createElement('canvas');
    const gl=layer.getContext('webgl',{alpha:true,antialias:true,powerPreference:'high-performance'});
    if(!gl){accelerators.set(canvas,null);return null;}
    const program=gl.createProgram();
    const vs=`
      attribute vec3 position,normal,color; attribute vec2 surfaceUV,labelUV; attribute float part;
      uniform mat3 rotation,forearm; uniform vec3 translation,magOffset,handOffset; uniform vec2 scale; uniform float slide;
      varying vec3 N,V,material,P; varying vec2 surf,label; varying float textile;
      void main(){
        vec3 p=position,n=normal;
        if(part>.5 && part<1.5)p+=magOffset;
        else if(part>1.5 && part<2.5)p+=handOffset*smoothstep(-1.52,-.54,p.y);
        else if(part>4.5){vec3 wrist=vec3(.234,-.53,-.60);p=wrist+forearm*(p-wrist);n=normalize(forearm*n);}
        else if(part>3.5)p.z-=slide;
        vec3 eye=rotation*p+translation;
        N=rotation*n; V=eye; P=position; material=color; surf=surfaceUV; label=labelUV;
        textile=step(1.5,part)*(1.-step(3.5,part))+step(4.5,part);
        gl_Position=vec4(eye.xy*scale,eye.z*1.012-.12,eye.z);
      }`;
    const fs=`
      precision mediump float;
      varying vec3 N,V,material,P; varying vec2 surf,label; varying float textile;
      uniform sampler2D atlas;
      uniform vec3 key;
      uniform float exposure;
      float hash(vec2 k){return fract(sin(mod(dot(k,vec2(8.13,23.47)),6.28318))*243.52);}
      void main(){
        if(label.x>=0.){
          float a=texture2D(atlas,label).a;
          if(a<.45)discard;
          gl_FragColor=vec4(vec3(.81,.85,.80)*exposure,1.);return;
        }
        vec3 n=normalize(N), view=normalize(-V);
        float sun=max(0.,dot(n,key)), sky=max(n.y,0.);
        float spec=pow(max(0.,dot(normalize(view+key),n)),22.);
        float rim=pow(1.-max(0.,dot(view,n)),4.);
        vec2 uv=vec2(P.z+.59*P.x,P.y-.51*P.x)*168.;
        float grain=hash(floor(uv));
        float fine=(grain-.5)*.022;
        float scratch=step(.986,hash(floor(vec2(uv.x*.21,uv.y))))*.044;
        vec2 e=min(surf,1.-surf);
        float edge=1.-smoothstep(.002,.014,min(e.x,e.y));
        vec3 col=material*(.64+.51*sun+.08*sky)+vec3(.043,.027,.009)*sun;
        if(textile>.5){
          float weave=sin(uv.x*2.)*sin(uv.y*2.);
          col+=vec3(spec*.026+rim*.013+fine*.67+weave*.004);
        }else{col+=vec3(spec*.104+rim*.023+edge*.032+fine+scratch);}
        gl_FragColor=vec4(col*exposure,1.);
      }`;
    for(const [type,source] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
      const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
      gl.attachShader(program,shader);
    }
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){accelerators.set(canvas,null);return null;}
    layer.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none';
    layer.setAttribute('aria-hidden','true');canvas.parentNode.insertBefore(layer,canvas);
    gl.useProgram(program);
    const labels=[...new Set(models.flatMap(o=>o.faces.map(face=>face.label).filter(Boolean)))];
    const sheet=document.createElement('canvas');sheet.width=256;sheet.height=256;
    const type=sheet.getContext('2d');type.font='bold 31px monospace';type.textBaseline='top';type.fillStyle='white';
    labels.forEach((str,i)=>type.fillText(str,2,i*48+4,250));
    const atlas=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,atlas);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,sheet);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    function upload(target,data){
      const buffer=gl.createBuffer();
      gl.bindBuffer(target,buffer);gl.bufferData(target,data,gl.STATIC_DRAW);return buffer;
    }
    const buffers=models.map(o=>{
      const data=[],indices=[];
      for(const face of o.faces){
        const axis=face.n.map(Math.abs);
        const dim=axis[0]>=axis[1]&&axis[0]>=axis[2]?[2,1]:axis[1]>=axis[2]?[2,0]:[0,1];
        const uv=face.vertices.map(p=>dim.map(k=>p[k]));
        const uvs=[0,1].map(j=>uv.map(p=>p[j]));
        const lo=uvs.map(v=>Math.min(...v)),hi=uvs.map(v=>Math.max(...v));
        const part={gun:0,mag:1,support:2,firing:3,action:4,sleeve:5}[face.group];
        const lab=labels.indexOf(face.label),len=face.label?Math.min(250,Math.ceil(type.measureText(face.label).width)+5):0;
        const label=[[0,0],[len/256,0],[len/256,40/256],[0,40/256]];
        const start=data.length/14,base=face.base.map(v=>v/255);
        for(let j=0;j<face.vertices.length;j++){
          const p=face.vertices[j],surf=uv[j].map((v,k)=>(v-lo[k])/(hi[k]-lo[k]||1));
          data.push(...p,...(face.smooth?face.smooth[j]:face.n),...base,...surf,
            lab<0?-1:label[j][0],lab<0?-1:lab*48/256+label[j][1],part);
          if(j>=2)indices.push(start,start+j-1,start+j);
        }
      }
      if(data.length/14>65536)throw Error('Weapon mesh exceeds index budget');
      return {vertices:upload(gl.ARRAY_BUFFER,new Float32Array(data)),
        elements:upload(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices)),count:indices.length};
    });
    const attribs=['position','normal','color','surfaceUV','labelUV','part'].map(k=>gl.getAttribLocation(program,k));
    const uniforms=Object.fromEntries(['rotation','translation','scale','magOffset','handOffset','forearm','slide','key','exposure'].map(k=>[k,gl.getUniformLocation(program,k)]));
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearColor(0,0,0,0);
    function clear(){gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);}
    function draw(o,m,pos,f,w,h,pose,slide,key,exposure){
      if(layer.width!==w||layer.height!==h){layer.width=w;layer.height=h;}
      gl.viewport(0,0,w,h);clear();
      const entry=buffers[o.index];
      gl.bindBuffer(gl.ARRAY_BUFFER,entry.vertices);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,entry.elements);
      let off=0;
      [3,3,3,2,2,1].forEach((count,i)=>{
        gl.enableVertexAttribArray(attribs[i]);gl.vertexAttribPointer(attribs[i],count,gl.FLOAT,false,56,off*4);off+=count;
      });
      gl.uniformMatrix3fv(uniforms.rotation,false,[m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]]);
      gl.uniform3fv(uniforms.translation,pos);gl.uniform2f(uniforms.scale,2*f/w,2*f/h);
      gl.uniform3fv(uniforms.magOffset,pose.mag);gl.uniform3fv(uniforms.handOffset,pose.hand);
      if(pose.forearm){const a=pose.forearm;gl.uniformMatrix3fv(uniforms.forearm,false,[a[0],a[3],a[6],a[1],a[4],a[7],a[2],a[5],a[8]]);}
      gl.uniform1f(uniforms.slide,slide);gl.uniform3fv(uniforms.key,key);gl.uniform1f(uniforms.exposure,exposure);
      gl.drawElements(gl.TRIANGLES,entry.count,gl.UNSIGNED_SHORT,0);
      return point=>{const p=rotate(point,m),z=p[2]+pos[2];return [w/2+f*(p[0]+pos[0])/z,h/2-f*(p[1]+pos[1])/z];};
    }
    const gpu={draw,clear,layer};accelerators.set(canvas,gpu);return gpu;
  }
  function flash(ctx,x,y,r,serial,strength){
    ctx.save();ctx.translate(x,y);ctx.globalCompositeOperation='lighter';
    const halo=ctx.createRadialGradient(0,0,r*.04,0,0,r*1.55);
    halo.addColorStop(0,'rgba(255,220,127,.75)');halo.addColorStop(.27,'rgba(255,153,56,.43)');halo.addColorStop(1,'rgba(255,112,22,0)');
    ctx.globalAlpha=strength;ctx.fillStyle=halo;ctx.fillRect(-r*1.55,-r*1.55,r*3.1,r*3.1);
    ctx.rotate(serial*2.31);
    for(let j=0;j<2;j++){
      ctx.beginPath();
      for(let k=0;k<14;k++){
        const a=k*TAU/14, radius=r*(k%2?.18:.56+.40*Math.sin(k*4.27+serial)**2)*(j?.46:1);
        const px=Math.cos(a)*radius,py=Math.sin(a)*radius*.8;
        if(k===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
      }
      ctx.closePath();ctx.fillStyle=j?'#fffbd8':'#ffa33a';ctx.fill();
    }
    ctx.restore();
  }
  const studioLight=unit([-.43,.81,-.46]);
  function lightInView(yaw,pitch){
    const sun=window.Arena?.sunDirection;
    if(!sun)return studioLight;
    const cs=Math.cos(yaw),sn=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const horizontal=sn*sun[0]-cs*sun[2];
    return [cs*sun[0]+sn*sun[2],cp*sun[1]-sp*horizontal,cp*horizontal+sp*sun[1]];
  }
  const knifeWrist=[.234,-.53,-.60],knifeArm=sub([.82,-1.62,-1.20],knifeWrist),armAxis=unit(knifeArm);
  function carryMotion(s){
    const crouch=clamp(s.crouch||0,0,1),grounded=s.grounded!==false;
    const vx=s.velocityX||0,vz=s.velocityZ||0,yaw=s.yaw||0;
    const speed=Number.isFinite(s.velocityX)&&Number.isFinite(s.velocityZ)?Math.hypot(vx,vz):(s.moving?4.25:0);
    const weight=grounded?clamp(speed/(4.25-2.3*crouch),0,1)*(1-.56*crouch):0,phase=s.bob||0;
    const side=clamp((vx*Math.cos(yaw)+vz*Math.sin(yaw))/4.25,-1,1);
    return {crouch,step:weight*Math.sin(phase),bounce:weight*(1-Math.cos(2*phase))*.5,
      side,run:s.sprinting?weight:0,air:grounded?0:1,rise:grounded?0:clamp((s.verticalSpeed||0)/5.7,-1,1),
      land:clamp(s.landing||0,0,1),hurt:clamp((s.hurt||0)/.38,0,1)};
  }
  function knifePose(s){
    const progress=s.swingProgress??-1,alternate=(s.swingSerial||0)%2===0;
    const wind=ease(0,.11,progress)*(1-ease(.11,.25,progress));
    const sweep=ease(.105,.39,progress)*(1-ease(.47,1,progress));
    const lift=ease(.10,.24,progress)*(1-ease(.24,.49,progress));
    const equip=ease(0,1,s.switchProgress||0),gait=carryMotion(s),carry=1-.8*Math.max(wind,sweep);
    const pos=[.64+.17*wind-1.16*sweep+carry*(.060*gait.step+.09*gait.run-.08*gait.crouch),
      -.46+.08*wind+(alternate?.19:-.09)*sweep+.085*lift-.42*equip+
        carry*(.045*gait.bounce+.082*gait.crouch-.12*gait.run+.048*gait.rise-.16*gait.land),
      2.01-.14*wind+.39*lift+.10*sweep+carry*(.065*gait.step-.12*gait.air)];
    const m=matrix(-1.02+.24*wind-(alternate?.38:.70)*sweep-.085*gait.side*carry,
      -.30-.10*wind+(alternate?-.68:.20)*sweep+.36*equip+carry*(.085*gait.run-.075*gait.rise+.12*gait.land),
      .47-.44*wind+(alternate?.62:1.21)*sweep-.40*equip+carry*(.065*gait.step-.10*gait.crouch+.08*gait.hurt));
    const wrist=rotate(knifeWrist,m);
    const delta=[.86-.19*sweep,-1.70,1.91].map((v,i)=>v-pos[i]-wrist[i]);
    const aim=[0,1,2].map(i=>m[i]*delta[0]+m[i+3]*delta[1]+m[i+6]*delta[2]);
    const v=unit(aim),[x,y,z]=cross(armAxis,v),c=dot(armAxis,v),k=1/Math.max(.00001,1+c);
    const forearm=[c+x*x*k,x*y*k-z,x*z*k+y,y*x*k+z,c+y*y*k,y*z*k-x,z*x*k-y,z*y*k+x,c+z*z*k];
    const stretch=Math.hypot(...aim)/Math.hypot(...knifeArm)-1;
    for(let i=0;i<9;i++)forearm[i]+=v[Math.floor(i/3)]*stretch*armAxis[i%3];
    return {m,pos,forearm};
  }
  function draw(canvas,s){
    if(!canvas||!s)return;
    const scope=s.weapon===0?clamp(s.scopeBlend||0,0,1):0;
    const visibility=s.hp?1-ease(.06,.78,scope):0;
    const opacity=visibility<=.001?'0':visibility>=.999?'':String(Math.round(visibility*1000)/1000);
    const changed=canvas.style.opacity!==opacity;
    if(changed)canvas.style.opacity=opacity;
    const previous=accelerators.get(canvas);
    if(previous&&previous.layer.style.opacity!==opacity)previous.layer.style.opacity=opacity;
    // The lens is drawn by the HUD over the world camera. Stop both foreground passes inside it.
    if(visibility<=.001){
      if(changed){previous?.clear();canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);}
      activeModels.delete(canvas);return;
    }
    const target=surface(canvas), {ctx,w,h}=target;
    const gpu=accelerator(canvas);
    if(gpu&&!previous)gpu.layer.style.opacity=opacity;
    if(w<2||h<2){gpu?.clear();return;}
    const model=models[s.weapon]||models[0],t=s.time||0;
    const key=lightInView(s.yaw||0,s.pitch||0),f=h*.88,exposure=window.Arena?.viewExposure??1;
    if(model.index===2){
      const {m,pos,forearm}=knifePose(s),pose={...atRest,forearm};
      if(gpu)gpu.draw(model,m,pos,f,w,h,pose,0,key,exposure);
      else render(model,{...target,m,pos,f,cx:w*.5,cy:h*.5,preview:false,pose,key,exposure});
      activeModels.delete(canvas);
      return;
    }
    const a=clamp(s.aim||0,0,1),hip=1-a;
    const pose=reloadPose(s.reload,model.index,s.reloadEmpty);
    const rw=pose.lift,rc=clamp(s.recoil||0,-.23,1.5),side=clamp(s.recoilSide||0,-1,1),sw=ease(0,1,s.switchProgress||0);
    const pistol=model.index===1,gait=carryMotion(s),carry=hip*(1-rw*.68)*(1-sw);
    const breathe=Math.sin(t*2.14)*.005;
    let mem=activeModels.get(canvas);
    if(!mem||t<mem.time||mem.index!==model.index){mem={index:model.index,shot:s.shotSerial||0,casings:[],time:t};activeModels.set(canvas,mem);}
    mem.time=t;
    const pos=[mix(.70,0,a)+breathe*hip-.23*rw+side*(pistol?.062:.041)+sw*(pistol?.14:-.07)+
        carry*(gait.step*(pistol?.047:.031)-gait.crouch*(pistol?.045:.085)+gait.run*(pistol?.075:-.14)),
      mix(-.64,-model.eye,a)+breathe*hip-sw*(pistol?.41:.31)+.24*rw+.045*pose.seat+
        carry*(gait.bounce*(pistol?.036:.024)+.06*gait.crouch-gait.run*(pistol?.15:.11)+.05*gait.rise-gait.land*(pistol?.14:.10)),
      mix(pistol?1.83:2.37,pistol?1.3:2.14,a)-rc*((pistol?.14:.20)-.04*a)+.12*rw+
        carry*(.034*gait.step-.075*gait.air+.055*gait.land)];
    const m=matrix(-.115*hip-.34*rw+side*.057+carry*(gait.run*(pistol?.06:.27)+.04*gait.side),
      -.095*hip-rc*((pistol?.18:.105)-.032*a)+sw*(pistol?.39:.27)-.07*rw+.06*pose.finish+
        carry*(.078*gait.run-.062*gait.rise+.091*gait.land),
      .082*hip-.78*rw-sw*(pistol?.39:.22)+side*.064-.041*pose.seat+
        carry*(gait.step*(pistol?.048:.027)-.063*gait.crouch+.055*gait.hurt));
    const slide=Math.max(s.flash||0,pose.finish*.8)*(model.index===1?.19:.075);
    const projected=gpu?gpu.draw(model,m,pos,f,w,h,pose,slide,key,exposure):
      render(model,{...target,m,pos,f,cx:w*.5,cy:h*.5,preview:false,pose,slide,key,exposure});
    if(s.flash>0){
      const tip=projected([0,model.index===1?.12:.055,model.tip+.07]);
      flash(ctx,tip[0],tip[1],h*(model.index===1?.042:.061)*(.72+s.flash*.48),s.shotSerial||0,s.flash);
    }
    if(s.shotSerial!=null&&s.shotSerial!==mem.shot){
      const p=projected([.20,.13,-.11]);mem.shot=s.shotSerial;
      mem.casings.push({x:p[0]/h,y:p[1]/h,birth:t,seed:mem.shot});
    }
    mem.casings=mem.casings.filter(c=>t-c.birth<.57);
    for(const c of mem.casings){
      const age=t-c.birth;
      ctx.save();ctx.translate((c.x+age*(.63+.15*Math.sin(c.seed)))*h,(c.y-age*.62+age*age*1.74)*h);
      ctx.rotate(c.seed+age*14);const ln=h*.015,ht=h*.0045;
      ctx.fillStyle='#a47b3a';ctx.fillRect(-ln/2,-ht/2,ln,ht);
      ctx.fillStyle='#e8c47b';ctx.fillRect(-ln/2,-ht/2,ln,ht*.35);
      ctx.fillStyle='#705637';ctx.fillRect(ln*.3,-ht/2,ln*.12,ht);ctx.restore();
    }
  }
  window.Weapon={draw,preview};
})();
