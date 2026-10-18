// SPDX-License-Identifier: Apache-2.0
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { config } from "../config.js";
import type { Context } from "hono";

const devSetup = new Hono();

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function getPrivateIpv4Addresses(): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address)) {
        addresses.add(entry.address);
      }
    }
  }
  return [...addresses].sort();
}

function unavailableInProduction(c: Context) {
  return c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404);
}

function page(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenSMS Local Setup</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #f5f7fb; color: #172033; }
    main { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { margin-bottom: 8px; }
    .card { background: #fff; border: 1px solid #dce2ed; border-radius: 12px; padding: 18px; margin: 16px 0; box-shadow: 0 2px 8px #17203312; }
    label { display: block; font-weight: 600; margin: 12px 0 6px; }
    input { box-sizing: border-box; width: 100%; padding: 10px; border: 1px solid #aab5c8; border-radius: 7px; font: inherit; }
    button { border: 0; border-radius: 7px; padding: 10px 14px; margin: 12px 8px 0 0; background: #1769d1; color: white; font: inherit; cursor: pointer; }
    button.secondary { background: #5d687a; }
    button:disabled { opacity: .6; cursor: wait; }
    .status { font-weight: 700; }
    .healthy { color: #147a3d; } .unhealthy { color: #b42318; } .unknown { color: #8a5a00; }
    .output { white-space: pre-wrap; overflow-wrap: anywhere; background: #f0f3f8; padding: 10px; border-radius: 7px; margin-top: 12px; }
    .hint { color: #536174; font-size: .95rem; }
  </style>
</head>
<body>
<main>
  <h1>OpenSMS Local Setup</h1>
  <p class="hint">Development-only dashboard. It never stores your admin secret or registration token.</p>
  <section class="card">
    <h2>Setup status</h2>
    <p>Dashboard origin: <strong id="origin"></strong></p>
    <p>Backend: <span id="health" class="status unknown">Checking…</span></p>
    <p id="health-detail" class="hint"></p>
  </section>
  <section class="card">
    <h2>Phone connection</h2>
    <label for="server-url">Server URL for Android</label>
    <input id="server-url" type="url" spellcheck="false">
    <button id="copy-url" type="button">Copy URL</button>
    <p class="hint">Use the PC’s LAN or hotspot IPv4 address, not localhost or 127.0.0.1. Windows Firewall and Wi-Fi isolation may still require manual attention.</p>
    <p id="addresses" class="hint">Finding private IPv4 addresses…</p>
  </section>
  <section class="card">
    <h2>Register a phone</h2>
    <p class="hint">Gateway status is not queried here. After generating a token, register the Android gateway and verify its connection in the app.</p>
    <label for="admin-secret">Local ADMIN_SECRET</label>
    <input id="admin-secret" type="password" autocomplete="off">
    <button id="generate" type="button">Generate Token</button>
    <button id="clear" class="secondary" type="button">Clear</button>
    <div id="token-output" class="output" hidden></div>
    <button id="copy-token" type="button" hidden>Copy Token</button>
    <button id="clear-token" class="secondary" type="button" hidden>Clear Token</button>
    <p id="message" class="hint" role="status"></p>
    <p class="hint">Registration tokens are single-use and expire. A network failure is not automatically retried.</p>
  </section>
</main>
<script nonce="${nonce}">
(() => {
  const $ = (id) => document.getElementById(id);
  const origin = window.location.origin;
  const url = $('server-url');
  const secret = $('admin-secret');
  const generate = $('generate');
  const tokenOutput = $('token-output');
  const copyToken = $('copy-token');
  const clearToken = $('clear-token');
  $('origin').textContent = origin;
  url.value = origin + '/';

  const setMessage = (text, kind) => {
    $('message').textContent = text;
    $('message').className = kind ? 'hint ' + kind : 'hint';
  };
  const clearTokenValue = () => {
    tokenOutput.textContent = '';
    tokenOutput.hidden = true;
    copyToken.hidden = true;
    clearToken.hidden = true;
  };
  $('copy-url').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url.value); setMessage('Server URL copied.', 'healthy'); }
    catch { setMessage('Copy failed; select and copy the URL manually.', 'unknown'); }
  });
  $('clear').addEventListener('click', () => {
    secret.value = '';
    clearTokenValue();
    setMessage('', '');
  });
  clearToken.addEventListener('click', clearTokenValue);
  copyToken.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(tokenOutput.dataset.token || ''); setMessage('Registration token copied.', 'healthy'); }
    catch { setMessage('Copy failed; select and copy the token manually.', 'unknown'); }
  });
  generate.addEventListener('click', async () => {
    const value = secret.value;
    if (!value) { setMessage('Enter the local ADMIN_SECRET.', 'unhealthy'); return; }
    generate.disabled = true;
    clearTokenValue();
    setMessage('Generating token…', '');
    try {
      const response = await fetch('/api/v1/admin/registration-tokens', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + value },
      });
      if (response.status === 401) throw new Error('Admin authentication failed.');
      if (!response.ok) throw new Error('The server could not generate a token (' + response.status + ').');
      const result = await response.json();
      if (typeof result.token !== 'string' || typeof result.expiresAt !== 'string') throw new Error('The server returned an invalid token response.');
      tokenOutput.textContent = 'Token: ' + result.token + '\\nExpires: ' + new Date(result.expiresAt).toLocaleString();
      tokenOutput.dataset.token = result.token;
      tokenOutput.hidden = false;
      copyToken.hidden = false;
      clearToken.hidden = false;
      setMessage('Token generated. Use it once in the Android app.', 'healthy');
    } catch (error) {
      setMessage(error instanceof TypeError ? 'Network request failed. Check the server URL and local network.' : (error.message || 'Token generation failed.'), 'unhealthy');
    } finally {
      secret.value = '';
      generate.disabled = false;
    }
  });
  fetch('/api/v1/health').then((response) => {
    $('health').textContent = response.ok ? 'Healthy' : 'Unhealthy';
    $('health').className = 'status ' + (response.ok ? 'healthy' : 'unhealthy');
    $('health-detail').textContent = response.ok ? 'Database connectivity check passed.' : 'The backend responded, but its database check is unhealthy.';
  }).catch(() => {
    $('health').textContent = 'Unknown';
    $('health').className = 'status unknown';
    $('health-detail').textContent = 'The health endpoint could not be reached.';
  });
  fetch('/_dev/setup/network-interfaces').then((response) => response.json()).then((result) => {
    $('addresses').textContent = result.addresses.length ? 'Usable private IPv4 addresses: ' + result.addresses.join(', ') : 'No usable private IPv4 address was found.';
  }).catch(() => { $('addresses').textContent = 'Private IPv4 helper unavailable; enter the address manually.'; });
})();
</script>
</body>
</html>`;
}

devSetup.get("/", (c) => {
  if (config.nodeEnv !== "development") return unavailableInProduction(c);
  const nonce = randomBytes(16).toString("base64");
  c.header("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'`);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  return c.html(page(nonce));
});

devSetup.get("/network-interfaces", (c) => {
  if (config.nodeEnv !== "development") return unavailableInProduction(c);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "no-store");
  return c.json({ addresses: getPrivateIpv4Addresses() });
});

export { devSetup };
