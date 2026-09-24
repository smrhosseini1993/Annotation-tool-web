# Medical Image Annotation Tool

A local, browser-based application for **structured annotation of medical images**. It records a reproducible grid-cell mask for each input image and can optionally record a binary, study-defined image-level assessment.

The application is designed for research studies that need more than a drawn overlay. Each saved annotation preserves a binary mask, structured annotation state, a visual overlay, a review image, and an optional image-linked assessment record.

> **Research-use software.** This application does not provide a clinical diagnosis, replace clinical reporting, or make automated treatment recommendations.

## Annotation workflow

1. Place the assigned images in the study input folder.
2. Open each image in the local annotation workspace.
3. Use Brush or Eraser to select the image region relevant to the study question.
4. Optionally choose the study-defined binary assessment, review the final annotation preview, and save.
5. Revisit a prior image when needed; saving again deliberately replaces that image’s prior outputs.

The tool uses a logical **128 × 128 grid** over the native dimensions of every input image. It does not require a fixed image size, a fixed anatomy, or a modality-specific stencil.

A session receives a randomised display order that is stored in `session_manifest.json`. Restarting the tool in the same study-data folder restores that order and the prior saved annotation state.

## Outputs

For every saved image, the application writes reproducible study outputs into the active study-data folder:

```text
Study_Data/
├── session_manifest.json  # Persistent random display order for the session
└── results/
    ├── binary_data/           # Native-dimension 0/1 masks
    ├── masked_images/         # Transparent annotation-colour overlays
    ├── final_preview_images/  # Original image plus clean white annotation overlay
    ├── annotation_state/      # Selected grid cells and optional study assessment
    └── assessments.csv        # image_filename and optional assessment_code (0/1)
```

The binary mask is the analysis-oriented output. The working overlay and final preview make the annotation visually reviewable, while the saved state and optional assessment file preserve the structured record required to revisit a case.

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

## Windows Study Kit

The repository includes a Windows packaging workflow for study participants who should not need VS Code, Python, Conda, or package installation. Build the Study Kit through GitHub Actions, then distribute **one separately extracted copy per participant/session**.

- [Windows Study Kit build and distribution guide](docs/windows_study_kit_build.md)
- [Study View quick guide (PDF)](docs/medical_image_annotation_quick_guide.pdf)
- [Study View quick guide (Markdown)](docs/medical_image_annotation_quick_guide.md)

The packaged kit uses this data layout:

```text
Medical-Image-Annotation-Study-Windows/
├── Start Annotation Tool.bat
├── Close Annotation Tool.bat
├── Study_Data/
│   ├── input_images/      # Place the assigned images here
│   └── results/           # Collect after the annotation session
└── Study_Guide/
```

## Implementation

| Area | Current implementation |
|---|---|
| Local application | Flask and Pillow |
| Annotation interface | HTML5 Canvas, CSS, and JavaScript |
| Annotation representation | 128 × 128 logical grid persisted as a native-dimension binary mask |
| Study outputs | Mask, overlay, final-preview image, structured state, and optional assessment CSV |
| Distribution | PyInstaller build on a Windows GitHub Actions runner |

## Verification

The regression test uses a non-square synthetic image to verify that the application preserves native image dimensions, creates correctly sized masks and overlays, and accepts an optional binary assessment.

```bash
python3 -m unittest discover -s tests -v
```

## Data handling

The application is designed to run locally. Do not commit research images, annotations, sensitive data, or participant-specific output folders to this repository. Use a separate study-data copy for each participant/session and collect only the intended output folder according to the study protocol.

## Screenshots

Repository screenshots should use synthetic, non-patient, or appropriately approved de-identified examples. Add them under `docs/screenshots/` when available; do not include study data in the public repository.
