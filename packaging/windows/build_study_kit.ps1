$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$python = if ($env:PYTHON) { $env:PYTHON } else { 'python' }
$buildDir = Join-Path $root 'build'
$distDir = Join-Path $root 'dist\PET-MPI-Annotation-Tool'
$releaseDir = Join-Path $root 'release\PET-MPI-Annotation-Study-Windows'

Write-Host 'Installing build dependencies...'
& $python -m pip install --upgrade pip
& $python -m pip install -r (Join-Path $root 'requirements.txt') pyinstaller

Write-Host 'Cleaning previous build output...'
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $buildDir
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $root 'dist')
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $root 'release')

Write-Host 'Creating the Windows application bundle...'
& $python -m PyInstaller `
    --noconfirm `
    --clean `
    --windowed `
    --name 'PET-MPI-Annotation-Tool' `
    --add-data "$root\static;static" `
    --collect-all flask `
    --collect-all flask_cors `
    --collect-all PIL `
    (Join-Path $root 'app.py')

Write-Host 'Assembling the Study Kit...'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $distDir '*') $releaseDir

$studyData = Join-Path $releaseDir 'Study_Data'
New-Item -ItemType Directory -Force -Path (Join-Path $studyData 'input_images') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $studyData 'results') | Out-Null

$guideDir = Join-Path $releaseDir 'Clinician_Guide'
New-Item -ItemType Directory -Force -Path $guideDir | Out-Null
Copy-Item -Force (Join-Path $root 'docs\clinician_study_view_quick_guide.pdf') $guideDir
Copy-Item -Force (Join-Path $root 'docs\clinician_study_view_quick_guide.md') $guideDir
Copy-Item -Force (Join-Path $PSScriptRoot 'START_HERE.txt') $releaseDir
Copy-Item -Force (Join-Path $PSScriptRoot 'Start Annotation Tool.bat') $releaseDir
Copy-Item -Force (Join-Path $PSScriptRoot 'Close Annotation Tool.bat') $releaseDir
Copy-Item -Force (Join-Path $PSScriptRoot 'STUDY_DATA_README.txt') $studyData

Write-Host ''
Write-Host "Study Kit created at: $releaseDir" -ForegroundColor Green
Write-Host 'Zip this folder or distribute it as a folder. Do not put study images in app_bundle.'
