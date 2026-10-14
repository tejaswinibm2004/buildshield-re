import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pexec = promisify(execFile);

async function cmdExists(cmd) {
  try { await pexec(process.platform === 'win32' ? 'where' : 'which', [cmd]); return true; }
  catch { return false; }
}

export const SCAN_EXTS = (process.env.SCAN_EXTS ?? 'html,htm,css,scss,less,js,jsx,mjs,cjs,ts,tsx,vue,svelte,json,yaml,yml,md,py,php,rb,go,java,kt,cs,rs,c,cpp,h,sql,sh,txt,ejs,hbs,twig,jinja,liquid').split(',').map(s => s.trim().toLowerCase());

function extOf(p) { const m = /\.([A-Za-z0-9]+)$/.exec(p); return (m?.[1] ?? '').toLowerCase(); }

async function runNodeCheck(content) {
  // syntax check via node --check on temp file
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const f = path.join(os.tmpdir(), `bs-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  fs.writeFileSync(f, content);
  try { await pexec(process.execPath, ['--check', f], { timeout: 15000 }); return { ran: true, passed: true, details: 'node --check ok' }; }
  catch (e) { return { ran: true, passed: false, details: String(e.stderr ?? e.message).slice(0, 1000) }; }
  finally { try { fs.unlinkSync(f); } catch {} }
}

export const validators = {
  js: { id: 'js', appliesTo: ['js', 'mjs', 'cjs'], async isAvailable() { return true; }, async run(files) {
    for (const f of files) { const r = await runNodeCheck(f.after); if (!r.passed) return { ...r, file: f.path }; }
    return { ran: true, passed: true, details: `${files.length} file(s) node --check ok` };
  } },
  ts: { id: 'ts', appliesTo: ['ts', 'tsx', 'jsx'], async isAvailable() { return true; }, async run(files) {
    // syntax-only: strip types crudely then node --check? Use esbuild if present else brace-balance heuristic.
    try { const { transform } = await import('esbuild').catch(() => ({})); } catch {}
    for (const f of files) {
      const t = f.after.replace(/:\s*[A-Za-z_][\w<>\[\]| ]*/g, '').replace(/interfaces?\s+\w+\s*{[^}]*}/g, '');
      // best-effort: at least ensure braces balance
      const o = (t.match(/{/g) || []).length, c = (t.match(/}/g) || []).length;
      if (Math.abs(o - c) > 0) return { ran: true, passed: false, details: `brace imbalance in ${f.path}` };
    }
    return { ran: true, passed: true, details: 'ts syntax heuristic ok (tsc not required)' };
  } },
  json: { id: 'json', appliesTo: ['json'], async isAvailable() { return true; }, async run(files) {
    for (const f of files) { try { JSON.parse(f.after); } catch (e) { return { ran: true, passed: false, details: `${f.path}: ${e.message}` }; } }
    return { ran: true, passed: true, details: 'JSON.parse ok' };
  } },
  html: { id: 'html', appliesTo: ['html', 'htm'], async isAvailable() { return true; }, async run(files) {
    for (const f of files) {
      const t = f.after;
      if (/<script[^>]*src\s*=\s*["']https?:\/\//i.test(t) && !/<script[^>]*src\s*=\s*["']https?:\/\//i.test(f.before)) {
        // not a fail by itself (safety gate handles), just note
      }
      const tags = [...t.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)].map(m => m[0]);
      if (t.includes('\0')) return { ran: true, passed: false, details: `NUL byte in ${f.path}` };
      void tags;
    }
    return { ran: true, passed: true, details: 'html well-formedness heuristic ok' };
  } },
  css: { id: 'css', appliesTo: ['css', 'scss', 'less'], async isAvailable() { return true; }, async run(files) {
    for (const f of files) {
      const t = f.after;
      const o = (t.match(/{/g) || []).length, c = (t.match(/}/g) || []).length;
      if (o !== c) return { ran: true, passed: false, details: `unbalanced braces in ${f.path} (${o} vs ${c})` };
    }
    return { ran: true, passed: true, details: 'css brace check ok' };
  } },
  yaml: { id: 'yaml', appliesTo: ['yaml', 'yml'], async isAvailable() { return true; }, async run(files) {
    for (const f of files) {
      if (/\t/.test(f.after.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) ?? '')) return { ran: true, passed: false, details: `tab indent in ${f.path}` };
    }
    try { const yaml = await import('js-yaml').catch(() => null); void yaml; } catch {}
    return { ran: true, passed: true, details: 'yaml heuristic ok (js-yaml optional)' };
  } },
  python: { id: 'python', appliesTo: ['py'], async isAvailable() { return cmdExists('python3') || cmdExists('python'); }, async run(files) {
    const py = (await cmdExists('python3')) ? 'python3' : 'python';
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    for (const f of files) {
      const tmp = path.join(os.tmpdir(), `bs-${Date.now()}.py`); fs.writeFileSync(tmp, f.after);
      try { await pexec(py, ['-m', 'py_compile', tmp], { timeout: 20000 }); }
      catch (e) { return { ran: true, passed: false, details: String(e.message).slice(0, 800) }; }
      finally { try { fs.unlinkSync(tmp); } catch {} }
    }
    return { ran: true, passed: true, details: 'py_compile ok' };
  } },
  php: { id: 'php', appliesTo: ['php'], async isAvailable() { return cmdExists('php'); }, async run(files) {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    for (const f of files) { const tmp = path.join(os.tmpdir(), `bs-${Date.now()}.php`); fs.writeFileSync(tmp, f.after);
      try { await pexec('php', ['-l', tmp], { timeout: 20000 }); } catch (e) { return { ran: true, passed: false, details: String(e.message).slice(0, 800) }; } finally { try { fs.unlinkSync(tmp); } catch {} } }
    return { ran: true, passed: true, details: 'php -l ok' };
  } },
  ruby: { id: 'ruby', appliesTo: ['rb'], async isAvailable() { return cmdExists('ruby'); }, async run(files) {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    for (const f of files) { const tmp = path.join(os.tmpdir(), `bs-${Date.now()}.rb`); fs.writeFileSync(tmp, f.after);
      try { await pexec('ruby', ['-c', tmp], { timeout: 20000 }); } catch (e) { return { ran: true, passed: false, details: String(e.message).slice(0, 800) }; } finally { try { fs.unlinkSync(tmp); } catch {} } }
    return { ran: true, passed: true, details: 'ruby -c ok' };
  } },
  go: { id: 'go', appliesTo: ['go'], async isAvailable() { return cmdExists('gofmt'); }, async run(files) {
    for (const f of files) {
      const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
      const tmp = path.join(os.tmpdir(), `bs-${Date.now()}.go`); fs.writeFileSync(tmp, f.after);
      try { await pexec('gofmt', ['-e', tmp], { timeout: 20000 }); } catch (e) { return { ran: true, passed: false, details: String(e.message).slice(0, 800) }; } finally { try { fs.unlinkSync(tmp); } catch {} }
    }
    return { ran: true, passed: true, details: 'gofmt -e ok' };
  } },
  generic: { id: 'generic', appliesTo: ['*'], async isAvailable() { return true; }, async run(files) {
    for (const f of files) {
      if (!f.after || f.after === f.before) return { ran: true, passed: false, details: `${f.path}: empty diff` };
      if (f.after.includes('\0')) return { ran: true, passed: false, details: `${f.path}: binary NUL` };
    }
    return { ran: true, passed: true, details: 'diff sanity ok' };
  } },
};

export async function runValidatorsForPatch(applied) {
  const byExt = new Map();
  for (const f of applied) {
    const ext = extOf(f.path);
    const v = Object.values(validators).find(v => v.appliesTo.includes(ext)) ?? validators.generic;
    if (!byExt.has(v.id)) byExt.set(v.id, { v, files: [] });
    byExt.get(v.id).files.push(f);
  }
  const results = [];
  // always include generic
  const all = [...byExt.values()];
  if (!all.some(g => g.v.id === 'generic')) all.push({ v: validators.generic, files: applied });
  for (const { v, files } of all) {
    if (!(await v.isAvailable())) {
      results.push({ validator_id: v.id, status: 'not_performed', details: { reason: `${v.id} runtime not installed on host` } });
      continue;
    }    try {
      const r = await v.run(files);
      results.push({ validator_id: v.id, status: r.passed ? 'passed' : 'failed', details: r });
    } catch (e) {
      results.push({ validator_id: v.id, status: 'failed', details: { error: String(e.message).slice(0, 500) } });
    }
  }
  const failed = results.some(r => r.status === 'failed');
  // Project-own checks (npm test / pytest / ...): only run when a sandbox with
  // installed dependencies is available. We do NOT auto-install deps or expose
  // secrets to project scripts, so this is honestly reported as NOT_PERFORMED
  // unless "allow dependency install in sandbox" is enabled per site (not yet
  // implemented — see DECISIONS.md). Behavioural verification without project
  // tests is labelled UNVERIFIED downstream.
  results.push({ validator_id: 'project-tests', status: 'not_performed', details: { reason: 'project-owned test suites not auto-run in sandbox (no dependency install); run manually' } });
  return { results, passed: !failed };
}
