# PET polar-map annotation tool (local Flask application)
#
# The application saves a binary mask, a working-colour overlay, a clean white
# final-preview image, and compact annotation metadata for each input image.
# Saving the same image again intentionally replaces its previous outputs.

from __future__ import annotations

import json
import os
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from PIL import Image
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / 'static'
INPUT_DIR = STATIC_DIR / 'input_images'
RESULTS_DIR = STATIC_DIR / 'results'
BINARY_DIR = RESULTS_DIR / 'binary_data'
WORKING_OVERLAY_DIR = RESULTS_DIR / 'masked_images'
FINAL_PREVIEW_DIR = RESULTS_DIR / 'final_preview_images'
STATE_DIR = RESULTS_DIR / 'annotation_state'
PREDICTIONS_FILE = RESULTS_DIR / 'predictions.txt'
FIXED_STENCIL_PATH = STATIC_DIR / 'assets' / 'polar_map_paintable_stencil_1024.png'
GRID_DIMENSION = 128
STANDARD_MAP_SIZE = 1024

for directory in [INPUT_DIR, BINARY_DIR, WORKING_OVERLAY_DIR, FINAL_PREVIEW_DIR, STATE_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder='static')
CORS(app)


def input_images() -> list[str]:
    """Return supported input images in deterministic filename order."""
    return sorted(
        path.name for path in INPUT_DIR.iterdir()
        if path.is_file() and path.suffix.lower() in {'.jpg', '.jpeg', '.png'}
    )


def image_stem(filename: str) -> str:
    return Path(secure_filename(filename)).stem


