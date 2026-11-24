function drawMap(canvas, state, radar=false, map=window.Arena?.map){
  if(!canvas||!map||!canvas.clientWidth) return;
  const w=canvas.clientWidth,h=canvas.clientHeight,k=Math.min(devicePixelRatio||1,2);
  if(canvas.width!==Math.round(w*k)||canvas.height!==Math.round(h*k)){
    canvas.width=Math.round(w*k);canvas.height=Math.round(h*k);
  }
  const g=canvas.getContext('2d');
  g.setTransform(k,0,0,k,0,0);g.fillStyle=radar?'#17231de6':'#222c27';g.clearRect(0,0,w,h);g.fillRect(0,0,w,h);
  g.lineWidth=.65;
  const grid=radar?9:12;g.strokeStyle='#82978628';g.beginPath();
  for(let x=0;x<w;x+=grid){g.moveTo(x,0);g.lineTo(x,h)}
  for(let y=0;y<h;y+=grid){g.moveTo(0,y);g.lineTo(w,y)}
  g.stroke();g.save();
  g.translate(w*.5,h*.5);
  const scale=Math.min((w-8)/(map.width+3),(h-(radar?5:24))/(map.depth+3));
  g.scale(scale,scale);g.lineWidth=1/scale;
  g.strokeStyle='#a9bb9a';g.fillStyle='#303d32';
  g.fillRect(-map.width/2,-map.depth/2,map.width,map.depth);
  g.strokeRect(-map.width/2,-map.depth/2,map.width,map.depth);
  for(const wall of map.walls){
    const {x,z,w:bw,d:bd}=wall,l=x-bw/2,t=z-bd/2;
    g.fillStyle='#637663';g.fillRect(l,t,bw,bd);g.strokeStyle='#b0bca0';g.lineWidth=.85/scale;g.strokeRect(l,t,bw,bd);
    if(!radar&&bw>2&&bd>2){g.strokeStyle='#37483d';g.beginPath();for(let s=.75;s<(bw>=bd?bw:bd)-.25;s+=.85){if(bw>=bd){g.moveTo(l+s,t+.22);g.lineTo(l+s,t+bd-.22)}else{g.moveTo(l+.22,t+s);g.lineTo(l+bw-.22,t+s)}}g.stroke()}
  }
  if(!radar){
    for(const {x,z} of map.spawns){
      g.fillStyle='#e6a06d';g.beginPath();g.arc(x,z,.62,0,2*Math.PI);g.fill();
    }
  }else if(state){
    for(const a of state.actors||[]){if(a.alive===false || Math.hypot(a.x-state.x,a.z-state.z)>12) continue;g.fillStyle='#e69c69';g.beginPath();g.arc(a.x,a.z,.95,0,7);g.fill()}
    g.translate(state.x,state.z);g.rotate(state.yaw||0);g.beginPath();g.moveTo(0,-2.3);g.lineTo(1.5,1.8);g.lineTo(0,1.1);g.lineTo(-1.5,1.8);g.closePath();g.fillStyle='#ffdc9e';g.fill();
  }
  g.restore();
  if(!radar){
    g.fillStyle='#b4c1ac';g.strokeStyle='#a9bba5';g.font='9px Consolas,monospace';g.textAlign='center';g.fillText('N',w-18,15);
    g.save();g.translate(w-18,24);g.beginPath();g.moveTo(0,-5);g.lineTo(-3,5);g.lineTo(0,2);g.lineTo(3,5);g.closePath();g.stroke();g.restore();
    const end=12+scale*5;g.textAlign='left';g.beginPath();g.moveTo(12,h-14);g.lineTo(12,h-10);g.lineTo(end,h-10);g.lineTo(end,h-14);g.stroke();g.fillText('5 m',end+5,h-8);
  }
}
