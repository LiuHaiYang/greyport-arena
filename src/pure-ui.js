(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const dlg=$('dialog'),body=$('modalBody');
  const guns=Game.guns;
  const gunTypes=['自动步枪','冲锋枪','半自动手枪'];
  function stored(key,fallback){try{return localStorage.getItem('greyport.'+key)??fallback}catch{return fallback}}
  function store(key,v){try{localStorage.setItem('greyport.'+key,v)}catch{}}
  let equipped=Math.max(0,Math.min(2,Number(stored('weapon','0'))||0)),lastState=null,toastTimer=0,modal='',lanStep=0;
  let lastRadar=0,roomRefreshTimer=0,previewMap=Arena.maps[0];
  const getMap=id=>Arena.maps.find(map=>map.id===id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=(id,v)=>{const el=$(id),s=String(v);if(el.textContent!==s) el.textContent=s};
  function notify(message){text('toast',message);$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3300)}
  function showModal(kind,en,title,html){
    modal=kind;text('modalEn',en);text('modalTitle',title);body.innerHTML=html;
    $('navArm').classList.toggle('active',kind==='arm');$('navHome').classList.toggle('active',kind!=='arm');
    if(!dlg.open) dlg.showModal();
  }
  function clearModal(keepConnection){
    if(modal==='lan'){
      lanStep++;
      clearInterval(roomRefreshTimer);
      roomRefreshTimer=0;
      if(!keepConnection) LAN.leave();
    }
    modal='';$('navArm').classList.remove('active');$('navHome').classList.add('active');
  }
  function closeModal(keepConnection=false){
    if(!dlg.open) return;
    clearModal(keepConnection===true);
    dlg.close();
  }
  dlg.addEventListener('cancel',e=>{e.preventDefault();closeModal()});
  dlg.addEventListener('close',()=>{if(!dlg.open&&modal) clearModal(false)});
  dlg.addEventListener('click',e=>{if(e.target===dlg){const r=dlg.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) closeModal()}});
  $('closeModal').onclick=closeModal;
  $('navHome').onclick=closeModal;
  function help(){
    const keys=[['移动','W A S D'],['转动视角','移动鼠标'],['开火','鼠标左键'],['举枪瞄准','按住右键'],['切换武器','1 / 2 / 3 或滚轮'],['单发 / 连发','B'],['换弹','R'],['跳跃','空格'],['疾跑','Shift'],['战斗菜单','Esc']];
    showModal('help','FIELD MANUAL','操作指南','<div class="keylist">'+keys.map(([a,b])=>'<div>'+a+'<kbd>'+b+'</kbd></div>').join('')+'</div><p style="margin-top:16px">点击战区画面控制视角。步枪和冲锋枪可按 B 切换模式：单发每次点击打一发，连发可按住左键。手枪固定单发。阵亡后 15 秒自动复活。</p>');
  }
  $('help').onclick=help;
  function refreshSound(){
    const on=Game.soundEnabled,label=on?'关闭音效':'开启音效';
    $('sound').innerHTML=icon(on?'volume':'mute');$('sound').setAttribute('aria-label',label);$('sound').title=label;
  }
  if(stored('sound','on')==='off') Game.setSound(false);
  refreshSound();$('sound').onclick=()=>{store('sound',Game.toggleSound()?'on':'off');refreshSound()};
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement) await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{notify('请使用浏览器的全屏功能（F11）。')}};
  function armory(selected){
    const g=guns[selected];
    const stats=[['弹匣容量',g.cap+' 发'],['基础伤害',g.damage],['射击模式',selected===2?'单发':'单发 / 连发'],
      ['射速上限',Math.round(60/(selected===2?g.semiDelay:g.delay))+' 发/分'],
      ['常规换弹',g.load.toFixed(2)+' 秒'],['空匣换弹',g.emptyLoad.toFixed(2)+' 秒']];
    showModal('arm','LOADOUT','武器库','<div class="seg">'+guns.map((w,i)=>'<button data-gun="'+i+'" class="'+(i===selected?'chosen':'')+'">'+w.name+'</button>').join('')+'</div><canvas id="gunPreview"></canvas><div class="gunhead"><strong>'+g.name+'</strong><span>'+gunTypes[selected]+'</span></div><div class="gunstats">'+stats.map(([k,v])=>'<div>'+k+'<b>'+v+'</b></div>').join('')+'</div><div class="rowactions"><button class="bt primary" id="equip">'+(selected===equipped?'已选为出场武器':'设为出场武器')+'</button></div>');
    body.querySelectorAll('[data-gun]').forEach(b=>b.onclick=()=>armory(Number(b.dataset.gun)));
    $('equip').onclick=()=>{equipped=selected;store('weapon',selected);closeModal();notify('出场武器 · '+g.name)};
    Weapon.preview($('gunPreview'),selected);
  }
  $('navArm').onclick=()=>armory(equipped);
  function refreshPreview(){
    text('mapName',previewMap.name);text('mapCode',previewMap.en);
    drawMap($('miniPlot'),null,false,previewMap);
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
  $('mapBtn').onclick=()=>{
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
  function start(name){
    closeModal(true);$('killfeed').replaceChildren();
    try{
      if(!Game.start({name:name||'玩家',weapon:equipped})){
        LAN.leave();
        return false;
      }
      text('radarMap',Arena.map.name);
      text('roomtag',roomLabel());
      return true;
    }catch(e){Game.quit();LAN.leave();screen('menu');notify(e.message||'无法进入游戏，请使用支持 WebGL 的桌面浏览器。');return false}
  }
  function nameField(){return '<label class="field">玩家代号<input id="playername" maxlength="16" value="'+esc(stored('name','玩家'))+'" autocomplete="nickname"></label>'}
  const playerName=()=>($('playername')?.value.trim().slice(0,16)||'玩家');
  function roomLabel(){
    const count=LAN.peers.length;
    return (count===1?'等待玩家 · ':'')+LAN.room+' · '+count+' / 8 人';
  }

  function addressForm(){
    return '<form id="lobbyAddressForm"><label class="field">大厅地址<input id="lobbyAddress" type="text" inputmode="url" autocomplete="url" placeholder="例如 http://192.168.1.10:8787" required></label>'
      +'<button class="bt" type="submit">打开大厅</button><p id="addressError" class="formerr" role="alert"></p></form>';
  }
  function bindAddressForm(){
    $('lobbyAddressForm').onsubmit=e=>{
      e.preventDefault();
      const address=$('lobbyAddress').value.trim();
      try{
        const url=new URL(/^https?:\/\//i.test(address)?address:'http://'+address);
        if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!address||(!/^https?:\/\//i.test(address)&&address.includes('://'))) throw new Error();
        location.assign(url.origin+'/#rooms');
      }catch{text('addressError','请填写大厅窗口显示的完整局域网地址。')}
    };
  }
  function openLAN(){
    const stamp=++lanStep;
    const active=()=>stamp===lanStep&&modal==='lan'&&dlg.open;
    if(!LAN.available){
      showModal('lan','LOCAL NETWORK','局域网大厅',
        '<section class="localHost"><h3>在这台电脑开大厅</h3><p>复制命令，在 Windows PowerShell 中粘贴并按回车。保持窗口开启，其他玩家打开窗口显示的局域网地址即可加入。</p>'
        +'<button id="copyHostCommand" class="bt primary" type="button">复制开房命令</button>'
        +'<details id="hostDetails"><summary>查看命令</summary><textarea id="hostCommand" aria-label="开房命令" readonly spellcheck="false" rows="4"></textarea></details>'
        +'<p id="copyStatus" role="status" hidden></p></section><h3 class="joinHeading">加入已有大厅</h3>'+addressForm());
      const field=$('hostCommand');
      field.value=SingleFileHost.command();
      $('copyHostCommand').onclick=async()=>{
        const details=$('hostDetails'),feedback=$('copyStatus');
        let copied=false;
        try{await navigator.clipboard.writeText(field.value);copied=true}catch{
          details.open=true;field.focus();field.select();
          try{copied=document.execCommand('copy')}catch{}
        }
        if(!copied){details.open=true;field.focus();field.select()}
        feedback.hidden=false;
        feedback.textContent=copied?'已复制。请粘贴到 Windows PowerShell。':'命令已选中，按 Ctrl+C 复制。';
      };
      bindAddressForm();
      return;
    }
    showModal('lan','LOCAL NETWORK','局域网大厅',
      nameField()
      +'<div class="roomListHead"><h3>现有房间</h3><button class="bt" type="button" id="refreshRooms">刷新</button></div>'
      +'<p id="roomListStatus" role="status">正在读取房间…</p><div id="roomList"></div>'
      +'<form id="createRoomForm"><label class="field">新房间名称<input id="newRoomName" maxlength="24" required placeholder="输入未被使用的房间名"></label>'
      +'<div class="roomCreateRow"><label class="field">房间地图<select id="roomMap">'+Arena.maps.map(m=>'<option value="'+esc(m.id)+'"'+(m===previewMap?' selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select></label>'
      +'<button id="createRoom" type="submit" class="bt primary">创建房间</button></div></form>'
      +'<p id="lanError" class="formerr" role="alert"></p><p class="smallnote" id="lobbyOrigin"></p>'
      +'<details id="otherLobby" hidden><summary>连接其他大厅</summary><p class="smallnote">'+esc(LAN.hint)+'</p>'+addressForm()+'</details>');
    bindAddressForm();
    let joining=false,reading=false,rooms=null,rendered='';
    const list=$('roomList'),refresh=$('refreshRooms'),create=$('createRoom');
    function updateControls(){
      create.disabled=joining;
      refresh.disabled=joining||reading;
      for(const btn of list.querySelectorAll('button')) btn.disabled=joining||btn.dataset.full==='true';
    }
    function setRooms(next){
      rooms=next;
      if(!rooms?.length){
        rendered='';list.replaceChildren();
        return;
      }
      const signature=JSON.stringify(rooms.map(r=>[r.room,r.map,r.count,r.max]));
      if(signature===rendered) return;
      const focusName=list.contains(document.activeElement)?document.activeElement.dataset.room:null;
      list.innerHTML='<table class="ranks"><thead><tr><th>房间 / 地图</th><th>人数</th><th aria-label="操作"></th></tr></thead><tbody>'+rooms.map(r=>{
        const full=r.count>=r.max,room=esc(r.room);
        const label=esc(getMap(r.map)?.name||'未知地图');
        return '<tr><td>'+room+'<span class="roomMap">'+label+'</span></td><td>'+Number(r.count)+' / '+Number(r.max)+'</td><td><button type="button" class="bt" data-room="'+room+'" data-full="'+full+'" aria-label="'+(full?'已满':'加入')+' '+room+'"'+(full||joining?' disabled':'')+'>'+(full?'已满':'加入')+'</button></td></tr>';
      }).join('')+'</tbody></table>';
      rendered=signature;
      if(focusName) [...list.querySelectorAll('button')].find(b=>b.dataset.room===focusName&&!b.disabled)?.focus();
    }
    async function refreshList(){
      if(!active()||reading||joining||document.hidden) return;
      reading=true;updateControls();
      try{
        const next=await LAN.listRooms();
        if(!active()||joining) return;
        setRooms(next);
        text('roomListStatus',rooms.length?'':'暂时没有房间。选一张地图，创建第一个房间。');
        $('roomListStatus').hidden=rooms.length>0;
        text('lobbyOrigin',LAN.lanUrl?'大厅地址 '+LAN.lanUrl:'');
        $('otherLobby').hidden=true;
      }catch(e){
        if(!active()||joining) return;
        setRooms(null);$('roomListStatus').hidden=false;
        text('roomListStatus',e.message||'读取房间失败，请刷新重试。');
        $('otherLobby').hidden=false;text('lobbyOrigin','');
      }finally{
        reading=false;
        if(active())updateControls();
      }
    }
    async function enterRoom(room,mode){
      if(joining||!active()) return;
      const name=playerName();
      if(!room){text('lanError','请填写新房间名称。');$('newRoomName').focus();return}
      joining=true;updateControls();store('name',name);text('lanError','');
      if(mode==='host')create.textContent='正在创建…';
      try{
        if(mode==='host')await LAN.createRoom(room,name,$('roomMap').value);
        else await LAN.joinRoom(room,name);
        if(active())start(name);
      }catch(e){
        if(!active())return;
        text('lanError',e.message||(mode==='host'?'创建失败，请重试。':'房间已关闭，请重新选择。'));
      }finally{
        joining=false;
        if(active()){create.textContent='创建房间';updateControls();void refreshList()}
      }
    }
    $('createRoomForm').onsubmit=e=>{e.preventDefault();void enterRoom($('newRoomName').value.trim(),'host')};
    list.onclick=e=>{const b=e.target.closest('button[data-room]');if(b&&!b.disabled)void enterRoom(b.dataset.room,'join')};
    refresh.onclick=refreshList;
    roomRefreshTimer=setInterval(refreshList,2500);
    void refreshList();
  }
  $('multi').onclick=openLAN;
  function feed(message){const line=document.createElement('div');line.textContent=message;const feed=$('killfeed');feed.append(line);if(feed.children.length>4)feed.firstChild.remove();setTimeout(()=>line.remove(),3200)}
  function elimination(name){text('defeatedName',name)}
  function hud(s){
    lastState=s;
    text('roomtag',roomLabel());
    const secs=Math.max(0,Math.ceil(s.secondsLeft));
    text('timer',String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0'));
    text('kills',s.kills);text('deaths',s.deaths);text('hp',Math.ceil(s.hp));$('hpbar').style.width=Math.max(0,s.hp)+'%';
    text('ammo',s.ammo);text('reserve',s.reserve);text('weapLabel',guns[s.weapon].name);
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
    $('matchOverlay').hidden=!['paused','ended','dead'].includes(phase);
    if(phase==='menu'){lastState=null;text('defeatedName','');$('elimination').classList.remove('visible');requestAnimationFrame(refreshPreview);return}
    if(phase==='playing') return;
    const s=Game.state||lastState||{};
    const actions=$('matchActions'),more=$('matchMore');
    actions.replaceChildren();more.replaceChildren();
    function action(label,callback,primary=false){const b=document.createElement('button');b.className='bt'+(primary?' primary':'');b.textContent=label;b.onclick=callback;actions.append(b)}
    if(phase==='paused'){
      text('matchEn','FIELD MENU');text('matchTitle','战斗菜单');
      text('matchText',Arena.map.name+' · 联机对局仍在进行');
      more.textContent=roomLabel();
      action('返回战斗',()=>Game.resume(),true);action('退出对局',()=>Game.quit());
    }else if(phase==='dead'){
      text('matchEn','RESPAWN');text('matchTitle','等待重返战区');text('matchText','复活后恢复生命与弹药。');
      more.innerHTML='<strong id="respawn">'+Math.max(0,Math.ceil(s.respawnLeft??Game.respawnSeconds))+'</strong> 秒后复活';action('退出对局',()=>Game.quit());
    }else if(phase==='ended'){
      text('matchEn','ROUND COMPLETE');text('matchTitle','对局结束');text('matchText',Arena.map.name+' · 自由混战');
      more.innerHTML='<table class="ranks"><thead><tr><th>排名</th><th>代号</th><th>击败</th><th>阵亡</th></tr></thead><tbody>'+(s.leaderboard||[]).map((a,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(a.name)+(a.isMe?'（你）':'')+'</td><td>'+a.kills+'</td><td>'+a.deaths+'</td></tr>').join('')+'</tbody></table>';
      action('返回大厅',()=>Game.quit(),true);
    }
  }
  $('pause').onclick=()=>Game.pause();
  LAN.onPeers(()=>{
    if(!Game.state) return;
    text('roomtag',roomLabel());
    if(document.body.dataset.screen==='paused') text('matchMore',roomLabel());
  });
  window.UI={screen,hud,notify,feed,elimination};
  const resize=()=>{refreshPreview();if($('gunPreview'))Weapon.preview($('gunPreview'),Number(body.querySelector('.chosen')?.dataset.gun??0))};
  new ResizeObserver(resize).observe($('mapBtn'));window.addEventListener('resize',resize);resize();
  if(location.hash==='#rooms')openLAN();
})();
