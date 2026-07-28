/**
 * Standalone 16x16 Pixel Art Editor Client App Logic.
 * Handles interactive grid drawing, state history, live 72x16 matrix preview, and API IPC.
 */

(function () {
  const GRID_SIZE = 16;
  let allIcons = {};
  let currentKey = 'SLACK_16X16_BITMAP';
  let activeMatrix = createEmptyMatrix();
  let activeColor = 'null';
  let activeTool = 'pencil'; // 'pencil', 'eraser', 'picker'
  let isMouseDown = false;

  // Undo / Redo History Stack
  let historyStack = [];
  let historyIndex = -1;

  // DOM Elements
  const iconSelect = document.getElementById('iconSelect');
  const gridCanvas = document.getElementById('gridCanvas');
  const paletteGrid = document.getElementById('paletteGrid');
  const customColorPicker = document.getElementById('customColorPicker');
  const hoverCoords = document.getElementById('hoverCoords');
  const previewCanvas = document.getElementById('previewMatrixCanvas');
  const previewCtx = previewCanvas.getContext('2d');
  const toast = document.getElementById('toast');

  const toolPencil = document.getElementById('toolPencil');
  const toolEraser = document.getElementById('toolEraser');
  const toolPicker = document.getElementById('toolPicker');

  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  const btnClear = document.getElementById('btnClear');
  const btnSave = document.getElementById('btnSave');

  /**
   * Initializes application state and fetches icons from backend API.
   */
  async function init() {
    setupEventListeners();
    await fetchIcons();
    loadIcon(iconSelect.value);
  }

  function createEmptyMatrix() {
    return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
  }

  async function fetchIcons() {
    try {
      const res = await fetch('/api/icons');
      const data = await res.json();
      if (data.success) {
        allIcons = data.icons;
        console.log('[PixelEditor] Loaded icons:', Object.keys(allIcons));
      }
    } catch (err) {
      console.error('[PixelEditor] Failed to fetch icons:', err);
    }
  }

  function loadIcon(key) {
    currentKey = key;
    if (allIcons[key]) {
      activeMatrix = JSON.parse(JSON.stringify(allIcons[key]));
    } else {
      activeMatrix = createEmptyMatrix();
    }
    historyStack = [];
    historyIndex = -1;
    saveHistoryState();
    renderGrid();
    renderPreview();
  }

  function saveHistoryState() {
    const snapshot = JSON.stringify(activeMatrix);
    if (historyIndex >= 0 && historyStack[historyIndex] === snapshot) return;
    
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(snapshot);
    historyIndex = historyStack.length - 1;
  }

  function undo() {
    if (historyIndex > 0) {
      historyIndex--;
      activeMatrix = JSON.parse(historyStack[historyIndex]);
      renderGrid();
      renderPreview();
    }
  }

  function redo() {
    if (historyIndex < historyStack.length - 1) {
      historyIndex++;
      activeMatrix = JSON.parse(historyStack[historyIndex]);
      renderGrid();
      renderPreview();
    }
  }

  function renderGrid() {
    gridCanvas.innerHTML = '';
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.x = x;
        cell.dataset.y = y;

        const color = activeMatrix[y][x];
        if (color === null || color === 'null') {
          cell.classList.add('cell-transparent');
          cell.style.backgroundColor = '';
        } else {
          cell.style.backgroundColor = color;
        }

        cell.addEventListener('mouseenter', (e) => {
          hoverCoords.textContent = `X: ${x}, Y: ${y}`;
          if (isMouseDown) applyTool(x, y);
        });

        cell.addEventListener('mousedown', (e) => {
          e.preventDefault();
          isMouseDown = true;
          applyTool(x, y);
        });

        gridCanvas.appendChild(cell);
      }
    }
  }

  function applyTool(x, y) {
    if (activeTool === 'pencil') {
      const colorToApply = activeColor === 'null' ? null : activeColor;
      if (activeMatrix[y][x] !== colorToApply) {
        activeMatrix[y][x] = colorToApply;
        updateCellUI(x, y, colorToApply);
        renderPreview();
      }
    } else if (activeTool === 'eraser') {
      if (activeMatrix[y][x] !== null) {
        activeMatrix[y][x] = null;
        updateCellUI(x, y, null);
        renderPreview();
      }
    } else if (activeTool === 'picker') {
      const pickedColor = activeMatrix[y][x];
      setActiveColor(pickedColor || 'null');
      setTool('pencil');
    }
  }

  function updateCellUI(x, y, color) {
    const index = y * GRID_SIZE + x;
    const cell = gridCanvas.children[index];
    if (!cell) return;

    if (color === null || color === 'null') {
      cell.classList.add('cell-transparent');
      cell.style.backgroundColor = '';
    } else {
      cell.classList.remove('cell-transparent');
      cell.style.backgroundColor = color;
    }
  }

  function setActiveColor(color) {
    activeColor = color;
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      if (swatch.dataset.color === color) {
        swatch.classList.add('active');
      } else {
        swatch.classList.remove('active');
      }
    });
    if (color !== 'null') {
      customColorPicker.value = color.length === 7 ? color : '#38BDF8';
    }
  }

  function setTool(tool) {
    activeTool = tool;
    toolPencil.classList.toggle('active', tool === 'pencil');
    toolEraser.classList.toggle('active', tool === 'eraser');
    toolPicker.classList.toggle('active', tool === 'picker');
  }

  function setupEventListeners() {
    document.addEventListener('mouseup', () => {
      if (isMouseDown) {
        isMouseDown = false;
        saveHistoryState();
      }
    });

    iconSelect.addEventListener('change', (e) => loadIcon(e.target.value));

    toolPencil.addEventListener('click', () => setTool('pencil'));
    toolEraser.addEventListener('click', () => setTool('eraser'));
    toolPicker.addEventListener('click', () => setTool('picker'));

    paletteGrid.addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (swatch) {
        setActiveColor(swatch.dataset.color);
        if (activeTool === 'eraser') setTool('pencil');
      }
    });

    customColorPicker.addEventListener('input', (e) => {
      setActiveColor(e.target.value.toUpperCase());
      if (activeTool === 'eraser') setTool('pencil');
    });

    btnUndo.addEventListener('click', undo);
    btnRedo.addEventListener('click', redo);
    btnClear.addEventListener('click', () => {
      activeMatrix = createEmptyMatrix();
      saveHistoryState();
      renderGrid();
      renderPreview();
    });

    btnSave.addEventListener('click', saveToProject);

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    });
  }

  async function saveToProject() {
    allIcons[currentKey] = activeMatrix;
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: currentKey, matrix: activeMatrix })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Saved ${currentKey} to pixel-bitmaps.ts!`);
      } else {
        alert(`Failed to save: ${data.error}`);
      }
    } catch (err) {
      alert(`Error saving to project: ${err.message}`);
    }
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  /**
   * Renders real-time 1:1 hardware simulation preview (72x16 matrix).
   */
  function renderPreview() {
    const scale = 8; // 72x8 = 576, 16x8 = 128
    previewCtx.fillStyle = '#090D16';
    previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

    // 1. Draw 16x16 icon at x=0..15
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const color = activeMatrix[y][x];
        if (color && color !== 'null') {
          previewCtx.fillStyle = color;
          previewCtx.fillRect(x * scale, y * scale, scale - 1, scale - 1);
        } else {
          previewCtx.fillStyle = '#111827';
          previewCtx.fillRect(x * scale, y * scale, scale - 1, scale - 1);
        }
      }
    }

    // 2. Draw mock display text on x=16..71
    previewCtx.fillStyle = '#38BDF8';
    previewCtx.font = 'bold 32px "JetBrains Mono", monospace';
    previewCtx.fillText('PROJ-142', 150, 50);

    previewCtx.fillStyle = '#F8FAFC';
    previewCtx.font = '24px "JetBrains Mono", monospace';
    previewCtx.fillText('00:14:20 Active Task', 150, 95);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
