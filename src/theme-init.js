(() => {
  try {
    const stored = localStorage.getItem('fahmo:theme') || 'system';
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const dark = stored === 'dark' || (stored === 'system' && Boolean(media?.matches));
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themePreference = stored;

    const parsedScale = Number(localStorage.getItem('fahmo:text-scale') || '100');
    const safeScale = Number.isFinite(parsedScale) && parsedScale >= 90 && parsedScale <= 130 ? parsedScale : 100;
    document.documentElement.style.setProperty('--text-scale', String(safeScale / 100));

    if (localStorage.getItem('fahmo:reduce-motion') === 'true') {
      document.documentElement.dataset.reduceMotion = 'true';
    }
  } catch {
    // Storage may be unavailable in hardened/private browser contexts. Defaults remain usable.
  }
})();
