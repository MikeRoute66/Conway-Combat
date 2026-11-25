const DEFAULT_CORNER_WIDTH = 32;
const MAX_CORNER_WIDTH = 128;
const COLORS = ["red", "blue", "purple", "green"];
const hostActions = new Set(["start", "stop", "step", "randomize", "speed", "resize"]);
const setupActions = new Set(["toggle", "spawn", "erase", "paste", "clear"]);

function createMatch(hostId, onState) {
  let cornerWidth = DEFAULT_CORNER_WIDTH;
  let size = cornerWidth * 2;
  let cells = createEmptyCells();
  let generation = 0;
  let running = false;
  let speed = 240;
  let timer = null;
  let countdownTimer = null;
  let countdown = null;
  let seenStates = new Set([boardKey()]);
  const players = new Map();

  function indexFor(row, col) {
    return row * size + col;
  }

  function colorForQuarter(row, col) {
    const isTop = row < cornerWidth;
    const isLeft = col < cornerWidth;

    if (isTop && isLeft) return "red";
    if (isTop && !isLeft) return "blue";
    if (!isTop && isLeft) return "purple";
    return "green";
  }

  function indexQuarter(index) {
    const row = Math.floor(index / size);
    const col = index % size;
    return colorForQuarter(row, col);
  }

  function createEmptyCells() {
    return Array.from({ length: size * size }, () => null);
  }

  function clearQuarter(color) {
    cells = cells.map((cellColor, index) => (indexQuarter(index) === color ? null : cellColor));
    generation = 0;
    resetHistory();
  }

  function boardKey() {
    return cells.map((color) => color ?? "-").join(",");
  }

  function resetHistory() {
    seenStates = new Set([boardKey()]);
  }

  function liveNeighbors(row, col) {
    const neighbors = [];

    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
        if (rowOffset === 0 && colOffset === 0) continue;

        const nextRow = row + rowOffset;
        const nextCol = col + colOffset;

        if (nextRow < 0 || nextRow >= size || nextCol < 0 || nextCol >= size) continue;

        const neighborColor = cells[indexFor(nextRow, nextCol)];
        if (neighborColor) neighbors.push(neighborColor);
      }
    }

    return neighbors;
  }

  function birthColor(parentColors) {
    const colorCounts = parentColors.reduce((counts, color) => {
      counts[color] = (counts[color] ?? 0) + 1;
      return counts;
    }, {});

    const majorityColor = Object.entries(colorCounts).find(([, count]) => count >= 2);
    return majorityColor ? majorityColor[0] : "white";
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (countdownTimer) clearInterval(countdownTimer);
    timer = null;
    countdownTimer = null;
    countdown = null;
    running = false;
  }

  function stepGeneration() {
    cells = cells.map((color, index) => {
      const row = Math.floor(index / size);
      const col = index % size;
      const neighbors = liveNeighbors(row, col);
      const neighborCount = neighbors.length;

      if (color) return neighborCount === 2 || neighborCount === 3 ? color : null;
      return neighborCount === 3 ? birthColor(neighbors) : null;
    });

    generation += 1;

    const key = boardKey();
    const isFamiliar = seenStates.has(key);

    if (!cells.some(Boolean) || isFamiliar) {
      stop();
    } else {
      seenStates.add(key);
    }

    broadcast();
  }

  function start() {
    stop();
    resetHistory();
    if (!cells.some(Boolean)) {
      broadcast();
      return;
    }

    countdown = 3;
    broadcast();

    countdownTimer = setInterval(() => {
      countdown -= 1;

      if (countdown > 0) {
        broadcast();
        return;
      }

      clearInterval(countdownTimer);
      countdownTimer = null;
      countdown = null;
      running = true;
      timer = setInterval(stepGeneration, speed);
      broadcast();
    }, 1000);
  }

  function snapshot() {
    const activePlayers = [...players.values()].map(({ id, color }) => ({ id, color, isHost: id === hostId }));

    return {
      size,
      cornerWidth,
      cells: cells.slice(),
      generation,
      running,
      countdown,
      speed,
      hostId,
      players: activePlayers,
    };
  }

  function broadcast() {
    onState(snapshot());
  }

  function addPlayer(id) {
    const used = new Set([...players.values()].map((player) => player.color));
    const available = COLORS.filter((color) => !used.has(color));
    const color = available[Math.floor(Math.random() * available.length)];
    if (!color) return null;
    players.set(id, { id, color });
    return color;
  }

  function removePlayer(id) {
    const player = players.get(id);
    if (!player || id === hostId) return;
    players.delete(id);
    if (!running && countdown === null && generation === 0) clearQuarter(player.color);
    broadcast();
  }

  function applyAction(playerId, body) {
    const player = players.get(playerId);

    if (!player) {
      return "Unknown player";
    }

    if (hostActions.has(body.type) && player.id !== hostId) {
      return "Only the host can use game controls";
    }

    if ((running || countdown !== null) && setupActions.has(body.type)) {
      return "Cannot edit during a match";
    }

    if (body.type === "toggle") {
      const index = Number(body.index);

      if (!Number.isInteger(index) || index < 0 || index >= cells.length) {
        return "Invalid cell index";
      }

      if (indexQuarter(index) !== player.color) {
        return;
      }

      cells[index] = cells[index] ? null : player.color;
      generation = 0;
      resetHistory();
    } else if (body.type === "spawn") {
      const index = Number(body.index);

      if (!Number.isInteger(index) || index < 0 || index >= cells.length) {
        return "Invalid cell index";
      }

      if (indexQuarter(index) !== player.color) {
        return;
      }

      cells[index] = player.color;
      generation = 0;
      resetHistory();
    } else if (body.type === "erase") {
      const index = Number(body.index);

      if (!Number.isInteger(index) || index < 0 || index >= cells.length) {
        return "Invalid cell index";
      }

      if (indexQuarter(index) !== player.color) {
        return;
      }

      if (cells[index] === player.color) cells[index] = null;
      generation = 0;
      resetHistory();
    } else if (body.type === "paste") {
      const anchor = Number(body.anchor);
      const pattern = Array.isArray(body.pattern) ? body.pattern : [];

      if (!Number.isInteger(anchor) || anchor < 0 || anchor >= cells.length || pattern.length > 1024) {
        return "Invalid paste";
      }

      const anchorRow = Math.floor(anchor / size);
      const anchorCol = anchor % size;

      pattern.forEach((cell) => {
        if (!cell || typeof cell !== "object") return;
        const row = anchorRow + Number(cell.row);
        const col = anchorCol + Number(cell.col);

        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= size || col < 0 || col >= size) return;

        const index = indexFor(row, col);
        if (indexQuarter(index) === player.color) cells[index] = player.color;
      });

      generation = 0;
      resetHistory();
    } else if (body.type === "start") {
      start();
      return;
    } else if (body.type === "stop") {
      stop();
    } else if (body.type === "step") {
      stop();
      stepGeneration();
      return;
    } else if (body.type === "randomize") {
      cells = cells.map((_, index) => {
        if (Math.random() <= 0.68) return null;

        const row = Math.floor(index / size);
        const col = index % size;
        return colorForQuarter(row, col);
      });
      generation = 0;
      resetHistory();
    } else if (body.type === "clear") {
      if (running || countdown !== null) {
        return "Cannot clear now";
      }

      cells = cells.map((color) => (color === player.color ? null : color));
      generation = 0;
      resetHistory();
    } else if (body.type === "speed") {
      const nextSpeed = Number(body.speed);
      if (!Number.isFinite(nextSpeed) || nextSpeed < 80 || nextSpeed > 800) {
        return "Invalid speed";
      }

      speed = nextSpeed;
      if (running) {
        clearInterval(timer);
        timer = setInterval(stepGeneration, speed);
      }
    } else if (body.type === "resize") {
      const nextCornerWidth = Number(body.cornerWidth);

      if (!Number.isInteger(nextCornerWidth) || nextCornerWidth < 1 || nextCornerWidth > MAX_CORNER_WIDTH) {
        return `Corner width must be an integer from 1 to ${MAX_CORNER_WIDTH}`;
      }

      stop();
      cornerWidth = nextCornerWidth;
      size = cornerWidth * 2;
      cells = createEmptyCells();
      generation = 0;
      resetHistory();
    } else {
      return "Invalid action";
    }

    broadcast();
  }

  return { addPlayer, removePlayer, snapshot, applyAction, stop };
}
