import crypto from 'node:crypto';

export function stripHtml(s) {
  return String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeReport({ title, description, steps }) {
  return {
    title: stripHtml(title).slice(0, 300),
    description: stripHtml(description).slice(0, 4000),
    steps: stripHtml(steps).slice(0, 2000),
  };
}

export function fingerprint({ keyHash, title, pagePath, firstError }) {
  const norm = `${keyHash}|${String(title).toLowerCase().trim()}|${pagePath}|${String(firstError || '').slice(0, 200)}`;
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 24);
}

export function extractHints({ title, description, steps, element, errors, network, page_url }) {
  const text = `${title}\n${description}\n${steps}`;
  const hints = { quoted: [], urls: [], selectors: [], errorMessages: [], stackFiles: [], identifiers: [] };
  for (const m of text.matchAll(/"([^"]{2,80})"|'([^']{2,80})'|`([^`]{2,80})`/g)) hints.quoted.push((m[1] ?? m[2] ?? m[3]).trim());
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) hints.urls.push(m[0].slice(0, 300));
  for (const m of text.matchAll(/[.#][A-Za-z_][\w-]*/g)) hints.selectors.push(m[0].slice(0, 80));
  for (const e of errors ?? []) {
    if (e.message) hints.errorMessages.push(String(e.message).slice(0, 300));
    const stack = String(e.stack ?? '');
    for (const m of stack.matchAll(/([A-Za-z0-9_./-]+\.(?:js|ts|jsx|tsx|py|php|rb|go|java|html|css|vue)):(\d+)/g))
      hints.stackFiles.push({ file: m[1].split('/').slice(-2).join('/'), line: +m[2] });
  }
  for (const n of network ?? []) if (n.status >= 400) hints.errorMessages.push(`HTTP ${n.status} ${n.url}`);
  if (element?.selector) hints.selectors.push(element.selector);
  if (element?.text) hints.quoted.push(String(element.text).slice(0, 120));
  try { hints.pagePath = new URL(page_url).pathname || '/'; } catch { hints.pagePath = String(page_url || '/').slice(0, 300); }
  // identifiers like camelCase / function names
  for (const m of text.matchAll(/\b[A-Za-z_$][\w$]{2,40}\b/g)) {
    const w = m[0];
    if (/^(the|and|for|with|from|this|that|page|site|when|click)$/i.test(w)) continue;
    if (hints.identifiers.length < 40) hints.identifiers.push(w);
  }
  return hints;
}
