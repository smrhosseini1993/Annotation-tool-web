$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$python = if ($env:PYTHON) { $env:PYTHON } else { 'python' }
$version = (Get-Content -Raw (Join-Path $root 'VERSION')).Trim()
if ([string]::IsNullOrWhiteSpace($version)) { throw 'VERSION must not be empty.' }
$kitName = "Medical-Image-Annotation-Study-Windows-v$version"
$buildDir = Join-Path $root 'build'
$distDir = Join-Path $root 'dist\Medical-Image-Annotation-Tool'
$releaseRoot = Join-Path $root 'release\Medical-Image-Annotation-Study-Windows'
$releaseDir = Join-Path $releaseRoot $kitName

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
    --name 'Medical-Image-Annotation-Tool' `
    --add-data "$root\static;static" `
    --add-data "$root\VERSION;." `
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

$guideDir = Join-Path $releaseDir 'Study_Guide'
New-Item -ItemType Directory -Force -Path $guideDir | Out-Null
Copy-Item -Force (Join-Path $root 'docs\medical_image_annotation_quick_guide.pdf') $guideDir
Copy-Item -Force (Join-Path $root 'docs\medical_image_annotation_quick_guide.md') $guideDir
Copy-Item -Force (Join-Path $PSScriptRoot 'START_HERE.txt') $releaseDir
Copy-Item -Force (Join-Path $PSScriptRoot 'Start Annotation Tool.bat') $releaseDir
Copy-Item -Force (Join-Path $PSScriptRoot 'Close Annotation Tool.bat') $releaseDir
Copy-Item -Force (Join-Path $PSScriptRoot 'STUDY_DATA_README.txt') $studyData
Copy-Item -Force (Join-Path $root 'VERSION') (Join-Path $releaseDir 'VERSION.txt')

Write-Host ''
Write-Host "Study Kit version: v$version" -ForegroundColor Green
Write-Host "Study Kit created at: $releaseDir" -ForegroundColor Green
Write-Host 'Zip this folder or distribute it as a folder. Do not put study images in the application bundle.'
