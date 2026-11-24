(() => {
  'use strict';
  let session = null;
  let generation = 0;
  const listeners = { game: new Set(), peers: new Set(), close: new Set() };
  let lobbyAddress = '';
  const localHelp = '打开游戏菜单中的联机选项，在 Windows PowerShell 运行本机开服命令。朋友打开同一个对局地址即可加入。';
  const defaultRoom='灰港';
  const validMap=value=>['dock','rail','warehouse'].includes(value);

  function route() {
    const params=new URL(location.href).searchParams;
    const map=params.get('map');
    return {room:params.get('room')?.trim()||defaultRoom,map:validMap(map)?map:'dock'};
  }
  function playUrl(origin, room=defaultRoom, map='dock') {
    const address=new URL('/',origin);
    if(!['http:', 'https:'].includes(address.protocol))throw new Error('对局地址需要使用 HTTP 或 HTTPS。');
    address.searchParams.set('room',room);
    address.searchParams.set('map',validMap(map)?map:'dock');
    return address.href;
  }
  function loopback(hostname) {
    return hostname==='localhost'||hostname==='[::1]'||/^127\./.test(hostname);
  }
  function sharedAddress(suggested) {
    // Keep the interface the player actually reached on machines with multiple network adapters.
    if(/^https?:$/.test(location.protocol)&&!loopback(location.hostname))return location.origin;
    return suggested&&!loopback(new URL(suggested).hostname)?suggested:'';
  }
  async function probeLocalHost() {
    if(location.protocol!=='file:')return '';
    const origin='http://127.0.0.1:8787';
    const abort=new AbortController();
    const timeout=setTimeout(()=>abort.abort(),750);
    try {
      const r=await fetch(origin+'/api/identity',{signal:abort.signal,credentials:'omit',cache:'no-store',redirect:'error'});
      const info=r.ok?await r.json():null;
      return info?.game==='greyport-arena'&&info.directPlay===3?origin:'';
    } catch { return ''; }
    finally { clearTimeout(timeout); }
  }

  function subscribe(group, fn) {
    listeners[group].add(fn);
    return () => listeners[group].delete(fn);
  }

  function publish(group, ...args) {
    for (const fn of [...listeners[group]]) {
      try { fn(...args); } catch (error) { console.error(error); }
    }
  }

  async function request(action, data) {
    if (!/^https?:$/.test(location.protocol)) throw new Error(localHelp);
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), 5000);
    try {
      const response = await fetch('/api/' + action, {
        method: data === undefined ? 'GET' : 'POST',
        headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
        cache: 'no-store',
        signal: abort.signal
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) {
        const error = new Error(result?.error || localHelp);
        error.status = response.status;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.status) throw error;
      throw new Error('无法连接对局服务。' + localHelp);
    } finally {
      clearTimeout(deadline);
    }
  }

  function release(token) {
    const data = JSON.stringify({ token });
    if (!navigator.sendBeacon?.('/api/leave', data)) {
      fetch('/api/leave', { method: 'POST', body: data, keepalive: true }).catch(() => {});
    }
  }

  function closeSession(current) {
    if (!current || current.localOnly) return;
    current.events.close();
    clearTimeout(current.lostTimer);
    clearTimeout(current.flushTimer);
    release(current.token);
  }
  function leave() {
    generation++;
    const current=session;
    session=null;
    closeSession(current);
  }

  function lost(current, reason) {
    if (session !== current) return;
    leave();
    publish('close', reason);
  }

  function localSession(action,data) {
    const room=String(data.room||'').normalize('NFKC').trim().replace(/\s+/g,' ');
    const name=String(data.name||'').trim();
    if(!room||Array.from(room).length>24||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(room))throw new Error('房间名须为 1–24 个字符。');
    if(!name||Array.from(name).length>16)throw new Error('玩家代号须为 1–16 个字符。');
    if(!validMap(data.map))throw new Error('请选择有效的地图。');
    if (session?.room.toLowerCase()===room.toLowerCase()) {
      if(action==='create')throw new Error('房间名已被使用。');
      return session;
    }
    const id='local-host';
    return {id,hostId:id,room,map:data.map,role:'host',peers:[{id,name}],backlog:[],localOnly:true,lanUrl:''};
  }
  async function begin(action, data) {
    const stamp=++generation;
    // Re-entering the current room must not evict its host or count this player twice.
    if(action!=='create' && session &&
        session.room.toLowerCase()===String(data.room).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()) {
      const {room,map,id,hostId,role,peers,lanUrl}=session;
      return {room,map,id,hostId,role,peers,lanUrl};
    }
    if(location.protocol==='file:') {
      const next=localSession(action,data);
      session=next;
      return {room:next.room,map:next.map,id:next.id,hostId:next.hostId,role:next.role,peers:next.peers,lanUrl:''};
    }
    const info=await request(action,data);
    if (stamp !== generation) {
      release(info.token);
      throw new Error('已取消连接。');
    }
    let events;
    try { events = new EventSource('/api/events?token=' + encodeURIComponent(info.token)); }
    catch (error) { release(info.token);throw error; }
    closeSession(session);
    const current = session = {
      ...info, events, outgoing: [], backlog: [], sending: false, seq: 0, flushTimer: 0, lostTimer: 0
    };
    events.onopen = () => {
      clearTimeout(current.lostTimer);
      current.lostTimer = 0;
    };
    events.onerror = () => {
      if (!current.lostTimer) {
        current.lostTimer = setTimeout(() => lost(current, '与房间失去连接，请重新加入。'), 12000);
      }
    };
    events.onmessage = event => {
      if (session !== current) return;
      const packet = JSON.parse(event.data);
      if (packet.type === 'peers') {
        current.peers = packet.peers;
        publish('peers', current.peers);
      } else if (packet.type === 'closed') {
        lost(current, packet.message);
      } else if (packet.type === 'game') {
        if (listeners.game.size) publish('game', packet.body, packet.from);
        else {
          current.backlog.push([packet.body, packet.from]);
          if (current.backlog.length > 96) current.backlog.shift();
        }
      }
    };
    const { room, map, id, hostId, peers, lanUrl, role } = info;
    lobbyAddress = sharedAddress(lanUrl);
    return { room, map, id, hostId, peers, lanUrl, role };
  }

  function scheduleFlush(current, delay) {
    if (current.sending || current.flushTimer || !current.outgoing.length) return;
    current.flushTimer = setTimeout(() => flush(current), delay);
  }

  async function flush(current) {
    current.flushTimer = 0;
    if (session !== current || current.sending || !current.outgoing.length) return;
    current.sending = true;
    const messages = current.outgoing.splice(0, 12);
    const batch = { token: current.token, seq: ++current.seq, messages };
    let failure;
    for (let attempt = 0; attempt < 3 && current === session; attempt++) {
      try {
        await request('send', batch);
        failure = null;
        break;
      } catch (error) {
        failure = error;
        if (error.status >= 400 && error.status < 500) break;
      }
    }
    current.sending = false;
    if (session !== current) return;
    if (failure) lost(current, failure.status ? failure.message : '与房间失去连接，请重新加入。');
    else scheduleFlush(current, 0);
  }

  window.LAN = {
    hint: localHelp,
    route,playUrl,probeLocalHost,
    get available() { return /^https?:$/.test(location.protocol); },
    get localOnly() { return Boolean(session?.localOnly); },
    get shareUrl() { return session && lobbyAddress && !session.localOnly ? playUrl(lobbyAddress,session.room,session.map) : ''; },
    get active() { return Boolean(session); },
    get id() { return session?.id || ''; },
    get hostId() { return session?.hostId || ''; },
    get room() { return session?.room || ''; },
    get map() { return session?.map || ''; },
    get lanUrl() { return lobbyAddress; },
    get peers() { return session?.peers || []; },
    async listRooms() {
      const result = await request('rooms');
      if (!Array.isArray(result.rooms)) throw new Error(localHelp);
      lobbyAddress = sharedAddress(result.lanUrl);
      return result.rooms;
    },
    createRoom(room, name, map = 'dock') { return begin('create', { room, name, map }); },
    joinRoom(room,name) { return begin('join', { room, name, map:'dock' }); },
    enterRoom(room,name,map='dock') { return begin('enter', { room, name, map }); },
    leave,
    onMessage(fn) {
      const stop = subscribe('game', fn);
      if (session?.backlog.length) {
        const buffered = session.backlog.splice(0);
        for (const [body, from] of buffered) fn(body, from);
      }
      return stop;
    },
    onPeers(fn) { return subscribe('peers', fn); },
    onClose(fn) { return subscribe('close', fn); },
    send(body, to = null) {
      const current = session;
      if (!current || !body || typeof body !== 'object' || current.peers.length === 1) return;
      // While a POST is pending, only the newest consecutive position or world snapshot
      // matters. Keep actions, targeted replies and their ordering intact.
      const last=current.outgoing[current.outgoing.length-1];
      if(last && (body.t==='pose'||body.t==='state') && last.body.t===body.t && last.to===to) {
        last.body=body;
        return;
      }
      if (current.outgoing.length >= 256) {
        lost(current, '网络拥堵，连接已中断，请重新加入房间。');
        return;
      }
      current.outgoing.push({ body, to });
      scheduleFlush(current, 0);
    }
  };
  addEventListener('pagehide', leave);
})();
