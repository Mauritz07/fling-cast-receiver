const namespace = 'urn:x-cast:dev.fling.view';
const context = cast.framework.CastReceiverContext.getInstance();
const empty = document.querySelector('#empty');
const view = document.querySelector('#view');
const image = document.querySelector('#content');
const title = document.querySelector('#title');
const transfers = new Map();
let expiryTimer;

function clearView() {
  clearTimeout(expiryTimer);
  expiryTimer = undefined;
  image.removeAttribute('src');
  view.hidden = true;
  empty.hidden = false;
  transfers.clear();
}

function reply(senderId, requestId, status, message) {
  context.sendCustomMessage(namespace, senderId, {
    version: 1,
    requestId,
    status,
    ...(message ? {message} : {}),
  });
}

function reject(event, message) {
  reply(event.senderId, event.data?.requestId, 'error', message);
}

context.addCustomMessageListener(namespace, event => {
  const message = event.data;
  if (!message || message.version !== 1 || typeof message.type !== 'string') {
    reject(event, 'INVALID_MESSAGE');
    return;
  }
  if (message.type === 'begin') {
    if (
      typeof message.transferId !== 'string' ||
      typeof message.chunkCount !== 'number' ||
      message.chunkCount < 1 ||
      message.chunkCount > 256 ||
      message.mimeType !== 'image/jpeg'
    ) {
      reject(event, 'INVALID_BEGIN');
      return;
    }
    transfers.clear();
    transfers.set(message.transferId, {
      title: typeof message.title === 'string' ? message.title.slice(0, 160) : 'Fling-Ansicht',
      chunks: new Array(message.chunkCount),
      bytes: 0,
      expiresAt: Number(message.expiresAt),
    });
    reply(event.senderId, message.requestId, 'ready');
    return;
  }
  if (message.type === 'chunk') {
    const transfer = transfers.get(message.transferId);
    if (
      !transfer ||
      !Number.isInteger(message.index) ||
      message.index < 0 ||
      message.index >= transfer.chunks.length ||
      typeof message.data !== 'string' ||
      message.data.length > 70_000
    ) {
      reject(event, 'INVALID_CHUNK');
      return;
    }
    transfer.bytes += message.data.length;
    if (transfer.bytes > 11_000_000) {
      transfers.delete(message.transferId);
      reject(event, 'VIEW_TOO_LARGE');
      return;
    }
    transfer.chunks[message.index] = message.data;
    reply(event.senderId, message.requestId, 'received');
    return;
  }
  if (message.type === 'commit') {
    const transfer = transfers.get(message.transferId);
    if (!transfer || transfer.chunks.some(chunk => typeof chunk !== 'string')) {
      reject(event, 'INCOMPLETE_VIEW');
      return;
    }
    image.src = `data:image/jpeg;base64,${transfer.chunks.join('')}`;
    title.textContent = transfer.title;
    empty.hidden = true;
    view.hidden = false;
    clearTimeout(expiryTimer);
    const remaining = Math.min(30 * 60_000, Math.max(0, transfer.expiresAt - Date.now()));
    expiryTimer = setTimeout(clearView, remaining);
    transfers.delete(message.transferId);
    reply(event.senderId, message.requestId, 'visible');
    return;
  }
  if (message.type === 'end') {
    clearView();
    reply(event.senderId, message.requestId, 'ended');
    return;
  }
  reject(event, 'UNKNOWN_MESSAGE');
});

context.addEventListener(
  cast.framework.system.EventType.SENDER_DISCONNECTED,
  () => {
    if (context.getSenders().length === 0) clearView();
  },
);

context.start({
  disableIdleTimeout: true,
  statusText: 'Fling ist bereit',
});
