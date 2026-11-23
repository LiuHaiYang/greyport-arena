(() => {
  'use strict';
  let session = null;
  let generation = 0;
  const listeners = { game: new Set(), peers: new Set(), close: new Set() };
  let lobbyAddress = '';
  const localHelp = '由一台 Windows 电脑打开游戏 HTML，在房间大厅复制开房命令并用 Windows PowerShell 运行。其他玩家打开同一个局域网地址。';

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
      throw new Error('无法连接局域网大厅。' + localHelp);
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

  function leave() {
    generation++;
    if (!session) return;
    const current = session;
    session = null;
    current.events.close();
    clearTimeout(current.lostTimer);
    clearTimeout(current.flushTimer);
    release(current.token);
  }

  function lost(current, reason) {
    if (session !== current) return;
    leave();
    publish('close', reason);
  }

  async function begin(action, data) {
    if (!/^https?:$/.test(location.protocol)) throw new Error(localHelp);
    leave();
    const stamp = generation;
    let info;
    try {
      info = await request(action, data);
    } catch (error) {
      throw error;
    }
    if (stamp !== generation) {
      release(info.token);
      throw new Error('已取消连接。');
    }
    const events = new EventSource('/api/events?token=' + encodeURIComponent(info.token));
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
    lobbyAddress = lanUrl;
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
    get available() { return /^https?:$/.test(location.protocol); },
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
      lobbyAddress = result.lanUrl;
      return result.rooms;
    },
    createRoom(room, name, map = 'dock') { return begin('create', { room, name, map }); },
    joinRoom(room,name) { return begin('join', { room, name }); },
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
