// Lucide icons via CDN (UMD). icon(name, size) -> svg string; refresh() after render.
export function icon(name, size = 16) {
  return `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
}
let retried = false;
export function refreshIcons(root = document) {
  try {
    if (window.lucide?.createIcons) {
      window.lucide.createIcons({ attrs: { width: 16, height: 16 }, nameAttr: 'data-lucide' });
      return;
    }
  } catch { /* icons are decorative; never break the page */ }
  // CDN script (defer) may not have run yet — retry once on load + once late.
  if (!retried) {
    retried = true;
    window.addEventListener('load', () => refreshIcons(root));
    setTimeout(() => refreshIcons(root), 1500);
  }
}
