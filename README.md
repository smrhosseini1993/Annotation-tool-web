# Medical Image Annotation Tool

A local, browser-based application for **structured expert annotation of medical images**. The current research configuration supports cardiac PET-MPI polar maps, combining image-level assessment with reproducible grid-cell decision-region masks.

The software is intended for research studies that need more than a drawn overlay. Each saved annotation preserves a binary mask, structured annotation state, a visual overlay, a review image, and an image-linked classification record. The current PET-MPI configuration is designed to support expert-mask creation for explainable-AI comparison and observer-variability analysis.

> **Research-use software.** This application does not provide a clinical diagnosis, replace clinical reporting, or make automated treatment recommendations.

## Current study configuration: cardiac PET-MPI polar maps

The current implementation is configured for **1024 × 1024 PET-MPI polar maps**. Experts annotate complete cells on a logical **128 × 128 grid** rather than painting freehand pixels. A fixed polar-map stencil excludes the black outer region and left notch from the final mask.

Each case includes an image-level **ischemic/non-ischemic** assessment and a decision-region annotation. The 17-segment guide is optional and does not constrain the selected region.

## Annotation workflow

1. Place the assigned images in the study input folder.
2. Open each image in the local Study View.
3. Use Brush or Eraser to select the region that informed the expert assessment.
4. Select the image-level assessment, review the final-mask preview, and save.
5. Revisit a prior image when needed; saving again deliberately replaces that image’s prior outputs.

A session receives a randomised display order that is stored in `session_manifest.json`. Restarting the tool in the same study-data folder restores that order and the prior saved annotation state.

## Outputs

For every saved image, the application writes reproducible study outputs into the active study-data folder:

```text
Study_Data/
├── session_manifest.json  # Persistent random display order for the session
└── results/
    ├── binary_data/           # Strict 1024 × 1024 0/1 masks
    ├── masked_images/         # Transparent expert-colour overlays
    ├── final_preview_images/  # Original map plus clean white mask overlay
    ├── annotation_state/      # Selected grid cells and image-level class
    └── classifications.csv    # image_filename and classification_code (0/1)
```

The binary mask is the analysis-oriented output. The working overlay and final preview make the annotation visually reviewable, while the saved state and classification file preserve the structured record required to revisit a case.

## Run locally

The local development application runs on macOS, Linux, or Windows with Python.

```bash
git clone https://github.com/smrhosseini1993/Annotation-tool-web.git
cd Annotation-tool-web
python3 -m pip install -r requirements.txt
python3 app.py
```

The application opens in the local browser. For development use, place supported `.jpg`, `.jpeg`, or `.png` inputs in:

```text
static/input_images/
```

The current PET-MPI Study View expects 1024 × 1024 polar-map inputs. The fixed stencil and PET-specific assessment labels are part of this study configuration, not a claim that every medical-image modality is handled identically.

## Windows Study Kit

The repository includes a Windows packaging workflow for study participants who should not need VS Code, Python, Conda, or package installation. Build the Study Kit through GitHub Actions, then distribute **one separately extracted copy per expert/session**.

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
│   └── results/           # Collect after the annotation session
└── Clinician_Guide/
```

## Implementation

| Area | Current implementation |
|---|---|
| Local application | Flask and Pillow |
| Annotation interface | HTML5 Canvas, CSS, and JavaScript |
| Annotation representation | 128 × 128 logical grid persisted as a 1024 × 1024 binary mask |
| Study outputs | Mask, overlay, final-preview image, structured state, and classification CSV |
| Distribution | PyInstaller build on a Windows GitHub Actions runner |

## Data handling

The application is designed to run locally. Do not commit research images, annotations, clinical data, or participant-specific output folders to this repository. Use a separate study-data copy for each expert/session and collect only the intended output folder according to the study protocol.

## Screenshots

Repository screenshots should use synthetic, non-patient, or appropriately approved de-identified examples. Add them under `docs/screenshots/` when available; do not include study data in the public repository.

## Acknowledgment

This project is a substantially modified web version of the PET-image annotation tool originally created by Kerttu Pusa as a student project. The original work is available at <https://gitlab.com/group17761803/Annotation_tool>.
