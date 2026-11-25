const boardFrame = document.querySelector(".board-frame");
const board = document.querySelector("#board");
const countdownOverlay = document.querySelector("#countdown-overlay");
const connectionStatusEl = document.querySelector("#connection-status");
const playerColorEl = document.querySelector("#player-color");
const generationEl = document.querySelector("#generation");
const playerCountEl = document.querySelector("#player-count");
const aliveCountEl = document.querySelector("#alive-count");
const colorCountEls = {
  red: document.querySelector("#red-count"),
  blue: document.querySelector("#blue-count"),
  purple: document.querySelector("#purple-count"),
  green: document.querySelector("#green-count"),
  white: document.querySelector("#white-count"),
};
const toggleButton = document.querySelector("#toggle");
const stepButton = document.querySelector("#step");
const randomizeButton = document.querySelector("#randomize");
const clearButton = document.querySelector("#clear");
const controlsEl = document.querySelector(".controls");
const speedControlEl = document.querySelector(".speed");
const testButton = document.querySelector("#test");
const resetTestButton = document.querySelector("#reset-test");
const replayButton = document.querySelector("#replay");
const replayPrevButton = document.querySelector("#replay-prev");
const replayNextButton = document.querySelector("#replay-next");
const replayStatusEl = document.querySelector("#replay-status");
const speedInput = document.querySelector("#speed");
const gridSizeControlEl = document.querySelector(".grid-size-control");
const cornerWidthInput = document.querySelector("#corner-width");
const patternList = document.querySelector("#pattern-list");
const copyStatusEl = document.querySelector("#copy-status");
const borderZones = document.querySelectorAll(".border-zone");

const CHEAT_PATTERNS = [
  { name: "Block", cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { name: "Blinker", cells: [[0, 0], [0, 1], [0, 2]] },
  { name: "Toad", cells: [[0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2]] },
  { name: "Beacon", cells: [[0, 0], [0, 1], [1, 0], [2, 3], [3, 2], [3, 3]] },
  { name: "Glider", cells: [[0, 1], [1, 2], [2, 0], [2, 1], [2, 2]] },
  { name: "LWSS", cells: [[0, 1], [0, 4], [1, 0], [2, 0], [2, 4], [3, 0], [3, 1], [3, 2], [3, 3]] },
  { name: "Pulsar", cells: [[0, 2], [0, 3], [0, 4], [0, 8], [0, 9], [0, 10], [2, 0], [2, 5], [2, 7], [2, 12], [3, 0], [3, 5], [3, 7], [3, 12], [4, 0], [4, 5], [4, 7], [4, 12], [5, 2], [5, 3], [5, 4], [5, 8], [5, 9], [5, 10], [7, 2], [7, 3], [7, 4], [7, 8], [7, 9], [7, 10], [8, 0], [8, 5], [8, 7], [8, 12], [9, 0], [9, 5], [9, 7], [9, 12], [10, 0], [10, 5], [10, 7], [10, 12], [12, 2], [12, 3], [12, 4], [12, 8], [12, 9], [12, 10]] },
  { name: "Pentadecathlon", cells: [[0, 1], [1, 1], [2, 0], [2, 2], [3, 1], [4, 1], [5, 1], [6, 1], [7, 0], [7, 2], [8, 1], [9, 1]] },
  { name: "R-Pentomino", cells: [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]] },
  { name: "Acorn", cells: [[0, 1], [1, 3], [2, 0], [2, 1], [2, 4], [2, 5], [2, 6]] },
  { name: "Diehard", cells: [[0, 6], [1, 0], [1, 1], [2, 1], [2, 5], [2, 6], [2, 7]] },
];

let cornerWidth = DEFAULT_CORNER_WIDTH;
let size = cornerWidth * 2;
let cells = Array.from({ length: size * size }, () => null);
let generation = 0;
let running = false;
let countdown = null;
let playerId = null;
let playerColor = null;
let isHost = false;
let playerCount = 0;
let selectedQuarter = null;
let testCells = null;
let testGeneration = 0;
let testTimer = null;
let testSeenStates = new Set();
let playbackQueue = [];
let playbackTimer = null;
let playbackSpeed = Number(speedInput.value);
let renderCache = [];
let pointerState = null;
let selectionRect = null;
let copyBuffer = null;
let copiedPatternName = null;
let activeCellIndex = null;
let testHistory = [];
let matchHistory = [];
let matchWasActive = false;
let lastMatchFrameKey = null;
let replayFrames = [];
let replayIndex = 0;
let replayMode = false;
let replaySource = null;
let replayReturnState = null;

