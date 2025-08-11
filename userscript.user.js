// ==UserScript==
// @name         BeatSaver BMSESSIONID Copier
// @match        https://beatsaver.com/*
// @run-at       document-idle
// ==/UserScript==
(function () {
  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function makeBtn() {
    const btn = document.createElement('button');
    btn.textContent = 'Copy BMSESSIONID';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '12px', right: '12px',
      padding: '8px 10px', zIndex: 999999, borderRadius: '6px',
      border: '1px solid #888', background: '#fff', cursor: 'pointer', fontSize: '12px'
    });
    btn.addEventListener('click', async () => {
      const v = getCookie('BMSESSIONID');
      if (!v) { btn.textContent = 'Not logged in'; return; }
      try { await navigator.clipboard.writeText(v); btn.textContent = 'Copied!'; }
      catch { console.log('BMSESSIONID =', v); btn.textContent = 'Copied to console'; }
      setTimeout(() => (btn.textContent = 'Copy BMSESSIONID'), 1500);
    });
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', makeBtn);
  } else {
    makeBtn();
  }
})();