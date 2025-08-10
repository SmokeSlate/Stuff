// ==UserScript==
// @name         BeatSaver Batch Sender (auto-read playlist, manual JSON batches)
// @namespace    beat-batch
// @version      1.0
// @description  On BeatSaver playlist pages: fetch songs -> collect hashes/keys -> split in 100s -> manual submit buttons -> POST JSON to API (with optional OAuth)
// @match        https://beatsaver.com/*
// @match        https://www.beatsaver.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      api.beatsaver.com
// @connect      beatsaver.com
// @connect      www.beatsaver.com
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Styles ----------
  GM_addStyle(`
    #bs-wrap{position:fixed; right:10px; bottom:10px; z-index:999999;
      width:min(600px, 92vw); max-height:80vh; overflow:auto; background:#fff;
      border:1px solid #cdd5df; border-radius:10px; box-shadow:0 6px 24px rgba(0,0,0,.15);
      font:13px/1.45 system-ui, -apple-system, Segoe UI, Arial}
    #bs-wrap h3{margin:0; padding:10px 12px; border-bottom:1px solid #eef}
    #bs-wrap .pad{padding:10px 12px}
    #bs-wrap .row{display:flex; gap:8px; align-items:center; margin:6px 0}
    #bs-wrap input[type="text"]{flex:1; padding:6px 8px; border:1px solid #c7cdd8; border-radius:6px}
    #bs-wrap .batch{border:1px solid #e6e9ef; border-radius:8px; margin:8px 0; padding:8px 10px}
    #bs-wrap button{padding:6px 10px; border:1px solid #99a; border-radius:6px; background:#f5f7fb; cursor:pointer}
    #bs-wrap pre{background:#f6f8fa; padding:8px; border-radius:6px; overflow:auto}
    #bs-log{white-space:pre-wrap; background:#0b1020; color:#cfe3ff; border-radius:6px; padding:8px; margin-top:8px; max-height:160px; overflow:auto}
    #bs-small{color:#667}
  `);

  // ---------- Utils ----------
  const chunk = (a, n) => { const out=[]; for(let i=0;i<a.length;i+=n) out.push(a.slice(i,i+n)); return out; };
  const dedupe = a => Array.from(new Set(a));
  const isPlaylistPath = () => /\/playlists\/id\/([^/?#]+)/i.test(location.pathname);

  function getPlaylistIdFromURL() {
    const m = location.pathname.match(/\/playlists\/id\/([^/?#]+)/i);
    return m ? m[1] : '';
  }

  function httpGetJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        url,
        method: 'GET',
        headers: { 'accept': 'application/json' },
        onload: (res) => {
          try { resolve(JSON.parse(res.responseText)); }
          catch (e) { reject(new Error('Invalid JSON from ' + url)); }
        },
        onerror: () => reject(new Error('Network error GET ' + url)),
        ontimeout: () => reject(new Error('Timeout GET ' + url)),
        timeout: 60000
      });
    });
  }

  function gmPostJson(url, body, token) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        url,
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          ...(token ? { 'authorization': `Bearer ${token}` } : {})
        },
        data: JSON.stringify(body),
        onload: (res) => {
          let json; try { json = JSON.parse(res.responseText) } catch { json = res.responseText }
          resolve({ status: res.status, ok: res.status>=200 && res.status<300, json });
        },
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
        timeout: 60000
      });
    });
  }

  function log(msg) {
    const el = document.getElementById('bs-log');
    if (el) { el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight; }
    console.log('[BeatBatch]', msg);
  }

  // ---------- UI ----------
  function ensureUI() {
    let wrap = document.getElementById('bs-wrap');
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.id = 'bs-wrap';
    wrap.innerHTML = `
      <h3>BeatSaver Batch Sender</h3>
      <div class="pad">
        <div class="row">
          <label>Playlist ID:</label>
          <input id="bs-playlist" type="text" placeholder="e.g. 658586">
        </div>
        <div class="row">
          <label>OAuth Bearer (optional):</label>
          <input id="bs-token" type="text" placeholder="eyJhbGciOi...">
        </div>
        <div class="row" id="bs-small">Loads songs -> splits in 100 -> manual submit buttons (JSON requests, no CORS issues).</div>
        <div class="row">
          <button id="bs-load">Load songs</button>
        </div>
        <div id="bs-summary" class="row" style="font-weight:600"></div>
        <div id="bs-list"></div>
        <div id="bs-log"></div>
      </div>
    `;
    document.body.appendChild(wrap);
    return wrap;
  }

  async function loadSongsAndBuild() {
    const pid = document.getElementById('bs-playlist').value.trim();
    if (!pid) { alert('Enter a playlist ID'); return; }

    log(`Fetching playlist meta for ${pid}…`);
    // 1) GET playlist meta
    const meta = await httpGetJson(`https://api.beatsaver.com/playlists/id/${encodeURIComponent(pid)}`);

    // Try to find songs:
    // Some responses may already include an array of songs; otherwise follow downloadURL.
    let songs = Array.isArray(meta.songs) ? meta.songs : null;

    if (!songs) {
      const dl = meta?.playlist?.downloadURL || meta?.downloadURL || meta?.playlistDownloadURL || meta?.downloadUrl;
      if (!dl) throw new Error('No downloadURL found in playlist meta');
      log(`Fetching playlist JSON from downloadURL…`);
      const dlJson = await httpGetJson(dl);
      songs = dlJson?.songs || dlJson?.playlist?.songs || [];
    }
    if (!Array.isArray(songs) || songs.length === 0) {
      throw new Error('No songs found in playlist JSON');
    }

    // 2) Collect keys & hashes
    const keys = dedupe(songs.map(s => String(s.key || s.id || '').trim()).filter(Boolean));
    const hashes = dedupe(
      songs.map(s => String(s.hash || s.sha1 || '').trim().toLowerCase())
           .filter(h => /^[0-9a-f]{40}$/.test(h))
    );

    // 3) Build batches
    const H = chunk(hashes, 100);
    const K = chunk(keys,   100);
    const total = Math.max(H.length, K.length) || 1;

    document.getElementById('bs-summary').textContent =
      `Loaded ${hashes.length} hashes, ${keys.length} keys → ${total} batch(es) of 100.`;

    const list = document.getElementById('bs-list');
    list.innerHTML = '';

    for (let i = 0; i < total; i++) {
      const h = H[i] || [];
      const k = K[i] || [];
      const box = document.createElement('div');
      box.className = 'batch';
      box.innerHTML = `
        <div><b>Batch ${i+1}</b>: ${h.length} hashes, ${k.length} keys</div>
        <details style="margin:6px 0"><summary>Show payload</summary>
          <pre>${JSON.stringify({hashes:h, keys:k, ignoreUnknown:true, inPlaylist:true}, null, 2)}</pre>
        </details>
        <button type="button">Submit Batch</button>
      `;
      const btn = box.querySelector('button');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const token = document.getElementById('bs-token').value.trim();
        const url = `https://api.beatsaver.com/playlists/id/${encodeURIComponent(pid)}/batch`;
        const body = { hashes: h, keys: k, ignoreUnknown: true, inPlaylist: true };
        log(`Sending batch ${i+1}…`);
        try {
          const res = await gmPostJson(url, body, token);
          log(`Batch ${i+1}: HTTP ${res.status} ${res.ok ? '✅' : '❌'} ${typeof res.json==='string'?res.json:JSON.stringify(res.json)}`);
        } catch (e) {
          log(`Batch ${i+1}: ❌ ${e.message}`);
        } finally {
          btn.disabled = false;
        }
      });
      list.appendChild(box);
    }
  }

  // ---------- Boot ----------
  if (!isPlaylistPath()) return; // only show on playlist pages

  const wrap = ensureUI();
  const pidInput = wrap.querySelector('#bs-playlist');
  const loadBtn  = wrap.querySelector('#bs-load');

  // Pre-fill playlist id from URL
  pidInput.value = getPlaylistIdFromURL();
  loadBtn.addEventListener('click', () => {
    (async () => {
      try { await loadSongsAndBuild(); }
      catch (e) { log('❌ ' + e.message); alert(e.message); }
    })();
  });
})();