function indexFor(row, col) {
  return row * size + col;
}

function rowColFor(index) {
  return {
    row: Math.floor(index / size),
    col: index % size,
  };
}

function quarterBounds(quarter) {
  const bounds = {
    red: { rowStart: 0, colStart: 0 },
    blue: { rowStart: 0, colStart: cornerWidth },
    purple: { rowStart: cornerWidth, colStart: 0 },
    green: { rowStart: cornerWidth, colStart: cornerWidth },
  };

  return bounds[quarter];
}

function visibleCellIndexes() {
  if (!selectedQuarter) return activeCells().map((_, index) => index);

  const indexes = [];
  const { rowStart, colStart } = quarterBounds(selectedQuarter);

  for (let row = rowStart; row < rowStart + cornerWidth; row += 1) {
    for (let col = colStart; col < colStart + cornerWidth; col += 1) {
      indexes.push(indexFor(row, col));
    }
  }

  return indexes;
}

function indexQuarter(index) {
  const row = Math.floor(index / size);
  const col = index % size;

  if (row < cornerWidth && col < cornerWidth) return "red";
  if (row < cornerWidth && col >= cornerWidth) return "blue";
  if (row >= cornerWidth && col < cornerWidth) return "purple";
  return "green";
}

function activeCells() {
  return currentReplayFrame()?.cells ?? testCells ?? cells;
}

function activeGeneration() {
  return currentReplayFrame()?.generation ?? (testCells ? testGeneration : generation);
}

function canEditIndex(index) {
  return !replayMode && Boolean(playerColor) && indexQuarter(index) === playerColor;
}

function boardKey(sourceCells) {
  return sourceCells.map((color) => color ?? "-").join(",");
}

