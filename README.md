# PET-MPI Polar-Map Annotation Tool

A local browser-based tool for expert annotation of PET-MPI polar maps. It supports image-level ischemic/non-ischemic classification and reproducible grid-cell decision-region masks for research and XAI comparison.

## Current annotation workflow

The tool uses a fixed **1024 × 1024 Study View** and a logical **128 × 128 grid**. Experts select complete grid cells rather than painting freehand pixels. The black outer region and fixed left notch are excluded from the final mask through a fixed coordinate stencil.

The interface includes a Brush/Eraser, four grid-brush sizes, per-user brush/grid/guide colours, optional grid and 17-segment guides, Undo/Redo, final-mask preview, Previous image, and overwrite-safe saving.

## Outputs

For every saved image, the application writes the following files into the active study-data folder:

```text
results/
├── binary_data/           # Strict 1024 × 1024 0/1 masks
├── masked_images/         # Transparent clinician-colour overlays
├── final_preview_images/  # Original map plus clean white mask overlay
├── annotation_state/      # Saved grid cells and image-level class
└── predictions.txt        # Ischemic/non-ischemic label per input image
```

Saving an image after revisiting it intentionally replaces its earlier outputs.

## Development use (macOS/Linux/Windows with Python)

```bash
git clone https://github.com/smrhosseini1993/Annotation-tool-web.git
cd Annotation-tool-web
python3 -m pip install -r requirements.txt
python3 app.py
```

The app opens the local browser page automatically. In development mode, place images in:

```text
static/input_images/
```

## Windows Study Kit for clinical experts

Clinical experts do not need VS Code, Python, Conda, or package installation. Build the Windows Study Kit from GitHub Actions and distribute one separate extracted copy for each expert/session.

The Study Kit workflow is documented here:

- [Windows Study Kit build and distribution guide](docs/windows_study_kit_build.md)
- [Clinician Study View quick guide (PDF)](docs/clinician_study_view_quick_guide.pdf)
- [Clinician Study View quick guide (Markdown)](docs/clinician_study_view_quick_guide.md)

The packaged kit uses this data layout:

```text
PET-MPI-Annotation-Study-Windows/
├── Start Annotation Tool.bat
├── Close Annotation Tool.bat
├── Study_Data/
│   ├── input_images/      # Place assigned 1024 × 1024 maps here
│   └── results/           # Collected at the end of the session
└── Clinician_Guide/
```

## Technology

- **Backend:** Flask and Pillow
- **Frontend:** HTML5 Canvas, CSS, and JavaScript
- **Mask model:** 128 × 128 logical cell grid saved as a 1024 × 1024 binary mask
- **Windows packaging:** PyInstaller build executed on a Windows runner

## Acknowledgment

This project is a substantially modified web version of the PET-image annotation tool originally created by Kerttu Pusa as a student project. The original work is available at <https://gitlab.com/group17761803/Annotation_tool>.
