// Optional mounted-DOM checks, not a browser or authenticated deployment e2e.
// Install jsdom and esbuild in an isolated directory; supply their module URLs.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { JSDOM } = await import(process.env.TENANT_JSDOM_MODULE ?? 'jsdom');
const { build } = await import(process.env.TENANT_ESBUILD_MODULE ?? 'esbuild');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.invalid/tenant' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const result = await build({ stdin: {
  contents: `export {default as Workspace} from './app/tenant/workspace'; export {act, createElement} from 'react'; export {createRoot} from 'react-dom/client';`,
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx',
}, bundle: true, write: false, format: 'cjs', platform: 'browser', jsx: 'automatic', loader: { '.css': 'empty', '.module.css': 'empty' },
define: { 'process.env.NODE_ENV': '"development"' } });
const compiled = { exports: {} };
new Function('module', 'exports', result.outputFiles[0].text)(compiled, compiled.exports);
const { Workspace, act, createElement, createRoot } = compiled.exports;
const root = createRoot(document.getElementById('root'));
const scope = 'account=10000000-0000-0000-0000-000000000001&org=20000000-0000-0000-0000-000000000001';
let calls = [];
let responder = url => Response.json(url.includes('/context?') ? { brand: 'Allowed brand', organization: 'Allowed organization', access: 'read-only' } : { items: [], hasMore: false });
globalThis.fetch = async (url, options) => { calls.push({ url, signal: options.signal }); return responder(url); };
async function render(query) {
  await act(async () => { root.render(createElement(Workspace, { query, key: query })); });
}
async function click(label) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === label);
  assert.ok(button, label + ' control exists');
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
let checks = 0;
try {
  await render('mode=model&view=customers&customer=model-jordan');
  assert.match(document.body.textContent, /Read-only fixture/); assert.match(document.body.textContent, /Jordan Lee/);
  assert.equal(calls.length, 0); checks++;
  await click('Tasks'); assert.match(document.body.textContent, /Review the onboarding follow-up/); checks++;
  await click('Decisions'); assert.match(document.body.textContent, /No decisions recorded/); checks++;
  await click('Communications'); assert.match(document.body.textContent, /history is not connected/); checks++;
  await render(scope + '&view=customers');
  // First render's context succeeds, then deliberately return an empty list.
  responder = url => Response.json(url.includes('/context?') ? { brand: 'Allowed brand', organization: 'Allowed organization', access: 'read-only' } : { items: [], hasMore: false });
  await render(scope + '&view=customers&offset=0');
  assert.match(document.body.textContent, /No customers found/); assert.doesNotMatch(document.body.textContent, /Jordan|Northstar/); checks++;
  assert.ok(calls.every(call => call.url.includes(scope))); checks++;
  responder = () => Response.json({ message: 'Private database detail' }, { status: 403 });
  await render(scope + '&view=customers&offset=1');
  assert.match(document.body.textContent, /unavailable for your access/); assert.doesNotMatch(document.body.textContent, /Private database|Jordan|Northstar/); checks++;
  responder = url => url.includes('/context?') ? Response.json({ brand: 'Allowed brand', organization: 'Allowed organization', access: 'read-only' }) : Response.json({}, { status: 404 });
  await render(scope + '&view=customers&customer=30000000-0000-0000-0000-000000000001');
  assert.match(document.body.textContent, /Customer not found/); checks++;
  responder = () => new Promise(() => {});
  await render(scope + '&view=work');
  const pending = calls.at(-1);
  await render('mode=model&view=home');
  assert.equal(pending.signal.aborted, true); checks++;
  await render('');
  assert.match(document.body.textContent, /Open your brand workspace/); assert.doesNotMatch(document.body.textContent, /Allowed brand|Jordan Lee/); checks++;
  console.log(`Passed ${checks} mounted-DOM checks: model separation, customer sections, empty/denied/not-found states, scope propagation and request cancellation.`);
} finally { await act(async () => root.unmount()); dom.window.close(); }
// React's bundled scheduler can retain a MessageChannel in Node.
process.exit(0);
