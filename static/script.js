/**
 * PET-image annotation tool (Web Version)
 *
 * This script handles the frontend logic for the web-based annotation tool.
 * It is based on the original Python application by Kerttu Pusa.
 *
 * Original project: https://gitlab.com/group17761803/Annotation_tool
 * Modified version: https://github.com/smrhosseini1993/Annotation-tool-web
 * Developer: Seyed M. Hosseini
 *
 * ── Tool modes ──────────────────────────────────────────────────────────────
 *  Brush    – freehand stroke (original behaviour, semi-transparent blue)
 *  Fill Pen – user draws a closed freehand border; on mouse-up the enclosed
 *             region is automatically flood-filled with the annotation colour.
 *             Ideal for annotating large decision-making regions (e.g. healthy
 *             non-ischemic areas on PET-MPI polar maps) without having to
 *             colour the entire interior with a brush.
 *  Eraser   – removes annotation pixels (original behaviour)
 * ────────────────────────────────────────────────────────────────────────────
 */

document.addEventListener('DOMContentLoaded', function () {

    // ── Canvas elements ──────────────────────────────────────────────────────
    const backgroundCanvas = document.getElementById('backgroundCanvas');
    const drawingCanvas    = document.getElementById('drawingCanvas');
    const brushSizeCanvas  = document.getElementById('brushSizeCanvas');

    if (!backgroundCanvas || !drawingCanvas || !brushSizeCanvas) {
        console.error('Could not find required canvas elements');
        return;
    }

    const bgCtx    = backgroundCanvas.getContext('2d');
    const ctx      = drawingCanvas.getContext('2d');
    const brushCtx = brushSizeCanvas.getContext('2d');

    // ── UI controls ──────────────────────────────────────────────────────────
    const brushSizeInput = document.getElementById('brushSize');
    const brushSizeValue = document.getElementById('brushSizeValue');
    const nextBtn        = document.getElementById('nextBtn');
    const fillPenHint    = document.getElementById('fillPenHint');

    // ── Tool state ───────────────────────────────────────────────────────────
    // 'brush' | 'fillpen' | 'eraser'
    let activeTool = 'brush';

    // ── Drawing state ────────────────────────────────────────────────────────
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    // ── Data / history ───────────────────────────────────────────────────────
    let binaryData        = [];
    let currentImageIndex = 0;
    let images            = [];
    let currentImage      = null;
    let drawingHistory    = [];   // [{path, tool, brushSize}, …]
    let redoStack         = [];
    let currentPath       = [];
    let originalIndices   = [];

    // ── Annotation colour ────────────────────────────────────────────────────
    const ANNOTATION_COLOUR       = 'rgba(0, 0, 255, 0.35)';
    const FILL_PEN_BORDER_WIDTH   = 2;   // px – thin border drawn while dragging

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
            console.log('Loaded images:', images);

            originalIndices = images.map((img) => ({
                image: img,
                index: parseInt(img.match(/\d+/)[0]) - 1
            }));

            const shuffled  = originalIndices.sort(() => Math.random() - 0.5);
            images          = shuffled.map(item => item.image);
            originalIndices = shuffled.map(item => item.index);

            console.log('Shuffled images:', images);
            await loadImage(currentImageIndex);
        } catch (error) {
            console.error('Error loading images:', error);
        }
    }

    function initializeCanvases(width, height) {
        backgroundCanvas.width  = width;
        backgroundCanvas.height = height;
        drawingCanvas.width     = width;
        drawingCanvas.height    = height;

        const container = document.querySelector('.canvas-container');
        container.style.width  = width  + 'px';
        container.style.height = height + 'px';
    }

    async function loadImage(index) {
        if (index >= images.length) {
            initializeCanvases(800, 400);
            ctx.font      = '22px Courier';
            ctx.fillStyle = 'blue';
            ctx.fillText('You have viewed all images.', 400 - 150, 200);
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
                currentImage  = img;
                binaryData    = Array(img.height).fill().map(() => Array(img.width).fill(0));
                drawingHistory = [];
                redoStack      = [];
                updateUndoRedoButtons();
                resolve();
            };

            img.onerror = reject;
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Core drawing helpers
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Render a single history entry onto the canvas.
     * @param {object} entry  – { path, tool, brushSize }
     * @param {CanvasRenderingContext2D} targetCtx – defaults to ctx
     */
    function renderEntry(entry, targetCtx) {
        targetCtx = targetCtx || ctx;
        const { path, tool, brushSize } = entry;

        if (path.length === 0) return;

        targetCtx.save();
        targetCtx.lineCap  = 'round';
        targetCtx.lineJoin = 'round';

        if (tool === 'eraser') {
            // ── Eraser ──────────────────────────────────────────────────────
            targetCtx.globalCompositeOperation = 'destination-out';
            targetCtx.lineWidth = brushSize;
            targetCtx.beginPath();
            path.forEach((pt, i) => {
                if (i === 0) targetCtx.moveTo(pt.x, pt.y);
                else         targetCtx.lineTo(pt.x, pt.y);
            });
            targetCtx.stroke();

        } else if (tool === 'fillpen') {
            // ── Fill Pen ─────────────────────────────────────────────────────
            // Draw a thin border and fill the enclosed area.
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.strokeStyle = ANNOTATION_COLOUR;
            targetCtx.fillStyle   = ANNOTATION_COLOUR;
            targetCtx.lineWidth   = FILL_PEN_BORDER_WIDTH;

            targetCtx.beginPath();
            path.forEach((pt, i) => {
                if (i === 0) targetCtx.moveTo(pt.x, pt.y);
                else         targetCtx.lineTo(pt.x, pt.y);
            });
            targetCtx.closePath();  // close the contour automatically
            targetCtx.fill();       // flood-fill the interior
            targetCtx.stroke();     // draw the border on top

        } else {
            // ── Brush (default) ──────────────────────────────────────────────
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.strokeStyle = ANNOTATION_COLOUR;
            targetCtx.lineWidth   = brushSize;

            targetCtx.beginPath();
            path.forEach((pt, i) => {
                if (i === 0) targetCtx.moveTo(pt.x, pt.y);
                else         targetCtx.lineTo(pt.x, pt.y);
            });
            targetCtx.stroke();
        }

        targetCtx.restore();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Mouse event handlers
    // ════════════════════════════════════════════════════════════════════════
    function getCanvasPos(e) {
        const rect = drawingCanvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    function startDrawing(e) {
        isDrawing = true;
        const pos = getCanvasPos(e);
        lastX = pos.x;
        lastY = pos.y;
        currentPath = [{ x: lastX, y: lastY }];
    }

    function draw(e) {
        if (!isDrawing) return;

        const pos = getCanvasPos(e);
        const x   = pos.x;
        const y   = pos.y;

        // Live preview while dragging
        ctx.save();
        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';

        if (activeTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = parseInt(brushSizeInput.value, 10);
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(x, y);
            ctx.stroke();

        } else if (activeTool === 'fillpen') {
            // For fill-pen we only show the live stroke preview; the fill
            // is applied on mouseup via renderEntry → closePath + fill.
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = ANNOTATION_COLOUR;
            ctx.lineWidth   = FILL_PEN_BORDER_WIDTH;
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(x, y);
            ctx.stroke();

        } else {
            // Brush
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = ANNOTATION_COLOUR;
            ctx.lineWidth   = parseInt(brushSizeInput.value, 10);
            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(x, y);
            ctx.stroke();
        }

        ctx.restore();

        currentPath.push({ x, y });
        lastX = x;
        lastY = y;
    }

    function stopDrawing() {
        if (!isDrawing) return;
        isDrawing = false;

        if (currentPath.length > 1) {
            const entry = {
                path:      [...currentPath],
                tool:      activeTool,
                brushSize: parseInt(brushSizeInput.value, 10)
            };

            // For fill-pen: clear the live-preview stroke and re-render the
            // entry properly (with closePath + fill) so the result is clean.
            if (activeTool === 'fillpen') {
                redrawCanvas(false);       // replay history without new entry
                renderEntry(entry);        // render the completed fill shape
            }

            drawingHistory.push(entry);
            currentPath = [];
            redoStack   = [];
            updateUndoRedoButtons();
        } else {
            currentPath = [];
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Canvas replay (undo / redo support)
    // ════════════════════════════════════════════════════════════════════════

    /**
     * Replay all history entries from scratch.
     * @param {boolean} [includeLast=true]  Pass false to replay all but the
     *                                      last entry (used during fill-pen
     *                                      mouseup to clear the live preview).
     */
    function redrawCanvas(includeLast) {
        if (includeLast === undefined) includeLast = true;

        ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        binaryData = Array(drawingCanvas.height).fill().map(() => Array(drawingCanvas.width).fill(0));

        const entries = includeLast ? drawingHistory : drawingHistory.slice(0, -1);
        entries.forEach(entry => renderEntry(entry));
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Undo / Redo
    // ════════════════════════════════════════════════════════════════════════
    function undo() {
        if (drawingHistory.length > 0) {
            redoStack.push(drawingHistory.pop());
            redrawCanvas();
            updateUndoRedoButtons();
        }
    }

    function redo() {
        if (redoStack.length > 0) {
            drawingHistory.push(redoStack.pop());
            redrawCanvas();
            updateUndoRedoButtons();
        }
    }

    function updateUndoRedoButtons() {
        document.getElementById('undoBtn').disabled = drawingHistory.length === 0;
        document.getElementById('redoBtn').disabled = redoStack.length === 0;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Tool selection
    // ════════════════════════════════════════════════════════════════════════
    function setTool(tool) {
        activeTool = tool;

        document.getElementById('brushBtn').classList.toggle('active',   tool === 'brush');
        document.getElementById('fillPenBtn').classList.toggle('active', tool === 'fillpen');
        document.getElementById('eraserBtn').classList.toggle('active',  tool === 'eraser');

        // Show/hide the fill-pen hint bar
        fillPenHint.style.display = (tool === 'fillpen') ? 'block' : 'none';

        // Hide brush-size preview when fill-pen is active (size is irrelevant)
        brushSizeCanvas.style.display = (tool === 'fillpen') ? 'none' : 'block';
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Save & Next
    // ════════════════════════════════════════════════════════════════════════
    async function saveAndNext() {
        if (currentImageIndex >= images.length) {
            console.log('All images processed');
            return;
        }

        const predictionInput = document.querySelector('input[name="prediction"]:checked');
        if (!predictionInput) {
            alert('Please select whether the image is ischemic or non-ischemic');
            return;
        }

        const filename      = images[currentImageIndex].replace(/\.[^/.]+$/, '');
        const originalIndex = originalIndices[currentImageIndex];

        try {
            // Save prediction
            await fetch('/save_prediction', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ imageIndex: originalIndex, prediction: predictionInput.value })
            });

            // Build binary data from canvas pixels
            const imageData = ctx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);
            for (let row = 0; row < drawingCanvas.height; row++) {
                for (let col = 0; col < drawingCanvas.width; col++) {
                    const alpha = imageData.data[(row * drawingCanvas.width + col) * 4 + 3];
                    binaryData[row][col] = alpha > 0 ? 1 : 0;
                }
            }

            const binaryString  = binaryData.map(row => row.join('\t')).join('\n');
            const binaryBlob    = new Blob([binaryString], { type: 'text/plain' });
            const binaryFile    = new File([binaryBlob], `${filename}_binary.txt`);
            const binaryFormData = new FormData();
            binaryFormData.append('file', binaryFile);

            // Save masked image
            drawingCanvas.toBlob(async (blob) => {
                const imageFile    = new File([blob], `${filename}_result_image.png`);
                const imageFormData = new FormData();
                imageFormData.append('file', imageFile);

                await Promise.all([
                    fetch('/save_binary',       { method: 'POST', body: binaryFormData }),
                    fetch('/save_masked_image', { method: 'POST', body: imageFormData })
                ]);

                console.log(`Saved annotations for image ${currentImageIndex + 1} of ${images.length}`);
                currentImageIndex++;
                await loadImage(currentImageIndex);
            }, 'image/png');

            document.querySelector('input[name="prediction"]:checked').checked = false;

        } catch (error) {
            console.error('Error saving:', error);
            alert('Error saving annotations. Please try again.');
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Event listeners
    // ════════════════════════════════════════════════════════════════════════
    drawingCanvas.addEventListener('mousedown', startDrawing);
    drawingCanvas.addEventListener('mousemove', draw);
    drawingCanvas.addEventListener('mouseup',   stopDrawing);
    drawingCanvas.addEventListener('mouseout',  stopDrawing);

    brushSizeInput.addEventListener('input', e => {
        brushSizeValue.textContent = e.target.value;
        drawBrushSizes();
    });

    nextBtn.addEventListener('click', saveAndNext);

    document.getElementById('brushBtn').addEventListener('click',   () => setTool('brush'));
    document.getElementById('fillPenBtn').addEventListener('click', () => setTool('fillpen'));
    document.getElementById('eraserBtn').addEventListener('click',  () => setTool('eraser'));
    document.getElementById('undoBtn').addEventListener('click',    undo);
    document.getElementById('redoBtn').addEventListener('click',    redo);

    // ── Initialise ───────────────────────────────────────────────────────────
    updateUndoRedoButtons();
    drawBrushSizes();
    loadImages();
});
