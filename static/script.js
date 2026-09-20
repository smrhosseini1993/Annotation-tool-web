/**
 * Local medical image annotation tool.
 *
 * Images remain at their native dimensions. A logical 128 × 128 grid creates
 * reproducible, image-aligned annotation masks without assuming a modality,
 * anatomy, fixed shape, or fixed image size.
 */

document.addEventListener('DOMContentLoaded', () => {
    const GRID_DIMENSION = 128;
    const MASK_ALPHA = 108;
    const PREVIEW_WHITE_ALPHA = 118;

    // ── Canvas elements ─────────────────────────────────────────────────────
    const backgroundCanvas = document.getElementById('backgroundCanvas');
    const maskCanvas = document.getElementById('maskCanvas');
    const gridCanvas = document.getElementById('gridCanvas');
    const previewCanvas = document.getElementById('previewCanvas');
    const canvasContainer = document.querySelector('.canvas-container');
    const bgCtx = backgroundCanvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    const gridCtx = gridCanvas.getContext('2d');
    const previewCtx = previewCanvas.getContext('2d');

    // ── Controls ────────────────────────────────────────────────────────────
    const progressText = document.getElementById('progressText');
    const savedText = document.getElementById('savedText');
    const appVersion = document.getElementById('appVersion');
    const brushBtn = document.getElementById('brushBtn');
    const eraserBtn = document.getElementById('eraserBtn');
    const brushSizeInput = document.getElementById('brushSize');
    const brushColorInput = document.getElementById('brushColor');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const cellGridToggle = document.getElementById('cellGridToggle');
    const gridColorInput = document.getElementById('gridColor');
    const assessmentOneCard = document.getElementById('assessmentOneCard');
    const assessmentZeroCard = document.getElementById('assessmentZeroCard');
    const previousBtn = document.getElementById('previousBtn');
    const previewBtn = document.getElementById('previewBtn');
    const nextBtn = document.getElementById('nextBtn');
    const previewModal = document.getElementById('previewModal');
    const closePreviewBtn = document.getElementById('closePreviewBtn');
    const returnToEditingBtn = document.getElementById('returnToEditingBtn');

    // ── Dataset/session state ───────────────────────────────────────────────
    let images = [];
    let currentImageIndex = 0;
    let currentImage = null;
    let selectedAssessment = null;
    let savedFilenames = new Set();
    let loadVersion = 0;
    const drafts = new Map();

    // ── Grid annotation state ───────────────────────────────────────────────
    let cellWidth = 8;
    let cellHeight = 8;
    let selectedCells = new Set();
    let undoStack = [];
    let redoStack = [];
    let activeMode = 'brush';
    let brushSizeInCells = 1;
    let isDrawing = false;
    let lastGridCell = null;
    let currentAction = null;
    let hoverCell = null;

    function hexToRgb(hex) {
        const normalised = hex.replace('#', '');
        return {
            r: parseInt(normalised.slice(0, 2), 16),
            g: parseInt(normalised.slice(2, 4), 16),
            b: parseInt(normalised.slice(4, 6), 16)
        };
    }

    function rgbaFromHex(hex, alpha) {
        const { r, g, b } = hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function cellKey(col, row) {
        return `${col}:${row}`;
    }

    function keyToCell(key) {
        const [col, row] = key.split(':').map(Number);
        return { col, row };
    }

    function currentFilename() {
        return images[currentImageIndex] || null;
    }

    async function loadAppVersion() {
        try {
            const response = await fetch('/app_info');
            if (!response.ok) throw new Error('Version information is unavailable.');
            const info = await response.json();
            appVersion.textContent = `v${info.version || 'development'}`;
            appVersion.title = `Medical Image Annotation Study Kit v${info.version || 'development'}`;
        } catch (error) {
            appVersion.textContent = 'v?';
            appVersion.title = 'Study Kit version unavailable';
        }
    }

    async function initialiseApp() {
        try {
            const [imagesResponse, statusResponse] = await Promise.all([
                fetch('/static/images'),
                fetch('/annotation_status')
            ]);
            if (!imagesResponse.ok || !statusResponse.ok) throw new Error('The dataset could not be loaded.');

            images = await imagesResponse.json();
            const status = await statusResponse.json();
            savedFilenames = new Set(status.savedFilenames || []);
            updateProgress();

            if (images.length === 0) {
                showNoImagesState();
                return;
            }
            await loadImage(0);
        } catch (error) {
            console.error(error);
            alert('Could not load the input images. Check Study_Data/input_images and restart the app.');
        }
    }

    async function fetchSavedState(filename) {
        const response = await fetch(`/annotation_state/${encodeURIComponent(filename)}`);
        if (!response.ok) throw new Error(`Could not load saved annotation state for ${filename}.`);
        return response.json();
    }

    async function loadImage(index) {
        if (index < 0 || index >= images.length) return;
        const thisLoadVersion = ++loadVersion;
        currentImageIndex = index;
        resetImageState();
        updateProgress();

        const filename = currentFilename();
        try {
            const [image, savedState] = await Promise.all([
                loadBackgroundImage(filename),
                drafts.has(filename) ? Promise.resolve(null) : fetchSavedState(filename)
            ]);
            if (thisLoadVersion !== loadVersion) return;

            currentImage = image;
            initialiseCanvases(image.width, image.height);
            bgCtx.clearRect(0, 0, image.width, image.height);
            bgCtx.drawImage(image, 0, 0);

            const draft = drafts.get(filename);
            if (draft) {
                restoreAnnotationState(draft);
            } else if (savedState && savedState.saved) {
                restoreAnnotationState({
                    selectedCells: savedState.selectedCells || [],
                    assessment: savedState.assessment || null
                });
            }
            redrawAll();
            updateProgress();
        } catch (error) {
            console.error(error);
            alert(`Could not load ${filename}. ${error.message}`);
        }
    }

    function loadBackgroundImage(filename) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.src = `/study_images/${encodeURIComponent(filename)}`;
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('The input image could not be opened.'));
        });
    }

    function showNoImagesState() {
        currentImage = null;
        initialiseCanvases(800, 380);
        bgCtx.fillStyle = '#0f172a';
        bgCtx.fillRect(0, 0, 800, 380);
        bgCtx.fillStyle = '#ffffff';
        bgCtx.font = '22px system-ui';
        bgCtx.fillText('No input images found in Study_Data/input_images.', 170, 195);
        progressText.textContent = 'No images';
        savedText.textContent = '';
        previousBtn.disabled = true;
        nextBtn.disabled = true;
        previewBtn.disabled = true;
    }

    function initialiseCanvases(width, height) {
        [backgroundCanvas, maskCanvas, gridCanvas].forEach(canvas => {
            canvas.width = width;
            canvas.height = height;
        });
        canvasContainer.style.width = `${width}px`;
        canvasContainer.style.height = `${height}px`;
        cellWidth = width / GRID_DIMENSION;
        cellHeight = height / GRID_DIMENSION;
    }

    function resetImageState() {
        selectedCells = new Set();
        selectedAssessment = null;
        undoStack = [];
        redoStack = [];
        isDrawing = false;
        lastGridCell = null;
        currentAction = null;
        hoverCell = null;
        updateHistoryButtons();
        updateAssessmentCards();
    }

    function restoreAnnotationState(state) {
        selectedCells = new Set((state.selectedCells || []).filter(isValidCellKey));
        selectedAssessment = state.assessment === '0' || state.assessment === '1' ? state.assessment : null;
        undoStack = [];
        redoStack = [];
        updateHistoryButtons();
        updateAssessmentCards();
    }

    function isValidCellKey(key) {
        if (typeof key !== 'string' || !/^\d+:\d+$/.test(key)) return false;
        const { col, row } = keyToCell(key);
        return col >= 0 && row >= 0 && col < GRID_DIMENSION && row < GRID_DIMENSION;
    }

    function cacheCurrentDraft() {
        const filename = currentFilename();
        if (!filename || !currentImage) return;
        drafts.set(filename, {
            selectedCells: [...selectedCells],
            assessment: selectedAssessment
        });
    }

    function updateProgress() {
        if (images.length === 0) return;
        progressText.textContent = `Image ${currentImageIndex + 1} / ${images.length}`;
        savedText.textContent = `${savedFilenames.size} saved`;
        previousBtn.disabled = currentImageIndex === 0;
        nextBtn.disabled = !currentImage;
        previewBtn.disabled = !currentImage;
        nextBtn.textContent = currentImageIndex === images.length - 1 ? 'Save image' : 'Save & next image';
    }

    // ── Canvas rendering ────────────────────────────────────────────────────
    function redrawAll() {
        redrawMask();
        drawCellGrid();
    }

    function redrawMask() {
        const width = maskCanvas.width;
        const height = maskCanvas.height;
        maskCtx.clearRect(0, 0, width, height);
        if (selectedCells.size === 0) return;

        const colour = hexToRgb(brushColorInput.value);
        const imageData = maskCtx.createImageData(width, height);
        const data = imageData.data;
        selectedCells.forEach(key => {
            const { col, row } = keyToCell(key);
            const startX = Math.floor(col * cellWidth);
            const endX = Math.min(width, Math.ceil((col + 1) * cellWidth));
            const startY = Math.floor(row * cellHeight);
            const endY = Math.min(height, Math.ceil((row + 1) * cellHeight));
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const outputIndex = (y * width + x) * 4;
                    data[outputIndex] = colour.r;
                    data[outputIndex + 1] = colour.g;
                    data[outputIndex + 2] = colour.b;
                    data[outputIndex + 3] = MASK_ALPHA;
                }
            }
        });
        maskCtx.putImageData(imageData, 0, 0);
    }

    function drawCellGrid() {
        const width = gridCanvas.width;
        const height = gridCanvas.height;
        gridCtx.clearRect(0, 0, width, height);
        if (!cellGridToggle.checked || !currentImage) return;

        gridCtx.save();
        gridCtx.strokeStyle = rgbaFromHex(gridColorInput.value, 0.30);
        gridCtx.lineWidth = 0.7;
        gridCtx.beginPath();
        for (let col = 0; col <= GRID_DIMENSION; col++) {
            const x = Math.round(col * cellWidth) + 0.5;
            gridCtx.moveTo(x, 0);
            gridCtx.lineTo(x, height);
        }
        for (let row = 0; row <= GRID_DIMENSION; row++) {
            const y = Math.round(row * cellHeight) + 0.5;
            gridCtx.moveTo(0, y);
            gridCtx.lineTo(width, y);
        }
        gridCtx.stroke();

        if (hoverCell) {
            const side = brushSizeInCells;
            const start = stampStart(hoverCell.col, hoverCell.row, side);
            gridCtx.strokeStyle = activeMode === 'brush'
                ? rgbaFromHex(brushColorInput.value, 0.98)
                : 'rgba(255, 104, 104, 0.98)';
            gridCtx.lineWidth = 1.6;
            gridCtx.strokeRect(
                start.col * cellWidth + 0.75,
                start.row * cellHeight + 0.75,
                side * cellWidth - 1.5,
                side * cellHeight - 1.5
            );
        }
        gridCtx.restore();
    }

    // ── Grid brush / eraser interaction ─────────────────────────────────────
    function getGridCellFromEvent(event) {
        const rect = maskCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * maskCanvas.width / rect.width;
        const y = (event.clientY - rect.top) * maskCanvas.height / rect.height;
        return {
            col: Math.max(0, Math.min(GRID_DIMENSION - 1, Math.floor(x / cellWidth))),
            row: Math.max(0, Math.min(GRID_DIMENSION - 1, Math.floor(y / cellHeight)))
        };
    }

    function stampStart(col, row, side) {
        return {
            col: Math.max(0, Math.min(GRID_DIMENSION - side, col - Math.floor(side / 2))),
            row: Math.max(0, Math.min(GRID_DIMENSION - side, row - Math.floor(side / 2)))
        };
    }

    function setActiveMode(mode) {
        activeMode = mode;
        brushBtn.classList.toggle('active', mode === 'brush');
        eraserBtn.classList.toggle('active', mode === 'eraser');
        drawCellGrid();
    }

    function beginAction() {
        currentAction = { changes: [] };
    }

    function applyCell(col, row) {
        if (!currentAction || col < 0 || row < 0 || col >= GRID_DIMENSION || row >= GRID_DIMENSION) return;
        const key = cellKey(col, row);
        const before = selectedCells.has(key);
        const after = activeMode === 'brush';
        if (before === after) return;
        selectedCells[after ? 'add' : 'delete'](key);
        currentAction.changes.push({ key, before, after });
    }

    function applyBrushStamp(col, row) {
        const start = stampStart(col, row, brushSizeInCells);
        for (let y = start.row; y < start.row + brushSizeInCells; y++) {
            for (let x = start.col; x < start.col + brushSizeInCells; x++) {
                applyCell(x, y);
            }
        }
    }

    function applyGridLine(from, to) {
        let x0 = from.col;
        let y0 = from.row;
        const x1 = to.col;
        const y1 = to.row;
        const dx = Math.abs(x1 - x0);
        const sx = x0 < x1 ? 1 : -1;
        const dy = -Math.abs(y1 - y0);
        const sy = y0 < y1 ? 1 : -1;
        let error = dx + dy;
        while (true) {
            applyBrushStamp(x0, y0);
            if (x0 === x1 && y0 === y1) break;
            const twiceError = 2 * error;
            if (twiceError >= dy) { error += dy; x0 += sx; }
            if (twiceError <= dx) { error += dx; y0 += sy; }
        }
    }

    function endAction() {
        if (!currentAction) return;
        if (currentAction.changes.length > 0) {
            undoStack.push(currentAction);
            redoStack = [];
            redrawMask();
            updateHistoryButtons();
            cacheCurrentDraft();
        }
        currentAction = null;
    }

    function undo() {
        const action = undoStack.pop();
        if (!action) return;
        for (let i = action.changes.length - 1; i >= 0; i--) {
            const change = action.changes[i];
            selectedCells[change.before ? 'add' : 'delete'](change.key);
        }
        redoStack.push(action);
        redrawMask();
        updateHistoryButtons();
        cacheCurrentDraft();
    }

    function redo() {
        const action = redoStack.pop();
        if (!action) return;
        action.changes.forEach(change => selectedCells[change.after ? 'add' : 'delete'](change.key));
        undoStack.push(action);
        redrawMask();
        updateHistoryButtons();
        cacheCurrentDraft();
    }

    function updateHistoryButtons() {
        undoBtn.disabled = undoStack.length === 0;
        redoBtn.disabled = redoStack.length === 0;
    }

    // ── Optional study assessment ───────────────────────────────────────────
    function chooseAssessment(assessment) {
        selectedAssessment = assessment;
        updateAssessmentCards();
        cacheCurrentDraft();
    }

    function updateAssessmentCards() {
        const isOne = selectedAssessment === '1';
        const isZero = selectedAssessment === '0';
        assessmentOneCard.classList.toggle('selected', isOne);
        assessmentZeroCard.classList.toggle('selected', isZero);
        assessmentOneCard.setAttribute('aria-checked', String(isOne));
        assessmentZeroCard.setAttribute('aria-checked', String(isZero));
    }

    // ── Final preview / saved output ─────────────────────────────────────────
    function buildWhitePreviewCanvas() {
        const width = backgroundCanvas.width;
        const height = backgroundCanvas.height;
        const composite = document.createElement('canvas');
        composite.width = width;
        composite.height = height;
        const compositeCtx = composite.getContext('2d');
        compositeCtx.drawImage(backgroundCanvas, 0, 0);
        if (selectedCells.size === 0) return composite;

        const overlay = compositeCtx.createImageData(width, height);
        const data = overlay.data;
        selectedCells.forEach(key => {
            const { col, row } = keyToCell(key);
            const startX = Math.floor(col * cellWidth);
            const endX = Math.min(width, Math.ceil((col + 1) * cellWidth));
            const startY = Math.floor(row * cellHeight);
            const endY = Math.min(height, Math.ceil((row + 1) * cellHeight));
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const outputIndex = (y * width + x) * 4;
                    data[outputIndex] = 255;
                    data[outputIndex + 1] = 255;
                    data[outputIndex + 2] = 255;
                    data[outputIndex + 3] = PREVIEW_WHITE_ALPHA;
                }
            }
        });
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        overlayCanvas.getContext('2d').putImageData(overlay, 0, 0);
        compositeCtx.drawImage(overlayCanvas, 0, 0);
        return composite;
    }

    function openPreview() {
        if (!currentImage) return;
        const composite = buildWhitePreviewCanvas();
        previewCanvas.width = composite.width;
        previewCanvas.height = composite.height;
        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        previewCtx.drawImage(composite, 0, 0);
        previewModal.hidden = false;
        closePreviewBtn.focus();
    }

    function closePreview() {
        previewModal.hidden = true;
    }

    // ── Navigation and overwrite-safe saving ─────────────────────────────────
    async function saveCurrentAnnotation() {
        if (!currentImage) return false;

        const filename = currentFilename();
        nextBtn.disabled = true;
        previousBtn.disabled = true;
        nextBtn.textContent = 'Saving…';

        try {
            const response = await fetch('/save_annotation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename,
                    imageIndex: currentImageIndex,
                    assessment: selectedAssessment,
                    selectedCells: [...selectedCells],
                    brushColour: brushColorInput.value
                })
            });
            if (!response.ok) {
                const failure = await response.json().catch(() => ({}));
                throw new Error(failure.error || 'The annotation could not be saved.');
            }
            savedFilenames.add(filename);
            drafts.set(filename, { selectedCells: [...selectedCells], assessment: selectedAssessment });
            updateProgress();
            return true;
        } catch (error) {
            console.error(error);
            alert(`The annotation could not be saved. ${error.message}`);
            updateProgress();
            return false;
        }
    }

    async function saveAndNext() {
        const saved = await saveCurrentAnnotation();
        if (!saved) return;
        if (currentImageIndex < images.length - 1) {
            await loadImage(currentImageIndex + 1);
        } else {
            nextBtn.textContent = 'Saved';
            alert('All images have been saved. The session is complete. Your results are available in Study_Data/results.');
            setTimeout(updateProgress, 900);
        }
    }

    async function goPrevious() {
        if (currentImageIndex === 0) return;
        cacheCurrentDraft();
        await loadImage(currentImageIndex - 1);
    }

    brushBtn.addEventListener('click', () => setActiveMode('brush'));
    eraserBtn.addEventListener('click', () => setActiveMode('eraser'));
    brushSizeInput.addEventListener('change', () => {
        brushSizeInCells = Number(brushSizeInput.value);
        drawCellGrid();
    });
    brushColorInput.addEventListener('input', redrawAll);
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    cellGridToggle.addEventListener('change', drawCellGrid);
    gridColorInput.addEventListener('input', drawCellGrid);
    assessmentOneCard.addEventListener('click', () => chooseAssessment('1'));
    assessmentZeroCard.addEventListener('click', () => chooseAssessment('0'));
    previousBtn.addEventListener('click', goPrevious);
    previewBtn.addEventListener('click', openPreview);
    nextBtn.addEventListener('click', saveAndNext);
    closePreviewBtn.addEventListener('click', closePreview);
    returnToEditingBtn.addEventListener('click', closePreview);
    previewModal.addEventListener('click', event => {
        if (event.target === previewModal) closePreview();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !previewModal.hidden) closePreview();
    });

    maskCanvas.addEventListener('mousedown', event => {
        if (!currentImage || !previewModal.hidden) return;
        event.preventDefault();
        isDrawing = true;
        const cell = getGridCellFromEvent(event);
        hoverCell = cell;
        lastGridCell = cell;
        beginAction();
        applyBrushStamp(cell.col, cell.row);
        redrawMask();
        drawCellGrid();
    });

    maskCanvas.addEventListener('mousemove', event => {
        if (!currentImage) return;
        const cell = getGridCellFromEvent(event);
        hoverCell = cell;
        if (isDrawing && lastGridCell) {
            applyGridLine(lastGridCell, cell);
            lastGridCell = cell;
            redrawMask();
        }
        drawCellGrid();
    });

    function finishGridGesture() {
        if (!isDrawing) return;
        isDrawing = false;
        lastGridCell = null;
        endAction();
    }

    maskCanvas.addEventListener('mouseup', finishGridGesture);
    maskCanvas.addEventListener('mouseleave', () => {
        hoverCell = null;
        finishGridGesture();
        drawCellGrid();
    });

    setActiveMode('brush');
    updateHistoryButtons();
    loadAppVersion();
    initialiseApp();
});
