import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatJson } from '../ai/provider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM = fs.readFileSync(path.join(__dirname, '../ai/prompts/critic.md'), 'utf8');

export async function critique({ report, snippet, diff, chatJsonFn = chatJson }) {
  const user = `<<<REPORT (untrusted)>>>\n${report.title}\n${report.description.slice(0, 1500)}\n<<<END>>>\n\n<<<ORIGINAL>>>${String(snippet).slice(0, 6000)}\n<<<END>>>\n\n<<<DIFF>>>\n${String(diff).slice(0, 8000)}\n<<<END>>>\nSTRICT JSON verdict only.`;
  const r = await chatJsonFn({ system: SYSTEM, user, maxTokens: 800 });
  const v = ['approve', 'concern', 'reject'].includes(r.data.verdict) ? r.data.verdict : 'concern';
  return { verdict: v, concerns: Array.isArray(r.data.concerns) ? r.data.concerns : [], _raw: (r.raw ?? '').slice(0, 2000) };
}
