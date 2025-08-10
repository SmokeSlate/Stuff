// ==UserScript==
// @name         BeatSaver Batch Sender (Userscripts/Safari)
// @version      1.1
// @description  Fetch playlist -> split into 100s -> manual JSON POSTs to BeatSaver API (uses fetch; no GM APIs)
// @match        https://beatsaver.com/*
// @match        https://www.beatsaver.com/*
// @run-at       document-idle
// ==/UserScript==

(() => {
  const css = `
    #bs-open-btn{position:fixed;right:12px;bottom:12px;z-index:2147483000;padding:10px 12px;border:1px solid #2a5bd7;
      background:#3b82f6;color:#fff;border-radius:999px;font:14px/1.2 system-ui,-apple-system,Segoe UI,Arial;cursor:pointer}
    #bs-open-btn:hover{filter:brightness(.95)}
    #bs-wrap{position:fixed;right:10px;bottom:60px;z-index:2147483001;width:min(640px,92vw);max-height:80vh;overflow:auto;background:#fff;
      border:1px solid #cdd5df;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.15);font:13px/1.45 system-ui,-apple-system,Segoe UI,Arial;display:none}
    #bs-wrap h3{margin:0;padding:10px 12px;border-bottom:1px solid #eef;display:flex;justify-content:space-between;align-items:center}
    #bs-wrap .pad{padding:10px 12px}
    #bs-wrap .row{display:flex;gap:8px;align-items:center;margin:6px 0}
    #bs-wrap input[type="text"]{flex:1;padding:6px 8px;border:1px solid #c7cdd8;border-radius:6px}
    #bs-wrap .batch{border:1px solid #e6e9ef;border-radius:8px;margin:8px 0;padding:8px 10px}
    #bs-wrap button{padding:6px 10px;border:1px solid #99a;border-radius:6px;background:#f5f7fb;cursor:pointer}
    #bs-wrap pre{background:#f6f8fa;padding:8px;border-radius:6px;overflow:auto;max-height:200px}
    #bs-log{white-space:pre-wrap;background:#0b1020;color:#cfe3ff;border-radius:6px;padding:8px;margin-top:8px;max-height:160px;overflow:auto}
    #bs-close{background:#eee;border:1px solid #aaa;border-radius:6px;padding:4px 8px;cursor:pointer}
    #bs-small{color:#667}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const chunk = (a, n) => { const out=[]; for (let i=0;i<a.length;i+=n) out.push(a.slice(i,i+n)); return out; };
  const dedupe = a => Array.from(new Set(a));
  const isPlaylist = () => /\/playlists\/id\/([^/?#]+)/i.test(location.pathname);
  const getPid = () => (location.pathname.match(/\/playlists\/id\/([^/?#]+)/i)||[])[1] || '';
  const log = s => { const el = document.getElementById('bs-log'); if (el){ el.textContent += s+'\n'; el.scrollTop = el.scrollHeight; } console.log('[BeatBatch]', s); };

  function ensurePanel() {
    let wrap = document.getElementById('bs-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'bs-wrap';
      wrap.innerHTML = `
        <h3><span>BeatSaver Batch Sender</span><button id="bs-close" type="button">Close</button></h3>
        <div class="pad">
          <div class="row">
            <label>Playlist ID:</label>
            <input id="bs-playlist" type="text" placeholder="e.g. 658586">
          </div>
          <div class="row">
            <label>OAuth Bearer (optional):</label>
            <input id="bs-token" type="text" placeholder="eyJhbGciOi...">
          </div>
          <div id="bs-small" class="row">Loads songs → splits in 100 → manual JSON requests.</div>
          <div class="row">
            <button id="bs-load" type="button">Load songs</button>
          </div>
          <div id="bs-summary" class="row" style="font-weight:600"></div>
          <div id="bs-list"></div>
          <div id="bs-log"></div>
        </div>`;
      document.body.appendChild(wrap);
      document.getElementById('bs-close').onclick = () => wrap.style.display = 'none';
    }
    return wrap;
  }

  function ensureOpener() {
    let btn = document.getElementById('bs-open-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'bs-open-btn';
      btn.textContent = 'Open Batch Sender';
      btn.onclick = openPanel;
      document.body.appendChild(btn);
    }
  }

  function openPanel() {
    const wrap = ensurePanel();
    const pidInput = wrap.querySelector('#bs-playlist');
    if (!pidInput.value) pidInput.value = getPid();
    wrap.style.display = 'block';
  }

  async function getJSON(url) {
    const res = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'omit', mode: 'cors' });
    if (!res.ok) throw new Error(`GET ${res.status} ${url}`);
    return res.json();
  }

  async function postJSON(url, body, token) {
    const headers = { 'accept': 'application/json', 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit', mode: 'cors' });
    let data = null; try { data = await res.json(); } catch { data = await res.text(); }
    return { ok: res.ok, status: res.status, data };
  }

  async function loadSongsAndBuild() {
    const pid = document.getElementById('bs-playlist').value.trim();
    if (!pid) { alert('Enter a playlist ID'); return; }

    log(`Fetching playlist meta for ${pid}…`);
    const meta = await getJSON(`https://api.beatsaver.com/playlists/id/${encodeURIComponent(pid)}`);

    let songs = Array.isArray(meta.songs) ? meta.songs : null;
    if (!songs) {
      const dl = meta?.playlist?.downloadURL || meta?.downloadURL || meta?.playlistDownloadURL || meta?.downloadUrl;
      if (!dl) throw new Error('No downloadURL in playlist meta');
      log(`Fetching playlist JSON from downloadURL…`);
      const dlJson = await getJSON(dl);
      songs = dlJson?.songs || dlJson?.playlist?.songs || [];
    }
    if (!Array.isArray(songs) || songs.length === 0) throw new Error('No songs found');

    const keys = dedupe(songs.map(s => String(s.key || s.id || '').trim()).filter(Boolean));
    const hashes = dedupe(
      songs.map(s => String(s.hash || s.sha1 || '').trim().toLowerCase())
           .filter(h => /^[0-9a-f]{40}$/.test(h))
    );

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
        try {
          log(`Sending batch ${i+1}…`);
          const res = await postJSON(url, body, token);
          log(`Batch ${i+1}: HTTP ${res.status} ${res.ok ? '✅' : '❌'} ${typeof res.data==='string'?res.data:JSON.stringify(res.data)}`);
        } catch (e) {
          log(`Batch ${i+1}: ❌ ${e.message}`);
        } finally {
          btn.disabled = false;
        }
      });
      list.appendChild(box);
    }
  }

  // Wire UI actions
  document.addEventListener('click', (e) => {
    const loadBtn = document.getElementById('bs-load');
    if (loadBtn && e.target === loadBtn) {
      (async () => { try { await loadSongsAndBuild(); } catch (err) { log('❌ ' + err.message); alert(err.message); } })();
    }
  });

  // Add opener button; auto-open on playlist pages
  ensureOpener();
  if (isPlaylist()) openPanel();
})();