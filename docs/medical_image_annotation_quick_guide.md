# Medical Image Annotation Tool

## Study View: Quick Operating Guide

> **Purpose.** This tool records grid-cell regions on an image and, when required by the study protocol, an optional binary image-level assessment. It is designed for research annotation and does not replace normal clinical interpretation or reporting.

## Before starting

Use the application in Chrome at **100% browser zoom**. The annotation workspace displays each input image at its native dimensions. If the full image is not visible, use the workspace scroll bars; do not change browser zoom during an annotation session. Use the same practical display setup throughout a session.

Confirm that the progress panel on the left shows the expected image number and saved count before beginning work.

## Annotating one image

| Step | What to do |
|---|---|
| **1. Select a tool** | Choose **Brush** to add grid cells or **Eraser** to remove selected cells. |
| **2. Choose brush size** | Use **1 cell**, **2 × 2**, **4 × 4**, **8 × 8**, or **16 × 16**. Select the smallest practical size that lets you mark the relevant region clearly. |
| **3. Mark the region** | Click or drag over the image region relevant to the study question. The annotation is cell based: each selected cell is either included or not included. |
| **4. Correct if needed** | Use **Undo**, **Redo**, or **Eraser**. You may change the brush colour for easier viewing; the saved scientific mask remains binary. |
| **5. Review and save** | Use **Review output** to check the clean white-overlay preview. If the protocol requires an image-level assessment, select **Class 1** or **Class 0** before saving. Otherwise, leave both options unselected. Select **Save & next image**. After the final image, the app confirms that the session is complete. |

## Viewing the grid

The **Grid** control shows or hides the annotation-cell boundaries. The colour square beside it changes the grid colour. The grid is a visual aid and does not change the content of the saved binary mask.

## Navigation and review

Images are presented in one saved random order for the session. If the application is reopened during the same session, it restores that same order. A new Study Kit/session uses a new random order.

Use **Previous image** to return to an earlier image. Its saved assessment and selected cells will be restored. After making any correction, select **Save & next image** again; the existing result for that image is replaced rather than duplicated. Each save records the optional image-level assessment, binary region mask, coloured working overlay, and clean white-overlay preview.

**Practical checklist:** review the full image before marking, use the smallest practical brush near a boundary, review the output when uncertain, and save before leaving an image.
