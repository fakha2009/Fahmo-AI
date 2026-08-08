const routes = [];
let cleanup = null;
let beforeNavigate = null;

export function registerRoute(pattern, loader, options = {}) {
  const keys = [];
  const expression = new RegExp(`^${pattern.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  })}/?$`);
  routes.push({ expression, keys, loader, title: options.title });
}

export function setBeforeNavigate(callback) { beforeNavigate = callback; }

export async function navigate(path, options = {}) {
  const target = new URL(path, location.origin);
  if (target.origin !== location.origin) {
    location.href = target.href;
    return;
  }
  if (beforeNavigate && !await beforeNavigate(target.pathname)) return;
  if (options.replace) history.replaceState(options.state ?? {}, '', target.pathname + target.search + target.hash);
  else history.pushState(options.state ?? {}, '', target.pathname + target.search + target.hash);
  await renderRoute();
}

export async function renderRoute() {
  cleanup?.();
  cleanup = null;
  const path = location.pathname;
  for (const route of routes) {
    const match = path.match(route.expression);
    if (!match) continue;
    const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]));
    const result = await route.loader({ params, search: new URLSearchParams(location.search), path });
    cleanup = typeof result === 'function' ? result : result?.cleanup ?? null;
    if (result?.title) document.title = `${result.title} — Fahmo AI`;
    return;
  }
  const fallback = routes.find((route) => route.expression.test('/not-found'));
  if (fallback) await fallback.loader({ params: {}, search: new URLSearchParams(), path });
}

export function initRouter() {
  addEventListener('popstate', renderRoute);
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-router]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = new URL(link.href, location.origin);
    if (target.origin !== location.origin) return;
    event.preventDefault();
    navigate(target.pathname + target.search + target.hash);
  });
  return renderRoute();
}