function liveNeighbors(sourceCells, row, col) {
  const neighbors = [];

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
      if (rowOffset === 0 && colOffset === 0) continue;

      const nextRow = row + rowOffset;
      const nextCol = col + colOffset;

      if (nextRow < 0 || nextRow >= size || nextCol < 0 || nextCol >= size) continue;

      const neighborColor = sourceCells[indexFor(nextRow, nextCol)];
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

function nextTestGeneration() {
  testCells = testCells.map((color, index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    const neighbors = liveNeighbors(testCells, row, col);
    const neighborCount = neighbors.length;

    if (color) return neighborCount === 2 || neighborCount === 3 ? color : null;
    return neighborCount === 3 ? birthColor(neighbors) : null;
  });

  testGeneration += 1;
  recordTestFrame();
  render();

  const key = boardKey(testCells);
  const isFamiliar = testSeenStates.has(key);

  if (!testCells.some(Boolean) || isFamiliar) {
    window.clearInterval(testTimer);
    testTimer = null;
    finishReplay(testHistory, "test");
    return;
  }

  testSeenStates.add(key);
}

function currentReplayFrame() {
  return replayMode ? replayFrames[replayIndex] ?? null : null;
}

function cloneReplayFrame(sourceCells, frameGeneration, source) {
  return {
    cells: [...sourceCells],
    generation: frameGeneration,
    size,
    cornerWidth,
    source,
  };
}

function frameKey(frame) {
  return `${frame.generation}|${frame.cells.map((color) => color ?? "-").join(",")}`;
}

function recordTestFrame() {
  testHistory.push(cloneReplayFrame(testCells, testGeneration, "test"));
}

function recordMatchState(state) {
  const isMatchActive = state.countdown !== null || state.running;
  const isGenerationFrame = state.countdown === null && (state.running || matchWasActive);

  if (isMatchActive && !matchWasActive) {
    matchHistory = [];
    lastMatchFrameKey = null;
  }

  if (isGenerationFrame) {
    const frame = {
      cells: [...state.cells],
      generation: state.generation,
      size: state.size,
      cornerWidth: state.cornerWidth,
      source: "match",
    };
    const key = frameKey(frame);

    if (key !== lastMatchFrameKey) {
      matchHistory.push(frame);
      lastMatchFrameKey = key;
    }
  }

  if (!isMatchActive && matchWasActive && matchHistory.length > 0) {
    finishReplay(matchHistory, "match");
  }

  matchWasActive = isMatchActive;
}

function finishReplay(frames, source) {
  if (frames.length === 0) return;

  replayFrames = frames.map((frame) => ({
    cells: [...frame.cells],
    generation: frame.generation,
    size: frame.size,
    cornerWidth: frame.cornerWidth,
    source,
  }));
  replayIndex = replayFrames.length - 1;
  replaySource = source;
  replayMode = false;
}

function startReplay() {
  if (replayFrames.length === 0) return;

  replayReturnState = { size, cornerWidth, selectedQuarter };
  replayMode = true;
  replayIndex = Math.min(replayIndex, replayFrames.length - 1);
  clearSelection();
  const frame = currentReplayFrame();
  const sizeChanged = frame && frame.size !== size;

  if (frame) {
    size = frame.size;
    cornerWidth = frame.cornerWidth;
  }

  if (sizeChanged) {
    selectedQuarter = null;
    boardFrame.dataset.view = "full";
    buildBoard();
  }

  render();
}

function stopReplay() {
  if (!replayMode) return;

  replayMode = false;
  if (replayReturnState) {
    size = replayReturnState.size;
    cornerWidth = replayReturnState.cornerWidth;
    selectedQuarter = replayReturnState.selectedQuarter;
  }
  replayReturnState = null;
  boardFrame.dataset.view = selectedQuarter ?? "full";
  borderZones.forEach((zone) => {
    zone.classList.toggle("selected", selectedQuarter === zone.dataset.quarter);
  });
  buildBoard();
  render();
}

function setReplayIndex(nextIndex) {
  if (!replayMode) return;

  replayIndex = Math.max(0, Math.min(replayFrames.length - 1, nextIndex));
  const frame = currentReplayFrame();
  const sizeChanged = frame && frame.size !== size;

  if (frame) {
    size = frame.size;
    cornerWidth = frame.cornerWidth;
  }

  if (sizeChanged) buildBoard();
  render();
}

function clearSelection() {
  selectionRect = null;
  activeCellIndex = null;
}

function replayStatusText() {
  if (replayFrames.length === 0) return "No replay";

  const source = replaySource === "test" ? "Test" : "Match";
  return `${source} ${replayIndex + 1}/${replayFrames.length}`;
}

function stopPlayback() {
  window.clearInterval(playbackTimer);
  playbackTimer = null;
}

function startPlayback() {
  if (playbackTimer) return;

  playbackTimer = window.setInterval(() => {
    const nextState = playbackQueue.shift();
    if (nextState) applyDisplayedState(nextState);
  }, playbackSpeed);
}

function setPlaybackSpeed(nextSpeed) {
  playbackSpeed = nextSpeed;

  if (playbackTimer) {
    stopPlayback();
    startPlayback();
  }
}

function selectionBounds() {
  if (!selectionRect) return null;

  const start = rowColFor(selectionRect.start);
  const end = rowColFor(selectionRect.end);

  return {
    rowMin: Math.min(start.row, end.row),
    rowMax: Math.max(start.row, end.row),
    colMin: Math.min(start.col, end.col),
    colMax: Math.max(start.col, end.col),
  };
}

function isInSelection(index) {
  const bounds = selectionBounds();
  if (!bounds) return false;

  const { row, col } = rowColFor(index);
  return row >= bounds.rowMin && row <= bounds.rowMax && col >= bounds.colMin && col <= bounds.colMax;
}

function selectionEdges(index) {
  const bounds = selectionBounds();
  if (!bounds) return "";

  const { row, col } = rowColFor(index);
  if (row < bounds.rowMin || row > bounds.rowMax || col < bounds.colMin || col > bounds.colMax) return "";

  return [
    row === bounds.rowMin ? "t" : "",
    row === bounds.rowMax ? "b" : "",
    col === bounds.colMin ? "l" : "",
    col === bounds.colMax ? "r" : "",
  ].join("");
}

function copyStatusText() {
  if (copyBuffer) {
    const name = copiedPatternName ?? "selection";
    return activeCellIndex === null ? `Copied ${name}: click destination` : `Copied ${name}: press Ctrl+V`;
  }

  if (selectionRect) return "Selection ready: press Ctrl+C";
  return "No pattern copied";
}

function render() {
  const cellButtons = board.querySelectorAll(".cell");
  const visibleIndexes = visibleCellIndexes();
  const renderedCells = activeCells();
  const isTestMode = Boolean(testCells) && !replayMode;
  const isTestRunning = Boolean(testTimer) && !replayMode;
  const isCountdown = countdown !== null;
  const isSetupPhase = !replayMode && !running && generation === 0 && !isTestMode && !isCountdown;
  const colorCounts = {
    red: 0,
    blue: 0,
    purple: 0,
    green: 0,
    white: 0,
  };

  renderedCells.forEach((color) => {
    if (color) colorCounts[color] += 1;
  });

  visibleIndexes.forEach((index, buttonIndex) => {
    const color = renderedCells[index];
    const cell = cellButtons[buttonIndex];
    const isHiddenOpponent = isSetupPhase && color && (color !== playerColor || indexQuarter(index) !== playerColor);
    const visibleColor = isHiddenOpponent ? null : color;
    const isAlive = Boolean(visibleColor);
    const canEdit = canEditIndex(index);
    const selectedEdges = selectionEdges(index);
    const isActive = activeCellIndex === index;
    const renderKey = `${visibleColor ?? ""}|${isHiddenOpponent ? "1" : "0"}|${canEdit ? "1" : "0"}|${selectedEdges}|${isActive ? "1" : "0"}`;

    if (renderCache[buttonIndex] !== renderKey) {
      cell.classList.toggle("alive", isAlive);
      cell.classList.toggle("hidden-opponent", Boolean(isHiddenOpponent));
      cell.classList.toggle("locked", !canEdit);
      cell.classList.toggle("selected", Boolean(selectedEdges));
      cell.classList.toggle("selection-top", selectedEdges.includes("t"));
      cell.classList.toggle("selection-bottom", selectedEdges.includes("b"));
      cell.classList.toggle("selection-left", selectedEdges.includes("l"));
      cell.classList.toggle("selection-right", selectedEdges.includes("r"));
      cell.classList.toggle("active", isActive);
      cell.dataset.color = visibleColor ?? "";
      cell.disabled = false;
      cell.setAttribute("aria-pressed", String(isAlive));
      cell.setAttribute("aria-label", `Row ${Math.floor(index / size) + 1}, column ${(index % size) + 1}: ${isAlive ? `${visibleColor} alive` : "dead"}`);
      renderCache[buttonIndex] = renderKey;
    }
  });

  generationEl.textContent = String(activeGeneration());
  playerCountEl.textContent = String(playerCount);
  aliveCountEl.textContent = String(Object.values(colorCounts).reduce((total, count) => total + count, 0));
  toggleButton.textContent = running ? "Pause" : "Start";
  toggleButton.disabled = isCountdown;
  stepButton.disabled = running || isCountdown;
  randomizeButton.disabled = running || isCountdown;
  speedInput.value = String(speedInput.value);
  controlsEl.hidden = !isHost || isTestMode || replayMode;
  speedControlEl.hidden = !isHost || isTestMode || replayMode;
  gridSizeControlEl.hidden = !isHost || isTestMode || replayMode;
  cornerWidthInput.disabled = running || isCountdown || replayMode;
  cornerWidthInput.value = String(cornerWidth);
  testButton.disabled = running || isCountdown || isTestMode || replayMode || !playerColor;
  resetTestButton.disabled = !isTestMode || replayMode;
  clearButton.disabled = running || isCountdown || isTestMode || replayMode || !playerColor;
  replayButton.disabled = replayFrames.length === 0 || running || isCountdown || isTestRunning;
  replayButton.textContent = replayMode ? "Exit Replay" : "Replay";
  replayPrevButton.disabled = !replayMode || replayIndex <= 0;
  replayNextButton.disabled = !replayMode || replayIndex >= replayFrames.length - 1;
  replayStatusEl.textContent = replayStatusText();
  copyStatusEl.textContent = copyStatusText();
  boardFrame.classList.toggle("running", running || isCountdown || isTestRunning || replayMode);
  boardFrame.classList.toggle("testing", isTestMode);
  countdownOverlay.hidden = !isCountdown;
  countdownOverlay.textContent = isCountdown ? String(countdown) : "";

  Object.entries(colorCounts).forEach(([color, count]) => {
    colorCountEls[color].textContent = String(count);
  });
}

function toggleCell(index) {
  if (replayMode || testCells || countdown !== null) return;
  if (!canEditIndex(index)) return;

  cells[index] = cells[index] ? null : playerColor;
  generation = 0;
  render();
  sendAction({ type: "toggle", index });
}

function spawnCell(index) {
  if (replayMode || testCells || countdown !== null || !canEditIndex(index) || cells[index] === playerColor) return;

  cells[index] = playerColor;
  generation = 0;
  render();
  sendAction({ type: "spawn", index });
}

function eraseCell(index) {
  if (replayMode || testCells || countdown !== null || !canEditIndex(index) || cells[index] !== playerColor) return;

  cells[index] = null;
  generation = 0;
  render();
  sendAction({ type: "erase", index });
}

function pastePattern(anchor) {
  if (replayMode || !copyBuffer || testCells || countdown !== null || !canEditIndex(anchor)) return;

  const { row: anchorRow, col: anchorCol } = rowColFor(anchor);
  const pattern = [];

  copyBuffer.forEach((cell) => {
    const row = anchorRow + cell.row;
    const col = anchorCol + cell.col;

    if (row < 0 || row >= size || col < 0 || col >= size) return;

    const index = indexFor(row, col);
    if (!canEditIndex(index)) return;

    cells[index] = playerColor;
    pattern.push(cell);
  });

  if (pattern.length === 0) return;

  generation = 0;
  selectionRect = null;
  render();
  sendAction({ type: "paste", anchor, pattern });
}

function buildBoard() {
  const fragment = document.createDocumentFragment();
  const indexes = visibleCellIndexes();
  const gridSize = selectedQuarter ? cornerWidth : size;

  board.innerHTML = "";
  renderCache = [];
  board.style.setProperty("--grid-size", String(gridSize));
  board.setAttribute("aria-label", `${gridSize} by ${gridSize} ${selectedQuarter ?? "full"} game board view`);

  indexes.forEach((index) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.dataset.index = String(index);
    cell.setAttribute("role", "gridcell");
    fragment.appendChild(cell);
  });

  board.appendChild(fragment);
}

