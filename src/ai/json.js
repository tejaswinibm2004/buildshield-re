// Tolerant JSON extraction: finds first {...} or [...] block, repairs common issues, one retry.
export function extractJson(text) {
  if (!text) throw new Error('Empty model response');
  // strip code fences
  let t = String(text).replace(/```(?:json)?/gi, '```').replace(/```/g, ' ');
  // try direct parse
  try { return JSON.parse(t); } catch {}
  const start = t.search(/[{[]/);
  if (start === -1) throw new Error('No JSON found in model response');
  for (let end = t.length; end > start; end--) {
    const slice = t.slice(start, end);
    try { return JSON.parse(slice); } catch {}
    // repair trailing commas
    try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); } catch {}
  }
  throw new Error('Could not parse JSON from model response');
}
