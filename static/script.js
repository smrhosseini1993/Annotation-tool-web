/**
 * PET-image annotation tool (Web Version)
 *
 * Original project : https://gitlab.com/group17761803/Annotation_tool  (Kerttu Pusa)
 * Modified version : https://github.com/smrhosseini1993/Annotation-tool-web
 * Developer        : Seyed M. Hosseini
 *
 * ── Tool modes ──────────────────────────────────────────────────────────────
 *
 *  Brush       – freehand stroke (semi-transparent blue)
 *
 *  Fill Pen    – freehand closed contour; interior is auto-filled on mouseup
 *
 *  Polygon Pen – click to place anchor points; live rubber-band line shows
 *                the evolving shape.  Click the first anchor OR press "Fill In"
 *                to close and fill the polygon.  After filling, anchors remain
 *                visible and draggable so the shape can be refined.
 *                Multiple polygons per image are supported.
 *
 *  Eraser      – removes annotation pixels
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

document.addEventListener('DOMContentLoaded', function () {

    // ── Canvas elements ──────────────────────────────────────────────────────
    const backgroundCanvas = document.getElementById('backgroundCanvas');
    const drawingCanvas    = document.getElementById('drawingCanvas');
    const brushSizeCanvas  = document.getElementById('brushSizeCanvas');
    const overlayCanvas    = document.getElementById('overlayCanvas');

    if (!backgroundCanvas || !drawingCanvas || !brushSizeCanvas || !overlayCanvas) {
        console.error('Could not find required canvas elements');
        return;
    }

    const bgCtx  = backgroundCanvas.getContext('2d');
    const ctx    = drawingCanvas.getContext('2d');
    const oCtx   = overlayCanvas.getContext('2d');   // anchor / rubber-band layer
    const brushCtx = brushSizeCanvas.getContext('2d');

    // ── UI controls ──────────────────────────────────────────────────────────
    const brushSizeInput   = document.getElementById('brushSize');
    const brushSizeValue   = document.getElementById('brushSizeValue');
    const nextBtn          = document.getElementById('nextBtn');
    const fillPenHint      = document.getElementById('fillPenHint');
    const polygonPenHint   = document.getElementById('polygonPenHint');
    const fillInBtn        = document.getElementById('fillInBtn');
    const cancelPolyBtn    = document.getElementById('cancelPolyBtn');

    // ── Tool state ───────────────────────────────────────────────────────────
    // 'brush' | 'fillpen' | 'polygonpen' | 'eraser'
    let activeTool = 'brush';

    // ── Brush / Fill Pen drawing state ───────────────────────────────────────
    let isDrawing  = false;
    let lastX      = 0;
    let lastY      = 0;
    let currentPath = [];

    // ── Data / history ───────────────────────────────────────────────────────
    let binaryData        = [];
    let currentImageIndex = 0;
    let images            = [];
    let currentImage      = null;
    let drawingHistory    = [];   // [{type, ...}]
    let redoStack         = [];
    let originalIndices   = [];

    // ── Polygon Pen state ────────────────────────────────────────────────────
    // A "polygon" object: { anchors: [{x,y}], filled: bool }
    // polygonsInProgress  – the one currently being built (anchors placed, not yet filled)
    // completedPolygons   – list of filled polygons still shown with draggable anchors
    let polygonInProgress  = null;   // { anchors: [{x,y}] }
    let completedPolygons  = [];     // [{ anchors: [{x,y}] }, …]  — all filled, editable

    // Drag state for anchor editing
    let draggingAnchor     = null;   // { polyIndex, anchorIndex }
    let mousePos           = { x: 0, y: 0 };

    // Visual constants
    const ANNOTATION_COLOUR    = 'rgba(0, 0, 255, 0.35)';
    const FILL_PEN_BORDER_W    = 2;
    const ANCHOR_RADIUS        = 7;
    const ANCHOR_FILL          = 'white';
    const ANCHOR_STROKE        = '#6f42c1';
    const ANCHOR_STROKE_W      = 2;
    const FIRST_ANCHOR_FILL    = '#17a2b8';   // teal – marks the closing target
    const SNAP_RADIUS          = 12;          // px – click within this to close polygon

    // ════════════════════════════════════════════════════════════════════════
    //  Brush-size preview
    // ════════════════════════════════════════════════════════════════════════
    function drawBrushSizes() {
        brushCtx.clearRect(0, 0, brushSizeCanvas.width, brushSizeCanvas.height);
        let x = 2;
        const y = 20;
        for (let size = 2; size <= 38; size += 2) {
            brushCtx.beginPath();
            brushCtx.arc(x + size / 2, y, size / 2, 0, Math.PI * 2);
            brushCtx.strokeStyle = 'blue';
            brushCtx.stroke();
            x += size + 5;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Image loading
    // ════════════════════════════════════════════════════════════════════════
    async function loadImages() {
        try {
            const response = await fetch('/static/images');
            images = await response.json();

            originalIndices = images.map(img => ({
                image: img,
                index: parseInt(img.match(/\d+/)[0]) - 1
            }));

            const shuffled  = originalIndices.sort(() => Math.random() - 0.5);
            images          = shuffled.map(i => i.image);
            originalIndices = shuffled.map(i => i.index);

            await loadImage(currentImageIndex);
        } catch (err) {
            console.error('Error loading images:', err);
        }
    }

    function initializeCanvases(width, height) {
        [backgroundCanvas, drawingCanvas, overlayCanvas].forEach(c => {
            c.width  = width;
            c.height = height;
        });
        const container = document.querySelector('.canvas-container');
        container.style.width  = width  + 'px';
        container.style.height = height + 'px';
    }

    async function loadImage(index) {
        // Reset polygon state for new image
        polygonInProgress = null;
        completedPolygons = [];
        drawingHistory    = [];
        redoStack         = [];
        updateUndoRedoButtons();
        updatePolygonUI();

        if (index >= images.length) {
            initializeCanvases(800, 400);
            ctx.font      = '22px Courier';
            ctx.fillStyle = 'blue';
            ctx.fillText('You have viewed all images.', 250, 200);
            oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            return;
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = `/static/input_images/${images[index]}`;
            img.onload = () => {
                initializeCanvases(img.width, img.height);
                bgCtx.clearRect(0, 0, img.width, img.height);
                bgCtx.drawImage(img, 0, 0);
                ctx.clearRect(0, 0, img.width, img.height);
                oCtx.clearRect(0, 0, img.width, img.height);
                currentImage = img;
                binaryData   = Array(img.height).fill().map(() => Array(img.width).fill(0));
                resolve();
            };
            img.onerror = reject;
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Core drawing helpers
    // ════════════════════════════════════════════════════════════════════════

    /** Render one history entry onto drawingCanvas (ctx). */
    function renderEntry(entry) {
        if (entry.type === 'eraser') {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineCap   = 'round';
            ctx.lineJoin  = 'round';
            ctx.lineWidth = entry.brushSize;
            ctx.beginPath();
            entry.path.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
            ctx.stroke();
            ctx.restore();

        } else if (entry.type === 'brush') {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = ANNOTATION_COLOUR;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.lineWidth   = entry.brushSize;
            ctx.beginPath();
            entry.path.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
            ctx.stroke();
            ctx.restore();

        } else if (entry.type === 'fillpen') {
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = ANNOTATION_COLOUR;
            ctx.fillStyle   = ANNOTATION_COLOUR;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.lineWidth   = FILL_PEN_BORDER_W;
            ctx.beginPath();
            entry.path.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();

        } else if (entry.type === 'polygon') {
            renderPolygonFill(entry.anchors, ctx);
        }
    }

    /** Fill a polygon defined by an anchors array onto a given context. */
    function renderPolygonFill(anchors, targetCtx) {
        if (anchors.length < 3) return;
        targetCtx.save();
        targetCtx.globalCompositeOperation = 'source-over';
        targetCtx.fillStyle   = ANNOTATION_COLOUR;
        targetCtx.strokeStyle = ANNOTATION_COLOUR;
        targetCtx.lineWidth   = FILL_PEN_BORDER_W;
        targetCtx.lineCap     = 'round';
        targetCtx.lineJoin    = 'round';
        targetCtx.beginPath();
        anchors.forEach((pt, i) => i === 0 ? targetCtx.moveTo(pt.x, pt.y) : targetCtx.lineTo(pt.x, pt.y));
        targetCtx.closePath();
        targetCtx.fill();
        targetCtx.stroke();
        targetCtx.restore();
    }

    /** Full redraw of drawingCanvas from history + completedPolygons. */
    function redrawCanvas() {
        ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        binaryData = Array(drawingCanvas.height).fill().map(() => Array(drawingCanvas.width).fill(0));
        drawingHistory.forEach(renderEntry);
        // Completed polygons are stored both in drawingHistory (for undo) and
        // in completedPolygons (for anchor editing).  They are rendered via
        // drawingHistory, so no double-render needed here.
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Overlay canvas – anchors + rubber-band line
    // ════════════════════════════════════════════════════════════════════════

    function drawOverlay() {
        oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        // ── In-progress polygon ──────────────────────────────────────────────
        if (polygonInProgress && polygonInProgress.anchors.length > 0) {
            const anchors = polygonInProgress.anchors;

            // Draw edges so far
            oCtx.save();
            oCtx.strokeStyle = ANNOTATION_COLOUR;
            oCtx.lineWidth   = FILL_PEN_BORDER_W;
            oCtx.setLineDash([5, 4]);
            oCtx.beginPath();
            anchors.forEach((pt, i) => i === 0 ? oCtx.moveTo(pt.x, pt.y) : oCtx.lineTo(pt.x, pt.y));
            oCtx.stroke();
            oCtx.restore();

            // Rubber-band line from last anchor to current mouse
            if (anchors.length >= 1) {
                const last = anchors[anchors.length - 1];
                oCtx.save();
                oCtx.strokeStyle = 'rgba(0,0,255,0.5)';
                oCtx.lineWidth   = 1.5;
                oCtx.setLineDash([4, 4]);
                oCtx.beginPath();
                oCtx.moveTo(last.x, last.y);
                oCtx.lineTo(mousePos.x, mousePos.y);
                oCtx.stroke();
                oCtx.restore();
            }

            // Draw anchors
            anchors.forEach((pt, i) => {
                oCtx.beginPath();
                oCtx.arc(pt.x, pt.y, ANCHOR_RADIUS, 0, Math.PI * 2);
                oCtx.fillStyle   = (i === 0) ? FIRST_ANCHOR_FILL : ANCHOR_FILL;
                oCtx.strokeStyle = ANCHOR_STROKE;
                oCtx.lineWidth   = ANCHOR_STROKE_W;
                oCtx.fill();
                oCtx.stroke();
            });
        }

        // ── Completed polygons (draggable anchors) ───────────────────────────
        completedPolygons.forEach(poly => {
            poly.anchors.forEach(pt => {
                oCtx.beginPath();
                oCtx.arc(pt.x, pt.y, ANCHOR_RADIUS, 0, Math.PI * 2);
                oCtx.fillStyle   = ANCHOR_FILL;
                oCtx.strokeStyle = ANCHOR_STROKE;
                oCtx.lineWidth   = ANCHOR_STROKE_W;
                oCtx.fill();
                oCtx.stroke();
            });
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Polygon Pen – anchor placement & editing
    // ════════════════════════════════════════════════════════════════════════

    /** Distance between two points. */
    function dist(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    /**
     * Find which completed-polygon anchor (if any) is within SNAP_RADIUS of pos.
     * Returns { polyIndex, anchorIndex } or null.
     */
    function findAnchorAt(pos) {
        for (let pi = 0; pi < completedPolygons.length; pi++) {
            const anchors = completedPolygons[pi].anchors;
            for (let ai = 0; ai < anchors.length; ai++) {
                if (dist(anchors[ai], pos) <= SNAP_RADIUS) {
                    return { polyIndex: pi, anchorIndex: ai };
                }
            }
        }
        return null;
    }

    /** Commit the in-progress polygon: fill it and move to completedPolygons. */
    function commitPolygon() {
        if (!polygonInProgress || polygonInProgress.anchors.length < 3) {
            alert('Please place at least 3 anchor points before filling.');
            return;
        }

        const anchors = polygonInProgress.anchors.map(p => ({ ...p }));

        // Render fill onto drawingCanvas
        renderPolygonFill(anchors, ctx);

        // Push to history (for undo)
        const entry = { type: 'polygon', anchors: anchors.map(p => ({ ...p })) };
        drawingHistory.push(entry);
        redoStack = [];
        updateUndoRedoButtons();

        // Keep in completedPolygons so anchors remain draggable
        completedPolygons.push({ anchors, historyEntry: entry });

        // Reset in-progress state
        polygonInProgress = null;
        updatePolygonUI();
        drawOverlay();
    }

    /** Cancel the polygon currently being placed. */
    function cancelPolygon() {
        polygonInProgress = null;
        updatePolygonUI();
        drawOverlay();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Mouse event handlers
    // ════════════════════════════════════════════════════════════════════════

    function getCanvasPos(e) {
        const rect = drawingCanvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    // ── mousedown ────────────────────────────────────────────────────────────
    drawingCanvas.addEventListener('mousedown', function (e) {
        const pos = getCanvasPos(e);

        if (activeTool === 'polygonpen') {
            // ── Check if clicking an existing completed-polygon anchor (drag) ──
            const hit = findAnchorAt(pos);
            if (hit) {
                draggingAnchor = hit;
                return;
            }

            // ── Placing a new anchor ─────────────────────────────────────────
            if (!polygonInProgress) {
                polygonInProgress = { anchors: [] };
            }

            const anchors = polygonInProgress.anchors;

            // Check snap-to-first to close polygon
            if (anchors.length >= 3 && dist(pos, anchors[0]) <= SNAP_RADIUS) {
                commitPolygon();
                return;
            }

            anchors.push({ x: pos.x, y: pos.y });
            updatePolygonUI();
            drawOverlay();
            return;
        }

        // ── Brush / Fill Pen / Eraser ────────────────────────────────────────
        isDrawing   = true;
        lastX       = pos.x;
        lastY       = pos.y;
        currentPath = [{ x: lastX, y: lastY }];
    });

    // ── mousemove ────────────────────────────────────────────────────────────
    drawingCanvas.addEventListener('mousemove', function (e) {
        const pos = getCanvasPos(e);
        mousePos = pos;

        if (activeTool === 'polygonpen') {
            // Dragging an anchor of a completed polygon
            if (draggingAnchor) {
                const poly = completedPolygons[draggingAnchor.polyIndex];
                poly.anchors[draggingAnchor.anchorIndex] = { x: pos.x, y: pos.y };
                // Also update the history entry so redo/replay is correct
                poly.historyEntry.anchors[draggingAnchor.anchorIndex] = { x: pos.x, y: pos.y };
                // Re-render all fills
                redrawCanvas();
                drawOverlay();
                return;
            }
            // Update rubber-band line
            if (polygonInProgress && polygonInProgress.anchors.length > 0) {
                drawOverlay();
            }
            return;
        }

        if (!isDrawing) return;

        // Live preview for brush / fill pen / eraser
        ctx.save();
        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';

        if (activeTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = parseInt(brushSizeInput.value, 10);
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        } else if (activeTool === 'fillpen') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = ANNOTATION_COLOUR;
            ctx.lineWidth   = FILL_PEN_BORDER_W;
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        } else {
            // brush
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = ANNOTATION_COLOUR;
            ctx.lineWidth   = parseInt(brushSizeInput.value, 10);
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        }

        ctx.restore();
        currentPath.push({ x: pos.x, y: pos.y });
        lastX = pos.x;
        lastY = pos.y;
    });

    // ── mouseup ──────────────────────────────────────────────────────────────
    drawingCanvas.addEventListener('mouseup', function () {
        if (activeTool === 'polygonpen') {
            if (draggingAnchor) {
                draggingAnchor = null;
                drawOverlay();
            }
            return;
        }

        if (!isDrawing) return;
        isDrawing = false;

        if (currentPath.length > 1) {
            const entry = {
                type:      activeTool === 'eraser' ? 'eraser'
                         : activeTool === 'fillpen' ? 'fillpen'
                         : 'brush',
                path:      [...currentPath],
                brushSize: parseInt(brushSizeInput.value, 10)
            };

            // For fill pen: clear live preview, re-render properly with fill
            if (activeTool === 'fillpen') {
                redrawCanvas();
                renderEntry(entry);
            }

            drawingHistory.push(entry);
            redoStack = [];
            updateUndoRedoButtons();
        }
        currentPath = [];
    });

    // ── mouseout ─────────────────────────────────────────────────────────────
    drawingCanvas.addEventListener('mouseout', function () {
        if (activeTool !== 'polygonpen') {
            if (isDrawing && currentPath.length > 1) {
                isDrawing = false;
                const entry = {
                    type:      activeTool === 'eraser' ? 'eraser'
                             : activeTool === 'fillpen' ? 'fillpen'
                             : 'brush',
                    path:      [...currentPath],
                    brushSize: parseInt(brushSizeInput.value, 10)
                };
                if (activeTool === 'fillpen') { redrawCanvas(); renderEntry(entry); }
                drawingHistory.push(entry);
                redoStack = [];
                updateUndoRedoButtons();
                currentPath = [];
            }
            isDrawing = false;
        }
        // For polygon pen: keep rubber-band visible until mouse returns
    });

    // ════════════════════════════════════════════════════════════════════════
    //  Undo / Redo
    // ════════════════════════════════════════════════════════════════════════
    function undo() {
        if (drawingHistory.length === 0) return;

        const last = drawingHistory[drawingHistory.length - 1];

        // If the last entry is a polygon, also remove it from completedPolygons
        if (last.type === 'polygon') {
            const idx = completedPolygons.findIndex(p => p.historyEntry === last);
            if (idx !== -1) completedPolygons.splice(idx, 1);
            drawOverlay();
        }

        redoStack.push(drawingHistory.pop());
        redrawCanvas();
        updateUndoRedoButtons();
    }

    function redo() {
        if (redoStack.length === 0) return;

        const entry = redoStack.pop();
        drawingHistory.push(entry);

        if (entry.type === 'polygon') {
            completedPolygons.push({
                anchors:      entry.anchors.map(p => ({ ...p })),
                historyEntry: entry
            });
            drawOverlay();
        }

        redrawCanvas();
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        document.getElementById('undoBtn').disabled = drawingHistory.length === 0;
        document.getElementById('redoBtn').disabled = redoStack.length === 0;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Tool selection
    // ════════════════════════════════════════════════════════════════════════
    function setTool(tool) {
        // Cancel any in-progress polygon when switching away
        if (activeTool === 'polygonpen' && tool !== 'polygonpen') {
            cancelPolygon();
        }

        activeTool = tool;

        document.getElementById('brushBtn').classList.toggle('active',      tool === 'brush');
        document.getElementById('fillPenBtn').classList.toggle('active',    tool === 'fillpen');
        document.getElementById('polygonPenBtn').classList.toggle('active', tool === 'polygonpen');
        document.getElementById('eraserBtn').classList.toggle('active',     tool === 'eraser');

        fillPenHint.style.display    = tool === 'fillpen'    ? 'block' : 'none';
        polygonPenHint.style.display = tool === 'polygonpen' ? 'block' : 'none';

        // Hide brush-size preview for fill pen and polygon pen
        brushSizeCanvas.style.display = (tool === 'fillpen' || tool === 'polygonpen') ? 'none' : 'block';

        updatePolygonUI();
    }

    /** Show/hide the Fill In and Cancel buttons based on polygon state. */
    function updatePolygonUI() {
        const inPoly = activeTool === 'polygonpen' && polygonInProgress && polygonInProgress.anchors.length > 0;
        fillInBtn.style.display    = inPoly ? 'inline-block' : 'none';
        cancelPolyBtn.style.display = inPoly ? 'inline-block' : 'none';
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Save & Next
    // ════════════════════════════════════════════════════════════════════════
    async function saveAndNext() {
        if (currentImageIndex >= images.length) return;

        const predictionInput = document.querySelector('input[name="prediction"]:checked');
        if (!predictionInput) {
            alert('Please select whether the image is ischemic or non-ischemic');
            return;
        }

        // Commit any in-progress polygon before saving
        if (polygonInProgress && polygonInProgress.anchors.length >= 3) {
            commitPolygon();
        }

        const filename      = images[currentImageIndex].replace(/\.[^/.]+$/, '');
        const originalIndex = originalIndices[currentImageIndex];

        try {
            await fetch('/save_prediction', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ imageIndex: originalIndex, prediction: predictionInput.value })
            });

            // Build binary data from canvas pixel alpha
            const imageData = ctx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);
            for (let row = 0; row < drawingCanvas.height; row++) {
                for (let col = 0; col < drawingCanvas.width; col++) {
                    const alpha = imageData.data[(row * drawingCanvas.width + col) * 4 + 3];
                    binaryData[row][col] = alpha > 0 ? 1 : 0;
                }
            }

            const binaryString   = binaryData.map(row => row.join('\t')).join('\n');
            const binaryBlob     = new Blob([binaryString], { type: 'text/plain' });
            const binaryFile     = new File([binaryBlob], `${filename}_binary.txt`);
            const binaryFormData = new FormData();
            binaryFormData.append('file', binaryFile);

            drawingCanvas.toBlob(async blob => {
                const imageFile    = new File([blob], `${filename}_result_image.png`);
                const imageFormData = new FormData();
                imageFormData.append('file', imageFile);

                await Promise.all([
                    fetch('/save_binary',       { method: 'POST', body: binaryFormData }),
                    fetch('/save_masked_image', { method: 'POST', body: imageFormData })
                ]);

                currentImageIndex++;
                await loadImage(currentImageIndex);
            }, 'image/png');

            predictionInput.checked = false;

        } catch (err) {
            console.error('Error saving:', err);
            alert('Error saving annotations. Please try again.');
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Event listeners
    // ════════════════════════════════════════════════════════════════════════
    brushSizeInput.addEventListener('input', e => {
        brushSizeValue.textContent = e.target.value;
        drawBrushSizes();
    });

    nextBtn.addEventListener('click', saveAndNext);

    document.getElementById('brushBtn').addEventListener('click',      () => setTool('brush'));
    document.getElementById('fillPenBtn').addEventListener('click',    () => setTool('fillpen'));
    document.getElementById('polygonPenBtn').addEventListener('click', () => setTool('polygonpen'));
    document.getElementById('eraserBtn').addEventListener('click',     () => setTool('eraser'));
    document.getElementById('undoBtn').addEventListener('click',       undo);
    document.getElementById('redoBtn').addEventListener('click',       redo);

    fillInBtn.addEventListener('click',    commitPolygon);
    cancelPolyBtn.addEventListener('click', cancelPolygon);

    // ── Initialise ───────────────────────────────────────────────────────────
    updateUndoRedoButtons();
    drawBrushSizes();
    loadImages();
});