function setQuarterView(quarter) {
  selectedQuarter = selectedQuarter === quarter ? null : quarter;
  boardFrame.dataset.view = selectedQuarter ?? "full";

  borderZones.forEach((zone) => {
    zone.classList.toggle("selected", selectedQuarter === zone.dataset.quarter);
  });

  buildBoard();
  render();
}

toggleButton.addEventListener("click", () => {
  if (replayMode) return;
  sendAction({ type: running ? "stop" : "start" });
});

stepButton.addEventListener("click", () => {
  if (replayMode) return;
  sendAction({ type: "step" });
});

randomizeButton.addEventListener("click", () => {
  if (replayMode) return;
  sendAction({ type: "randomize" });
});

clearButton.addEventListener("click", () => {
  if (replayMode || running || countdown !== null || testCells || !playerColor) return;

  cells = cells.map((color) => (color === playerColor ? null : color));
  generation = 0;
  render();
  sendAction({ type: "clear" });
});

testButton.addEventListener("click", () => {
  if (replayMode || running || countdown !== null || !playerColor || testCells) return;

  testCells = cells.map((color) => (color === playerColor ? color : null));
  testGeneration = 0;
  testHistory = [];
  recordTestFrame();
  testSeenStates = new Set([boardKey(testCells)]);
  testTimer = window.setInterval(nextTestGeneration, Number(speedInput.value));
  render();
});

