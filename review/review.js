const el = id => document.getElementById(id);
const text = (tag, value, className) => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};

async function init() {
  const response = await fetch('/review/data.json');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Evidence unavailable');
  if (data.recorded !== true || data.packMatchesExactly !== true) throw new Error('Recorded pack could not be verified');
  el('score').replaceChildren();
  for (const [label, value, detail] of [
    ['Recorded replay', `${data.before.passedScenarios}/${data.before.totalScenarios} → ${data.after.passedScenarios}/${data.after.totalScenarios}`, 'scenarios passing'],
    ['Failures resolved', String(data.comparison.assertionsFixed), 'measured assertions'],
    ['Regressions', String(data.comparison.assertionsRegressed), 'measured assertions'],
    ['Identical pack', 'HASH VERIFIED', data.packHash],
  ]) {
    const metric = text('div', '', 'metric');
    metric.append(text('small', label), text('strong', value), text(label === 'Identical pack' ? 'code' : 'span', detail));
    el('score').append(metric);
  }
  const recorded = new Date(data.completedAt).toISOString().replace('T', ' ').slice(0,19) + ' UTC';
  const buttons = new Map();
  function show(item) {
    el('case-title').textContent = item.name;
    el('viewport').textContent = `${item.viewport.width}×${item.viewport.height}px · ${data.browser} · recorded ${recorded}`;
    for (const target of ['before', 'after']) {
      const status = item[`${target}Status`];
      el(`${target}-status`).textContent = status.toUpperCase();
      el(`${target}-status`).className = status;
      el(`${target}-image`).src = item[`${target}Image`];
      el(`${target}-image`).alt = `Actual recorded ${target} Chromium capture: ${item.name}`;
    }
    el('assertions').replaceChildren();
    for (const rule of item.assertions) {
      const box = text('div', '', 'assertion');
      const status = text('span', `${rule.beforeStatus.toUpperCase()} → ${rule.afterStatus.toUpperCase()}`, `statuses ${rule.afterStatus}`);
      box.append(status, text('strong', rule.label || rule.assertionLabel || rule.assertionId));
      box.append(text('p', `Before: ${rule.beforeSummary}`), text('p', `After: ${rule.afterSummary}`));
      el('assertions').append(box);
    }
    for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(id === item.id));
  }
  for (const item of data.cases) {
    const button = text('button', '', 'case-button');
    button.type = 'button';
    button.append(text('span', `${item.beforeStatus.toUpperCase()} → ${item.afterStatus.toUpperCase()}`, item.afterStatus), text('div', item.name), text('small', `${item.viewport.width}×${item.viewport.height}px · ${item.outcome.replaceAll('_',' ')}`));
    button.addEventListener('click', () => show(item));
    buttons.set(item.id, button); el('cases').append(button);
  }
  el('diff').textContent = data.diff;
  el('receipts').textContent = JSON.stringify(data.receipts, null, 2);
  show(data.cases.find(item => item.beforeStatus === 'fail') || data.cases[0]);
}
init().catch(error => {
  el('score').replaceChildren(text('p', `${error.message}. Open the public repository to inspect the archived evidence.`, 'metric fail'));
});
