/**
 * Render check: server-renders every screen once so that a broken component
 * (bad hook order, undefined identifier, missing export) fails here instead of
 * silently in the browser. This is not a UI test — it proves the screens mount.
 */
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

const vite = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});

let failures = 0;

function render(label, element) {
  try {
    const html = renderToString(element);
    const size = html.length;
    if (size < 50) throw new Error(`suspiciously small output (${size} bytes)`);
    console.log(`  ✓ ${label} — ${size} bytes of HTML`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${label} — ${err.message}`);
  }
}

console.log('\nRender check (server-side mount of every screen)\n');

const { default: Onboarding } = await vite.ssrLoadModule('/src/components/Onboarding.jsx');
const { default: Shell } = await vite.ssrLoadModule('/src/components/Shell.jsx');
const { StatusView, ChannelsView, CallsView } = await vite.ssrLoadModule('/src/components/PlaceholderViews.jsx');
const { makeT } = await vite.ssrLoadModule('/src/i18n.js');

const { t, translated } = makeT('en');
const noop = () => {};

render(
  'Onboarding',
  React.createElement(Onboarding, {
    t,
    lang: 'en',
    translated,
    onLangChange: noop,
    onDone: noop,
  })
);

const identity = { privateKey: {}, publicKey: {}, jwk: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }, fresh: true };
const me = { id: 'u1', name: 'Alice', phoneMasked: '+91 •••••43210', avatarUrl: null, about: '' };

render(
  'Shell (empty directory)',
  React.createElement(Shell, { user: me, identity, t, lang: 'en', onLangChange: noop, onLogout: noop })
);

render('Status view', React.createElement(StatusView, { t }));
render('Channels view', React.createElement(ChannelsView, { t }));
render('Calls view', React.createElement(CallsView, { t }));

await vite.close();
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — render check\n`);
process.exit(failures === 0 ? 0 : 1);
