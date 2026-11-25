const roomLobby = document.querySelector("#room-lobby");
const roomSession = document.querySelector("#room-session");
const roomCodeInput = document.querySelector("#room-code");
const roomInvite = document.querySelector("#room-invite");
const copyInviteButton = document.querySelector("#copy-invite");
const createRoomButton = document.querySelector("#create-room");
const joinRoomButton = document.querySelector("#join-button");
const joinRoomForm = document.querySelector("#join-room");
const roomAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomCodePattern = new RegExp(`^[${roomAlphabet}]{10}$`);
const roomProtocol = "life-v1";
const cellColors = [null, ...COLORS, "white"];
const colorCodes = new Map(cellColors.map((color, code) => [color, String(code)]));
const connectionTimeout = 25_000;
const localPreview = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
let activeRoom = null;

function inviteUrl(code) {
  const url = new URL(window.location.href);
  url.hash = new URLSearchParams({ room: code });
  return url.href;
}

function readInvite() {
  const code = new URLSearchParams(window.location.hash.slice(1)).get("room");
  if (code && roomCodePattern.test(code)) roomCodeInput.value = code;
}

function makeRoomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => roomAlphabet[byte % 32]).join("");
}

function showLobby(message) {
  const room = activeRoom;
  activeRoom = null;
  if (room) {
    clearTimeout(room.timeout);
    clearTimeout(room.reconnect);
    room.match?.stop();
    room.peer?.destroy();
    resetRoomGame();
  }
  roomLobby.hidden = false;
  roomSession.hidden = true;
  createRoomButton.disabled = false;
  joinRoomButton.disabled = false;
  connectionStatusEl.textContent = message;
  (roomCodeInput.value ? roomCodeInput : createRoomButton).focus();
}

function showRoom(room, id, color, action) {
  clearTimeout(room.timeout);
  room.ready = true;
  setRoomPlayer(id, color, action);
  roomInvite.value = room.code;
  roomLobby.hidden = true;
  roomSession.hidden = false;
  connectionStatusEl.textContent = room.match ? "Hosting room" : "Connected to room";
  copyInviteButton.focus();
}

function packState(state) {
  return { ...state, cells: state.cells.map((color) => colorCodes.get(color)).join("") };
}

function unpackState(state) {
  if (!state || !Number.isInteger(state.cornerWidth) || state.cornerWidth < 1 ||
      state.cornerWidth > MAX_CORNER_WIDTH || state.size !== state.cornerWidth * 2 ||
      typeof state.cells !== "string" || state.cells.length !== state.size ** 2 ||
      /[^0-5]/.test(state.cells) || !Array.isArray(state.players)) return null;
  return { ...state, cells: Array.from(state.cells, (code) => cellColors[Number(code)]) };
}

function sendRoomMessage(connection, message) {
  if (connection.open) connection.send(message);
}

function publishState(room, state) {
  applyState(state);
  if (room.guests.size === 0) return;
  const message = { type: "state", state: packState(state) };
  for (const guest of room.guests.values()) sendRoomMessage(guest, message);
}

function acceptGuest(room, connection) {
  let id;
  const timeout = setTimeout(() => connection.close(), connectionTimeout);
  connection.on("open", () => {
    clearTimeout(timeout);
    if (activeRoom !== room || !room.match || connection.label !== roomProtocol) {
      connection.close();
      return;
    }

    id = crypto.randomUUID();
    const color = room.match.addPlayer(id);
    if (!color) {
      sendRoomMessage(connection, { type: "rejected", message: "Room is full (4 players)." });
      setTimeout(() => connection.close(), 2000);
      return;
    }

    const state = room.match.snapshot();
    sendRoomMessage(connection, { type: "welcome", id, color, state: packState(state) });
    publishState(room, state);
    room.guests.set(id, connection);
  });
  connection.on("data", (message) => {
    if (activeRoom !== room || !room.guests.has(id) || message?.type !== "action") return;
    const action = message.action;
    if (!action || typeof action.type !== "string") return;
    const error = room.match.applyAction(id, action);
    if (error) sendRoomMessage(connection, { type: "state", state: packState(room.match.snapshot()) });
  });
  connection.on("error", () => connection.close());
  connection.on("close", () => {
    clearTimeout(timeout);
    if (activeRoom !== room || !room.guests.delete(id)) return;
    room.match.removePlayer(id);
  });
}