resetTestButton.addEventListener("click", () => {
  if (replayMode) return;
  window.clearInterval(testTimer);
  testTimer = null;
  testCells = null;
  testGeneration = 0;
  testSeenStates = new Set();
  render();
});

replayButton.addEventListener("click", () => {
  if (replayMode) {
    stopReplay();
    return;
  }

  if (running || countdown !== null || testTimer || replayFrames.length === 0) return;
  startReplay();
});

replayPrevButton.addEventListener("click", () => {
  setReplayIndex(replayIndex - 1);
});

replayNextButton.addEventListener("click", () => {
  setReplayIndex(replayIndex + 1);
});

speedInput.addEventListener("input", () => {
  if (replayMode) return;
  sendAction({ type: "speed", speed: Number(speedInput.value) });
});

cornerWidthInput.addEventListener("change", () => {
  if (replayMode) return;
  const nextCornerWidth = Number(cornerWidthInput.value);
  if (!Number.isInteger(nextCornerWidth) || nextCornerWidth < 1) {
    cornerWidthInput.value = String(cornerWidth);
    return;
  }

  sendAction({ type: "resize", cornerWidth: nextCornerWidth });
});

borderZones.forEach((zone) => {
  zone.addEventListener("click", () => setQuarterView(zone.dataset.quarter));
});

