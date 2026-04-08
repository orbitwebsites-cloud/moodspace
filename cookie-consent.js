// ============================================================
// cookie-consent.js — MoodSpace Cookie Consent Banner
// Inject this script on every page. It auto-shows the banner
// on first visit and remembers the user's choice in localStorage.
// ============================================================

(function () {
  const CONSENT_KEY = 'ms-cookie-consent'

  // Already decided — do nothing
  if (localStorage.getItem(CONSENT_KEY)) return

  const banner = document.createElement('div')
  banner.id = 'cookie-banner'
  banner.innerHTML = `
    <div class="cc-inner">
      <div class="cc-text">
        <span class="cc-icon">🍪</span>
        <div>
          <strong>We use cookies</strong>
          <span>We use essential cookies to keep you logged in and remember your preferences. No tracking or advertising cookies — ever. <a href="/privacy.html" target="_blank">Learn more</a></span>
        </div>
      </div>
      <div class="cc-actions">
        <button id="cc-decline">Decline non-essential</button>
        <button id="cc-accept">Accept all</button>
      </div>
    </div>
  `

  const style = document.createElement('style')
  style.textContent = `
    #cookie-banner {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 9999;
      background: #fff;
      border-top: 1px solid rgba(0,0,0,0.09);
      box-shadow: 0 -4px 24px rgba(60,49,19,0.10);
      padding: 14px 20px;
      font-family: 'Be Vietnam Pro', sans-serif;
      animation: cc-slide-up 0.3s ease;
    }
    @keyframes cc-slide-up {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    .cc-inner {
      max-width: 900px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .cc-text {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      flex: 1;
      min-width: 240px;
    }
    .cc-icon { font-size: 1.4rem; flex-shrink: 0; margin-top: 2px; }
    .cc-text strong { display: block; font-size: 0.9rem; font-weight: 700; color: #221a10; margin-bottom: 2px; }
    .cc-text span { font-size: 0.82rem; color: #85736b; line-height: 1.5; }
    .cc-text a { color: #9b452e; }
    .cc-actions { display: flex; gap: 8px; flex-shrink: 0; }
    #cc-decline {
      padding: 8px 16px;
      background: transparent;
      border: 1.5px solid #e0d5cc;
      border-radius: 9999px;
      font-size: 0.82rem;
      font-weight: 600;
      font-family: 'Be Vietnam Pro', sans-serif;
      color: #85736b;
      cursor: pointer;
      transition: 0.15s ease;
    }
    #cc-decline:hover { border-color: #9b452e; color: #9b452e; }
    #cc-accept {
      padding: 8px 20px;
      background: #9b452e;
      border: none;
      border-radius: 9999px;
      font-size: 0.82rem;
      font-weight: 700;
      font-family: 'Be Vietnam Pro', sans-serif;
      color: #fff;
      cursor: pointer;
      transition: 0.15s ease;
    }
    #cc-accept:hover { background: #7d3621; }

    @media (max-width: 560px) {
      .cc-inner { flex-direction: column; }
      .cc-actions { width: 100%; }
      #cc-decline, #cc-accept { flex: 1; text-align: center; }
    }
  `

  document.head.appendChild(style)
  document.body.appendChild(banner)

  function dismiss(choice) {
    localStorage.setItem(CONSENT_KEY, choice)
    banner.style.transition = 'transform 0.25s ease, opacity 0.25s ease'
    banner.style.transform  = 'translateY(100%)'
    banner.style.opacity    = '0'
    setTimeout(() => banner.remove(), 300)
  }

  document.getElementById('cc-accept').addEventListener('click',  () => dismiss('accepted'))
  document.getElementById('cc-decline').addEventListener('click', () => dismiss('declined'))
})()
