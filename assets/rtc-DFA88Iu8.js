const CHANNELS = {
  fast: { ordered: false, maxRetransmits: 0 },
  reliable: { ordered: true },
  meta: { ordered: true },
  bulk: { ordered: true },
};

const OPCODES = { MOVE_REL: 0x01, BTN: 0x03, KEY: 0x05, TEXT: 0x06, RELEASE_ALL: 0x0C, PING: 0x20, FILE_OFFER: 0x30, FILE_ACCEPT: 0x31, FILE_CHUNK: 0x32, FILE_ACK: 0x33, FILE_CANCEL: 0x34, FILE_DONE: 0x35, CLIP: 0x50 };
const MAX_CLIPBOARD_BYTES = 5 * 1024 * 1024;
const MAX_FILE_CHUNK_BYTES = 16 * 1024 - 12;
const MAX_FILE_NAME_BYTES = 120;
const MAX_BUFFERED_BYTES = { fast: 64 * 1024, reliable: 256 * 1024, meta: 256 * 1024, bulk: 512 * 1024 };

export function encodeRecord(opcode, payload) {
  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const frame = new Uint8Array(3 + data.byteLength);
  frame[0] = opcode;
  new DataView(frame.buffer).setUint16(1, data.byteLength, false);
  frame.set(data, 3);
  return frame;
}

export const encodeFastRecord = encodeRecord;
export const encodeReliableRecord = encodeRecord;

export function encodeMoveRel(dx, dy) {
  const payload = new ArrayBuffer(4);
  const view = new DataView(payload);
  view.setInt16(0, Math.max(-2000, Math.min(2000, Math.trunc(dx))), false);
  view.setInt16(2, Math.max(-2000, Math.min(2000, Math.trunc(dy))), false);
  return encodeFastRecord(OPCODES.MOVE_REL, new Uint8Array(payload));
}

export function encodeButton(button, pressed) {
  return encodeFastRecord(OPCODES.BTN, Uint8Array.of(button, pressed ? 1 : 0));
}

export function encodeKey(usage, pressed, modifiers = 0) {
  if (!Number.isInteger(usage) || usage < 0 || usage > 0xffff) throw new RangeError('invalid HID usage');
  if (!Number.isInteger(modifiers) || modifiers < 0 || modifiers > 0xff) throw new RangeError('invalid HID modifiers');
  const payload = new Uint8Array(4);
  const view = new DataView(payload.buffer);
  view.setUint16(0, usage, false);
  payload[2] = pressed ? 1 : 0;
  payload[3] = modifiers;
  return encodeReliableRecord(OPCODES.KEY, payload);
}

export function hidUsageForCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3) - 65 + 0x04;
  if (/^Digit[1-9]$/.test(code)) return code.charCodeAt(5) - 49 + 0x1e;
  if (code === 'Digit0') return 0x27;
  const fixed = {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c,
    Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30,
    Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
    Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39,
    F1: 0x3a, F2: 0x3b, F3: 0x3c, F4: 0x3d, F5: 0x3e, F6: 0x3f,
    F7: 0x40, F8: 0x41, F9: 0x42, F10: 0x43, F11: 0x44, F12: 0x45,
    ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
    Delete: 0x4c, Home: 0x4a, End: 0x4d, PageUp: 0x4b, PageDown: 0x4e,
    ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3,
    ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7,
  };
  return fixed[code];
}

export function encodeText(text, mode = 0) {
  if (mode !== 0 && mode !== 1) throw new RangeError('invalid text mode');
  const bytes = new TextEncoder().encode(String(text));
  if (bytes.byteLength > 1024) throw new RangeError('text payload too large');
  const payload = new Uint8Array(3 + bytes.byteLength);
  const view = new DataView(payload.buffer);
  payload[0] = mode;
  view.setUint16(1, bytes.byteLength, false);
  payload.set(bytes, 3);
  return encodeReliableRecord(OPCODES.TEXT, payload);
}