function cellIndexFromEvent(event) {
  const target = event.target.closest(".cell") || document.elementFromPoint(event.clientX, event.clientY)?.closest(".cell");
  const cell = target && board.contains(target) ? target : null;
  if (!cell || !board.contains(cell)) return null;

  const index = Number(cell.dataset.index);
  return Number.isInteger(index) ? index : null;
}

function copySelection() {
  if (replayMode) return;

  const bounds = selectionBounds();
  if (!bounds || !playerColor) return;

  const pattern = [];

  for (let row = bounds.rowMin; row <= bounds.rowMax; row += 1) {
    for (let col = bounds.colMin; col <= bounds.colMax; col += 1) {
      const index = indexFor(row, col);
      if (cells[index] === playerColor && indexQuarter(index) === playerColor) {
        pattern.push({ row: row - bounds.rowMin, col: col - bounds.colMin });
      }
    }
  }

  copyBuffer = pattern.length > 0 ? pattern : null;
  copiedPatternName = copyBuffer ? "selection" : null;
  activeCellIndex = null;
  render();
}

function setCopiedPattern(name, cellsToCopy) {
  if (replayMode) return;

  copyBuffer = cellsToCopy.map(([row, col]) => ({ row, col }));
  copiedPatternName = name;
  selectionRect = null;
  activeCellIndex = null;
  render();
}

function buildPatternList() {
  const fragment = document.createDocumentFragment();

  CHEAT_PATTERNS.forEach((pattern) => {
    const button = document.createElement("button");
    const preview = document.createElement("span");
    const label = document.createElement("span");
    const maxRow = Math.max(...pattern.cells.map(([row]) => row));
    const maxCol = Math.max(...pattern.cells.map(([, col]) => col));
    const liveCells = new Set(pattern.cells.map(([row, col]) => `${row},${col}`));

    button.type = "button";
    preview.className = "pattern-preview";
    preview.style.setProperty("--pattern-rows", String(maxRow + 1));
    preview.style.setProperty("--pattern-cols", String(maxCol + 1));
    label.className = "pattern-label";
    label.textContent = pattern.name;

    for (let row = 0; row <= maxRow; row += 1) {
      for (let col = 0; col <= maxCol; col += 1) {
        const cell = document.createElement("span");
        cell.className = liveCells.has(`${row},${col}`) ? "pattern-cell live" : "pattern-cell";
        preview.appendChild(cell);
      }
    }

    button.append(preview, label);
    button.addEventListener("click", () => setCopiedPattern(pattern.name, pattern.cells));
    fragment.appendChild(button);
  });

  patternList.appendChild(fragment);
}

board.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

board.addEventListener("pointerdown", (event) => {
  const index = cellIndexFromEvent(event);
  if (index === null || replayMode || testCells || countdown !== null) return;

  if (event.button === 2 || (event.button === 0 && event.shiftKey)) {
    event.preventDefault();
    pointerState = { type: "select", start: index, last: index, moved: false };
    selectionRect = { start: index, end: index };
    board.setPointerCapture(event.pointerId);
    render();
    return;
  }

  if (event.button !== 0 || !canEditIndex(index)) return;

  event.preventDefault();
  pointerState = { type: cells[index] === playerColor ? "erase" : "paint", start: index, last: index, moved: false, touched: new Set() };
  board.setPointerCapture(event.pointerId);
});

board.addEventListener("pointermove", (event) => {
  if (!pointerState) return;

  const index = cellIndexFromEvent(event);
  if (index === null || index === pointerState.last) return;

  pointerState.moved = true;
  pointerState.last = index;

  if (pointerState.type === "select") {
    selectionRect = { start: pointerState.start, end: index };
    render();
    return;
  }

  if (pointerState.type === "paint" || pointerState.type === "erase") {
    [pointerState.start, index].forEach((cellIndex) => {
      if (!pointerState.touched.has(cellIndex)) {
        pointerState.touched.add(cellIndex);
        if (pointerState.type === "paint") {
          spawnCell(cellIndex);
        } else {
          eraseCell(cellIndex);
        }
      }
    });
  }
});

