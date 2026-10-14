// Safety scanner on ADDED lines only. Any hit forces human approval.
const RULES = [
  { id: 'new-script', rx: /<\s*script/i, reason: 'adds <script>' },
  { id: 'inline-handler', rx: /\son\w+\s*=/i, reason: 'inline event handler' },
  { id: 'eval', rx: /\beval\s*\(|\bnew\s+Function\s*\(/i, reason: 'eval/Function' },
  { id: 'innerhtml-var', rx: /innerHTML|document\.write|outerHTML/i, reason: 'innerHTML/document.write' },
  { id: 'network', rx: /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|navigator\.sendBeacon/i, reason: 'new network call' },
  { id: 'url', rx: /https?:\/\/[^\s"']+/i, reason: 'new URL/domain' },
  { id: 'base64', rx: /[A-Za-z0-9+/=]{120,}/, reason: 'long base64/blob' },
  { id: 'credential', rx: /(password|secret|api[_-]?key|token)\s*[:=]/i, reason: 'credential/token handling' },
  { id: 'obfuscation', rx: /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){3,}|fromCharCode/i, reason: 'possible obfuscation' },
];

export function scanAddedLines(diffText) {
  const added = String(diffText ?? '').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const hits = [];
  for (const line of added) {
    for (const r of RULES) {
      if (r.rx.test(line)) hits.push({ rule: r.id, reason: r.reason, line: line.slice(0, 200) });
    }
  }
  // instruction-copied check: report text echoed into code (caller passes reportSnippet optionally)
  return hits;
}

export function instructionEchoCheck(diffText, reportText) {
  if (!reportText) return [];
  const words = String(reportText).split(/\W+/).filter(w => w.length >= 8).slice(0, 20);
  const hits = [];
  for (const w of words) {
    if (w && String(diffText).includes(w)) hits.push({ rule: 'echo', reason: `diff contains long word from report: ${w.slice(0, 40)}`, line: w });
  }
  return hits.slice(0, 5);
}
