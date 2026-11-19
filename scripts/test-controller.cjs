const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const http = require('node:http');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium, devices } = require('playwright');
const { WebSocket, WebSocketServer } = require('ws');

const pairCode = '462513';
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', webmanifest: 'application/manifest+json' };
const sockets = new Map();
let base;
let claims = 0;
let phoneConnections = 0;
const server = http.createServer((request, response) => {
  const { pathname } = new URL(request.url, base);
  if (request.method === 'POST' && pathname === '/v1/pair/claim') {
    if (claims++) return response.writeHead(404).end();
    return response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  }
  if (pathname === '/test-host') return response.end('<!doctype html><title>Test receiver</title>');
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^(?:index\.html|sw\.js|assets\/[\w.-]+)$/.test(file)) return response.writeHead(404).end();
  try {
    let body = readFileSync(join(process.cwd(), file), 'utf8');
    if (file === 'index.html') body = body.replace("connect-src 'self'", "connect-src 'self' " + base.replace('http:', 'ws:'));
    if (/^assets\/index-.+\.js$/.test(file)) {
      body = body
        .replace('https://br-holy-leaf-b39m40ce-api.compute.c-4.ap-southeast-1.aws.neon.tech', base)
        .replace('wss://br-holy-leaf-b39m40ce-signal.compute.c-4.ap-southeast-1.aws.neon.tech', base.replace('http:', 'ws:'));
    }
    response.writeHead(200, { 'content-type': types[file.split('.').pop()] }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});

const relay = new WebSocketServer({ server });
relay.on('connection', (socket, request) => {
  const role = new URL(request.url, base).searchParams.get('role');
  if (role === 'phone') phoneConnections++;
  sockets.set(role, socket);
  socket.on('message', bytes => {
    const other = sockets.get(role === 'host' ? 'phone' : 'host');
    if (other?.readyState === WebSocket.OPEN) other.send(bytes.toString());
  });
});

function netem(...args) {
  execFileSync('sudo', ['tc', 'qdisc', 'replace', 'dev', 'lo', 'root', 'netem', ...args]);
}

async function openReceiver(page) {
  await page.goto(base + '/test-host');
  await page.evaluate(({ wsUrl, pairCode }) => {
    const peer = new RTCPeerConnection();
    const socket = new WebSocket(wsUrl);
    const receiver = window.receiver = { samples: [], granted: false, errors: [] };
    const candidates = [];
    const send = (type, payload = {}) => socket.send(JSON.stringify({ type, pairCode, payload }));
    peer.onicecandidate = ({ candidate }) => { if (candidate) send('ice_candidate', { candidate }); };
    peer.ondatachannel = ({ channel }) => {
      channel.binaryType = 'arraybuffer';
      channel.onmessage = ({ data }) => {
        const bytes = new DataView(data);
        if (channel.label === 'rl-fast' && bytes.byteLength === 7 && bytes.getUint8(0) === 1 && receiver.granted) {
          receiver.samples.push({ at: Date.now(), dx: bytes.getInt16(3) });
        }
      };
    };
    socket.onmessage = async ({ data }) => {
      try {
        const { type, payload } = JSON.parse(data);
        if (type === 'phone_ready') {
          receiver.granted = false;
          send('host_approved');
        } else if (type === 'pair_offer') {
          await peer.setRemoteDescription(payload.description);
          await peer.setLocalDescription(await peer.createAnswer());
          send('pair_answer', { description: peer.localDescription });
          for (const candidate of candidates.splice(0)) await peer.addIceCandidate(candidate);
        } else if (type === 'ice_candidate') {
          if (peer.remoteDescription) await peer.addIceCandidate(payload.candidate);
          else candidates.push(payload.candidate);
        } else if (type === 'grant_input') receiver.granted = true;
        else if (type === 'revoke_input') receiver.granted = false;
      } catch (error) {
        receiver.errors.push(error.message);
      }
    };
  }, { wsUrl: base.replace('http:', 'ws:') + '/signal?role=host', pairCode });
}

async function swipe(page, context) {
  const pad = await page.locator('#pad').boundingBox();
  assert.ok(pad && pad.height >= 180);
  const cdp = await context.newCDPSession(page);
  const y = Math.round(pad.y + pad.height / 2);
  const startX = Math.round(pad.x + 28);
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: x === undefined ? [] : [{ x, y }],
  });
  await touch('touchStart', startX);
  for (let step = 1; step <= 48; step++) {
    await delay(17);
    await touch('touchMove', startX + step * 4);
  }
  await touch('touchEnd');
  await cdp.detach();
  await delay(300);
}

async function measure(label, page, context, receiver) {
  await receiver.evaluate(() => { window.receiver.samples = []; });
  await swipe(page, context);
  const samples = await receiver.evaluate(() => window.receiver.samples);
  const gaps = samples.slice(1).map((sample, i) => sample.at - samples[i].at).sort((a, b) => a - b);
  const p95 = gaps[Math.floor(gaps.length * 0.95)];
  const displacement = samples.reduce((sum, { dx }) => sum + dx, 0);
  console.log(JSON.stringify({ label, cursorPackets: samples.length, p95GapMs: p95, displacement }));
  assert.ok(samples.length >= 28, label + ': too few cursor packets');
  assert.ok(p95 <= 100, label + ': cursor packets stalled');
  assert.ok(displacement >= 225 && displacement <= 280, label + ': cursor distance drifted');
}

(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const receiver = await browser.newPage();
    await openReceiver(receiver);
    while (!sockets.has('host')) await delay(25);
    const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 640 } });
    await context.route(url => url.hostname.includes('.neonauth.'), route => route.fulfill({ json: null }));
    await context.addInitScript(() => {
      const NativeRtc = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativeRtc {
        constructor(config) {
          super({ ...config, iceServers: [] });
          window.testPeer = this;
        }
      };
    });
    const phone = await context.newPage();
    const errors = [];
    phone.on('pageerror', error => errors.push(error.message));
    await phone.goto(base + '/?pair=' + pairCode, { waitUntil: 'domcontentloaded' });
    const ready = () => phone.waitForFunction(() => !document.querySelector('#authorize').disabled);
    const grant = async () => {
      await phone.locator('#authorize').click();
      await receiver.waitForFunction(() => window.receiver.granted);
    };
    await ready();
    await grant();
    await measure('baseline', phone, context, receiver);

    await context.setOffline(true);
    sockets.get('phone').close(1012, 'simulated network switch');
    await phone.waitForFunction(() => document.querySelector('#authorize').disabled);
    netem('loss', '100%');
    await phone.waitForFunction(() => ['disconnected', 'failed'].includes(window.testPeer?.connectionState), undefined, { timeout: 20000 });
    console.log('Observed loss of the WebRTC connection.');
    netem('delay', '45ms', '8ms', 'loss', '0.3%');
    const recoveredAt = performance.now();
    await context.setOffline(false);
    await ready();
    console.log(JSON.stringify({ recoveryMs: Math.round(performance.now() - recoveredAt), pairClaims: claims, phoneConnections }));
    assert.equal(claims, 1);
    assert.ok(phoneConnections >= 2);
    assert.equal(await phone.locator('body').getAttribute('data-controlling'), 'false');
    await grant();
    await measure('after switch (45ms delay, 8ms jitter, 0.3% loss)', phone, context, receiver);
    assert.deepEqual(errors, []);
    assert.deepEqual(await receiver.evaluate(() => window.receiver.errors), []);
  } finally {
    await browser.close();
    for (const socket of relay.clients) socket.terminate();
    server.close();
  }
})().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
