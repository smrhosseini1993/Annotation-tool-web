/**
 * PET polar-map annotation tool
 *
 * Formal annotation mode uses a fixed 128 × 128 grid.  Every image in the
 * study is 1024 × 1024, so a selected grid cell maps to an 8 × 8 pixel block.
 * The black outer background/ring and the fixed left-side notch are a
 * non-adherent layer: gestures may pass over them, but their pixels cannot be
 * coloured or exported as part of the binary mask.
 */

document.addEventListener('DOMContentLoaded', () => {
    // ── Fixed annotation configuration ──────────────────────────────────────
    const GRID_DIMENSION = 128;
    const BLACK_PIXEL_LIMIT = 12;
    const MIN_PAINTABLE_PIXELS_PER_CELL = 16;
    const MASK_RGB = [0, 102, 255];
    const MASK_ALPHA = 108; // consistent 42% opacity for every selected pixel

    // ── Canvases ────────────────────────────────────────────────────────────
    const backgroundCanvas = document.getElementById('backgroundCanvas');
    const maskCanvas = document.getElementById('maskCanvas');
    const guideCanvas = document.getElementById('guideCanvas');
    const gridCanvas = document.getElementById('gridCanvas');

    const bgCtx = backgroundCanvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    const guideCtx = guideCanvas.getContext('2d');
    const gridCtx = gridCanvas.getContext('2d');

    // ── Controls ────────────────────────────────────────────────────────────
    const addCellsBtn = document.getElementById('addCellsBtn');
    const removeCellsBtn = document.getElementById('removeCellsBtn');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const guideToggle = document.getElementById('guideToggle');
    const guideStrength = document.getElementById('guideStrength');
    const cellGridToggle = document.getElementById('cellGridToggle');
    const nextBtn = document.getElementById('nextBtn');

    // ── Image/session state ─────────────────────────────────────────────────
    let images = [];
    let originalIndices = [];
    let currentImageIndex = 0;
    let currentImage = null;

    // ── Grid annotation state ───────────────────────────────────────────────
    let cellWidth = 8;
    let cellHeight = 8;
    let selectedCells = new Set();
    let undoStack = [];
    let redoStack = [];
    let activeMode = 'add'; // 'add' | 'remove'
    let isDrawing = false;
    let lastGridCell = null;
    let currentAction = null;
    let hoverCell = null;

    // `paintablePixels` is the fixed non-adherent stencil for the current map.
    // 1 = overlay/mask allowed; 0 = black background/notch, permanently zero.
    let paintablePixels = null;
    let cellHasPaintableArea = new Uint8Array(GRID_DIMENSION * GRID_DIMENSION);

    // ════════════════════════════════════════════════════════════════════════
    //  Canvas and image loading
    // ════════════════════════════════════════════════════════════════════════
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

    async function loadImages() {
        try {
            const response = await fetch('/static/images');
            const sourceImages = await response.json();

            // The original project uses the number embedded in each filename to
            // preserve prediction-file ordering after images are shuffled.
            originalIndices = sourceImages.map((image, listIndex) => {
                const numberMatch = image.match(/\d+/);
                return {
                    image,
                    index: numberMatch ? parseInt(numberMatch[0], 10) - 1 : listIndex
                };
            });

            const shuffled = [...originalIndices].sort(() => Math.random() - 0.5);
            images = shuffled.map(item => item.image);
            originalIndices = shuffled.map(item => item.index);
            await loadImage(currentImageIndex);
        } catch (error) {
            console.error('Could not load input images:', error);
            alert('Could not load the input images. Check static/input_images and restart the app.');
        }
    }

    async function loadImage(index) {
        resetAnnotationState();

        if (index >= images.length) {
            initialiseCanvases(800, 400);
            bgCtx.fillStyle = '#111';
            bgCtx.fillRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
            bgCtx.font = '22px system-ui';
            bgCtx.fillStyle = '#fff';
            bgCtx.fillText('You have viewed all images.', 260, 205);
            return;
        }

        return new Promise((resolve, reject) => {
            const image = new Image();
            image.src = `/static/input_images/${images[index]}`;

            image.onload = () => {
                initialiseCanvases(image.width, image.height);
                bgCtx.clearRect(0, 0, image.width, image.height);
                bgCtx.drawImage(image, 0, 0);
                currentImage = image;

                buildNonAdherentStencil();
                redrawMask();
                drawGuide();
                drawCellGrid();
                resolve();
            };

            image.onerror = () => reject(new Error(`Could not load ${images[index]}`));
        });
    }

    function resetAnnotationState() {
        selectedCells = new Set();
        undoStack = [];
        redoStack = [];
        isDrawing = false;
        lastGridCell = null;
        currentAction = null;
        hoverCell = null;
        paintablePixels = null;
        cellHasPaintableArea = new Uint8Array(GRID_DIMENSION * GRID_DIMENSION);
        updateHistoryButtons();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Fixed protected black-region layer
    // ════════════════════════════════════════════════════════════════════════
    function buildNonAdherentStencil() {
        const width = backgroundCanvas.width;
        const height = backgroundCanvas.height;
        const sourcePixels = bgCtx.getImageData(0, 0, width, height).data;
        paintablePixels = new Uint8Array(width * height);
        const validCounts = new Uint16Array(GRID_DIMENSION * GRID_DIMENSION);

        for (let y = 0; y < height; y++) {
            const row = Math.min(GRID_DIMENSION - 1, Math.floor(y / cellHeight));
            for (let x = 0; x < width; x++) {
                const sourceIndex = (y * width + x) * 4;
                const r = sourcePixels[sourceIndex];
                const g = sourcePixels[sourceIndex + 1];
                const b = sourcePixels[sourceIndex + 2];

                // The supplied polar maps use fixed near-black pixels for the
                // outer background/ring and left-side notch. Those locations
                // form the non-adherent stencil; dark blue perfusion data is
                // far above this threshold and remains paintable.
                const isProtectedBlack = r <= BLACK_PIXEL_LIMIT &&
                    g <= BLACK_PIXEL_LIMIT &&
                    b <= BLACK_PIXEL_LIMIT;

                if (!isProtectedBlack) {
                    paintablePixels[y * width + x] = 1;
                    const col = Math.min(GRID_DIMENSION - 1, Math.floor(x / cellWidth));
                    validCounts[row * GRID_DIMENSION + col]++;
                }
            }
        }

        // A cell that contains only a thin white border against black
        // background is not a usable selection cell. This avoids visible paint
        // fragments in the black ring/notch while retaining partly covered
        // cells at the true circular boundary.
        for (let i = 0; i < validCounts.length; i++) {
            cellHasPaintableArea[i] = validCounts[i] >= MIN_PAINTABLE_PIXELS_PER_CELL ? 1 : 0;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Grid rendering and binary mask rendering
    // ════════════════════════════════════════════════════════════════════════
    function cellKey(col, row) {
        return `${col}:${row}`;
    }

    function keyToCell(key) {
        const [col, row] = key.split(':').map(Number);
        return { col, row };
    }

    function isSelectableCell(col, row) {
        if (col < 0 || row < 0 || col >= GRID_DIMENSION || row >= GRID_DIMENSION) return false;
        return cellHasPaintableArea[row * GRID_DIMENSION + col] === 1;
    }

    /**
     * Render selected grid cells at one perfectly consistent visual opacity.
     * Only pixels permitted by the non-adherent stencil receive alpha.
     */
    function redrawMask() {
        const width = maskCanvas.width;
        const height = maskCanvas.height;
        maskCtx.clearRect(0, 0, width, height);
        if (!paintablePixels || selectedCells.size === 0) return;

        const imageData = maskCtx.createImageData(width, height);
        const data = imageData.data;

        selectedCells.forEach(key => {
            const { col, row } = keyToCell(key);
            const startX = Math.floor(col * cellWidth);
            const endX = Math.min(width, Math.ceil((col + 1) * cellWidth));
            const startY = Math.floor(row * cellHeight);
            const endY = Math.min(height, Math.ceil((row + 1) * cellHeight));

            for (let y = startY; y < endY; y++) {
                const rowOffset = y * width;
                for (let x = startX; x < endX; x++) {
                    const pixelIndex = rowOffset + x;
                    if (!paintablePixels[pixelIndex]) continue;
                    const outputIndex = pixelIndex * 4;
                    data[outputIndex] = MASK_RGB[0];
                    data[outputIndex + 1] = MASK_RGB[1];
                    data[outputIndex + 2] = MASK_RGB[2];
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
        gridCtx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
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

        // Highlight the cell that will be affected by the next click/drag.
        if (hoverCell && isSelectableCell(hoverCell.col, hoverCell.row)) {
            const x = hoverCell.col * cellWidth;
            const y = hoverCell.row * cellHeight;
            gridCtx.strokeStyle = activeMode === 'add'
                ? 'rgba(98, 255, 160, 0.96)'
                : 'rgba(255, 120, 120, 0.96)';
            gridCtx.lineWidth = 1.5;
            gridCtx.strokeRect(x + 0.75, y + 0.75, cellWidth - 1.5, cellHeight - 1.5);
        }
        gridCtx.restore();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  17-segment white viewing guide (display only; never affects the mask)
    // ════════════════════════════════════════════════════════════════════════
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
        // The coloured polar-map disc occupies a fixed central area of the
        // supplied 1024 × 1024 images. Keep the guide inside that disc, not on
        // the surrounding black ring.
        const outerRadius = Math.min(width, height) * 0.409;
        const basalInnerRadius = outerRadius * 0.67;
        const midInnerRadius = outerRadius * 0.38;
        const apicalInnerRadius = outerRadius * 0.18;

        guideCtx.save();
        guideCtx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        guideCtx.lineWidth = lineWidth;
        guideCtx.lineCap = 'round';

        // Ring boundaries: basal, mid, apical, apex.
        [outerRadius, basalInnerRadius, midInnerRadius, apicalInnerRadius].forEach(radius => {
            guideCtx.beginPath();
            guideCtx.arc(cx, cy, radius, 0, Math.PI * 2);
            guideCtx.stroke();
        });

        // Basal ring: six sectors.
        for (let i = 0; i < 6; i++) {
            const angle = -Math.PI / 2 + i * (Math.PI / 3);
            drawRadialLine(cx, cy, basalInnerRadius, outerRadius, angle);
        }

        // Mid ring: six sectors, offset by 30 degrees from basal segments.
        for (let i = 0; i < 6; i++) {
            const angle = -Math.PI / 2 + Math.PI / 6 + i * (Math.PI / 3);
            drawRadialLine(cx, cy, midInnerRadius, basalInnerRadius, angle);
        }

        // Apical ring: four sectors.
        for (let i = 0; i < 4; i++) {
            const angle = -Math.PI / 2 + Math.PI / 4 + i * (Math.PI / 2);
            drawRadialLine(cx, cy, apicalInnerRadius, midInnerRadius, angle);
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
    //  Grid-cell selection interaction
    // ════════════════════════════════════════════════════════════════════════
    function getGridCellFromEvent(event) {
        const rect = maskCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) * maskCanvas.width / rect.width;
        const y = (event.clientY - rect.top) * maskCanvas.height / rect.height;
        const col = Math.max(0, Math.min(GRID_DIMENSION - 1, Math.floor(x / cellWidth)));
        const row = Math.max(0, Math.min(GRID_DIMENSION - 1, Math.floor(y / cellHeight)));
        return { col, row };
    }

    function setActiveMode(mode) {
        activeMode = mode;
        addCellsBtn.classList.toggle('active', mode === 'add');
        removeCellsBtn.classList.toggle('active', mode === 'remove');
        drawCellGrid();
    }

    function beginAction() {
        currentAction = { changes: [] };
    }

    function applyCell(col, row) {
        if (!currentAction || !isSelectableCell(col, row)) return;

        const key = cellKey(col, row);
        const before = selectedCells.has(key);
        const after = activeMode === 'add';
        if (before === after) return;

        selectedCells[after ? 'add' : 'delete'](key);
        currentAction.changes.push({ key, before, after });
    }

    /**
     * Connect cells between event samples so fast mouse movement selects a
     * continuous chain of grid boxes rather than leaving blank gaps.
     */
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
            applyCell(x0, y0);
            if (x0 === x1 && y0 === y1) break;
            const twiceError = 2 * error;
            if (twiceError >= dy) {
                error += dy;
                x0 += sx;
            }
            if (twiceError <= dx) {
                error += dx;
                y0 += sy;
            }
        }
    }

    function endAction() {
        if (!currentAction) return;
        if (currentAction.changes.length > 0) {
            undoStack.push(currentAction);
            redoStack = [];
            redrawMask();
            updateHistoryButtons();
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
    }

    function redo() {
        const action = redoStack.pop();
        if (!action) return;
        action.changes.forEach(change => {
            selectedCells[change.after ? 'add' : 'delete'](change.key);
        });
        undoStack.push(action);
        redrawMask();
        updateHistoryButtons();
    }

    function updateHistoryButtons() {
        undoBtn.disabled = undoStack.length === 0;
        redoBtn.disabled = redoStack.length === 0;
    }

    maskCanvas.addEventListener('mousedown', event => {
        if (!currentImage) return;
        event.preventDefault();
        isDrawing = true;
        const cell = getGridCellFromEvent(event);
        hoverCell = cell;
        lastGridCell = cell;
        beginAction();
        applyCell(cell.col, cell.row);
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

    // ════════════════════════════════════════════════════════════════════════
    //  Export
    // ════════════════════════════════════════════════════════════════════════
    function buildBinaryMaskText() {
        const width = maskCanvas.width;
        const height = maskCanvas.height;
        const rows = new Array(height);

        for (let y = 0; y < height; y++) {
            const row = new Array(width);
            const gridRow = Math.min(GRID_DIMENSION - 1, Math.floor(y / cellHeight));
            for (let x = 0; x < width; x++) {
                const gridCol = Math.min(GRID_DIMENSION - 1, Math.floor(x / cellWidth));
                const selected = selectedCells.has(cellKey(gridCol, gridRow));
                row[x] = selected && paintablePixels[y * width + x] ? '1' : '0';
            }
            rows[y] = row.join('\t');
        }
        return rows.join('\n');
    }

    async function saveAndNext() {
        if (currentImageIndex >= images.length) return;

        const selectedPrediction = document.querySelector('input[name="prediction"]:checked');
        if (!selectedPrediction) {
            alert('Please select whether the image is ischemic or non-ischemic.');
            return;
        }

        const filename = images[currentImageIndex].replace(/\.[^/.]+$/, '');
        const originalIndex = originalIndices[currentImageIndex];

        try {
            const predictionResponse = await fetch('/save_prediction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageIndex: originalIndex,
                    prediction: selectedPrediction.value
                })
            });
            if (!predictionResponse.ok) throw new Error('Prediction could not be saved.');

            const binaryBlob = new Blob([buildBinaryMaskText()], { type: 'text/plain' });
            const binaryForm = new FormData();
            binaryForm.append('file', new File([binaryBlob], `${filename}_binary.txt`));

            const overlayBlob = await new Promise(resolve => maskCanvas.toBlob(resolve, 'image/png'));
            if (!overlayBlob) throw new Error('Annotation overlay could not be created.');
            const overlayForm = new FormData();
            overlayForm.append('file', new File([overlayBlob], `${filename}_result_image.png`));

            const [binaryResponse, overlayResponse] = await Promise.all([
                fetch('/save_binary', { method: 'POST', body: binaryForm }),
                fetch('/save_masked_image', { method: 'POST', body: overlayForm })
            ]);
            if (!binaryResponse.ok || !overlayResponse.ok) {
                throw new Error('One or more annotation files could not be saved.');
            }

            selectedPrediction.checked = false;
            currentImageIndex++;
            await loadImage(currentImageIndex);
        } catch (error) {
            console.error('Save failed:', error);
            alert('The annotation could not be saved. Please try again.');
        }
    }

    // ── Event wiring ─────────────────────────────────────────────────────────
    addCellsBtn.addEventListener('click', () => setActiveMode('add'));
    removeCellsBtn.addEventListener('click', () => setActiveMode('remove'));
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);

    guideToggle.addEventListener('change', () => {
        guideStrength.disabled = !guideToggle.checked;
        drawGuide();
    });
    guideStrength.addEventListener('change', drawGuide);
    cellGridToggle.addEventListener('change', drawCellGrid);
    nextBtn.addEventListener('click', saveAndNext);

    // ── Initial state ────────────────────────────────────────────────────────
    setActiveMode('add');
    updateHistoryButtons();
    loadImages();
});
