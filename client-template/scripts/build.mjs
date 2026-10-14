import fs from 'node:fs';
// Build: writes config.js from env + version.json with RENDER_GIT_COMMIT (proves fix is live).
const host = process.env.BUGSHIELD_HOST ?? '';
const appId = process.env.BUGSHIELD_APP_ID ?? '';
const key = process.env.BUGSHIELD_INGESTION_KEY ?? '';
fs.writeFileSync('config.js', `window.BUGSHIELD_CONFIG=${JSON.stringify({ host, appId, key })};\n`);
fs.writeFileSync('version.json', JSON.stringify({ commit: process.env.RENDER_GIT_COMMIT ?? 'local', builtAt: new Date().toISOString() }, null, 2));
console.log('built config.js + version.json');