def write_binary_mask_from_state(stem: str, selected_cells: list[str]) -> None:
    """Write the strict 0/1 mask from selected cells and the fixed stencil.

    Generating this server-side avoids transferring a large 1024×1024 text
    matrix from the browser and keeps the saved scientific mask independent of
    visual brush colour.
    """
    if not FIXED_STENCIL_PATH.exists():
        raise FileNotFoundError('Fixed polar-map stencil is missing.')

    stencil = Image.open(FIXED_STENCIL_PATH).convert('L')
    if stencil.size != (STANDARD_MAP_SIZE, STANDARD_MAP_SIZE):
        raise ValueError('Fixed polar-map stencil has the wrong dimensions.')

    selected: set[tuple[int, int]] = set()
    for key in selected_cells:
        try:
            col_text, row_text = key.split(':', 1)
            col, row = int(col_text), int(row_text)
        except (AttributeError, ValueError):
            continue
        if 0 <= col < GRID_DIMENSION and 0 <= row < GRID_DIMENSION:
            selected.add((col, row))

    cell_size = STANDARD_MAP_SIZE // GRID_DIMENSION
    stencil_pixels = stencil.load()
    BINARY_DIR.mkdir(parents=True, exist_ok=True)
    target = BINARY_DIR / f'{stem}_binary.txt'
    with target.open('w', encoding='utf-8') as output:
        for y in range(STANDARD_MAP_SIZE):
            row = y // cell_size
            values = [
                '1' if (x // cell_size, row) in selected and stencil_pixels[x, y] >= 128 else '0'
                for x in range(STANDARD_MAP_SIZE)
            ]
            output.write('\t'.join(values))
            if y < STANDARD_MAP_SIZE - 1:
                output.write('\n')


def parse_selected_cells(selected_cells: list[str]) -> set[tuple[int, int]]:
    selected: set[tuple[int, int]] = set()
    for key in selected_cells:
        try:
            col_text, row_text = key.split(':', 1)
            col, row = int(col_text), int(row_text)
        except (AttributeError, ValueError):
            continue
        if 0 <= col < GRID_DIMENSION and 0 <= row < GRID_DIMENSION:
            selected.add((col, row))
    return selected


def annotation_alpha_from_state(selected_cells: list[str]) -> Image.Image:
    """Build a per-pixel alpha mask from selected cells and fixed stencil."""
    stencil = Image.open(FIXED_STENCIL_PATH).convert('L')
    selected = parse_selected_cells(selected_cells)
    cell_size = STANDARD_MAP_SIZE // GRID_DIMENSION
    stencil_pixels = stencil.load()
    alpha_values = []
    for y in range(STANDARD_MAP_SIZE):
        row = y // cell_size
        for x in range(STANDARD_MAP_SIZE):
            alpha_values.append(255 if (x // cell_size, row) in selected and stencil_pixels[x, y] >= 128 else 0)
    return Image.frombytes('L', (STANDARD_MAP_SIZE, STANDARD_MAP_SIZE), bytes(alpha_values))


def write_working_overlay_from_state(stem: str, selected_cells: list[str], brush_colour: str) -> None:
    """Create the transparent clinician-colour working overlay from state."""
    if not isinstance(brush_colour, str) or not brush_colour.startswith('#') or len(brush_colour) != 7:
        brush_colour = '#0066ff'
    try:
        red = int(brush_colour[1:3], 16)
        green = int(brush_colour[3:5], 16)
        blue = int(brush_colour[5:7], 16)
    except ValueError:
        red, green, blue = 0, 102, 255

    alpha = annotation_alpha_from_state(selected_cells).point(lambda value: 108 if value else 0)
    overlay = Image.new('RGBA', (STANDARD_MAP_SIZE, STANDARD_MAP_SIZE), (red, green, blue, 0))
    overlay.putalpha(alpha)
    WORKING_OVERLAY_DIR.mkdir(parents=True, exist_ok=True)
    overlay.save(WORKING_OVERLAY_DIR / f'{stem}_result_image.png')


def write_final_preview_from_state(stem: str, filename: str, selected_cells: list[str]) -> None:
    """Create the manuscript-style white-overlay image on the backend."""
    image_path = INPUT_DIR / filename
    if not image_path.exists():
        raise FileNotFoundError('Input polar-map image is missing.')

    image = Image.open(image_path).convert('RGBA')
    if image.size != (STANDARD_MAP_SIZE, STANDARD_MAP_SIZE):
        raise ValueError('Input polar-map image has the wrong dimensions.')
    stencil = Image.open(FIXED_STENCIL_PATH).convert('L')

    alpha = annotation_alpha_from_state(selected_cells).point(lambda value: 118 if value else 0)
    overlay = Image.new('RGBA', image.size, (255, 255, 255, 0))
    overlay.putalpha(alpha)
    FINAL_PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    Image.alpha_composite(image, overlay).save(FINAL_PREVIEW_DIR / f'{stem}_final_preview.png')


def write_prediction(image_index: int, prediction: str) -> None:
    """Replace the image-level class at its original dataset index."""
    predictions: list[str] = []
    if PREDICTIONS_FILE.exists():
        predictions = PREDICTIONS_FILE.read_text(encoding='utf-8').splitlines()

    while len(predictions) <= image_index:
        predictions.append('')
    predictions[image_index] = prediction

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    PREDICTIONS_FILE.write_text('\n'.join(predictions) + '\n', encoding='utf-8')


@app.route('/')
def serve_index():
    return send_from_directory(STATIC_DIR, 'index.html')


@app.route('/static/images')
def list_images():
    return jsonify(input_images())


@app.route('/annotation_status')
def annotation_status():
    """Return filenames with saved state metadata for progress display."""
    saved_filenames = []
    for state_file in STATE_DIR.glob('*_state.json'):
        try:
            state = json.loads(state_file.read_text(encoding='utf-8'))
            filename = state.get('filename')
            if filename:
                saved_filenames.append(filename)
        except (OSError, json.JSONDecodeError):
            continue
    return jsonify({'savedFilenames': sorted(set(saved_filenames))})


@app.route('/annotation_state/<path:filename>')
def get_annotation_state(filename: str):
    """Load a compact saved selection and prediction for revisiting an image."""
    requested = secure_filename(filename)
    if requested not in input_images():
        return jsonify({'error': 'Unknown input image.'}), 404

    state_path = STATE_DIR / f'{image_stem(requested)}_state.json'
    if not state_path.exists():
        return jsonify({'saved': False})

    try:
        state = json.loads(state_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return jsonify({'error': 'Saved annotation metadata is unreadable.'}), 500

    return jsonify({
        'saved': True,
        'prediction': state.get('prediction'),
        'selectedCells': state.get('selectedCells', []),
        'gridDimension': state.get('gridDimension', 128),
    })


@app.route('/save_annotation', methods=['POST'])
def save_annotation():
    """Save or replace all outputs associated with one annotated image."""
    metadata = request.get_json(silent=True)
    if not metadata:
        return jsonify({'error': 'Annotation metadata is required.'}), 400

    try:
        filename = secure_filename(metadata['filename'])
        prediction = str(metadata['prediction'])
        image_index = int(metadata['imageIndex'])
        selected_cells = metadata['selectedCells']
        brush_colour = metadata.get('brushColour', '#0066ff')
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return jsonify({'error': 'Invalid annotation metadata.'}), 400

    if filename not in input_images():
        return jsonify({'error': 'Unknown input image.'}), 404
    if prediction not in {'0', '1'}:
        return jsonify({'error': 'Prediction must be 0 or 1.'}), 400
    if not isinstance(selected_cells, list) or not all(isinstance(cell, str) for cell in selected_cells):
        return jsonify({'error': 'Selected cells must be a list of grid-cell keys.'}), 400

    stem = image_stem(filename)
    # These fixed destinations intentionally overwrite existing outputs when an
    # expert revisits and corrects a previous image.
    write_binary_mask_from_state(stem, selected_cells)
    write_working_overlay_from_state(stem, selected_cells, brush_colour)
    write_final_preview_from_state(stem, filename, selected_cells)

    state = {
        'filename': filename,
        'prediction': prediction,
        'selectedCells': selected_cells,
        'gridDimension': 128,
    }
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / f'{stem}_state.json').write_text(json.dumps(state), encoding='utf-8')
    write_prediction(image_index, prediction)

    return jsonify({'message': 'Annotation saved.', 'replacedExisting': True})


# Legacy endpoints are retained for compatibility with earlier frontends.
@app.route('/save_binary', methods=['POST'])
def save_binary():
    file = request.files.get('file')
    if not file:
        return 'No file part', 400
    file.save(BINARY_DIR / secure_filename(file.filename))
    return 'File saved', 200


@app.route('/save_masked_image', methods=['POST'])
def save_masked_image():
    file = request.files.get('file')
    if not file:
        return 'No file part', 400
    file.save(WORKING_OVERLAY_DIR / secure_filename(file.filename))
    return 'File saved', 200


@app.route('/save_prediction', methods=['POST'])
def save_prediction():
    data = request.get_json(silent=True) or {}
    try:
        write_prediction(int(data['imageIndex']), str(data['prediction']))
    except (KeyError, TypeError, ValueError):
        return 'Invalid prediction payload', 400
    return 'Prediction saved', 200


if __name__ == '__main__':
    print(f'Current directory: {BASE_DIR}')
    print(f'Found images: {input_images()}')
    app.run(port=5000, debug=True)
