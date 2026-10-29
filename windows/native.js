/*
 * Nur in „Hajime für Windows“: Verbindung der Seite zum Hintergrundprogramm (node.exe).
 * Bietet dieselben Aufrufe wie die Electron-App für „Matten im Netz“, dazu die Firewall-Freigabe.
 * Wird von hajime-windows.js vor transport.js in control.html eingefügt.
 */
(function (root) {
  'use strict';
  let ws = null;
  let open = false;
  let seq = 0;
  const pending = new Map();
  const queue = [];
  const listeners = { 'hub-event': [], 'hubs-found': [] };

  function connect() {
    ws = new WebSocket(`ws://${location.host}/bridge`);
    ws.onopen = () => {
      open = true;
      queue.splice(0).forEach((m) => ws.send(m));
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      if (m.event) {
        if (m.event === 'focus') {
          try {
            root.focus();
          } catch (err) {
            /* egal */
          }
        }
        (listeners[m.event] || []).forEach((fn) => fn(m.data));
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error || 'Fehler'));
    };
    ws.onclose = () => {
      open = false;
      pending.forEach((p) => p.reject(new Error('Verbindung zu Hajime unterbrochen')));
      pending.clear();
      setTimeout(connect, 1000);
    };
  }

  function call(op) {
    const args = Array.prototype.slice.call(arguments, 1);
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ id, op, args });
      if (open) ws.send(msg);
      else queue.push(msg);
    });
  }

  connect();

  root.judoNative = {
    kind: 'windows',
    hubStart: (opts) => call('hubStart', opts),
    hubStop: () => call('hubStop'),
    hubSend: (id, msg) => call('hubSend', id, msg),
    hubOverview: (data) => {
      if (open) ws.send(JSON.stringify({ op: 'hubOverview', args: [data] }));
    },
    onHubEvent: (cb) => listeners['hub-event'].push(cb),
    finderStart: () => call('finderStart'),
    finderStop: () => call('finderStop'),
    onHubsFound: (cb) => listeners['hubs-found'].push(cb),
    openExternal: (url) => call('openExternal', url),
    firewallStatus: () => call('firewallStatus'),
    firewallAllow: () => call('firewallAllow'),
    firewallRemove: () => call('firewallRemove'),
  };
})(window);
