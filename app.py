# Medical image annotation tool (local Flask application).
# It creates structured grid annotations for local research studies.

from __future__ import annotations

import csv
import json
import os
import random
import socket
import sys
import threading
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from PIL import Image
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR))
STATIC_DIR = BUNDLE_DIR / "static"
VERSION_FILE = BUNDLE_DIR / "VERSION"
GRID_DIMENSION = 128


def load_app_version() -> str:
    """Read the version bundled with this exact application build."""
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip() or "development"
    except OSError:
        return "development"


APP_VERSION = load_app_version()


def running_packaged_app() -> bool:
    """Return true when running from a PyInstaller Windows bundle."""
    return bool(getattr(sys, "frozen", False))


def resolve_study_data_root() -> Path:
    """Return the writable study-data directory.

    Development keeps the existing static/input_images and static/results paths.
    The packaged Windows Study Kit uses a Study_Data folder beside the app bundle.
    """
    configured = os.environ.get("ANNOTATION_STUDY_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    if running_packaged_app():
        return Path(sys.executable).resolve().parent / "Study_Data"
    return STATIC_DIR


STUDY_DATA_DIR = resolve_study_data_root()
INPUT_DIR = STUDY_DATA_DIR / "input_images"
RESULTS_DIR = STUDY_DATA_DIR / "results"
BINARY_DIR = RESULTS_DIR / "binary_data"
WORKING_OVERLAY_DIR = RESULTS_DIR / "masked_images"
FINAL_PREVIEW_DIR = RESULTS_DIR / "final_preview_images"
STATE_DIR = RESULTS_DIR / "annotation_state"
ASSESSMENTS_FILE = RESULTS_DIR / "assessments.csv"
SESSION_MANIFEST_FILE = STUDY_DATA_DIR / "session_manifest.json"

for directory in [INPUT_DIR, BINARY_DIR, WORKING_OVERLAY_DIR, FINAL_PREVIEW_DIR, STATE_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
CORS(app)


def input_images() -> list[str]:
    """Return supported input images in deterministic filename order."""
    return sorted(
        path.name
        for path in INPUT_DIR.iterdir()
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )


def session_images() -> list[str]:
    """Return one persistent randomised image order for this Study_Data folder."""
    source_images = input_images()
    if not source_images:
        return []

    if SESSION_MANIFEST_FILE.exists():
        try:
            manifest = json.loads(SESSION_MANIFEST_FILE.read_text(encoding="utf-8"))
            saved_order = manifest.get("image_order", [])
            if isinstance(saved_order, list) and set(saved_order) == set(source_images) and len(saved_order) == len(source_images):
                return saved_order
        except (OSError, json.JSONDecodeError):
            pass

    random_order = source_images.copy()
    random.SystemRandom().shuffle(random_order)
    manifest = {
        "image_order": random_order,
        "source_filenames": source_images,
        "image_count": len(source_images),
    }
    SESSION_MANIFEST_FILE.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return random_order


def image_stem(filename: str) -> str:
    return Path(secure_filename(filename)).stem


def image_size(filename: str) -> tuple[int, int]:
    image_path = INPUT_DIR / filename
    if not image_path.exists():
        raise FileNotFoundError("Input image is missing.")
    with Image.open(image_path) as image:
        return image.size


def parse_selected_cells(selected_cells: list[str]) -> set[tuple[int, int]]:
    selected: set[tuple[int, int]] = set()
    for key in selected_cells:
        try:
            col_text, row_text = key.split(":", 1)
            col, row = int(col_text), int(row_text)
        except (AttributeError, ValueError):
            continue
        if 0 <= col < GRID_DIMENSION and 0 <= row < GRID_DIMENSION:
            selected.add((col, row))
    return selected


def cell_for_pixel(x: int, y: int, width: int, height: int) -> tuple[int, int]:
    """Map a native image pixel to the logical annotation grid."""
    col = min(GRID_DIMENSION - 1, (x * GRID_DIMENSION) // width)
    row = min(GRID_DIMENSION - 1, (y * GRID_DIMENSION) // height)
    return col, row


def write_binary_mask_from_state(stem: str, filename: str, selected_cells: list[str]) -> None:
    """Write a native-dimension 0/1 mask from the selected logical grid cells."""
    width, height = image_size(filename)
    selected = parse_selected_cells(selected_cells)
    BINARY_DIR.mkdir(parents=True, exist_ok=True)
    target = BINARY_DIR / f"{stem}_binary.txt"
    with target.open("w", encoding="utf-8") as output:
        for y in range(height):
            row = min(GRID_DIMENSION - 1, (y * GRID_DIMENSION) // height)
            values = [
                "1" if ((x * GRID_DIMENSION) // width, row) in selected else "0"
                for x in range(width)
            ]
            output.write("\t".join(values))
            if y < height - 1:
                output.write("\n")


def annotation_alpha_from_state(filename: str, selected_cells: list[str]) -> Image.Image:
    """Build a native-dimension alpha mask from selected logical grid cells."""
    width, height = image_size(filename)
    selected = parse_selected_cells(selected_cells)
    alpha_values = bytearray(width * height)
    for y in range(height):
        row = min(GRID_DIMENSION - 1, (y * GRID_DIMENSION) // height)
        for x in range(width):
            if ((x * GRID_DIMENSION) // width, row) in selected:
                alpha_values[y * width + x] = 255
    return Image.frombytes("L", (width, height), bytes(alpha_values))


def write_working_overlay_from_state(stem: str, filename: str, selected_cells: list[str], brush_colour: str) -> None:
    """Create a transparent annotation-colour working overlay from saved state."""
    if not isinstance(brush_colour, str) or not brush_colour.startswith("#") or len(brush_colour) != 7:
        brush_colour = "#0066ff"
    try:
        red = int(brush_colour[1:3], 16)
        green = int(brush_colour[3:5], 16)
        blue = int(brush_colour[5:7], 16)
    except ValueError:
        red, green, blue = 0, 102, 255

    alpha = annotation_alpha_from_state(filename, selected_cells).point(lambda value: 108 if value else 0)
    overlay = Image.new("RGBA", alpha.size, (red, green, blue, 0))
    overlay.putalpha(alpha)
    WORKING_OVERLAY_DIR.mkdir(parents=True, exist_ok=True)
    overlay.save(WORKING_OVERLAY_DIR / f"{stem}_result_image.png")


def write_final_preview_from_state(stem: str, filename: str, selected_cells: list[str]) -> None:
    """Create a white-overlay review image from the original input and saved state."""
    image_path = INPUT_DIR / filename
    if not image_path.exists():
        raise FileNotFoundError("Input image is missing.")

    image = Image.open(image_path).convert("RGBA")
    alpha = annotation_alpha_from_state(filename, selected_cells).point(lambda value: 118 if value else 0)
    overlay = Image.new("RGBA", image.size, (255, 255, 255, 0))
    overlay.putalpha(alpha)
    FINAL_PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    Image.alpha_composite(image, overlay).save(FINAL_PREVIEW_DIR / f"{stem}_final_preview.png")


def write_assessment(filename: str, assessment: str | None) -> None:
    """Write a filename-linked optional binary study assessment."""
    existing: dict[str, str] = {}
    if ASSESSMENTS_FILE.exists():
        try:
            with ASSESSMENTS_FILE.open("r", encoding="utf-8", newline="") as source:
                for row in csv.DictReader(source):
                    name = row.get("image_filename")
                    code = row.get("assessment_code")
                    if name and code in {"0", "1"}:
                        existing[name] = code
        except OSError:
            pass

    if assessment in {"0", "1"}:
        existing[filename] = assessment
    else:
        existing.pop(filename, None)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with ASSESSMENTS_FILE.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=["image_filename", "assessment_code"])
        writer.writeheader()
        for image_name in input_images():
            if image_name in existing:
                writer.writerow({"image_filename": image_name, "assessment_code": existing[image_name]})


@app.route("/")
def serve_index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/health")
def health_check():
    """Expose a local-only marker used by the launcher to reuse a running app."""
    return jsonify({"app": "medical-image-annotation-tool", "version": APP_VERSION, "studyDataDir": str(STUDY_DATA_DIR)})


@app.route("/app_info")
def app_info():
    """Return the exact visible Study Kit version."""
    return jsonify({"version": APP_VERSION})


@app.route("/study_images/<path:filename>")
def serve_study_image(filename: str):
    """Serve images from the writable Study_Data input directory."""
    requested = secure_filename(filename)
    if requested not in input_images():
        return "Unknown input image.", 404
    return send_from_directory(INPUT_DIR, requested)


@app.route("/static/images")
def list_images():
    return jsonify(session_images())


@app.route("/annotation_status")
def annotation_status():
    """Return filenames with saved state metadata for progress display."""
    saved_filenames = []
    for state_file in STATE_DIR.glob("*_state.json"):
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
            filename = state.get("filename")
            if filename:
                saved_filenames.append(filename)
        except (OSError, json.JSONDecodeError):
            continue
    return jsonify({"savedFilenames": sorted(set(saved_filenames))})


@app.route("/annotation_state/<path:filename>")
def get_annotation_state(filename: str):
    """Load compact saved selection and optional assessment for a revisit."""
    requested = secure_filename(filename)
    if requested not in input_images():
        return jsonify({"error": "Unknown input image."}), 404

    state_path = STATE_DIR / f"{image_stem(requested)}_state.json"
    if not state_path.exists():
        return jsonify({"saved": False})

    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return jsonify({"error": "Saved annotation metadata is unreadable."}), 500

    return jsonify({
        "saved": True,
        "assessment": state.get("assessment"),
        "selectedCells": state.get("selectedCells", []),
        "gridDimension": state.get("gridDimension", GRID_DIMENSION),
    })


@app.route("/save_annotation", methods=["POST"])
def save_annotation():
    """Save or replace every study output associated with one annotated image."""
    metadata = request.get_json(silent=True)
    if not metadata:
        return jsonify({"error": "Annotation metadata is required."}), 400

    try:
        filename = secure_filename(metadata["filename"])
        image_index = int(metadata.get("imageIndex", 0))
        selected_cells = metadata["selectedCells"]
        brush_colour = metadata.get("brushColour", "#0066ff")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return jsonify({"error": "Invalid annotation metadata."}), 400

    assessment_raw = metadata.get("assessment")
    assessment = None if assessment_raw in {None, ""} else str(assessment_raw)
    if assessment not in {None, "0", "1"}:
        return jsonify({"error": "Assessment must be 0, 1, or empty."}), 400
    if filename not in input_images():
        return jsonify({"error": "Unknown input image."}), 404
    if not isinstance(selected_cells, list) or not all(isinstance(cell, str) for cell in selected_cells):
        return jsonify({"error": "Selected cells must be a list of grid-cell keys."}), 400

    stem = image_stem(filename)
    # These destinations intentionally replace existing outputs when an expert
    # revisits and corrects a previous image.
    write_binary_mask_from_state(stem, filename, selected_cells)
    write_working_overlay_from_state(stem, filename, selected_cells, brush_colour)
    write_final_preview_from_state(stem, filename, selected_cells)

    state = {
        "filename": filename,
        "assessment": assessment,
        "selectedCells": selected_cells,
        "gridDimension": GRID_DIMENSION,
        "displayedOrder": image_index + 1,
    }
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / f"{stem}_state.json").write_text(json.dumps(state), encoding="utf-8")
    write_assessment(filename, assessment)

    return jsonify({"message": "Annotation saved.", "replacedExisting": True})


# Legacy endpoints are retained for compatibility with earlier frontends.
@app.route("/save_binary", methods=["POST"])
def save_binary():
    file = request.files.get("file")
    if not file:
        return "No file part", 400
    BINARY_DIR.mkdir(parents=True, exist_ok=True)
    file.save(BINARY_DIR / secure_filename(file.filename))
    return "File saved", 200


@app.route("/save_masked_image", methods=["POST"])
def save_masked_image():
    file = request.files.get("file")
    if not file:
        return "No file part", 400
    WORKING_OVERLAY_DIR.mkdir(parents=True, exist_ok=True)
    file.save(WORKING_OVERLAY_DIR / secure_filename(file.filename))
    return "File saved", 200


def existing_local_study_url(start_port: int = 8765, attempts: int = 40) -> str | None:
    """Return the URL of an already-running copy of this Study Kit, if present."""
    for port in range(start_port, start_port + attempts):
        url = f"http://127.0.0.1:{port}"
        try:
            with urlopen(f"{url}/health", timeout=0.15) as response:
                status = json.loads(response.read().decode("utf-8"))
        except (URLError, OSError, ValueError, json.JSONDecodeError):
            continue
        if status.get("app") == "medical-image-annotation-tool" and status.get("studyDataDir") == str(STUDY_DATA_DIR):
            return url
    return None


def find_available_port(start_port: int = 8765, attempts: int = 40) -> int:
    """Find an available loopback port so the Study Kit avoids port conflicts."""
    for port in range(start_port, start_port + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
            candidate.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                candidate.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError("Could not find an available local port for the annotation tool.")


def open_local_browser(port: int) -> None:
    webbrowser.open_new(f"http://127.0.0.1:{port}")


def main() -> None:
    existing_url = existing_local_study_url()
    if existing_url:
        print(f"Reopening the running annotation tool at {existing_url}")
        webbrowser.open_new(existing_url)
        return

    port = find_available_port()
    print(f"Medical Image Annotation Study Kit v{APP_VERSION}")
    print(f"Study data folder: {STUDY_DATA_DIR}")
    print(f"Found images: {len(session_images())}")
    print(f"Opening annotation tool at http://127.0.0.1:{port}")
    threading.Timer(0.8, open_local_browser, args=(port,)).start()
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
