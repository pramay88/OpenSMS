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

function legacyPage(nonce: string): string {
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
    <h2>Overview</h2>
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
  <section class="card">
    <h2>Local operator console</h2>
    <p class="hint">Read-only operational data from the authenticated admin API. The shared secret remains in memory only and is cleared when you clear this page.</p>
    <button id="refresh-console" type="button">Load dashboard data</button>
    <div id="console-message" class="hint" role="status"></div>
    <div id="summary" class="output">Dashboard data has not been loaded.</div>
    <h3>Gateways</h3>
    <div id="gateways" class="output">Not loaded.</div>
    <h3>API clients</h3>
    <div id="clients" class="output">Not loaded.</div>
    <h3>Recent messages</h3>
    <label for="message-status">Filter by status</label>
    <select id="message-status">
      <option value="">All statuses</option><option>QUEUED</option><option>ASSIGNED</option><option>SENDING</option><option>SENT</option><option>FAILED</option><option>EXPIRED</option>
    </select>
    <button id="previous-messages" class="secondary" type="button">Previous</button>
    <button id="next-messages" type="button">Next</button>
    <div id="messages" class="output">Not loaded.</div>
    <h3>API-client management</h3>
    <label for="client-name">New client name</label>
    <input id="client-name" type="text" maxlength="100" autocomplete="off">
    <button id="create-client" type="button">Create API client</button>
    <div id="client-result" class="output" hidden></div>
    <p class="hint">API keys are returned once. Existing keys are never displayed.</p>
    <h3>Gateway management</h3>
    <label for="gateway-id">Gateway ID to revoke</label>
    <input id="gateway-id" type="text" autocomplete="off">
    <button id="revoke-gateway" class="secondary" type="button">Revoke gateway</button>
    <p class="hint">Revocation is immediate and requires the gateway to be registered again.</p>
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
  const refreshConsole = $('refresh-console');
  const createClient = $('create-client');
  const revokeGatewayButton = $('revoke-gateway');
  let messageOffset = 0;
  $('origin').textContent = origin;
  url.value = origin + '/';

  const setMessage = (text, kind) => {
    $('message').textContent = text;
    $('message').className = kind ? 'hint ' + kind : 'hint';
  };
  const clearTokenValue = () => {
    tokenOutput.textContent = '';
    delete tokenOutput.dataset.token;
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
    $('summary').textContent = 'Dashboard data has not been loaded.';
    $('gateways').textContent = 'Not loaded.';
    $('clients').textContent = 'Not loaded.';
    $('messages').textContent = 'Not loaded.';
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
      const adminFetch = async (path) => {
        const value = secret.value;
        if (!value) throw new Error('Enter the local ADMIN_SECRET first.');
        const response = await fetch(path, { headers: { Authorization: 'Bearer ' + value } });
        if (response.status === 401) throw new Error('Admin authentication failed.');
        if (!response.ok) throw new Error('The server could not load dashboard data (' + response.status + ').');
        return response.json();
      };
      const adminMutate = async (path, method, body) => {
        const value = secret.value;
        if (!value) throw new Error('Enter the local ADMIN_SECRET first.');
        const response = await fetch(path, {
          method,
          headers: { Authorization: 'Bearer ' + value, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (response.status === 401) throw new Error('Admin authentication failed.');
        if (!response.ok) throw new Error('The server rejected this operation (' + response.status + ').');
        return response.json();
      };
      const renderRows = (items, empty, render) => items.length ? items.map(render).join('\\n') : empty;
      refreshConsole.addEventListener('click', async () => {
        refreshConsole.disabled = true;
        $('console-message').textContent = 'Loading dashboard data…';
        try {
          const [summary, gatewayData, clientData, messageData] = await Promise.all([
            adminFetch('/api/v1/admin/summary'),
            adminFetch('/api/v1/admin/gateways'),
            adminFetch('/api/v1/admin/clients'),
            adminFetch('/api/v1/admin/messages?status=' + encodeURIComponent($('message-status').value) + '&offset=' + messageOffset),
          ]);
          const messageCounts = Object.entries(summary.messages || {}).map(([status, count]) => status + ': ' + count).join(' | ') || 'No messages';
          const gatewayCounts = Object.entries(summary.gateways || {}).map(([status, count]) => status + ': ' + count).join(' | ') || 'No gateways';
          $('summary').textContent = 'Messages — ' + messageCounts + '\\nGateways — ' + gatewayCounts;
          $('gateways').textContent = renderRows(gatewayData.gateways, 'No gateways registered.', (gateway) =>
            gateway.name + ' — ' + gateway.status + ' — last heartbeat: ' + (gateway.lastHeartbeatAt || 'never') + ' — active jobs: ' + gateway.activeJobCount
          );
          $('clients').textContent = renderRows(clientData.clients, 'No API clients created.', (client) =>
            client.name + ' — ' + (client.revokedAt ? 'revoked' : 'active') + ' — created: ' + client.createdAt
          );
          $('messages').textContent = renderRows(messageData.messages, 'No messages found.', (message) =>
            message.id + ' — ' + message.status + ' — to: ' + message.to + (message.errorCode ? ' — error: ' + message.errorCode : '')
          );
          $('console-message').textContent = 'Dashboard data loaded.';
          $('console-message').className = 'hint healthy';
        } catch (error) {
          $('console-message').textContent = error instanceof TypeError ? 'Network request failed.' : (error.message || 'Dashboard data could not be loaded.');
          $('console-message').className = 'hint unhealthy';
        } finally {
          refreshConsole.disabled = false;
        }
      });
      $('previous-messages').addEventListener('click', () => {
        messageOffset = Math.max(0, messageOffset - 100);
        refreshConsole.click();
      });
      $('next-messages').addEventListener('click', () => {
        messageOffset += 100;
        refreshConsole.click();
      });
      createClient.addEventListener('click', async () => {
        const name = $('client-name').value.trim();
        if (!name) { $('console-message').textContent = 'Enter a client name.'; return; }
        createClient.disabled = true;
        try {
          const result = await adminMutate('/api/v1/admin/clients', 'POST', { name });
          $('client-result').textContent = 'Client: ' + result.name + '\\nAPI key (save now; shown once): ' + result.apiKey;
          $('client-result').hidden = false;
          $('client-name').value = '';
          $('console-message').textContent = 'API client created.';
          refreshConsole.click();
        } catch (error) {
          $('console-message').textContent = error.message || 'Client creation failed.';
        } finally { createClient.disabled = false; }
      });
      revokeGatewayButton.addEventListener('click', async () => {
        const id = $('gateway-id').value.trim();
        if (!id || !window.confirm('Revoke this gateway? It will stop authenticating immediately.')) return;
        revokeGatewayButton.disabled = true;
        try {
          await adminMutate('/api/v1/admin/gateways/' + encodeURIComponent(id) + '/revoke', 'POST');
          $('gateway-id').value = '';
          $('console-message').textContent = 'Gateway revoked.';
          refreshConsole.click();
        } catch (error) {
          $('console-message').textContent = error.message || 'Gateway revocation failed.';
        } finally { revokeGatewayButton.disabled = false; }
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

function modernPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenSMS Admin</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f6f8fb;line-height:1.45}
*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button{border:0;border-radius:8px;padding:10px 14px;background:#155eef;color:#fff;font-weight:650;cursor:pointer}button:hover{background:#0f4dcc}button:disabled{opacity:.55;cursor:wait}.muted{color:#667085}.danger{background:#b42318}.secondary{background:#667085}.shell{min-height:100vh}.login{min-height:100vh;display:grid;place-items:center;padding:20px}.login-card{width:min(420px,100%);background:#fff;padding:32px;border:1px solid #e4e7ec;border-radius:16px;box-shadow:0 18px 50px #10182812}.brand{font-size:1.35rem;font-weight:800}.eyebrow{color:#155eef;font-size:.8rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em}label{display:block;font-weight:700;margin:16px 0 6px}input,select{width:100%;padding:11px 12px;border:1px solid #cfd5df;border-radius:8px;background:#fff}input:focus,select:focus,button:focus{outline:3px solid #84adff;outline-offset:2px}.login-actions{display:flex;gap:10px;align-items:center;margin-top:20px}.password-row{display:flex;gap:8px}.password-row input{flex:1}.app{display:grid;grid-template-columns:240px 1fr;min-height:100vh}.sidebar{background:#101828;color:#e4e7ec;padding:22px 14px}.sidebar .brand{padding:0 10px 26px}.nav{display:grid;gap:5px}.nav button{background:transparent;color:#98a2b3;text-align:left;width:100%}.nav button.active,.nav button:hover{background:#1d2939;color:#fff}.content{min-width:0}.topbar{height:76px;background:#fff;border-bottom:1px solid #e4e7ec;display:flex;justify-content:space-between;align-items:center;padding:0 28px}.top-actions{display:flex;gap:10px}.main{max-width:1300px;margin:auto;padding:28px}.section{display:none}.section.active{display:block}.section-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px}.section-head h1{margin:0;font-size:1.8rem}.actions{display:flex;gap:8px;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.card{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:18px}.metric{font-size:1.8rem;font-weight:800;margin-top:8px}.metric-label{color:#667085;font-size:.9rem}.table-wrap{overflow:auto;background:#fff;border:1px solid #e4e7ec;border-radius:12px}table{width:100%;border-collapse:collapse;min-width:680px}th,td{text-align:left;padding:13px 16px;border-bottom:1px solid #eef0f3}th{color:#667085;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}tr:last-child td{border-bottom:0}.status{display:inline-flex;padding:3px 9px;border-radius:999px;font-size:.78rem;font-weight:750;background:#eef2ff;color:#344054}.ok{background:#ecfdf3;color:#027a48}.warn{background:#fffaeb;color:#b54708}.bad{background:#fef3f2;color:#b42318}.panel{margin-top:18px}.notice{padding:12px 14px;background:#f2f4f7;border-radius:8px}.error{color:#b42318}.success{color:#027a48}.token{font-family:ui-monospace,monospace;word-break:break-all;background:#f2f4f7;padding:12px;border-radius:8px}.hidden{display:none!important}.form-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end}.mobile-menu{display:none}
@media(max-width:800px){.app{grid-template-columns:1fr}.sidebar{display:none}.sidebar.open{display:block;position:fixed;z-index:3;inset:0 auto 0 0;width:250px}.mobile-menu{display:inline-block}.topbar{padding:0 16px}.main{padding:20px 14px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.section-head{display:block}.actions{margin-top:14px}}
@media(max-width:480px){.grid{grid-template-columns:1fr}.topbar h2{font-size:1rem}.top-actions button{padding:8px}}
</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
(() => {
  const root=document.getElementById('root'); let secret=''; let current='overview'; let messageOffset=0;
  const esc=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=(value)=>value?new Date(value).toLocaleString():'Never';
  const status=(value)=>'<span class="status '+(value==='ONLINE'||value==='SENT'?'ok':value==='FAILED'||value==='REVOKED'?'bad':'warn')+'">'+esc(value)+'</span>';
  const login=()=>{root.innerHTML='<main class="login"><form class="login-card" id="login"><div class="eyebrow">OpenSMS</div><h1>Admin dashboard</h1><p class="muted">Sign in for this browser session. The admin secret is held in memory only and is cleared on logout or page refresh.</p><label for="login-secret">Admin Secret</label><div class="password-row"><input id="login-secret" type="password" autocomplete="current-password" required><button id="toggle" class="secondary" type="button">Show</button></div><div id="login-error" class="error" role="alert"></div><div class="login-actions"><button id="login-submit" type="submit">Sign in</button></div></form></main>'; const input=document.getElementById('login-secret'),toggle=document.getElementById('toggle'); toggle.onclick=()=>{input.type=input.type==='password'?'text':'password';toggle.textContent=input.type==='password'?'Show':'Hide'}; document.getElementById('login').onsubmit=async(e)=>{e.preventDefault(); const button=document.getElementById('login-submit'); button.disabled=true; document.getElementById('login-error').textContent=''; const candidate=input.value; try{const r=await fetch('/api/v1/admin/summary',{headers:{Authorization:'Bearer '+candidate}}); if(!r.ok)throw new Error(r.status===401||r.status===403?'Invalid admin secret.':'Dashboard could not be loaded.'); secret=candidate; renderApp(); await loadOverview()}catch(error){document.getElementById('login-error').textContent=error.message||'Authentication failed.'}finally{button.disabled=false}}};
  const renderApp=()=>{root.innerHTML='<div class="app"><aside class="sidebar" id="sidebar"><div class="brand">OpenSMS Admin</div><nav class="nav"><button data-section="overview">Overview</button><button data-section="setup">Guided setup</button><button data-section="gateways">Gateways</button><button data-section="clients">API clients</button><button data-section="messages">Messages</button></nav></aside><div class="content"><header class="topbar"><div><button class="mobile-menu secondary" id="menu">Menu</button> <strong id="title">Overview</strong></div><div class="top-actions"><button id="refresh" class="secondary">Refresh</button><button id="logout" class="danger">Log out</button></div></header><main class="main"><section id="overview" class="section active"><div class="section-head"><div><h1>Overview</h1><p class="muted">Live operational status from the backend.</p></div></div><div id="metrics" class="grid"></div><div id="overview-errors" class="panel"></div></section><section id="setup" class="section"><div class="section-head"><div><h1>Guided setup</h1><p class="muted">Complete the safe local setup sequence.</p></div></div><div id="setup-content"></div></section><section id="gateways" class="section"><div class="section-head"><div><h1>Gateways</h1><p class="muted">Registered Android devices and heartbeat state.</p></div><div class="actions"><button id="token-action">Generate registration token</button><button id="gateway-refresh" class="secondary">Refresh</button></div></div><div class="form-row"><div><label for="gateway-search">Search gateways</label><input id="gateway-search" placeholder="Name or gateway ID"></div></div><div id="gateway-table" class="panel"></div><div id="token-panel" class="card panel hidden"></div></section><section id="clients" class="section"><div class="section-head"><div><h1>API clients</h1><p class="muted">Client credentials are shown only when created.</p></div><button id="client-create-action">Create API client</button></div><div id="client-table"></div><div id="client-form" class="card panel hidden"><label for="new-client-name">Client name</label><input id="new-client-name" maxlength="100"><div class="actions"><button id="client-submit">Create</button><button id="client-cancel" class="secondary">Cancel</button></div><div id="client-created" class="token panel hidden"></div></div></section><section id="messages" class="section"><div class="section-head"><div><h1>Messages</h1><p class="muted">Bounded message history and delivery evidence.</p></div><button id="message-refresh" class="secondary">Refresh</button></div><div class="form-row"><div><label for="message-filter">Status filter</label><select id="message-filter"><option value="">All statuses</option><option>QUEUED</option><option>ASSIGNED</option><option>SENDING</option><option>SENT</option><option>FAILED</option><option>EXPIRED</option></select></div><div class="actions"><button id="message-prev" class="secondary">Previous</button><button id="message-next">Next</button></div></div><div id="message-table" class="panel"></div></section></main></div></div>'; document.querySelectorAll('[data-section]').forEach((button)=>button.onclick=()=>show(button.dataset.section)); document.getElementById('menu').onclick=()=>document.getElementById('sidebar').classList.toggle('open'); document.getElementById('logout').onclick=()=>{secret='';login()}; document.getElementById('refresh').onclick=refreshCurrent; document.getElementById('gateway-refresh').onclick=loadGateways; document.getElementById('message-refresh').onclick=loadMessages; document.getElementById('message-filter').onchange=()=>{messageOffset=0;loadMessages()}; document.getElementById('message-prev').onclick=()=>{messageOffset=Math.max(0,messageOffset-100);loadMessages()}; document.getElementById('message-next').onclick=()=>{messageOffset+=100;loadMessages()}; document.getElementById('token-action').onclick=generateToken; document.getElementById('client-create-action').onclick=()=>document.getElementById('client-form').classList.remove('hidden'); document.getElementById('client-cancel').onclick=()=>document.getElementById('client-form').classList.add('hidden'); document.getElementById('client-submit').onclick=createClient; document.getElementById('gateway-search').oninput=loadGateways; show('overview')};
  const show=(name)=>{current=name; document.querySelectorAll('.section').forEach((section)=>section.classList.toggle('active',section.id===name)); document.querySelectorAll('[data-section]').forEach((button)=>button.classList.toggle('active',button.dataset.section===name)); document.getElementById('title').textContent=name==='clients'?'API clients':name.charAt(0).toUpperCase()+name.slice(1); if(name==='overview')loadOverview(); if(name==='setup')loadSetup(); if(name==='gateways')loadGateways(); if(name==='clients')loadClients(); if(name==='messages')loadMessages(); document.getElementById('sidebar').classList.remove('open')};
  const api=async(path,options={})=>{const response=await fetch(path,{...options,headers:{...(options.headers||{}),Authorization:'Bearer '+secret}}); if(response.status===401||response.status===403){secret='';login();throw new Error('Authentication expired. Please sign in again.')} if(!response.ok)throw new Error('Request failed ('+response.status+').'); return response.json()};
  const loadOverview=async()=>{const metrics=document.getElementById('metrics'); if(!metrics)return; metrics.innerHTML='<div class="card muted">Loading…</div>'; try{const [summary,health]=await Promise.all([api('/api/v1/admin/summary'),fetch('/api/v1/health').then((r)=>r.json())]); const m=summary.messages||{},g=summary.gateways||{}; metrics.innerHTML='<div class="card"><div class="metric-label">Database</div><div class="metric">'+(health.status==='ok'?'Healthy':'Degraded')+'</div></div><div class="card"><div class="metric-label">Gateways</div><div class="metric">'+Object.values(g).reduce((a,b)=>a+Number(b),0)+'</div><div class="muted">'+(g.ONLINE||0)+' online · '+(g.OFFLINE||0)+' offline</div></div><div class="card"><div class="metric-label">API clients</div><div class="metric">Loading details…</div></div><div class="card"><div class="metric-label">Messages</div><div class="metric">'+Object.values(m).reduce((a,b)=>a+Number(b),0)+'</div><div class="muted">'+(m.SENT||0)+' sent · '+(m.FAILED||0)+' failed</div></div>'; const clients=await api('/api/v1/admin/clients'); metrics.children[2].innerHTML='<div class="metric-label">API clients</div><div class="metric">'+clients.clients.length+'</div><div class="muted">'+clients.clients.filter((c)=>!c.revokedAt).length+' active</div>'; const failures=(summary.recentFailures||[]).map((f)=>'<div>'+status(f.status)+' '+esc(f.id)+' '+esc(f.errorCode||'')+'</div>').join('')||'<div class="muted">No recent failures.</div>'; document.getElementById('overview-errors').innerHTML='<div class="card"><strong>Recent failures</strong><div class="panel">'+failures+'</div></div>'}catch(error){metrics.innerHTML='<div class="card error">'+esc(error.message)+'</div>'}};
  const loadSetup=()=>{document.getElementById('setup-content').innerHTML='<div class="card"><h2>Local readiness</h2><p>1. Confirm backend health. 2. Generate a single-use registration token. 3. Register Android using the server URL shown below. 4. Create an API client. 5. Submit a simulated message using that client key.</p><p class="muted">Environment secrets and database migrations remain deployment tasks; this dashboard does not accept or expose them.</p><div class="notice">Android server URL: <strong>'+esc(location.origin)+'</strong><br>Physical phones must use the PC LAN/hotspot IPv4 address and port 3000.</div></div>'};
  const loadGateways=async()=>{const target=document.getElementById('gateway-table'); if(!target)return; target.innerHTML='<div class="card muted">Loading…</div>'; try{const data=await api('/api/v1/admin/gateways'); const q=(document.getElementById('gateway-search').value||'').toLowerCase(); const rows=data.gateways.filter((g)=>!q||g.name.toLowerCase().includes(q)||g.id.toLowerCase().includes(q)).map((g)=>'<tr><td>'+esc(g.name)+'</td><td>'+status(g.status)+'</td><td>'+date(g.lastHeartbeatAt)+'</td><td>'+esc(g.activeJobCount)+'</td><td><button class="danger revoke" data-id="'+esc(g.id)+'">Revoke</button></td></tr>').join(''); target.innerHTML='<div class="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Last heartbeat</th><th>Active jobs</th><th>Action</th></tr></thead><tbody>'+ (rows||'<tr><td colspan="5" class="muted">No gateways registered yet.</td></tr>')+'</tbody></table></div>'; target.querySelectorAll('.revoke').forEach((b)=>b.onclick=async()=>{if(confirm('Revoke this gateway?')){await api('/api/v1/admin/gateways/'+encodeURIComponent(b.dataset.id)+'/revoke',{method:'POST'});loadGateways()}})}catch(error){target.innerHTML='<div class="card error">'+esc(error.message)+'</div>'}};
  const loadClients=async()=>{const target=document.getElementById('client-table'); if(!target)return; target.innerHTML='<div class="card muted">Loading…</div>'; try{const data=await api('/api/v1/admin/clients'); const rows=data.clients.map((c)=>'<tr><td>'+esc(c.name)+'</td><td>'+status(c.revokedAt?'REVOKED':'ACTIVE')+'</td><td>'+date(c.createdAt)+'</td><td>'+(!c.revokedAt?'<button class="danger client-revoke" data-id="'+esc(c.id)+'">Revoke</button>':'')+'</td></tr>').join(''); target.innerHTML='<div class="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>'+ (rows||'<tr><td colspan="4" class="muted">No API clients created yet.</td></tr>')+'</tbody></table></div>'; target.querySelectorAll('.client-revoke').forEach((b)=>b.onclick=async()=>{if(confirm('Revoke this API client?')){await api('/api/v1/admin/clients/'+encodeURIComponent(b.dataset.id)+'/revoke',{method:'POST'});loadClients()}})}catch(error){target.innerHTML='<div class="card error">'+esc(error.message)+'</div>'}};
  const loadMessages=async()=>{const target=document.getElementById('message-table'); if(!target)return; target.innerHTML='<div class="card muted">Loading…</div>'; try{const filter=document.getElementById('message-filter').value; const data=await api('/api/v1/admin/messages?status='+encodeURIComponent(filter)+'&offset='+messageOffset); const rows=data.messages.map((m)=>'<tr><td><code>'+esc(m.id)+'</code></td><td>'+esc(m.to)+'</td><td>'+status(m.status)+'</td><td>'+date(m.createdAt)+'</td><td>'+esc(m.errorCode||'—')+'</td></tr>').join(''); target.innerHTML='<div class="table-wrap"><table><thead><tr><th>ID</th><th>Recipient</th><th>Status</th><th>Created</th><th>Failure</th></tr></thead><tbody>'+ (rows||'<tr><td colspan="5" class="muted">No messages match this filter.</td></tr>')+'</tbody></table></div>'}catch(error){target.innerHTML='<div class="card error">'+esc(error.message)+'</div>'}};
  const generateToken=async()=>{const panel=document.getElementById('token-panel'); panel.classList.remove('hidden'); panel.innerHTML='<span class="muted">Generating…</span>'; try{const result=await api('/api/v1/admin/registration-tokens',{method:'POST'}); panel.innerHTML='<strong>Registration token</strong><p class="muted">Single-use · expires '+esc(date(result.expiresAt))+'</p><div class="token">'+esc(result.token)+'</div><button id="copy-token" class="panel">Copy token</button>'; document.getElementById('copy-token').onclick=()=>navigator.clipboard.writeText(result.token)}catch(error){panel.innerHTML='<span class="error">'+esc(error.message)+'</span>'}};
  const createClient=async()=>{const input=document.getElementById('new-client-name'),name=input.value.trim(); if(!name)return; const result=document.getElementById('client-created'); try{const data=await api('/api/v1/admin/clients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}); result.textContent='API key (save it now; shown once): '+data.apiKey; result.classList.remove('hidden'); input.value=''; loadClients()}catch(error){result.textContent=error.message;result.classList.remove('hidden')}};
  const refreshCurrent=()=>{if(current==='overview')loadOverview();else if(current==='gateways')loadGateways();else if(current==='clients')loadClients();else if(current==='messages')loadMessages();else loadSetup()};
  login();
})();
</script>
</body></html>`;
}

devSetup.get("/", (c) => {
  if (config.nodeEnv !== "development") return unavailableInProduction(c);
  const nonce = randomBytes(16).toString("base64");
  c.header("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'`);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  return c.html(modernPage(nonce));
});

devSetup.get("/network-interfaces", (c) => {
  if (config.nodeEnv !== "development") return unavailableInProduction(c);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "no-store");
  return c.json({ addresses: getPrivateIpv4Addresses() });
});

export { devSetup };
