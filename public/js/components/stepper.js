// Signature live-pipeline stepper (F-5). 8 nodes, click-to-evidence.
import { html, esc } from '../core/html.js';
import { icon } from '../core/icons.js';

const NODES = [
  { key: 'received', label: 'Received' },
  { key: 'locate', label: 'Locate code' },
  { key: 'analyze', label: 'Analyze' },
  { key: 'risk', label: 'Risk check' },
  { key: 'fix', label: 'Write fix' },
  { key: 'validate', label: 'Validate' },
  { key: 'approve', label: 'Approve' },
  { key: 'deploy', label: 'Deploy' },
  { key: 'live', label: 'Live' },
];
// Map pipeline_steps rows onto nodes. steps: [{name,status,...}]
export function nodeStates(steps, issueStatus) {
  const by = {};
  for (const s of steps) by[s.name] = s.status;
  const st = (n, okNames, opts = {}) => {
    if (by[n] === 'failed' || /fail|reject|invalid/.test(by[n] || '')) return 'failed';
    if (okNames.some(k => (by[k] || '').match(/ok|pass|approve|clean|paused|done/))) return 'done';
    return opts.default || 'pending';
  };
  const states = {
    received: 'done',
    locate: st('localizer', ['localizer']),
    analyze: st('analyzer', ['analyzer']),
    risk: st('risk', ['risk']),
    fix: st('patcher', ['patcher']),
    validate: st('validator', ['validator']),
    approve: 'pending',
    deploy: st('deployer', ['deployer']),
    live: st('verifier', ['verifier']),
  };
  if (issueStatus === 'AWAITING_APPROVAL') states.approve = 'human';
  else if (['APPROVED', 'PUSHING', 'DEPLOYING', 'RESOLVED_AND_DEPLOYED'].includes(issueStatus)) states.approve = 'done';
  else if (issueStatus === 'REJECTED_BY_ADMIN') states.approve = 'failed';
  if (['PUSHING', 'DEPLOYING'].includes(issueStatus)) states.deploy = 'active';
  if (issueStatus === 'RESOLVED_AND_DEPLOYED') { states.deploy = 'done'; states.live = 'done'; }
  if (issueStatus === 'DEPLOY_TIMEOUT') { states.deploy = 'done'; states.live = 'failed'; }
  if (issueStatus === 'ROLLED_BACK') states.live = 'failed';
  // first non-done node becomes active (unless a human gate or failure holds)
  let activated = false;
  for (const n of NODES) {
    if (states[n.key] === 'pending' && !activated && !['failed'].includes(states[n.key])) {
      const anyFailed = Object.values(states).includes('failed');
      if (!anyFailed && states.approve !== 'human') { states[n.key] = 'active'; activated = true; }
    }
  }
  return states;
}

export function stepper(steps, issueStatus, { onNode = null, nowLine = '' } = {}) {
  const states = nodeStates(steps, issueStatus);
  const dur = name => {
    const s = steps.find(x => x.name === name);
    if (!s?.started_at || !s?.finished_at) return '';
    const ms = new Date(s.finished_at) - new Date(s.started_at);
    return ms >= 0 && ms < 3600000 ? (ms / 1000).toFixed(1) + 's' : '';
  };
  const ball = st => {
    if (st === 'done') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path class="check-draw" d="M4 12.5l5 5L20 6.5"/></svg>`;
    if (st === 'failed') return icon('x');
    if (st === 'active') return `<span class="spin" style="display:inline-flex">${icon('loader')}</span>`;
    if (st === 'human') return icon('hand');
    return '';
  };
  let out = '<div class="stepper" role="list" aria-label="Fix pipeline">';
  NODES.forEach((n, i) => {
    const st = states[n.key];
    if (i > 0) {
      const prevDone = ['done'].includes(states[NODES[i - 1].key]);
      out += `<span class="plink${prevDone ? ' done' : ''}${st === 'active' ? ' live' : ''}" aria-hidden="true"></span>`;
    }
    out += `<button class="pnode ${st}" role="listitem" data-node="${n.key}" ${onNode ? '' : 'disabled'}
      aria-label="${n.label}: ${st}"><span class="ball">${ball(st)}</span>
      <span class="pl">${n.label}</span><span class="pc">${dur(n.key) || (st === 'human' ? 'waiting' : '')}</span></button>`;
  });
  out += '</div>';
  if (nowLine) out += `<div class="now-line"><span class="pdot pulse-dot" style="color:var(--accent-text);background:currentColor;width:6px;height:6px;border-radius:50%"></span><span>${esc(nowLine)}</span></div>`;
  return out;
}

export function wireStepper(root, onNode) {
  root.querySelectorAll('[data-node]').forEach(b => {
    if (b.disabled) return;
    b.onclick = () => onNode(b.dataset.node);
  });
}
