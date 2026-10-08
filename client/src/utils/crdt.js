import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

/**
 * Yjs provider for a CodeChatter room.
 *
 * A hand-rolled provider rather than y-websocket because the connection has to
 * carry our auth token and hit our own room endpoint, and y-websocket assumes
 * it owns the URL shape. The wire format is the standard y-protocol, so the
 * Python side and this agree without either knowing about the other.
 */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export class RoomCrdtProvider {
  constructor(url, doc, { user } = {}) {
    this.url = url;
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.synced = false;
    this.ws = null;
    this.destroyed = false;
    this.retries = 0;
    this._listeners = { status: new Set(), synced: new Set() };

    if (user) {
      this.awareness.setLocalStateField("user", user);
    }

    this._onDocUpdate = (update, origin) => {
      // Skip updates we just applied from the socket, or they bounce back out.
      if (origin === this) return;

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this._send(encoding.toUint8Array(encoder));
    };

    this._onAwarenessUpdate = ({ added, updated, removed }) => {
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
      );
      this._send(encoding.toUint8Array(encoder));
    };

    this.doc.on("update", this._onDocUpdate);
    this.awareness.on("update", this._onAwarenessUpdate);

    this.connect();
  }

  on(event, handler) {
    this._listeners[event]?.add(handler);
    return () => this._listeners[event]?.delete(handler);
  }

  _emit(event, value) {
    this._listeners[event]?.forEach((handler) => handler(value));
  }

  _send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    }
  }

  connect() {
    if (this.destroyed) return;

    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      this._emit("status", "connected");

      // Step 1: tell the server what we have so it can send back the difference.
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this._send(encoding.toUint8Array(encoder));

      if (this.awareness.getLocalState()) {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
        );
        this._send(encoding.toUint8Array(awarenessEncoder));
      }
    };

    ws.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        // `this` as origin so _onDocUpdate can tell our own echo apart.
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);

        if (encoding.length(encoder) > 1) {
          this._send(encoding.toUint8Array(encoder));
        }

        if (!this.synced) {
          this.synced = true;
          this._emit("synced", true);
        }
        return;
      }

      if (messageType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this,
        );
      }
    };

    ws.onclose = () => {
      this.ws = null;
      this._emit("status", "disconnected");

      if (this.destroyed) return;

      // Backing off matters: a server restart otherwise gets a reconnect storm
      // from every open room at once.
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.retries, RECONNECT_MAX_MS);
      this.retries += 1;
      this._reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };

    ws.onerror = () => ws.close();
  }

  destroy() {
    this.destroyed = true;
    window.clearTimeout(this._reconnectTimer);
    this.doc.off("update", this._onDocUpdate);
    this.awareness.off("update", this._onAwarenessUpdate);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], this);
    this.awareness.destroy();
    this.ws?.close();
    this.ws = null;
  }
}

/** The shared map of path -> Y.Text, matching the server's `files` map. */
export function getFilesMap(doc) {
  return doc.getMap("files");
}

/** Y.Text for one file, created on first use so a new file just works. */
export function getFileText(doc, path) {
  const files = getFilesMap(doc);

  if (!files.has(path)) {
    files.set(path, new Y.Text());
  }

  return files.get(path);
}
