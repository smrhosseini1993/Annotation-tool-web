# Windows Study Kit: Build and Distribution

The Windows Study Kit is designed for study participants who should not need VS Code, Python, Conda, or package installation. It runs locally on the Windows computer and opens the annotation page automatically in the default browser.

## Recommended build method: GitHub Actions

1. Open the repository’s **Actions** tab on GitHub.
2. Select **Build Windows Study Kit**.
3. Select **Run workflow** and run it from the required version of the `main` branch.
4. Open the newest completed workflow run and download its **Medical-Image-Annotation-Study-Windows** artifact.
5. Extract the downloaded archive. Inside it, the Study Kit folder includes the exact version, for example `Medical-Image-Annotation-Study-Windows-v1.3.0`.
6. Confirm the version by opening the package's `VERSION.txt` file or checking the version badge in the app's upper-left corner.

The workflow uses a Windows runner because a Windows executable must be built on Windows.

## Preparing one participant/session package

Make a separate copy of the extracted Study Kit for every participant and annotation session. Name the parent folder clearly, for example:

```text
Participant_01_Session_01/
```

Place only that session’s assigned `.png`, `.jpg`, or `.jpeg` images in:

```text
Study_Data/input_images/
```

The application keeps each image at its native dimensions. Do not place images or results inside the application’s `_internal` folder.

## What the participant does

The participant only needs to:

1. Read `Study_Guide/medical_image_annotation_quick_guide.pdf`.
2. Double-click `Start Annotation Tool.bat`.
3. Annotate in the browser that opens automatically.
4. Double-click `Close Annotation Tool.bat` when the session is complete.

No Python, VS Code, Conda, or browser address needs to be entered.

## Collecting outputs

At the end of the session, collect the complete folder:

```text
Study_Data/results/
```

It contains binary masks, working overlays, white final-preview images, saved annotation state, and `assessments.csv`. The CSV contains the filename-linked optional binary assessment for saved images.

> Do not mix different participants or different sessions in one Study Kit folder. Each participant/session must retain its own independent `Study_Data/results` folder.

## Manual Windows build option

If needed, clone the repository on a Windows machine with Python 3.11 installed, then open PowerShell in the repository folder and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\packaging\windows\build_study_kit.ps1
```

The finished package is created in:

```text
release/Medical-Image-Annotation-Study-Windows-v<version>/
```
