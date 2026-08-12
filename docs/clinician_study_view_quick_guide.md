# PET-MPI Annotation Tool

## Clinician Study View: Quick Operating Guide

> **Purpose.** This tool records your image-level classification and the grid-cell regions that informed your decision. It is designed for research annotation and does not replace normal clinical interpretation or reporting.

## Before starting

Use the application in Chrome at **100% browser zoom**. The right panel displays the polar map at its fixed native Study View size of **1024 × 1024**. If the whole map is not visible, use the panel scroll bars; do not change browser zoom during the annotation session. Use the same practical display setup throughout a session.

Confirm that the progress panel on the left shows the expected image number and saved count before beginning work.

## Annotating one polar map

| Step | What to do |
|---|---|
| **1. Select a tool** | Choose **Brush** to add grid cells or **Eraser** to remove selected cells. |
| **2. Choose brush size** | Use **1 (8 px)**, **2 (16 px)**, **4 (32 px)**, or **8 (64 px)**. Select the smallest size that lets you mark the decision region clearly. |
| **3. Mark the region** | Click or drag over the relevant decision-making region. The mark is cell based: each selected cell is either included or not included. |
| **4. Correct if needed** | Use **Undo**, **Redo**, or **Eraser**. You may also change the brush colour for easier viewing; the saved scientific mask remains binary. |
| **5. Classify and save** | Select **Ischemic** or **Non-ischemic**. Use **Preview final mask** for a clean white-overlay check, then select **Save & next image**. |

## Viewing guides

The **Grid** control shows or hides the annotation-cell boundaries. The small colour square beside it changes the grid colour. The **17-segment** control is an optional visual guide only; it does not constrain what you can select. Its compact selector changes guide strength, and its colour square changes guide colour.

## Navigation and review

Use **Previous image** to return to an earlier map. Its saved classification and selected cells will be restored. After making any correction, select **Save & next image** again; the existing result for that image is replaced rather than duplicated. Each save records the image-level class, binary decision-region mask, coloured working overlay, and clean white-overlay preview.

**Practical checklist:** review the full map before marking, use the smallest practical brush near a boundary, confirm the image-level class, preview when uncertain, and save before leaving an image.
