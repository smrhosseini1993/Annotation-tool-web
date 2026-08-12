/**
 * PET polar-map annotation tool
 *
 * The standard study format is a fixed 1024 × 1024 layout. A permanent
 * coordinate stencil—not each image's colours—defines the tissue coordinates
 * where annotation may be displayed or exported.
 */

document.addEventListener('DOMContentLoaded', () => {
    const GRID_DIMENSION = 128;
    const STANDARD_MAP_SIZE = 1024;
    const FIXED_STENCIL_PATH = '/static/assets/polar_map_paintable_stencil_1024.png';
    const MIN_PAINTABLE_PIXELS_PER_CELL = 16;
    const MASK_ALPHA = 108;
    const PREVIEW_WHITE_ALPHA = 118;

    // ── Canvas elements ─────────────────────────────────────────────────────
    const backgroundCanvas = document.getElementById('backgroundCanvas');
    const maskCanvas = document.getElementById('maskCanvas');
    const guideCanvas = document.getElementById('guideCanvas');
    const gridCanvas = document.getElementById('gridCanvas');
    const previewCanvas = document.getElementById('previewCanvas');
    const bgCtx = backgroundCanvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    const guideCtx = guideCanvas.getContext('2d');
    const gridCtx = gridCanvas.getContext('2d');
    const previewCtx = previewCanvas.getContext('2d');

    // ── Controls ────────────────────────────────────────────────────────────
    const progressText = document.getElementById('progressText');
    const savedText = document.getElementById('savedText');
    const brushBtn = document.getElementById('brushBtn');
    const eraserBtn = document.getElementById('eraserBtn');
    const brushSizeInput = document.getElementById('brushSize');
    const brushColorInput = document.getElementById('brushColor');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const cellGridToggle = document.getElementById('cellGridToggle');
    const gridColorInput = document.getElementById('gridColor');
    const guideToggle = document.getElementById('guideToggle');
    const guideStrength = document.getElementById('guideStrength');
    const guideColorInput = document.getElementById('guideColor');
    const ischemicCard = document.getElementById('ischemicCard');
    const nonIschemicCard = document.getElementById('nonIschemicCard');
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
    let selectedPrediction = null;
    let savedFilenames = new Set();
    let loadVersion = 0;
    // Keeps unsaved work in memory when the expert uses Previous and returns.
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

    // 1 = paint allowed by the fixed coordinate stencil, 0 = non-adherent.
    let paintablePixels = null;
    let cellHasPaintableArea = new Uint8Array(GRID_DIMENSION * GRID_DIMENSION);
    let fixedStencilImage = null;

    // ════════════════════════════════════════════════════════════════════════
    //  Utilities
    // ════════════════════════════════════════════════════════════════════════
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

    // ════════════════════════════════════════════════════════════════════════
    //  Dataset / saved-state loading
    // ════════════════════════════════════════════════════════════════════════
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
            alert('Could not load the input images. Check static/input_images and restart the app.');
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
            await loadFixedCoordinateStencil(image.width, image.height);
            if (thisLoadVersion !== loadVersion) return;

            const draft = drafts.get(filename);
            if (draft) {
                restoreAnnotationState(draft);
            } else if (savedState && savedState.saved) {
                restoreAnnotationState({
                    selectedCells: savedState.selectedCells || [],
                    prediction: savedState.prediction || null
                });
            }
            redrawAll();
            // loadImage initially disables controls while the image/stencil load;
            // re-enable the relevant actions once the canvas is ready.
            updateProgress();
        } catch (error) {
            console.error(error);
            alert(`Could not load ${filename}. ${error.message}`);
        }
    }

    function loadBackgroundImage(filename) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.src = `/static/input_images/${encodeURIComponent(filename)}`;
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('The polar-map image could not be opened.'));
        });
    }

    function showNoImagesState() {
        currentImage = null;
        initialiseCanvases(800, 380);
        bgCtx.fillStyle = '#0f172a';
        bgCtx.fillRect(0, 0, 800, 380);
        bgCtx.fillStyle = '#ffffff';
        bgCtx.font = '22px system-ui';
        bgCtx.fillText('No input images found in static/input_images.', 215, 195);
        progressText.textContent = 'No images';
        savedText.textContent = '';
        previousBtn.disabled = true;
        nextBtn.disabled = true;
        previewBtn.disabled = true;
    }

    function initialiseCanvases(width, height) {
        [backgroundCanvas, maskCanvas, guideCanvas, gridCanvas].forEach(canvas => {
            canvas.width = width;
            canvas.height = height;
        });
        const container = document.querySelector('.canvas-container');
        container.style.width = `${width}px`;
        container.style.height = `${height}px`;
        cellWidth = width / GRID_DIMENSION;
        cellHeight = height / GRID_DIMENSION;
    }

    function resetImageState() {
        selectedCells = new Set();
        selectedPrediction = null;
        undoStack = [];
        redoStack = [];
        isDrawing = false;
        lastGridCell = null;
        currentAction = null;
        hoverCell = null;
        paintablePixels = null;
        cellHasPaintableArea = new Uint8Array(GRID_DIMENSION * GRID_DIMENSION);
        updateHistoryButtons();
        updateClassificationCards();
    }

    function restoreAnnotationState(state) {
        selectedCells = new Set((state.selectedCells || []).filter(isValidCellKey));
        selectedPrediction = state.prediction === '0' || state.prediction === '1' ? state.prediction : null;
        undoStack = [];
        redoStack = [];
        updateHistoryButtons();
        updateClassificationCards();
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
            prediction: selectedPrediction
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

    // ════════════════════════════════════════════════════════════════════════
    //  Fixed coordinate stencil
    // ════════════════════════════════════════════════════════════════════════
    function loadFixedCoordinateStencil(width, height) {
        if (width !== STANDARD_MAP_SIZE || height !== STANDARD_MAP_SIZE) {
            return Promise.reject(new Error(`This tool requires ${STANDARD_MAP_SIZE} × ${STANDARD_MAP_SIZE} polar maps; received ${width} × ${height}.`));
        }

        const useStencil = stencil => {
            if (stencil.width !== width || stencil.height !== height) {
                throw new Error('The fixed polar-map stencil does not match the input image dimensions.');
            }
            const stencilCanvas = document.createElement('canvas');
            stencilCanvas.width = width;
            stencilCanvas.height = height;
            const stencilCtx = stencilCanvas.getContext('2d');
            stencilCtx.drawImage(stencil, 0, 0);
            const stencilPixels = stencilCtx.getImageData(0, 0, width, height).data;

            paintablePixels = new Uint8Array(width * height);
            const validCounts = new Uint16Array(GRID_DIMENSION * GRID_DIMENSION);
            for (let y = 0; y < height; y++) {
                const row = Math.min(GRID_DIMENSION - 1, Math.floor(y / cellHeight));
                for (let x = 0; x < width; x++) {
                    const pixelIndex = y * width + x;
                    if (stencilPixels[pixelIndex * 4] < 128) continue;
                    paintablePixels[pixelIndex] = 1;
                    const col = Math.min(GRID_DIMENSION - 1, Math.floor(x / cellWidth));
                    validCounts[row * GRID_DIMENSION + col]++;
                }
            }
            for (let i = 0; i < validCounts.length; i++) {
                cellHasPaintableArea[i] = validCounts[i] >= MIN_PAINTABLE_PIXELS_PER_CELL ? 1 : 0;
            }
        };

        if (fixedStencilImage && fixedStencilImage.complete) {
            try {
                useStencil(fixedStencilImage);
                return Promise.resolve();
            } catch (error) {
                return Promise.reject(error);
            }
        }

        return new Promise((resolve, reject) => {
            const stencil = new Image();
            stencil.onload = () => {
                try {
                    fixedStencilImage = stencil;
                    useStencil(stencil);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };
            stencil.onerror = () => reject(new Error('Could not load the fixed polar-map stencil.'));
            stencil.src = FIXED_STENCIL_PATH;
        });
    }

    function isSelectableCell(col, row) {
        if (col < 0 || row < 0 || col >= GRID_DIMENSION || row >= GRID_DIMENSION) return false;
        return cellHasPaintableArea[row * GRID_DIMENSION + col] === 1;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Canvas rendering
    // ════════════════════════════════════════════════════════════════════════
    function redrawAll() {
        redrawMask();
        drawGuide();
        drawCellGrid();
    }

    function redrawMask() {
        const width = maskCanvas.width;
        const height = maskCanvas.height;
        maskCtx.clearRect(0, 0, width, height);
        if (!paintablePixels || selectedCells.size === 0) return;

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
                    const pixelIndex = y * width + x;
                    if (!paintablePixels[pixelIndex]) continue;
                    const outputIndex = pixelIndex * 4;
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

        if (hoverCell && isSelectableCell(hoverCell.col, hoverCell.row)) {
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

    function guideStyle() {
        if (guideStrength.value === 'faint') return { alpha: 0.36, lineWidth: 0.85 };
        if (guideStrength.value === 'bold') return { alpha: 0.92, lineWidth: 2.35 };
        return { alpha: 0.65, lineWidth: 1.35 };
    }

    function drawGuide() {
        const width = guideCanvas.width;
        const height = guideCanvas.height;
        guideCtx.clearRect(0, 0, width, height);
        if (!guideToggle.checked || !currentImage) return;

        const { alpha, lineWidth } = guideStyle();
        const cx = width / 2;
        const cy = height / 2;
        const outerRadius = Math.min(width, height) * 0.409;
        const basalInnerRadius = outerRadius * 0.67;
        const midInnerRadius = outerRadius * 0.38;
        const apicalInnerRadius = outerRadius * 0.18;

        guideCtx.save();
        guideCtx.strokeStyle = rgbaFromHex(guideColorInput.value, alpha);
        guideCtx.lineWidth = lineWidth;
        guideCtx.lineCap = 'round';
        [outerRadius, basalInnerRadius, midInnerRadius, apicalInnerRadius].forEach(radius => {
            guideCtx.beginPath();
            guideCtx.arc(cx, cy, radius, 0, Math.PI * 2);
            guideCtx.stroke();
        });
        for (let i = 0; i < 6; i++) {
            drawRadialLine(cx, cy, basalInnerRadius, outerRadius, -Math.PI / 2 + i * Math.PI / 3);
        }
        for (let i = 0; i < 6; i++) {
            drawRadialLine(cx, cy, midInnerRadius, basalInnerRadius, -Math.PI / 2 + Math.PI / 6 + i * Math.PI / 3);
        }
        for (let i = 0; i < 4; i++) {
            drawRadialLine(cx, cy, apicalInnerRadius, midInnerRadius, -Math.PI / 2 + Math.PI / 4 + i * Math.PI / 2);
        }
        guideCtx.restore();
    }

    function drawRadialLine(cx, cy, innerRadius, outerRadius, angle) {
        guideCtx.beginPath();
        guideCtx.moveTo(cx + Math.cos(angle) * innerRadius, cy + Math.sin(angle) * innerRadius);
        guideCtx.lineTo(cx + Math.cos(angle) * outerRadius, cy + Math.sin(angle) * outerRadius);
        guideCtx.stroke();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Grid brush / eraser interaction
    // ════════════════════════════════════════════════════════════════════════
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
        if (!currentAction || !isSelectableCell(col, row)) return;
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

    // ════════════════════════════════════════════════════════════════════════
    //  Classification cards
    // ════════════════════════════════════════════════════════════════════════
    function choosePrediction(prediction) {
        selectedPrediction = prediction;
        updateClassificationCards();
        cacheCurrentDraft();
    }

    function updateClassificationCards() {
        const isIschemic = selectedPrediction === '1';
        const isNonIschemic = selectedPrediction === '0';
        ischemicCard.classList.toggle('selected', isIschemic);
        nonIschemicCard.classList.toggle('selected', isNonIschemic);
        ischemicCard.setAttribute('aria-checked', String(isIschemic));
        nonIschemicCard.setAttribute('aria-checked', String(isNonIschemic));
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Final preview / saved output
    // ════════════════════════════════════════════════════════════════════════
    function buildWhitePreviewCanvas() {
        const width = backgroundCanvas.width;
        const height = backgroundCanvas.height;
        const composite = document.createElement('canvas');
        composite.width = width;
        composite.height = height;
        const compositeCtx = composite.getContext('2d');
        compositeCtx.drawImage(backgroundCanvas, 0, 0);
        if (!paintablePixels || selectedCells.size === 0) return composite;

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
                    const pixelIndex = y * width + x;
                    if (!paintablePixels[pixelIndex]) continue;
                    const outputIndex = pixelIndex * 4;
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

    // ════════════════════════════════════════════════════════════════════════
    //  Navigation and overwrite-safe saving
    // ════════════════════════════════════════════════════════════════════════
    async function saveCurrentAnnotation() {
        if (!currentImage || !selectedPrediction) {
            alert('Please select Ischemic or Non-ischemic before saving this image.');
            return false;
        }

        const filename = currentFilename();
        nextBtn.disabled = true;
        previousBtn.disabled = true;
        nextBtn.textContent = 'Saving…';

        try {
            // The backend creates all output artifacts deterministically from
            // this compact state: binary mask, coloured audit overlay, and the
            // standard white manuscript-style preview.
            const response = await fetch('/save_annotation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename,
                    imageIndex: currentImageIndex,
                    prediction: selectedPrediction,
                    selectedCells: [...selectedCells],
                    brushColour: brushColorInput.value
                })
            });
            if (!response.ok) {
                const failure = await response.json().catch(() => ({}));
                throw new Error(failure.error || 'The annotation could not be saved.');
            }
            savedFilenames.add(filename);
            drafts.set(filename, { selectedCells: [...selectedCells], prediction: selectedPrediction });
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
            setTimeout(updateProgress, 900);
        }
    }

    async function goPrevious() {
        if (currentImageIndex === 0) return;
        cacheCurrentDraft();
        await loadImage(currentImageIndex - 1);
    }

    // ── Event wiring ─────────────────────────────────────────────────────────
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
    guideToggle.addEventListener('change', () => {
        guideStrength.disabled = !guideToggle.checked;
        drawGuide();
    });
    guideStrength.addEventListener('change', drawGuide);
    guideColorInput.addEventListener('input', drawGuide);

    ischemicCard.addEventListener('click', () => choosePrediction('1'));
    nonIschemicCard.addEventListener('click', () => choosePrediction('0'));
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
    initialiseApp();
});