function joinHost(room) {
  const connection = room.peer.connect(`${roomProtocol}-${room.code}`, {
    label: roomProtocol,
    reliable: true,
  });
  room.host = connection;
  connection.on("data", (message) => {
    if (activeRoom !== room) return;
    if (message?.type === "rejected" && !room.ready) {
      showLobby(message.message);
      return;
    }
    if (message?.type !== (room.ready ? "state" : "welcome")) return;
    const state = unpackState(message.state);
    if (!state) {
      showLobby("The host sent an incompatible match. Make sure you have the same version.");
      return;
    }
    if (!room.ready) {
      showRoom(room, message.id, message.color, (action) =>
        sendRoomMessage(connection, { type: "action", action })
      );
    }
    applyState(state);
  });
  connection.on("error", () => {
    if (activeRoom === room) showLobby("Could not connect to the host. Try again or check relay settings.");
  });
  connection.on("close", () => {
    if (activeRoom !== room) return;
    showLobby(room.ready ? "The host disconnected. Join again with the same code if the room is still open."
      : "The room closed before you could join.");
  });
}

async function loadPeerOptions() {
  const options = {
    secure: true,
    config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] },
  };
  if (!lifeIceServerEndpoint) return options;
  const response = await fetch(lifeIceServerEndpoint, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("ICE server request failed");
  const { iceServers } = await response.json();
  if (!Array.isArray(iceServers) || !iceServers.length) throw new Error("Missing ICE servers");
  options.config.iceServers = iceServers;
  return options;
}

async function openRoom(code, hosting) {
  if (activeRoom) return;
  if (!window.Peer || !window.RTCPeerConnection || !crypto.randomUUID) {
    connectionStatusEl.textContent = "Multiplayer requires a current browser, HTTPS or localhost, and access to PeerJS.";
    return;
  }

  const room = { code, guests: new Map() };
  activeRoom = room;
  createRoomButton.disabled = true;
  joinRoomButton.disabled = true;
  connectionStatusEl.textContent = hosting ? "Creating room…" : "Connecting to room…";
  room.timeout = setTimeout(() => {
    if (activeRoom !== room) return;
    if (hosting) {
      showLobby("Room creation timed out. Try again.");
      return;
    }
    showLobby(lifeIceServerEndpoint
      ? "Connection timed out. Check the room code and try again."
      : "Connection timed out. If the code is right and the host is online, this network may need a TURN relay.");
  }, connectionTimeout);

  let options;
  try {
    options = await loadPeerOptions();
  } catch {
    if (activeRoom === room) showLobby("Could not load relay settings. Try again.");
    return;
  }
  if (activeRoom !== room) return;

  const peer = hosting ? new Peer(`${roomProtocol}-${code}`, options) : new Peer(options);
  room.peer = peer;
  peer.on("open", () => {
    if (activeRoom !== room) return;
    clearTimeout(room.reconnect);
    if (room.ready) {
      connectionStatusEl.textContent = hosting ? "Hosting room" : "Connected to room";
      return;
    }
    if (!hosting) {
      if (!room.host) joinHost(room);
      return;
    }

    const id = crypto.randomUUID();
    room.match = createMatch(id, (state) => publishState(room, state));
    const color = room.match.addPlayer(id);
    showRoom(room, id, color, (action) => room.match.applyAction(id, action));
    applyState(room.match.snapshot());
  });
  peer.on("connection", (connection) => {
    if (hosting && activeRoom === room) acceptGuest(room, connection);
    else connection.close();
  });
  peer.on("error", (error) => {
    if (activeRoom !== room) return;
    if (room.ready && !peer.destroyed) return;
    const messages = {
      "peer-unavailable": "Room not found. Check the code and make sure the host still has the game open.",
      "unavailable-id": "That room code is in use. Create another room.",
    };
    showLobby(messages[error.type] || "Multiplayer connection failed. Try again.");
  });
  peer.on("disconnected", () => {
    if (activeRoom !== room || !room.ready || peer.destroyed) return;
    if (hosting) connectionStatusEl.textContent = "Hosting room. Reconnecting so new players can join…";
    clearTimeout(room.reconnect);
    room.reconnect = setTimeout(() => {
      if (activeRoom === room && peer.disconnected && !peer.destroyed) peer.reconnect();
    }, 2000);
  });
}

createRoomButton.addEventListener("click", () => openRoom(makeRoomCode(), true));
joinRoomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!roomCodePattern.test(code)) {
    connectionStatusEl.textContent = "Enter the 10-character code from your friend.";
    return;
  }
  openRoom(code, false);
});

if (localPreview) copyInviteButton.textContent = "Copy room code";
copyInviteButton.addEventListener("click", async () => {
  const room = activeRoom;
  try {
    await navigator.clipboard.writeText(localPreview ? room.code : inviteUrl(room.code));
    if (activeRoom === room) connectionStatusEl.textContent = localPreview ? "Room code copied." : "Invite link copied.";
  } catch {
    if (activeRoom !== room) return;
    roomInvite.select();
    connectionStatusEl.textContent = "Copy the selected room code and send it to your friends.";
  }
});

document.querySelector("#leave-room").addEventListener("click", () => {
  showLobby("You left the room.");
});

window.addEventListener("hashchange", readInvite);
readInvite();
