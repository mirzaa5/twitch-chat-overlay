/*
  chat.js — Twitch Chat Overlay
  What this file does: WebSocket connection to Twitch IRC + DOM rendering logic
  Expects: window.OVERLAY_CONFIG (from config.js, loaded before this script)
  Exports: nothing (self-contained, runs on DOMContentLoaded)
*/

(() => {
  const cfg = window.OVERLAY_CONFIG;
  const container = document.getElementById('chat-container');

  let socket = null;
  let reconnectTimer = null;
  let statusEl = null;
  let firstMessageReceived = false;

  // Badge image URL cache — populated from Helix API if clientId + oauthToken are set.
  // Key: "setId/version" (e.g. "subscriber/3"), value: 1x image URL
  const badgeCache = new Map();

  async function fetchBadges(channel) {
    const clientId   = (cfg.clientId   || '').trim();
    const oauthToken = (cfg.oauthToken || '').trim().replace(/^oauth:/, '');
    if (!clientId || !oauthToken) return;

    const headers = {
      'Authorization': `Bearer ${oauthToken}`,
      'Client-Id': clientId,
    };

    try {
      // Fetch global badges (mod, vip, broadcaster, etc.)
      const globalRes = await fetch('https://api.twitch.tv/helix/chat/badges/global', { headers });
      if (!globalRes.ok) { console.warn('[Twitch Overlay] Badge API error:', globalRes.status); return; }
      const globalData = await globalRes.json();
      (globalData.data || []).forEach(set => {
        set.versions.forEach(v => badgeCache.set(`${set.set_id}/${v.id}`, v.image_url_1x));
      });

      // Get broadcaster_id for channel-specific badges (subscriber, bits, etc.)
      const userRes  = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`, { headers });
      const userData = await userRes.json();
      const broadcasterId = userData.data?.[0]?.id;

      if (broadcasterId) {
        const chanRes  = await fetch(`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${broadcasterId}`, { headers });
        const chanData = await chanRes.json();
        (chanData.data || []).forEach(set => {
          set.versions.forEach(v => badgeCache.set(`${set.set_id}/${v.id}`, v.image_url_1x));
        });
      }

      console.log(`[Twitch Overlay] Loaded ${badgeCache.size} badge variants ✓`);
    } catch (err) {
      console.warn('[Twitch Overlay] Badge fetch failed:', err);
    }
  }

  // ─── Apply CSS custom properties from config ──────────────────────────────
  function applyConfigToCSS() {
    const root = document.documentElement;
    root.style.setProperty('--bg-color',           cfg.backgroundColor);
    root.style.setProperty('--glass-bg',           cfg.backgroundColor); // what .chat-message actually reads
    root.style.setProperty('--msg-color',          cfg.messageColor);
    root.style.setProperty('--username-color',     cfg.usernameColor);
    root.style.setProperty('--mention-color',      cfg.mentionColor);
    root.style.setProperty('--font-size',          cfg.fontSize);
    root.style.setProperty('--font-family',        cfg.fontFamily);
    root.style.setProperty('--badge-size',         cfg.badgeSize);
    root.style.setProperty('--animation-duration', cfg.animationDuration);
    root.style.setProperty('--max-width',          cfg.maxWidth);
    root.style.setProperty('--chat-height',        cfg.chatHeight || '600px');
    root.style.setProperty('--text-shadow',        cfg.textShadow
      ? '0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)'
      : 'none');
    root.style.setProperty('--username-shadow',    cfg.textShadow
      ? '0 0 8px currentColor'
      : 'none');
  }

  // ─── Position variant ─────────────────────────────────────────────────────
  function applyPosition() {
    const validPositions = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];
    const pos = validPositions.includes(cfg.position) ? cfg.position : 'bottom-left';
    container.classList.add(pos);
  }

  // ─── Status message helpers ───────────────────────────────────────────────
  function showStatus(text, variant = '') {
    removeStatus();
    statusEl = document.createElement('div');
    statusEl.className = 'status-message' + (variant ? ' ' + variant : '');
    statusEl.textContent = text;
    container.appendChild(statusEl);
  }

  function removeStatus() {
    if (statusEl && statusEl.parentNode) {
      statusEl.parentNode.removeChild(statusEl);
    }
    statusEl = null;
  }

  // ─── IRC parser ───────────────────────────────────────────────────────────
  // Parses: @tag1=val1;tag2=val2 :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
  function parseIRC(raw) {
    try {
      let remainder = raw;
      let tags = {};

      // Extract tags (@...)
      if (remainder.startsWith('@')) {
        const spaceIdx = remainder.indexOf(' ');
        const tagStr = remainder.slice(1, spaceIdx);
        remainder = remainder.slice(spaceIdx + 1).trimStart();
        tagStr.split(';').forEach(part => {
          const eqIdx = part.indexOf('=');
          if (eqIdx !== -1) {
            tags[part.slice(0, eqIdx)] = part.slice(eqIdx + 1);
          } else {
            tags[part] = '';
          }
        });
      }

      // Extract prefix (:user!user@host)
      let prefix = '';
      if (remainder.startsWith(':')) {
        const spaceIdx = remainder.indexOf(' ');
        prefix = remainder.slice(1, spaceIdx);
        remainder = remainder.slice(spaceIdx + 1).trimStart();
      }

      // Extract command
      const parts = remainder.split(' ');
      const command = parts[0];

      // Extract channel (params[0])
      let channel = '';
      if (parts[1] && parts[1].startsWith('#')) {
        channel = parts[1].slice(1);
      }

      // Extract message text (everything after the final :)
      let message = '';
      const colonIdx = remainder.indexOf(' :');
      if (colonIdx !== -1) {
        message = remainder.slice(colonIdx + 2);
      }

      // Extract username from prefix  user!user@...
      let username = '';
      if (prefix) {
        username = prefix.split('!')[0];
      }

      return { tags, prefix, command, channel, message, username };
    } catch (err) {
      console.log('[Twitch Overlay] Parse error: ' + raw);
      return null;
    }
  }

  // ─── Badge rendering ──────────────────────────────────────────────────────
  // Twitch badge CDN now uses UUID-based set IDs, not name-based paths.
  // These UUIDs are stable global badge set IDs from the Helix API.
  const BADGE_UUIDS = {
    broadcaster: '5527c58c-fb7d-422d-b71b-f309dcb85cc1',
    moderator:   '3267646d-33f0-4b17-b3df-f923a41db1d0',
    vip:         'b817aba4-fad8-49e2-b88a-7cc744dfa6ec',
    staff:       'd97c37be-a222-4a84-91b3-af6488e7e8f0',
    partner:     'd12a2e27-16f6-41d0-ab77-b780518f00a3',
    turbo:       'bd444ec6-8f34-4bf9-91f4-af1e3428d80f',
  };

  // badge-set format: "broadcaster/1,subscriber/3"
  function parseBadges(badgeStr) {
    if (!badgeStr) return [];
    return badgeStr.split(',').map(b => {
      const [name, version] = b.split('/');
      return { name, version: version || '1' };
    });
  }

  function renderBadges(badges) {
    const wrap = document.createElement('span');
    wrap.className = 'badges';
    badges.forEach(({ name, version }) => {
      const span = document.createElement('span');
      span.className = 'badge';

      // Priority: Helix API cache → hardcoded UUID fallback → CSS dot
      const cachedUrl = badgeCache.get(`${name}/${version}`);
      const uuid      = BADGE_UUIDS[name];
      const imgUrl    = cachedUrl || (uuid ? `https://static-cdn.jtvnw.net/badges/v1/${uuid}/1` : null);

      if (!imgUrl) {
        span.dataset.badgeType = name;
        span.classList.add('badge-dot');
      } else {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = name;
        img.onerror = () => {
          img.style.display = 'none';
          span.dataset.badgeType = name;
          span.classList.add('badge-dot');
        };
        span.appendChild(img);
      }
      wrap.appendChild(span);
    });
    return wrap;
  }

  // ─── Emote rendering ──────────────────────────────────────────────────────
  // emotes format: "emoteid:start-end,start-end/emoteid2:start-end"
  function renderEmotes(text, emoteStr) {
    if (!emoteStr) return escapeHTML(text);

    // Build list of replacements: { start, end, id }
    const replacements = [];
    emoteStr.split('/').forEach(part => {
      const [id, positions] = part.split(':');
      if (!positions) return;
      positions.split(',').forEach(range => {
        const [start, end] = range.split('-').map(Number);
        replacements.push({ start, end, id });
      });
    });

    // Sort descending by start so we replace from end → start
    replacements.sort((a, b) => b.start - a.start);

    // Work on array of chars to preserve indices
    const chars = [...text];
    replacements.forEach(({ start, end, id }) => {
      const emoteName = chars.slice(start, end + 1).join('');
      const imgHTML = `<img src="https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0" `
        + `style="width:24px;height:24px;vertical-align:middle;" alt="${escapeAttr(emoteName)}">`;
      chars.splice(start, end - start + 1, imgHTML);
    });

    // Escape non-emote text segments and join
    return chars
      .map(c => (c.startsWith('<img') ? c : escapeHTML(c)))
      .join('');
  }

  // ─── Accessibility: getLegibleColor ──────────────────────────────────────
  // If the hex color's relative luminance < 0.3, mix it 40% toward white
  function getLegibleColor(hex) {
    if (!hex || !hex.startsWith('#')) return cfg.usernameColor;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6) return cfg.usernameColor;

    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;

    // Relative luminance (WCAG)
    const lin = (v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

    if (L >= 0.3) return hex;

    // Mix 40% toward white
    const mix = (channel) => Math.round(channel * 255 * 0.6 + 255 * 0.4);
    const rr = mix(r).toString(16).padStart(2, '0');
    const gg = mix(g).toString(16).padStart(2, '0');
    const bb = mix(b).toString(16).padStart(2, '0');
    return `#${rr}${gg}${bb}`;
  }

  // ─── Escape helpers ───────────────────────────────────────────────────────
  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─── Scroll helpers ───────────────────────────────────────────────────────
  function isNearBottom() {
    const threshold = 60;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }

  function scrollToBottom() {
    container.scrollTop = container.scrollHeight;
  }

  // ─── Remove oldest message with fade ─────────────────────────────────────
  function removeOldestMessage() {
    // Only target visible messages — skip ones already animating out
    const msgs = container.querySelectorAll('.chat-message:not(.removing)');
    if (msgs.length === 0) return;
    const oldest = msgs[0];
    oldest.classList.add('removing');
    const duration = parseFloat(cfg.animationDuration) * 1000 || 300;
    setTimeout(() => {
      if (oldest.parentNode) oldest.parentNode.removeChild(oldest);
    }, duration);
  }

  // ─── Add message to DOM ───────────────────────────────────────────────────
  function addMessage(parsed) {
    const { tags, username, message } = parsed;

    const displayName = tags['display-name'] || username;
    const rawColor = tags['color'] || '';
    const userColor = getLegibleColor(rawColor) || cfg.usernameColor;
    const badgeStr = tags['badges'] || '';
    const emoteStr = tags['emotes'] || '';

    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';

    // Highlight mention
    const channelName = cfg.channel.toLowerCase();
    if (cfg.highlightMentions && message.toLowerCase().includes('@' + channelName)) {
      msgEl.classList.add('highlight-mention');
    }

    // Timestamp
    if (cfg.showTimestamps) {
      const ts = document.createElement('span');
      ts.className = 'timestamp';
      const now = new Date();
      ts.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      msgEl.appendChild(ts);
    }

    // Badges
    if (cfg.showBadges && badgeStr) {
      const badges = parseBadges(badgeStr);
      if (badges.length > 0) {
        msgEl.appendChild(renderBadges(badges));
      }
    }

    // Username
    const usernameEl = document.createElement('span');
    usernameEl.className = 'username';
    usernameEl.style.color = userColor;
    usernameEl.textContent = displayName + ':';
    msgEl.appendChild(usernameEl);

    // Message text (with emotes)
    const textEl = document.createElement('span');
    textEl.className = 'message-text';
    textEl.innerHTML = renderEmotes(message, emoteStr);
    msgEl.appendChild(textEl);

    const wasNearBottom = isNearBottom();

    container.appendChild(msgEl);

    if (wasNearBottom) scrollToBottom();

    // Enforce maxMessages — only count visible messages, remove all excess at once
    const allMsgs = container.querySelectorAll('.chat-message:not(.removing)');
    const excess = allMsgs.length - cfg.maxMessages;
    for (let i = 0; i < excess; i++) {
      removeOldestMessage();
    }

    // Optional auto-fade
    if (cfg.fadeMessageAfter > 0) {
      setTimeout(() => {
        msgEl.classList.add('removing');
        const dur = parseFloat(cfg.animationDuration) * 1000 || 300;
        setTimeout(() => {
          if (msgEl.parentNode) msgEl.parentNode.removeChild(msgEl);
        }, dur);
      }, cfg.fadeMessageAfter * 1000);
    }
  }

  // ─── WebSocket connection ─────────────────────────────────────────────────
  function connect() {
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }

    const channel = cfg.channel.toLowerCase();
    showStatus(`Connecting to #${channel}...`);

    const nick = `justinfan${Math.floor(10000 + Math.random() * 90000)}`;
    socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');

    socket.onopen = () => {
      console.log('[Twitch Overlay] Connected');
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      socket.send('PASS SCHMOOPIIE');
      socket.send(`NICK ${nick}`);
      socket.send(`JOIN #${channel}`);
      console.log(`[Twitch Overlay] Joining #${channel}`);
    };

    socket.onmessage = (event) => {
      const lines = event.data.split('\r\n').filter(Boolean);
      lines.forEach(line => {
        handleLine(line);
      });
    };

    socket.onerror = () => {
      showStatus('Connection failed. Retrying in 3s...', 'error');
      scheduleReconnect();
    };

    socket.onclose = () => {
      console.log('[Twitch Overlay] Reconnecting in 3s...');
      showStatus('Connection failed. Retrying in 3s...', 'error');
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 3000);
  }

  // ─── IRC tag value unescaping ─────────────────────────────────────────────
  function unescapeTag(str) {
    return str.replace(/\\s/g, ' ').replace(/\\n/g, '\n').replace(/\\r/g, '\r')
              .replace(/\\\\/g, '\\').replace(/\\:/g, ';');
  }

  // ─── USERNOTICE alert renderer ────────────────────────────────────────────
  const ALERT_TYPES = {
    sub:            { icon: '⭐', cls: 'alert-sub'  },
    resub:          { icon: '⭐', cls: 'alert-sub'  },
    subgift:        { icon: '🎁', cls: 'alert-gift' },
    anonsubgift:    { icon: '🎁', cls: 'alert-gift' },
    submysterygift: { icon: '🎁', cls: 'alert-gift' },
    raid:           { icon: '🚀', cls: 'alert-raid' },
    ritual:         { icon: '👋', cls: 'alert-sub'  },
  };

  function handleUserNotice(parsed) {
    if (!cfg.showAlerts) return;
    const { tags } = parsed;
    const msgId = tags['msg-id'];
    if (!msgId || !ALERT_TYPES[msgId]) return;

    const { icon, cls } = ALERT_TYPES[msgId];
    const systemMsg = unescapeTag(tags['system-msg'] || '');
    if (!systemMsg) return;

    // resub may include an optional chat message typed by the user
    const userMsg = (msgId === 'resub' && parsed.message) ? parsed.message : '';

    addAlert(icon, cls, systemMsg, userMsg);

    if (!firstMessageReceived) {
      firstMessageReceived = true;
      removeStatus();
    }
  }

  function addAlert(icon, cls, text, subtext) {
    const el = document.createElement('div');
    el.className = `chat-message alert-message ${cls}`;

    const iconEl = document.createElement('span');
    iconEl.className = 'alert-icon';
    iconEl.textContent = icon;

    const bodyEl = document.createElement('span');
    bodyEl.className = 'alert-body';

    const textEl = document.createElement('span');
    textEl.className = 'alert-text';
    textEl.textContent = text;
    bodyEl.appendChild(textEl);

    if (subtext) {
      const sub = document.createElement('span');
      sub.className = 'alert-subtext';
      sub.textContent = `"${subtext}"`;
      bodyEl.appendChild(sub);
    }

    el.appendChild(iconEl);
    el.appendChild(bodyEl);

    container.appendChild(el);
    container.scrollTop = container.scrollHeight;

    const allMsgs = container.querySelectorAll('.chat-message:not(.removing)');
    const excess = allMsgs.length - cfg.maxMessages;
    for (let i = 0; i < excess; i++) removeOldestMessage();

    if (cfg.fadeMessageAfter > 0) {
      const dur = parseFloat(cfg.animationDuration) * 1000 || 300;
      setTimeout(() => {
        el.classList.add('removing');
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, dur);
      }, cfg.fadeMessageAfter * 1000);
    }
  }

  // ─── Handle a single IRC line ─────────────────────────────────────────────
  function handleLine(line) {
    // Keepalive
    if (line.startsWith('PING')) {
      socket.send('PONG :tmi.twitch.tv');
      return;
    }

    // Twitch RECONNECT command
    if (line.includes('RECONNECT')) {
      console.log('[Twitch Overlay] Reconnecting in 3s...');
      scheduleReconnect();
      return;
    }

    const parsed = parseIRC(line);
    if (!parsed) return;

    if (parsed.command === 'PRIVMSG') {
      if (!firstMessageReceived) {
        firstMessageReceived = true;
        removeStatus();
        console.log('[Twitch Overlay] Receiving messages ✓');
      }
      addMessage(parsed);
    } else if (parsed.command === 'USERNOTICE') {
      handleUserNotice(parsed);
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    applyConfigToCSS();
    applyPosition();

    // Expose API for settings panel
    window.overlayAPI = { applyConfigToCSS, connect, addAlert };

    if (!cfg.channel || cfg.channel.trim() === '') {
      showStatus('⚠ Open config.js and set your channel name', 'warning');
      return;
    }

    // Fetch badge images from Helix API (non-blocking — runs alongside IRC connect)
    fetchBadges(cfg.channel.trim().toLowerCase());
    connect();
  });
})();