export function encodeReleaseAll() {
  return encodeReliableRecord(OPCODES.RELEASE_ALL, new Uint8Array());
}

export function encodePing(counter = 0) {
  const payload = new ArrayBuffer(16);
  const view = new DataView(payload);
  view.setUint32(0, Math.trunc(performance.now()) >>> 0, false);
  view.setUint32(4, 0, false);
  view.setBigUint64(8, BigInt(counter), false);
  return encodeFastRecord(OPCODES.PING, new Uint8Array(payload));
}

export function encodeClipboardText(text) {
  const bytes = new TextEncoder().encode(String(text));
  if (bytes.byteLength > MAX_CLIPBOARD_BYTES) throw new RangeError('clipboard payload too large');
  const payload = new Uint8Array(5 + bytes.byteLength);
  const view = new DataView(payload.buffer);
  payload[0] = 0;
  view.setUint32(1, bytes.byteLength, false);
  payload.set(bytes, 5);
  return encodeRecord(OPCODES.CLIP, payload);
}

export function encodeFileChunk(id, offset, chunk) {
  const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new RangeError('invalid file id');
  if (!Number.isInteger(offset) || offset < 0) throw new RangeError('invalid file offset');
  if (data.byteLength > MAX_FILE_CHUNK_BYTES) throw new RangeError('file chunk too large');
  const payload = new Uint8Array(12 + data.byteLength);
  const view = new DataView(payload.buffer);
  view.setUint32(0, id, false);
  view.setBigUint64(4, BigInt(offset), false);
  payload.set(data, 12);
  return encodeRecord(OPCODES.FILE_CHUNK, payload);
}

function fileIdPayload(id) {
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new RangeError('invalid file id');
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, id, false);
  return payload;
}

function fileDigest(value) {
  const digest = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (digest.byteLength !== 32) throw new RangeError('invalid file sha256');
  return digest;
}

export async function sha256Bytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export function encodeFileOffer(id, size, name, sha256) {
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new RangeError('invalid file id');
  if (!Number.isInteger(size) || size < 0 || size > 2 * 1024 * 1024 * 1024) throw new RangeError('invalid file size');
  const fileName = String(name);
  if ([...fileName].some(char => char < ' ' || char === '/' || char === '\\')) throw new RangeError('invalid file name');
  const stem = fileName.split('.')[0].toUpperCase();
  if (['CON', 'PRN', 'AUX', 'NUL'].includes(stem) || /^(COM|LPT)[1-9]$/.test(stem)) throw new RangeError('invalid file name');
  const nameBytes = new TextEncoder().encode(fileName);
  if (nameBytes.byteLength === 0 || nameBytes.byteLength > MAX_FILE_NAME_BYTES) throw new RangeError('invalid file name');
  const digest = fileDigest(sha256);
  const payload = new Uint8Array(4 + 8 + 2 + nameBytes.byteLength + digest.byteLength);
  const view = new DataView(payload.buffer);
  view.setUint32(0, id, false);
  view.setBigUint64(4, BigInt(size), false);
  view.setUint16(12, nameBytes.byteLength, false);
  payload.set(nameBytes, 14);
  payload.set(digest, 14 + nameBytes.byteLength);
  return encodeRecord(OPCODES.FILE_OFFER, payload);
}

export function encodeFileAccept(id) { return encodeRecord(OPCODES.FILE_ACCEPT, fileIdPayload(id)); }

export function encodeFileAck(id, offset) {
  if (!Number.isInteger(offset) || offset < 0) throw new RangeError('invalid file offset');
  const payload = new Uint8Array(12);
  payload.set(fileIdPayload(id));
  new DataView(payload.buffer).setBigUint64(4, BigInt(offset), false);
  return encodeRecord(OPCODES.FILE_ACK, payload);
}

export function encodeFileCancel(id) { return encodeRecord(OPCODES.FILE_CANCEL, fileIdPayload(id)); }

