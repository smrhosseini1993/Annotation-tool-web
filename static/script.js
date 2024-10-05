// Wait for DOM to be ready
/**
 * PET-image annotation tool (Web Version)
 *
 * This script handles the frontend logic for the web-based annotation tool.
 * It is based on the original Python application by Kerttu Pusa.
 *
 * Original project: https://gitlab.com/group17761803/Annotation_tool
 * Modified version: https://github.com/your-username/pet-image-annotation-tool-web
 * Developer: Seyed M. Hosseini
 */

document.addEventListener('DOMContentLoaded', function() {
    // Canvas elements
    const backgroundCanvas = document.getElementById('backgroundCanvas');
    const drawingCanvas = document.getElementById('drawingCanvas');
    const brushSizeCanvas = document.getElementById('brushSizeCanvas');

    // Check if elements exist
    if (!backgroundCanvas || !drawingCanvas || !brushSizeCanvas) {
        console.error('Could not find required canvas elements');
        return;
    }

    // Canvas contexts
    const bgCtx = backgroundCanvas.getContext('2d');
    const ctx = drawingCanvas.getContext('2d');
    const brushCtx = brushSizeCanvas.getContext('2d');

    // Controls
    const brushSizeInput = document.getElementById('brushSize');
    const brushSizeValue = document.getElementById('brushSizeValue');
    const nextBtn = document.getElementById('nextBtn');

    // Drawing state
    let isDrawing = false;
    let currentX = 0;
    let currentY = 0;
    let lastX = 0;
    let lastY = 0;
    let isEraser = false;

    // History and data
    let binaryData = [];
    let currentImageIndex = 0;
    let images = [];
    let currentImage = null;
    let drawingHistory = [];
    let redoStack = [];
    let currentPath = [];
    let originalIndices = [];

    // Remove drawnPaths as it's redundant with drawingHistory

    function drawBrushSizes() {
        const bctx = brushSizeCanvas.getContext('2d');
        bctx.clearRect(0, 0, brushSizeCanvas.width, brushSizeCanvas.height);
        let x = 2;
        const y = 20;
        for (let size = 2; size <= 38; size += 2) {
            bctx.beginPath();
            bctx.arc(x + size/2, y, size/2, 0, Math.PI * 2);
            bctx.strokeStyle = 'blue';
            bctx.stroke();
            x += size + 5;
        }
    }

    async function loadImages() {
        try {
            const response = await fetch('/static/images');
            images = await response.json();
            console.log("Loaded images:", images);
            
            // Store original indices before shuffling
            originalIndices = images.map((img, idx) => ({
                image: img,
                index: parseInt(img.match(/\d+/)[0]) - 1  // Assuming images are named like "image1.jpg"
            }));
            
            // Shuffle images while keeping track of original indices
            const shuffled = originalIndices.sort(() => Math.random() - 0.5);
            images = shuffled.map(item => item.image);
            originalIndices = shuffled.map(item => item.index);
            
            console.log("Shuffled images:", images);
            await loadImage(currentImageIndex);
        } catch (error) {
            console.error('Error loading images:', error);
        }
    }

    // Update initializeCanvases function
    function initializeCanvases(width, height) {
        // Set both canvases to exact image dimensions
        backgroundCanvas.width = width;
        backgroundCanvas.height = height;
        drawingCanvas.width = width;
        drawingCanvas.height = height;
        
        // Set container size to match
        const container = document.querySelector('.canvas-container');
        container.style.width = width + 'px';
        container.style.height = height + 'px';
    }

    // Update loadImage function
    async function loadImage(index) {
        if (index >= images.length) {
            initializeCanvases(800, 400);
            ctx.font = '22px Courier';
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
                currentImage = img;
                binaryData = Array(img.height).fill().map(() => Array(img.width).fill(0));
                resolve();
            };
            
            img.onerror = reject;
        });
    }

    // Update draw function for better eraser
    function draw(e) {
        if (!isDrawing) return;
        
        const rect = drawingCanvas.getBoundingClientRect();
        currentX = e.clientX - rect.left;
        currentY = e.clientY - rect.top;
        
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSizeInput.value;
        
        if (isEraser) {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(0,0,255,0.3)';
        }
        
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(currentX, currentY);
        ctx.stroke();
        
        currentPath.push({x: currentX, y: currentY});
        
        lastX = currentX;
        lastY = currentY;
    }

    function startDrawing(e) {
        isDrawing = true;
        const rect = drawingCanvas.getBoundingClientRect();
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
        currentPath.push({ x: lastX, y: lastY });
    }

    function stopDrawing() {
        isDrawing = false;
        saveState();
    }

    async function saveAndNext() {
        if (currentImageIndex >= images.length) {
            console.log("All images processed");
            return;
        }

        // Check if prediction is selected
        const predictionInput = document.querySelector('input[name="prediction"]:checked');
        if (!predictionInput) {
            alert('Please select whether the image is ischemic or non-ischemic');
            return;
        }

        const filename = images[currentImageIndex].replace(/\.[^/.]+$/, '');
        const originalIndex = originalIndices[currentImageIndex];
        
        try {
            // Save prediction
            await fetch('/save_prediction', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    imageIndex: originalIndex,
                    prediction: predictionInput.value
                })
            });

            // Save binary data
            const binaryString = binaryData.map(row => row.join('\t')).join('\n');
            const binaryBlob = new Blob([binaryString], { type: 'text/plain' });
            const binaryFile = new File([binaryBlob], `${filename}_binary.txt`);
            const binaryFormData = new FormData();
            binaryFormData.append('file', binaryFile);
            
            // Save masked image
            drawingCanvas.toBlob(async (blob) => {
                const imageFile = new File([blob], `${filename}_result_image.png`);
                const imageFormData = new FormData();
                imageFormData.append('file', imageFile);
                
                // Send both files
                await Promise.all([
                    fetch('/save_binary', {
                        method: 'POST',
                        body: binaryFormData
                    }),
                    fetch('/save_masked_image', {
                        method: 'POST',
                        body: imageFormData
                    })
                ]);

                console.log(`Saved annotations for image ${currentImageIndex + 1} of ${images.length}`);
                currentImageIndex++;
                await loadImage(currentImageIndex);
            }, 'image/png');
            
            // Reset radio buttons
            document.querySelector('input[name="prediction"]:checked').checked = false;
            
        } catch (error) {
            console.error('Error saving:', error);
            alert('Error saving annotations. Please try again.');
        }
    }

    function setTool(tool) {
        isEraser = tool === 'eraser';
        document.getElementById('brushBtn').classList.toggle('active', !isEraser);
        document.getElementById('eraserBtn').classList.toggle('active', isEraser);
    }

    function saveState() {
        if (currentPath.length > 0) {
            drawingHistory.push({
                path: [...currentPath],
                isEraser: isEraser
            });
            currentPath = [];
            redoStack = []; // Clear redo stack when new action is performed
            updateUndoRedoButtons();
        }
    }

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

    // Update redrawCanvas function
    function redrawCanvas() {
        ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        binaryData = Array(drawingCanvas.height).fill().map(() => Array(drawingCanvas.width).fill(0));
        
        drawingHistory.forEach(({path, isEraser}) => {
            ctx.beginPath();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = brushSizeInput.value;
            
            if (isEraser) {
                ctx.globalCompositeOperation = 'destination-out';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = 'rgba(0,0,255,0.3)';
            }
            
            path.forEach((point, index) => {
                if (index === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            });
            ctx.stroke();
        });
    }

    // Event Listeners
    drawingCanvas.addEventListener('mousedown', startDrawing);
    drawingCanvas.addEventListener('mousemove', draw);
    drawingCanvas.addEventListener('mouseup', stopDrawing);
    drawingCanvas.addEventListener('mouseout', stopDrawing);

    brushSizeInput.addEventListener('input', e => {
        brushSizeValue.textContent = e.target.value;
        drawBrushSizes();
    });

    nextBtn.addEventListener('click', saveAndNext);

    document.getElementById('brushBtn').addEventListener('click', () => setTool('brush'));
    document.getElementById('eraserBtn').addEventListener('click', () => setTool('eraser'));
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);
    drawingCanvas.addEventListener('mouseup', saveState);
    updateUndoRedoButtons();

    // Initialize
    drawBrushSizes();
    loadImages();
});