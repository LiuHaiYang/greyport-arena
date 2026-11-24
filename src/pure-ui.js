(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const dlg=$('dialog'),body=$('modalBody');
  const guns=Game.guns,gunTypes=['突击步枪','半自动手枪','近战武器'];
  const slotIds=['rifle','pistol','knife'];
  function stored(key,fallback){try{return localStorage.getItem('greyport.'+key)??fallback}catch{return fallback}}
  function store(key,value){try{localStorage.setItem('greyport.'+key,value)}catch{}}
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function text(id,value){const el=$(id),next=String(value);if(el.textContent!==next)el.textContent=next}
  // Earlier versions saved 2 for the pistol, 1 for the retired SMG, and 0 for the rifle.
  const savedSlot=stored('loadout',stored('weapon','0')==='2'?'pistol':'rifle');
  let equipped=Math.max(0,slotIds.indexOf(savedSlot));
  let player=stored('name','')||('玩家'+String(Math.floor(Math.random()*9000)+1000));
  let lastState=null,lastRadar=0,toastTimer=0,previewMap=Arena.maps[0],joining=false;
  let target=LAN.route();
  const getMap=id=>Arena.maps.find(map=>map.id===id);
  function notify(message){text('toast',message);$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3300)}
  function showModal(kind,en,title,html){
    if(Game.state?.phase==='playing'||Game.state?.phase==='dead')Game.pause();
    text('modalEn',en);text('modalTitle',title);body.innerHTML=html;
    if(!dlg.open)dlg.showModal();
  }
  function closeModal(){if(dlg.open)dlg.close()}
  $('closeModal').onclick=closeModal;
  dlg.addEventListener('click',e=>{if(e.target!==dlg)return;const r=dlg.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal()});
  if(stored('sound','on')==='off')Game.setSound(false);
  function help(){
    const keys=[['突击步枪','1'],['手枪','2'],['刀','3'],['上一把武器','Q'],['循环切换武器','鼠标滚轮'],['开火 / 挥刀','鼠标左键'],['举枪瞄准 / 开镜','按住右键'],['步枪倍镜 2× / 4× / 8×','V'],['步枪单发 / 连发','B'],['换弹','R'],['移动 / 疾跑','WASD / Shift'],['跳跃','空格'],['战斗菜单','Esc']];
    showModal('help','FIELD MANUAL','操作指南','<div class="keylist">'+keys.map(([a,b])=>'<div>'+a+'<kbd>'+b+'</kbd></div>').join('')+'</div><p style="margin-top:16px">第一次点击画面后，移动鼠标转动视角。手枪每次点击打一发，持刀时每次点击挥一次。阵亡后 15 秒自动复活。</p>');
  }
  function armory(selected){
    const g=guns[selected];
    const stats=g.melee?[['装备键','3'],['基础伤害',g.damage],['攻击距离',g.range+' 米'],['挥击间隔',g.delay+' 秒']]:
      [['弹匣容量',g.cap+' 发'],['基础伤害',g.damage],['射击模式',selected===0?'单发 / 连发':'单发'],
      ['射速上限',Math.round(60/(selected===0?g.delay:g.semiDelay))+' 发/分'],
      ['常规换弹',g.load.toFixed(2)+' 秒'],['空匣换弹',g.emptyLoad.toFixed(2)+' 秒']];
    if(selected===0)stats.push(['可变倍镜','2× / 4× / 8×']);
    showModal('arm','LOADOUT','武器库','<div class="seg">'+guns.map((w,i)=>'<button data-gun="'+i+'" class="'+(i===selected?'chosen':'')+'">'+w.name+'</button>').join('')+'</div><canvas id="gunPreview"></canvas><div class="gunhead"><strong>'+g.name+'</strong><span>'+gunTypes[selected]+'</span></div><div class="gunstats">'+stats.map(([k,v])=>'<div>'+k+'<b>'+v+'</b></div>').join('')+'</div><div class="rowactions"><button class="bt primary" id="equip">'+(selected===equipped?'已选为出场武器':'设为出场武器')+'</button></div>');
    body.querySelectorAll('[data-gun]').forEach(b=>b.onclick=()=>armory(Number(b.dataset.gun)));
    $('equip').onclick=()=>{equipped=selected;store('loadout',slotIds[selected]);closeModal();notify('下次入场使用 '+g.name)};
    Weapon.preview($('gunPreview'),selected);
  }
  function refreshPreview(){
    const large=$('largePlot');
    if(!large)return;
    text('modalTitle',previewMap.name);text('mapDescription',previewMap.description);
    text('mapSize',previewMap.width+' × '+previewMap.depth+' m');
    large.setAttribute('aria-label',previewMap.name+'俯视图');
    for(const b of body.querySelectorAll('[data-map]')){
      const selected=b.dataset.map===previewMap.id;
      b.classList.toggle('chosen',selected);b.setAttribute('aria-pressed',selected);
    }
    drawMap(large,null,false,previewMap);
  }
  function maps(){
    previewMap=Arena.map;
    showModal('map','MAP INTEL',previewMap.name,
      '<div class="seg mapnav" role="group" aria-label="浏览地图">'+Arena.maps.map(m=>'<button type="button" data-map="'+esc(m.id)+'">'+esc(m.name)+'</button>').join('')+'</div>'
      +'<canvas id="largePlot" class="largeplot" role="img"></canvas><p class="legend"><span>●</span> 出生点　▧ 障碍物</p><p class="mapdesc" id="mapDescription"></p>'
      +'<div class="briefstats"><span>场地尺寸<b id="mapSize"></b></span><span>对局时长<b>5 分钟</b></span><span>复活间隔<b>15 秒</b></span></div>');
    body.querySelector('.mapnav').onclick=e=>{
      const choice=e.target.closest('[data-map]');
      if(choice){previewMap=getMap(choice.dataset.map);refreshPreview()}
    };
    refreshPreview();
  };
  function roomLabel(){
    if(!LAN.active)return '';
    return LAN.localOnly?LAN.room+' · 本机对局':LAN.room+' · '+LAN.peers.length+' / 8 人';
  }
  function rememberRoute(){
    target={room:LAN.room,map:LAN.map};
    if(location.protocol==='file:')return;
    const url=new URL(location.href);
    url.searchParams.set('room',target.room);url.searchParams.set('map',target.map);url.hash='';
    history.replaceState(null,'',url.href);
  }
  function action(label,handler,primary=false,id=''){
    const button=document.createElement('button');
    button.type='button';button.className='bt'+(primary?' primary':'');button.textContent=label;
    if(id)button.id=id;
    button.onclick=handler;$('matchActions').append(button);
  }
  function overlay(en,title,message){
    $('matchOverlay').hidden=false;text('matchEn',en);text('matchTitle',title);text('matchText',message);
    $('matchMore').replaceChildren();$('matchActions').replaceChildren();
  }
  function disconnected(message){
    document.body.dataset.screen='menu';$('entryStatus').hidden=true;
    overlay('MATCH','进入对局',message||'已离开 '+target.room+'。');
    action('重新进入',()=>enter(target),true,'rejoinMatch');
    action('另开对局',newMatch,false,'newMatch');
  }
  async function enter(route,create=false,name=player){
    if(joining)return;
    joining=true;
    try{
      if(create)await LAN.createRoom(route.room,name,route.map);
      else await LAN.enterRoom(route.room,name,route.map);
      rememberRoute();closeModal();
      if(!Game.start({name,weapon:equipped})){
        Game.quit();LAN.leave();disconnected('场景加载失败。请使用支持 WebGL 的桌面浏览器后重试。');return;
      }
      player=name;if(create)store('name',name);
      text('radarMap',Arena.map.name);text('roomtag',roomLabel());$('killfeed').replaceChildren();
      $('entryStatus').hidden=true;
    }catch(e){
      const message=e.message||'连接失败，请重试。';
      if(create&&dlg.open&&$('matchError'))text('matchError',message);
      else if(Game.state)notify(message);
      else disconnected(message);
    }finally{joining=false;if($('createRoom'))$('createRoom').disabled=false}
  }
  function newMatch(){
    const current=LAN.active?LAN.room:target.room;
    const defaultRoom=('战区 '+Math.random().toString(36).slice(2,6).toUpperCase());
    const activeMap=LAN.map||target.map;
    showModal('new','NEW MATCH','另开对局','<form id="newMatchForm">'
      +'<label class="field">玩家代号<input id="playername" maxlength="16" required value="'+esc(player)+'" autocomplete="nickname"></label>'
      +'<label class="field">对局名称<input id="newRoomName" maxlength="24" required value="'+esc(defaultRoom)+'" autocomplete="off"></label>'
      +'<label class="field">地图<select id="roomMap">'+Arena.maps.map(m=>'<option value="'+esc(m.id)+'"'+(m.id===activeMap?' selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select></label>'
      +(!LAN.localOnly&&LAN.active&&LAN.id===LAN.hostId&&LAN.peers.length>1?'<p class="smallnote">切换后，你主持的「'+esc(current)+'」将结束。</p>':'')
      +'<p class="formerr" id="matchError" role="alert"></p><button type="submit" id="createRoom" class="bt primary">进入新对局</button></form>');
    $('newMatchForm').onsubmit=e=>{
      e.preventDefault();if(joining)return;
      const room=$('newRoomName').value.trim(),name=$('playername').value.trim();
      if(!name||!room){text('matchError','请填写对局名称和玩家代号。');return}
      $('createRoom').disabled=true;
      void enter({room,map:$('roomMap').value},true,name);
    };
  }
  async function copyField(field,success){
    const status=$('copyStatus');
    try{await navigator.clipboard.writeText(field.value);status.textContent=success;return}catch{}
    field.closest('details')?.setAttribute('open','');field.focus();field.select();
    try{if(document.execCommand('copy')){status.textContent=success;return}}catch{}
    status.textContent='内容已选中，按 Ctrl+C 复制。';
  }
  function share(){
    const url=LAN.shareUrl;
    if(url){
      showModal('share','LOCAL NETWORK','分享对局',
        '<section class="sharing"><p>同一局域网的玩家打开这个地址，即可进入「'+esc(LAN.room)+'」。</p>'
        +'<label class="field">对局地址<input id="shareAddress" readonly></label><button type="button" class="bt primary" id="copyAddress">复制对局地址</button>'
        +'<p role="status" id="copyStatus"></p></section>');
      const field=$('shareAddress');field.value=url;
      $('copyAddress').onclick=()=>copyField(field,'对局地址已复制。');void copyField(field,'对局地址已复制。');
    }else if(LAN.localOnly){
      showModal('share','LOCAL NETWORK','让好友加入',
        '<section class="sharing"><p>在这台 Windows 电脑的 PowerShell 中运行下方命令，浏览器会打开可联机的同名对局。好友用浏览器打开窗口显示的局域网地址即可加入。</p>'
        +'<div class="rowactions"><button type="button" class="bt primary" id="copyHostCommand">复制启动命令</button></div><details><summary>查看命令</summary>'
        +'<textarea id="hostCommand" readonly rows="4" aria-label="联机启动命令"></textarea></details><p role="status" id="copyStatus"></p></section>');
      const field=$('hostCommand');field.value=SingleFileHost.command(LAN.room||target.room,LAN.map||target.map);
      $('copyHostCommand').onclick=()=>copyField(field,'已复制。请粘贴到 Windows PowerShell 后按回车。');
    }else{
      showModal('share','LOCAL NETWORK','分享对局',
        '<p>当前服务未提供其他电脑可以访问的局域网地址。请在连接局域网的 Windows 主机上打开本地游戏文件，从「分享对局」启用联机。</p>');
    }
  }
  function feed(message){const line=document.createElement('div');line.textContent=message;const feed=$('killfeed');feed.append(line);if(feed.children.length>4)feed.firstChild.remove();setTimeout(()=>line.remove(),3200)}
  function elimination(name){text('defeatedName',name)}
  let shownTarget=null,targetTimer=0;
  function vitals(hp,kills,deaths,target){
    text('kills',kills);text('deaths',deaths);text('hp',Math.ceil(hp));$('hpbar').style.width=Math.max(0,hp)+'%';
    if(target===shownTarget)return;
    clearTimeout(targetTimer);shownTarget=target;
    const health=$('targetHealth');
    health.hidden=!target;
    if(!target)return;
    text('targetName',target.name);text('targetReading',target.protected?'出生保护':target.hp+' HP');
    health.classList.toggle('protected',target.protected);
    $('targetFill').style.transform='scaleX('+target.hp/100+')';
    targetTimer=setTimeout(()=>{health.hidden=true;shownTarget=null;},Math.max(0,target.until*1000-performance.now()));
  }
  const slotLabels=[...$('weaponSlots').children];
  const scopeLayer=$('scopeView'),hipCross=$('cross');
  let scopeOpacity=0;
  function scope(s){
    const alpha=s && s.phase==='playing' && s.weapon===0 ? Math.round((s.scopeBlend||0)*1000)/1000 : 0;
    if(alpha>0)text('lensPower',s.scopeZoom+'×');
    if(alpha===scopeOpacity)return;
    scopeOpacity=alpha;
    scopeLayer.hidden=alpha===0;
    scopeLayer.style.opacity=String(alpha);
    hipCross.style.visibility=alpha>.15?'hidden':'';
  }
  let activeSlot=-1;
  function hud(s){
    lastState=s;
    $('fieldHint').hidden=Boolean(s.controlsEngaged);
    text('roomtag',roomLabel());
    const secs=Math.max(0,Math.ceil(s.secondsLeft));
    text('timer',String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0'));
    vitals(s.hp,s.kills,s.deaths,s.targetFeedback);
    if(activeSlot!==s.weapon){
      activeSlot=s.weapon;
      for(let i=0;i<slotLabels.length;i++)slotLabels[i].classList.toggle('equipped',i===activeSlot);
    }
    text('weapLabel',guns[s.weapon].name);
    $('opticSetting').hidden=s.weapon!==0 || s.scopeBlend>.8;
    if(s.weapon===0)text('scopePower',s.scopeZoom+'×');
    $('ammoLine').hidden=s.melee;$('knifeAction').hidden=!s.melee;$('fireSetting').hidden=s.melee;
    if(!s.melee){text('ammo',s.ammo);text('reserve',s.reserve);}
    const automatic=s.fireMode==='auto', reloading=s.reload>=0;
    text('fireModeLabel',automatic?'连发':'单发');
    $('fireSetting').classList.toggle('automatic',automatic);$('fireModeKey').hidden=!s.canToggleFireMode;
    $('reloadMeter').hidden=!reloading;
    if(reloading){
      text('gunstatus','换弹 · '+s.reloadStage);
      $('reloadFill').style.transform='scaleX('+Math.min(1,s.reload)+')';
    }
    const confirm=s.killConfirm||0,marker=$('marker'),cross=$('cross');
    marker.classList.toggle('confirmed',confirm>0);
    marker.style.opacity=confirm>0?String(Math.min(1,confirm*5)):String(Math.min(1,(s.hit||0)*14));
    $('elimination').classList.toggle('visible',confirm>0);
    $('hurt').style.opacity=Math.min(.78,(s.hurt||0)*2);
    const spread=4.5-3*s.aim+(s.moving?1.5:0)*(1-s.aim)+(s.recoil||0)*(10-5*s.aim);
    cross.style.setProperty('--spread',Math.min(21,spread).toFixed(1)+'px');
    cross.style.opacity=reloading?'.28':s.hp>0?'1':'0';
    if(performance.now()-lastRadar>125){drawMap($('radar'),s,true);lastRadar=performance.now()}
    if(document.body.dataset.screen==='dead'&&$('respawn')) text('respawn',Math.max(0,Math.ceil(s.respawnLeft)));
  }
  function screen(phase){
    document.body.dataset.screen=phase;
    if(phase!=='playing')scope(null);
    $('entryStatus').hidden=true;
    if(phase==='menu'){lastState=null;closeModal();text('defeatedName','');$('elimination').classList.remove('visible');disconnected();return}
    if(phase==='playing'){$('matchOverlay').hidden=true;return}
    const s=Game.state||lastState||{};
    if(phase==='paused'){
      overlay('FIELD MENU','战斗菜单',Arena.map.name+' · '+roomLabel());
      action('返回战斗',()=>Game.resume(),true,'resumeMatch');action('分享对局',share,false,'menuShare');
      action('另开对局',newMatch,false,'newMatch');action('地图简报',maps,false,'mapBtn');action('武器库',()=>armory(equipped),false,'navArm');
      action('操作指南',help,false,'help');
      action(Game.soundEnabled?'关闭音效':'开启音效',()=>{store('sound',Game.toggleSound()?'on':'off');screen('paused')});
      action('全屏',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{notify('请使用浏览器的全屏功能（F11）。')}});
      action('离开对局',()=>Game.quit(),false,'leaveMatch');
    }else if(phase==='dead'){
      overlay('RESPAWN','等待重返战区','');
      $('matchMore').innerHTML='<strong id="respawn">'+Math.max(0,Math.ceil(s.respawnLeft??Game.respawnSeconds))+'</strong> 秒后复活';action('战斗菜单',()=>Game.pause());
    }else if(phase==='ended'){
      closeModal();overlay('ROUND COMPLETE','对局结束',Arena.map.name+' · 自由混战');
      $('matchMore').innerHTML='<table class="ranks"><thead><tr><th>排名</th><th>代号</th><th>击败</th><th>阵亡</th></tr></thead><tbody>'+(s.leaderboard||[]).map((a,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(a.name)+(a.isMe?'（你）':'')+'</td><td>'+a.kills+'</td><td>'+a.deaths+'</td></tr>').join('')+'</tbody></table>';
      action('另开对局',newMatch,true,'newMatch');action('离开对局',()=>Game.quit());
    }
  }
  $('pause').onclick=()=>Game.pause();$('shareMatch').onclick=share;
  LAN.onPeers(()=>{text('roomtag',roomLabel());if(document.body.dataset.screen==='paused')text('matchText',Arena.map.name+' · '+roomLabel())});
  window.UI={screen,hud,scope,vitals,notify,feed,elimination};
  window.addEventListener('resize',()=>{if($('largePlot'))refreshPreview();if($('gunPreview'))Weapon.preview($('gunPreview'),Number(body.querySelector('.chosen')?.dataset.gun??0))});
  void enter(target).then(async()=>{
    if(!LAN.localOnly)return;
    const origin=await LAN.probeLocalHost();
    if(origin&&LAN.localOnly)location.replace(LAN.playUrl(origin,LAN.room,LAN.map));
  });
})();
