# Windows Study Kit: Build and Distribution

The Windows Study Kit is designed for clinical experts who should not need VS Code, Python, Conda, or package installation. It runs locally on the Windows computer and opens the annotation page automatically in the default browser.

## Recommended build method: GitHub Actions

1. Open the repository’s **Actions** tab on GitHub.
2. Select **Build Windows Study Kit**.
3. Select **Run workflow** and run it from the required version of the `main` branch.
4. When the workflow completes, download the artifact named **PET-MPI-Annotation-Study-Windows**.
5. Extract the downloaded archive. The extracted `PET-MPI-Annotation-Study-Windows` folder is the package to provide to one expert for one session.

The workflow uses a Windows runner because a Windows executable must be built on Windows.

## Preparing one expert/session package

Make a separate copy of the extracted Study Kit for every expert and annotation session. Name the parent folder clearly, for example:

```text
Expert_01_Session_01/
```

Place only that session’s assigned 1024 × 1024 polar-map images in:

```text
Study_Data/input_images/
```

Do not place images or results inside the application’s `_internal` folder.

## What the expert does

The expert only needs to:

1. Read `Clinician_Guide/clinician_study_view_quick_guide.pdf`.
2. Double-click `Start Annotation Tool.bat`.
3. Annotate in the browser that opens automatically.
4. Double-click `Close Annotation Tool.bat` when the session is complete.

No Python, VS Code, Conda, or browser address needs to be entered.

## Collecting outputs

At the end of the session, collect the complete folder:

```text
Study_Data/results/
```

It contains binary masks, working overlays, white final-preview images, saved annotation state, and `predictions.txt`.

> Do not mix different experts or different sessions in one Study Kit folder. Each expert/session must retain its own independent `Study_Data/results` folder.

## Manual Windows build option

If needed, clone the repository on a Windows machine with Python 3.11 installed, then open PowerShell in the repository folder and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\packaging\windows\build_study_kit.ps1
```

The finished package is created in:

```text
release/PET-MPI-Annotation-Study-Windows/
```
