import { config } from '../config.js';
import { extractJson } from './json.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function aiStatus() {
  if (!config.aiApiKey || !config.aiBaseUrl || !config.aiModel)
    return { configured: false, reason: 'AI key/base-url/model not configured (AI_UNAVAILABLE)' };
  return { configured: true, model: config.aiModel, baseUrl: config.aiBaseUrl };
}

// Deterministic fake provider for tests / offline eval.
export async function fakeChat(messages, schemaHint = '') {
  const last = messages[messages.length - 1]?.content ?? '';
  // Very small heuristic so benchmark can run offline.
  if (last.includes('LOCALIZE') || last.includes('choose up to 5 files')) {
    return { content: JSON.stringify({ files: [] }), fake: true };
  }
  return { content: JSON.stringify({ is_defect: false, confidence: 0.2, defect_type: 'other', explanation: 'fake provider: no key', user_visible_impact: '', needs_more_context: false, extra_files_needed: [] }), fake: true };
}

export async function chat({ system, user, maxTokens = 4000, temperature = 0.2, timeoutMs = 90000 }) {
  const st = aiStatus();
  if (!st.configured) {
    const err = new Error(st.reason);
    err.code = 'AI_UNAVAILABLE';
    throw err;
  }
  const url = config.aiBaseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: config.aiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  const backoffs = { 429: [2000, 5000, 15000], 500: [5000, 15000, 60000], 502: [5000, 15000, 60000], 503: [5000, 15000, 60000] };
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.aiApiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      if (res.ok) {
        const j = await res.json();
        const content = j.choices?.[0]?.message?.content ?? '';
        return { content, usage: j.usage ?? {}, model: j.model ?? config.aiModel };
      }
      if (backoffs[res.status] && attempt < 3) {
        await sleep(backoffs[res.status][attempt] ?? 5000);
        continue;
      }
      const err = new Error(`AI provider error ${res.status}`);
      err.code = 'AI_PROVIDER_ERROR';
      err.status = res.status;
      throw err;
    } catch (e) {
      lastErr = e;
      if (e.code === 'AI_PROVIDER_ERROR') throw e;
      if (attempt < 3) { await sleep([2000, 5000][attempt] ?? 5000); continue; }
      const err = new Error(`AI network error: ${e.message}`);
      err.code = 'AI_PROVIDER_ERROR';
      throw err;
    }
  }
  throw lastErr;
}

export async function chatJson({ system, user, ...opts }) {
  const r = await chat({ system, user, ...opts });
  try { return { data: extractJson(r.content), raw: r.content, usage: r.usage }; }
  catch (e) {
    // one repair retry: ask model to re-emit strict JSON
    const r2 = await chat({ system: system + '\nRe-emit ONLY strict JSON. No prose.', user: `Your previous reply was not valid JSON. Fix it:\n${r.content.slice(0, 4000)}`, ...opts });
    return { data: extractJson(r2.content), raw: r2.content, usage: r2.usage, repaired: true };
  }
}