board.addEventListener("pointerup", (event) => {
  if (!pointerState) return;

  const state = pointerState;
  pointerState = null;

  if (board.hasPointerCapture(event.pointerId)) {
    board.releasePointerCapture(event.pointerId);
  }

  const index = cellIndexFromEvent(event) ?? state.last;

  if (state.type === "select") {
    selectionRect = { start: state.start, end: index };
    activeCellIndex = null;
    render();
    return;
  }

  if (state.moved) {
    if (state.type === "paint") {
      spawnCell(index);
    } else {
      eraseCell(index);
    }
    return;
  }

  if (copyBuffer) {
    activeCellIndex = canEditIndex(index) ? index : null;
    selectionRect = null;
    render();
    return;
  }

  toggleCell(index);
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if ((event.ctrlKey || event.metaKey) && key === "c") {
    event.preventDefault();
    if (replayMode) return;
    copySelection();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && key === "v") {
    event.preventDefault();
    if (replayMode) return;
    if (activeCellIndex !== null) pastePattern(activeCellIndex);
    return;
  }

  if (event.key === "Escape") {
    if (replayMode) {
      stopReplay();
      return;
    }

    copyBuffer = null;
    copiedPatternName = null;
    selectionRect = null;
    activeCellIndex = null;
    render();
  }
});

function clearTestMode() {
  window.clearInterval(testTimer);
  testTimer = null;
  testCells = null;
  testGeneration = 0;
  testSeenStates = new Set();
}

function applyDisplayedState(state) {
  const sizeChanged = state.size !== size;

  recordMatchState(state);
  size = state.size;
  cornerWidth = state.cornerWidth;
  cells = state.cells;
  generation = state.generation;
  running = state.running;
  countdown = state.countdown;
  isHost = playerId !== null && state.hostId === playerId;
  playerCount = state.players.length;
  speedInput.value = String(state.speed);
  cornerWidthInput.value = String(cornerWidth);
  if (sizeChanged) {
    selectedQuarter = null;
    boardFrame.dataset.view = "full";
    selectionRect = null;
    activeCellIndex = null;
    buildBoard();
  }
  render();
}

function applyState(state) {
  const combatStarted = state.running && !running;
  const countdownStarted = state.countdown !== null && countdown === null;

  if (replayMode && (state.running || state.countdown !== null)) stopReplay();
  if ((combatStarted || countdownStarted) && testCells) clearTestMode();

  setPlaybackSpeed(Number(state.speed));

  if (state.running) {
    if (!running) {
      playbackQueue = [];
      applyDisplayedState(state);
    } else {
      playbackQueue.push(state);

      if (playbackQueue.length > 8) {
        playbackQueue = playbackQueue.slice(-8);
      }
    }

    startPlayback();
    return;
  }

  playbackQueue = [];
  stopPlayback();
  applyDisplayedState(state);
}

function sendAction(action) {
  roomAction?.(action);
}

function setRoomPlayer(id, color, action) {
  playerId = id;
  playerColor = color;
  roomAction = action;
  playerColorEl.textContent = color ? `as ${color}` : "";
  playerColorEl.className = color ? `player-color ${color}` : "";
}

function resetRoomGame() {
  if (replayMode) stopReplay();
  clearTestMode();
  setRoomPlayer(null, null, null);
  playbackQueue = [];
  stopPlayback();
  testHistory = [];
  matchHistory = [];
  matchWasActive = false;
  lastMatchFrameKey = null;
  replayFrames = [];
  replaySource = null;
  selectedQuarter = null;
  boardFrame.dataset.view = "full";
  clearSelection();
  pointerState = null;
  activeCellIndex = null;
  applyDisplayedState({
    size: DEFAULT_CORNER_WIDTH * 2,
    cornerWidth: DEFAULT_CORNER_WIDTH,
    cells: Array((DEFAULT_CORNER_WIDTH * 2) ** 2).fill(null),
    generation: 0,
    running: false,
    countdown: null,
    speed: 240,
    hostId: null,
    players: [],
  });
  buildBoard();
  render();
}

let roomAction = null;
buildBoard();
buildPatternList();
render();
