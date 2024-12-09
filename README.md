# PET-image annotation tool (Web Version)

A modern web-based application for annotating positron emission tomography (PET) images with interactive drawing capabilities, undo/redo functionality, and automated data export. Originally developed as a desktop application, this version has been completely refactored into a responsive web interface that allows researchers and medical professionals to efficiently annotate PET images with an intuitive drawing interface.

## Acknowledgments

This project is a significantly modified version of the "PET-image annotation tool" originally created by Kerttu Pusa as part of a student project. The original work can be found on GitLab: [https://gitlab.com/group17761803/Annotation_tool](https://gitlab.com/group17761803/Annotation_tool).

### Original Functionality

The original tool was a desktop application built with Python and the `tkinter` library. It allowed users to load PET images, draw annotations with a mouse, and save the results as binary data and masked images.

### Modifications and Enhancements

This version of the tool has been substantially refactored and enhanced with the following key changes:

*   **Web-Based Interface:** The application has been migrated from a desktop GUI to a web-based interface using Flask for the backend and HTML, CSS, and JavaScript for the frontend.
*   **Interactive Canvas:** The annotation functionality is now implemented using the HTML5 canvas, providing a more modern and accessible user experience.
*   **New Features:** Additional features such as undo/redo functionality, brush size preview, and a more streamlined user interface have been added.
*   **Backend Refactoring:** The backend has been rewritten to handle image serving, data saving, and other web-related tasks.

## Installation and Setup

### Prerequisites

*   Python 3.7 or higher
*   pip (Python package manager)
*   A modern web browser (Chrome, Firefox, Safari, Edge)

### Installation Steps

1.  **Clone or download the repository:**

    ```bash
    git clone https://github.com/your-username/pet-image-annotation-tool-web.git
    cd pet-image-annotation-tool-web
    ```

2.  **Install required Python libraries:**

    ```bash
    pip install -r requirements.txt
    ```

    Or manually install:

    ```bash
    pip install Flask Flask-Cors
    ```

3.  **Prepare your input images:**

    Place your PET images (JPEG or PNG format) in the `static/input_images/` directory.

4.  **Run the Flask application:**

    ```bash
    python app.py
    ```

5.  **Access the application:**

    Open your web browser and navigate to `http://127.0.0.1:5000`

## Usage Guide

1.  **Load Images:** The application automatically loads images from the `static/input_images/` directory
2.  **Draw Annotations:** Click and drag on the canvas to draw annotations using the brush tool
3.  **Adjust Brush Size:** Use the slider to adjust the brush size (2-38 pixels)
4.  **Erase Mistakes:** Click the Eraser button to switch to eraser mode
5.  **Undo/Redo:** Use the Undo and Redo buttons to correct mistakes
6.  **Classify Image:** Select whether the image is "Ischemic" or "Non-ischemic"
7.  **Save and Next:** Click the NEXT button to save your annotations and move to the next image

## Output Files

The application generates three types of output files in the `static/results/` directory:

*   **Binary Data Files:** Text files containing pixel-level binary data (0 or 1) indicating annotated regions
*   **Masked Images:** PNG images showing the original image overlaid with your annotations
*   **Predictions File:** A text file containing the classification predictions for all images

## Author

This modified version was developed by **Seyed M. Hosseini**.

## Features

*   **Interactive Drawing Interface:** Draw annotations on PET images using an HTML5 canvas with adjustable brush sizes
*   **Undo/Redo Functionality:** Easily correct mistakes with full undo and redo support
*   **Brush Size Preview:** Visual preview of brush sizes for precise control
*   **Binary Data Export:** Export annotations as binary data for machine learning applications
*   **Masked Image Generation:** Generate overlay images combining original PET images with annotations
*   **Image Classification:** Classify images as ischemic or non-ischemic
*   **Responsive Design:** Modern, user-friendly web interface compatible with modern browsers

## Technology Stack

*   **Backend:** Flask (Python)
*   **Frontend:** HTML5, CSS3, JavaScript
*   **Canvas API:** HTML5 Canvas for drawing functionality
*   **API Communication:** RESTful endpoints with JSON data exchange

## Project Structure

```
ToolV2/
├── app.py                 # Flask backend application
├── static/
│   ├── index.html        # Main HTML interface
│   ├── styles.css        # CSS styling
│   ├── script.js         # JavaScript drawing logic
│   ├── input_images/     # Directory for input PET images
│   └── results/          # Directory for output annotations
├── README.md             # Project documentation
├── LICENSE               # MIT License
└── .gitignore           # Git ignore file
```
