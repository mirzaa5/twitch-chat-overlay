/*
  settings.js — Twitch Chat Overlay Settings Panel
  Runs before chat.js: applies localStorage overrides to OVERLAY_CONFIG synchronously,
  then builds the gear-icon + settings panel UI on DOMContentLoaded.
*/

(() => {
  const STORAGE_KEY = 'twitch-overlay-config';
  const VALID_POSITIONS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];

  // ─── Apply saved config overrides before chat.js connects ─────────────────
  (function loadSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        Object.assign(window.OVERLAY_CONFIG, saved);
      }
    } catch (e) { /* ignore corrupt storage */ }
  })();

  // ─── Build UI on DOM ready ─────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const cfg = window.OVERLAY_CONFIG;
    const gearBtn = document.getElementById('gear-btn');
    const panel   = document.getElementById('settings-panel');

    const pos = validPos(cfg.position);
    gearBtn.classList.add(pos);
    panel.classList.add(pos);

    panel.innerHTML = buildPanelHTML(cfg);
    bindEvents(gearBtn, panel);
  });

  // ─── Event wiring ──────────────────────────────────────────────────────────
  function bindEvents(gearBtn, panel) {
    let snapshot = null; // cfg state at the moment the panel was opened

    // Opacity label live update
    const opacityRange = panel.querySelector('#sp-bgOpacity');
    const opacityVal   = panel.querySelector('#sp-bg-opacity-val');
    opacityRange.addEventListener('input', () => {
      opacityVal.textContent = opacityRange.value + '%';
      applySettings(panel, true);
    });

    // Live preview: colors + toggles
    panel.querySelectorAll('input[type=color]').forEach(el =>
      el.addEventListener('input', () => applySettings(panel, true))
    );
    panel.querySelectorAll('.sp-toggle-input').forEach(el =>
      el.addEventListener('change', () => applySettings(panel, true))
    );

    // Gear toggle — snapshot cfg on open
    gearBtn.addEventListener('click', () => {
      const isOpen = panel.classList.toggle('open');
      gearBtn.classList.toggle('active', isOpen);
      if (isOpen) {
        snapshot = Object.assign({}, window.OVERLAY_CONFIG);
        populateForm(panel);
      }
    });

    function closeAndRevert() {
      panel.classList.remove('open');
      gearBtn.classList.remove('active');
      if (snapshot) {
        Object.assign(window.OVERLAY_CONFIG, snapshot);
        if (window.overlayAPI) window.overlayAPI.applyConfigToCSS();
        const chatContainer = document.getElementById('chat-container');
        const pos = validPos(snapshot.position);
        VALID_POSITIONS.forEach(p => {
          gearBtn.classList.toggle(p, p === pos);
          panel.classList.toggle(p, p === pos);
          chatContainer && chatContainer.classList.toggle(p, p === pos);
        });
        snapshot = null;
      }
    }

    // Close button — revert any live preview changes
    panel.querySelector('#sp-close').addEventListener('click', closeAndRevert);

    // Alert test buttons
    const TEST_ALERTS = {
      sub:     { icon: '⭐', cls: 'alert-sub',  text: 'TestViewer just subscribed with Tier 1!',              sub: '' },
      resub:   { icon: '⭐', cls: 'alert-sub',  text: "LongTimeFan subscribed for 12 months! (Tier 1)",       sub: 'love this stream keep it up!' },
      gift:    { icon: '🎁', cls: 'alert-gift', text: 'GenerousGuy gifted a Tier 1 sub to LuckyViewer!',      sub: '' },
      mystery: { icon: '🎁', cls: 'alert-gift', text: 'BigSpender is gifting 5 Tier 1 subs to the community!', sub: '' },
      raid:    { icon: '🚀', cls: 'alert-raid', text: '420 raiders from FriendlyStreamer have joined!',        sub: '' },
    };
    panel.querySelectorAll('.sp-alert-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = TEST_ALERTS[btn.dataset.alert];
        if (a && window.overlayAPI) window.overlayAPI.addAlert(a.icon, a.cls, a.text, a.sub);
      });
    });

    // Apply button — validate first, then commit or show error
    panel.querySelector('#sp-apply').addEventListener('click', () => {
      const btn = panel.querySelector('#sp-apply');
      const valid = validateInputs(panel);

      if (!valid) {
        btn.textContent = 'Check values ✗';
        btn.classList.add('sp-apply-error');
        btn.disabled = true;
        setTimeout(() => {
          btn.textContent = 'Apply Changes';
          btn.classList.remove('sp-apply-error');
          btn.disabled = false;
        }, 2000);
        return;
      }

      applySettings(panel, false);
      snapshot = null;
      btn.textContent = 'Applied ✓';
      btn.classList.add('sp-apply-success');
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = 'Apply Changes';
        btn.classList.remove('sp-apply-success');
        btn.disabled = false;
      }, 1500);
    });
  }

  // ─── Validate all inputs — returns true if all in range ───────────────────
  function validateInputs(panel) {
    const get = (id) => panel.querySelector('#' + id);

    // Clear previous error highlights
    panel.querySelectorAll('.sp-input-error').forEach(el => el.classList.remove('sp-input-error'));

    const numChecks = [
      { id: 'sp-maxMessages', min: 1,   max: 20  },
      { id: 'sp-fontSize',    min: 11,  max: 26  },
      { id: 'sp-maxWidth',    min: 220, max: 480 },
      { id: 'sp-chatHeight',  min: 200, max: 900 },
      { id: 'sp-badgeSize',   min: 14,  max: 24  },
      { id: 'sp-animDuration',min: 0.1, max: 1.0 },
      { id: 'sp-fadeAfter',   min: 0,   max: 60  },
    ];

    let valid = true;

    // Channel must not be empty
    const channelEl = get('sp-channel');
    if (!channelEl.value.trim()) {
      channelEl.classList.add('sp-input-error');
      valid = false;
    }

    numChecks.forEach(({ id, min, max }) => {
      const el = get(id);
      const val = parseFloat(el.value);
      if (isNaN(val) || val < min || val > max) {
        el.classList.add('sp-input-error');
        valid = false;
      }
    });

    return valid;
  }

  // ─── Apply settings from form → cfg → CSS ─────────────────────────────────
  function applySettings(panel, previewOnly) {
    const cfg = window.OVERLAY_CONFIG;
    const get = (id) => panel.querySelector('#' + id);

    const prevChannel = cfg.channel;

    cfg.channel          = get('sp-channel').value.trim().toLowerCase() || cfg.channel;
    cfg.maxMessages       = clamp(parseInt(get('sp-maxMessages').value) || 10, 1, 20);
    cfg.fontSize          = clamp(parseFloat(get('sp-fontSize').value)  || 14, 11, 26)  + 'px';
    cfg.maxWidth          = clamp(parseFloat(get('sp-maxWidth').value)   || 340, 220, 480) + 'px';
    cfg.chatHeight        = clamp(parseFloat(get('sp-chatHeight').value) || 600, 200, 900) + 'px';
    cfg.badgeSize         = clamp(parseFloat(get('sp-badgeSize').value)  || 18, 14, 24)  + 'px';
    cfg.animationDuration = clamp(parseFloat(get('sp-animDuration').value) || 0.3, 0.1, 1.0).toFixed(2) + 's';
    cfg.fadeMessageAfter  = clamp(parseFloat(get('sp-fadeAfter').value)  || 0,   0,  60);
    cfg.position         = get('sp-position').value;
    cfg.messageColor     = get('sp-messageColor').value;
    cfg.usernameColor    = get('sp-usernameColor').value;
    cfg.mentionColor     = get('sp-mentionColor').value;
    cfg.backgroundColor  = toRgba(get('sp-bgColor').value, parseInt(get('sp-bgOpacity').value));
    cfg.showBadges          = get('sp-showBadges').checked;
    cfg.showTimestamps      = get('sp-showTimestamps').checked;
    cfg.highlightMentions   = get('sp-highlightMentions').checked;
    cfg.textShadow          = get('sp-textShadow').checked;
    cfg.showAlerts          = get('sp-showAlerts').checked;

    // Apply CSS vars live
    if (window.overlayAPI) window.overlayAPI.applyConfigToCSS();

    // Apply non-CSS settings to existing messages immediately
    applyToExistingMessages(cfg);

    // Update position classes on chat container, gear, and panel
    const gearBtn = document.getElementById('gear-btn');
    const chatContainer = document.getElementById('chat-container');
    const pos = validPos(cfg.position);
    VALID_POSITIONS.forEach(p => {
      gearBtn.classList.toggle(p, p === pos);
      panel.classList.toggle(p, p === pos);
      chatContainer && chatContainer.classList.toggle(p, p === pos);
    });

    if (!previewOnly) {
      persistConfig(cfg);
      if (cfg.channel !== prevChannel && window.overlayAPI) {
        window.overlayAPI.connect();
      }
    }
  }

  // ─── Sync form to current cfg when panel is opened ─────────────────────────
  function populateForm(panel) {
    const cfg = window.OVERLAY_CONFIG;
    const bg  = parseRgba(cfg.backgroundColor);
    const set = (id, val) => {
      const el = panel.querySelector('#' + id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = val;
    };

    set('sp-channel',          cfg.channel);
    set('sp-maxMessages',      cfg.maxMessages);
    set('sp-fontSize',         stripUnit(cfg.fontSize));
    set('sp-maxWidth',         stripUnit(cfg.maxWidth));
    set('sp-chatHeight',       stripUnit(cfg.chatHeight || '600px'));
    set('sp-badgeSize',        stripUnit(cfg.badgeSize));
    set('sp-animDuration',     stripUnit(cfg.animationDuration));
    set('sp-fadeAfter',        cfg.fadeMessageAfter);
    set('sp-position',         cfg.position);
    set('sp-messageColor',     cfg.messageColor);
    set('sp-usernameColor',    cfg.usernameColor);
    set('sp-mentionColor',     cfg.mentionColor);
    set('sp-bgColor',          bg.hex);
    set('sp-bgOpacity',        bg.alpha);
    set('sp-showBadges',       cfg.showBadges);
    set('sp-showTimestamps',   cfg.showTimestamps);
    set('sp-highlightMentions',cfg.highlightMentions);
    set('sp-textShadow',       cfg.textShadow);
    set('sp-showAlerts',       cfg.showAlerts);

    const opacityVal = panel.querySelector('#sp-bg-opacity-val');
    if (opacityVal) opacityVal.textContent = bg.alpha + '%';
  }

  // ─── Apply non-CSS settings to existing DOM messages ──────────────────────
  function applyToExistingMessages(cfg) {
    const container = document.getElementById('chat-container');
    if (!container) return;
    const dur = parseFloat(cfg.animationDuration) * 1000 || 300;

    // Show / hide badges on existing messages
    container.querySelectorAll('.badges').forEach(el => {
      el.style.display = cfg.showBadges ? '' : 'none';
    });

    // Show / hide timestamps on existing messages
    container.querySelectorAll('.timestamp').forEach(el => {
      el.style.display = cfg.showTimestamps ? '' : 'none';
    });

    // Highlight mentions — remove or re-apply on existing messages
    if (!cfg.highlightMentions) {
      container.querySelectorAll('.highlight-mention').forEach(el => {
        el.classList.remove('highlight-mention');
      });
    } else {
      const channelLower = cfg.channel.toLowerCase();
      container.querySelectorAll('.chat-message').forEach(msgEl => {
        const textEl = msgEl.querySelector('.message-text');
        if (textEl && textEl.textContent.toLowerCase().includes('@' + channelLower)) {
          msgEl.classList.add('highlight-mention');
        }
      });
    }

    // Trim excess messages when maxMessages is reduced (skip already-removing ones)
    const msgs = [...container.querySelectorAll('.chat-message:not(.removing)')];
    const excess = msgs.length - cfg.maxMessages;
    for (let i = 0; i < excess; i++) {
      const el = msgs[i];
      el.classList.add('removing');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, dur);
    }

    // Apply fade timer to existing messages if fadeMessageAfter was just enabled
    if (cfg.fadeMessageAfter > 0) {
      container.querySelectorAll('.chat-message:not(.removing)').forEach(el => {
        setTimeout(() => {
          el.classList.add('removing');
          setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, dur);
        }, cfg.fadeMessageAfter * 1000);
      });
    }
  }

  // ─── Persist to localStorage ───────────────────────────────────────────────
  function persistConfig(cfg) {
    const toSave = {
      channel: cfg.channel, maxMessages: cfg.maxMessages,
      fontSize: cfg.fontSize, fontFamily: cfg.fontFamily,
      messageColor: cfg.messageColor, usernameColor: cfg.usernameColor,
      backgroundColor: cfg.backgroundColor, badgeSize: cfg.badgeSize,
      animationDuration: cfg.animationDuration, showBadges: cfg.showBadges,
      showTimestamps: cfg.showTimestamps, highlightMentions: cfg.highlightMentions,
      mentionColor: cfg.mentionColor, fadeMessageAfter: cfg.fadeMessageAfter,
      textShadow: cfg.textShadow, maxWidth: cfg.maxWidth, chatHeight: cfg.chatHeight, position: cfg.position,
      showAlerts: cfg.showAlerts,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave)); } catch (e) {}
  }

  // ─── Build panel HTML ──────────────────────────────────────────────────────
  function buildPanelHTML(cfg) {
    const bg  = parseRgba(cfg.backgroundColor);
    const pos = validPos(cfg.position);

    return `
      <div class="sp-header">
        <span class="sp-title">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
          </svg>
          Chat Settings
        </span>
        <button class="sp-close-btn" id="sp-close" title="Close">
          <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>

      <div class="sp-body">

        <div class="sp-section">
          <div class="sp-section-label">Connection</div>
          <div class="sp-field">
            <label class="sp-label" for="sp-channel">Channel</label>
            <input class="sp-input" type="text" id="sp-channel"
              value="${esc(cfg.channel)}" placeholder="channel name"
              autocomplete="off" spellcheck="false">
          </div>
        </div>

        <div class="sp-section">
          <div class="sp-section-label">Display</div>
          <div class="sp-row">
            <div class="sp-field sp-field-half">
              <label class="sp-label" for="sp-maxMessages">Max messages</label>
              <input class="sp-input" type="number" id="sp-maxMessages"
                value="${cfg.maxMessages}" min="1" max="20">
              <span class="sp-hint">1 – 20</span>
            </div>
            <div class="sp-field sp-field-half">
              <label class="sp-label" for="sp-fontSize">Font size</label>
              <div class="sp-input-unit">
                <input class="sp-input" type="number" id="sp-fontSize"
                  value="${stripUnit(cfg.fontSize)}" min="11" max="26">
                <span class="sp-unit">px</span>
              </div>
              <span class="sp-hint">11 – 26 px</span>
            </div>
          </div>
          <div class="sp-row">
            <div class="sp-field sp-field-half">
              <label class="sp-label" for="sp-maxWidth">Chat width</label>
              <div class="sp-input-unit">
                <input class="sp-input" type="number" id="sp-maxWidth"
                  value="${stripUnit(cfg.maxWidth)}" min="220" max="480">
                <span class="sp-unit">px</span>
              </div>
              <span class="sp-hint">220 – 480 px</span>
            </div>
            <div class="sp-field sp-field-half">
              <label class="sp-label" for="sp-chatHeight">Chat height</label>
              <div class="sp-input-unit">
                <input class="sp-input" type="number" id="sp-chatHeight"
                  value="${stripUnit(cfg.chatHeight || '600px')}" min="200" max="900">
                <span class="sp-unit">px</span>
              </div>
              <span class="sp-hint">200 – 900 px</span>
            </div>
          </div>
          <div class="sp-row">
            <div class="sp-field sp-field-half">
              <label class="sp-label" for="sp-badgeSize">Badge size</label>
              <div class="sp-input-unit">
                <input class="sp-input" type="number" id="sp-badgeSize"
                  value="${stripUnit(cfg.badgeSize)}" min="14" max="24">
                <span class="sp-unit">px</span>
              </div>
              <span class="sp-hint">14 – 24 px</span>
            </div>
          </div>
          <div class="sp-field">
            <label class="sp-label" for="sp-position">Position</label>
            <select class="sp-select" id="sp-position">
              ${VALID_POSITIONS.map(p =>
                `<option value="${p}"${p === pos ? ' selected' : ''}>${p.replace('-', ' ')}</option>`
              ).join('')}
            </select>
          </div>
        </div>

        <div class="sp-section">
          <div class="sp-section-label">Colors</div>
          <div class="sp-color-row">
            <label class="sp-label" for="sp-messageColor">Message text</label>
            <input type="color" class="sp-color-input" id="sp-messageColor" value="${cfg.messageColor}">
          </div>
          <div class="sp-color-row">
            <label class="sp-label" for="sp-usernameColor">Username (default)</label>
            <input type="color" class="sp-color-input" id="sp-usernameColor" value="${cfg.usernameColor}">
          </div>
          <div class="sp-color-row">
            <label class="sp-label" for="sp-mentionColor">Mention highlight</label>
            <input type="color" class="sp-color-input" id="sp-mentionColor" value="${cfg.mentionColor}">
          </div>
          <div class="sp-field">
            <label class="sp-label">Background</label>
            <div class="sp-row" style="gap:10px;align-items:flex-end">
              <div style="flex:0 0 auto">
                <span class="sp-sublabel">Color</span>
                <input type="color" class="sp-color-input" id="sp-bgColor"
                  value="${bg.hex}" style="width:52px;height:30px;display:block">
              </div>
              <div style="flex:1;min-width:0">
                <span class="sp-sublabel">
                  Opacity&nbsp;<span id="sp-bg-opacity-val">${bg.alpha}%</span>
                </span>
                <input type="range" class="sp-range" id="sp-bgOpacity"
                  min="0" max="100" value="${bg.alpha}">
              </div>
            </div>
          </div>
        </div>

        <div class="sp-section">
          <div class="sp-section-label">Features</div>
          ${toggle('sp-showBadges',        'Show badges',        cfg.showBadges)}
          ${toggle('sp-showTimestamps',    'Show timestamps',    cfg.showTimestamps)}
          ${toggle('sp-highlightMentions', 'Highlight mentions', cfg.highlightMentions)}
          ${toggle('sp-textShadow',        'Text shadow',        cfg.textShadow)}
          <div class="sp-field" style="margin-top:2px">
            <label class="sp-label" for="sp-fadeAfter">Fade messages after (0 = never)</label>
            <div class="sp-input-unit">
              <input class="sp-input" type="number" id="sp-fadeAfter"
                value="${cfg.fadeMessageAfter}" min="0" max="60" step="1">
              <span class="sp-unit">s</span>
            </div>
            <span class="sp-hint">0 – 60 s</span>
          </div>
        </div>

        <div class="sp-section">
          <div class="sp-section-label">Animation</div>
          <div class="sp-field">
            <label class="sp-label" for="sp-animDuration">Slide-in duration</label>
            <div class="sp-input-unit">
              <input class="sp-input" type="number" id="sp-animDuration"
                value="${stripUnit(cfg.animationDuration)}" min="0.1" max="1.0" step="0.05">
              <span class="sp-unit">s</span>
            </div>
            <span class="sp-hint">0.1 – 1.0 s</span>
          </div>
        </div>

        <div class="sp-section">
          <div class="sp-section-label">Alerts</div>
          ${toggle('sp-showAlerts', 'Show sub / raid alerts', cfg.showAlerts !== false)}
          <div class="sp-field" style="margin-top:6px">
            <span class="sp-label" style="margin-bottom:6px;display:block">Preview alerts</span>
            <div class="sp-alert-btns">
              <button class="sp-alert-btn sp-alert-btn--sub"     data-alert="sub">⭐ Sub</button>
              <button class="sp-alert-btn sp-alert-btn--sub"     data-alert="resub">⭐ Resub</button>
              <button class="sp-alert-btn sp-alert-btn--gift"    data-alert="gift">🎁 Gift</button>
              <button class="sp-alert-btn sp-alert-btn--gift"    data-alert="mystery">🎁 Mystery</button>
              <button class="sp-alert-btn sp-alert-btn--raid"    data-alert="raid">🚀 Raid</button>
            </div>
          </div>
        </div>

      </div>

      <div class="sp-footer">
        <button class="sp-apply-btn" id="sp-apply">Apply Changes</button>
      </div>
    `;
  }

  function toggle(id, label, checked) {
    return `
      <label class="sp-toggle">
        <input type="checkbox" class="sp-toggle-input" id="${id}"${checked ? ' checked' : ''}>
        <span class="sp-toggle-track"><span class="sp-toggle-thumb"></span></span>
        <span class="sp-toggle-label">${label}</span>
      </label>`;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

  function validPos(p) {
    return VALID_POSITIONS.includes(p) ? p : 'bottom-left';
  }

  function stripUnit(val) {
    return parseFloat(String(val)) || 0;
  }

  function parseRgba(str) {
    const m = String(str).match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
    if (!m) return { hex: '#000000', alpha: 50 };
    const hex = '#' + [m[1], m[2], m[3]]
      .map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
    const alpha = m[4] !== undefined ? Math.round(parseFloat(m[4]) * 100) : 100;
    return { hex, alpha };
  }

  function toRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${(alpha / 100).toFixed(2)})`;
  }

  function esc(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();