export function encodeFileDone(id, sha256) {
  const payload = new Uint8Array(36);
  payload.set(fileIdPayload(id));
  payload.set(fileDigest(sha256), 4);
  return encodeRecord(OPCODES.FILE_DONE, payload);
}

export function createRemoteTransport(onState = () => {}, onSignal = () => {}, options = {}) {
  const peer = new RTCPeerConnection({ iceServers: options.iceServers ?? [{ urls: 'stun:stun.cloudflare.com:3478' }] });
  let inputAuthorized = false;
  let heartbeatTimer;
  let heartbeatCounter = 0;
  let remoteDescriptionSet = false;
  let readyAnnounced = false;
  const pendingCandidates = [];
  const channels = {};
  const isReady = () => peer.connectionState === 'connected'
    && channels.fast?.readyState === 'open'
    && channels.reliable?.readyState === 'open';
  const notifyReady = () => {
    if (isReady() && !readyAnnounced) {
      readyAnnounced = true;
      options.onReady?.();
    } else if (!isReady()) {
      readyAnnounced = false;
    }
  };
  const configureChannel = (name, channel) => {
    channel.binaryType = 'arraybuffer';
    channels[name] = channel;
    channel.addEventListener('open', notifyReady);
    channel.addEventListener('close', notifyReady);
    notifyReady();
  };
  if (options.initiator !== false) {
    for (const [name, channelOptions] of Object.entries(CHANNELS)) {
      configureChannel(name, peer.createDataChannel(`rl-${name}`, channelOptions));
    }
  }
  peer.ondatachannel = event => {
    const name = event.channel.label.startsWith('rl-') ? event.channel.label.slice(3) : '';
    if (name in CHANNELS) configureChannel(name, event.channel);
  };
  peer.onconnectionstatechange = () => { onState(peer.connectionState); notifyReady(); };
  peer.onicecandidate = event => { if (event.candidate) onSignal({ type: 'ice_candidate', candidate: event.candidate }); };
  return {
    peer,
    channels,
    isReady,
    sendInput(frame) {
      const channel = channels.fast;
      if (!inputAuthorized || !channel || channel.readyState !== 'open' || channel.bufferedAmount > MAX_BUFFERED_BYTES.fast) return false;
      channel.send(frame);
      return true;
    },
    sendReliable(frame) {
      const channel = channels.reliable;
      if (!inputAuthorized || !channel || channel.readyState !== 'open' || channel.bufferedAmount > MAX_BUFFERED_BYTES.reliable) return false;
      channel.send(frame);
      return true;
    },
    sendMeta(frame) {
      const channel = channels.meta;
      if (!inputAuthorized || !channel || channel.readyState !== 'open' || channel.bufferedAmount > MAX_BUFFERED_BYTES.meta) return false;
      channel.send(frame);
      return true;
    },
    sendBulk(frame) {
      const channel = channels.bulk;
      if (!inputAuthorized || !channel || channel.readyState !== 'open' || channel.bufferedAmount > MAX_BUFFERED_BYTES.bulk) return false;
      channel.send(frame);
      return true;
    },
    authorizeInput() {
      inputAuthorized = true;
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        const channel = channels.fast;
        if (inputAuthorized && channel && channel.readyState === 'open' && channel.bufferedAmount <= MAX_BUFFERED_BYTES.fast) {
          channel.send(encodePing(++heartbeatCounter));
        }
      }, 1000);
    },
    revokeInput() {
      inputAuthorized = false;
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    },
    async createOffer() {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      onSignal({ type: 'pair_offer', description: peer.localDescription });
      return peer.localDescription;
    },
    async acceptAnswer(description) {
      await peer.setRemoteDescription(description);
      remoteDescriptionSet = true;
      for (const candidate of pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
      notifyReady();
    },
    async addCandidate(candidate) {
      if (!remoteDescriptionSet) { pendingCandidates.push(candidate); return; }
      await peer.addIceCandidate(candidate);
    },
    close() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      inputAuthorized = false;
      peer.close();
    },
  };
}
