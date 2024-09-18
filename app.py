# PET-image annotation tool (Web Version)
#
# This is a web-based version of the original PET-image annotation tool
# created by Kerttu Pusa. This version was developed by Seyed M. Hosseini.
#
# Original project: https://gitlab.com/group17761803/Annotation_tool
# Modified version: https://github.com/your-username/pet-image-annotation-tool-web

from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS
import os

app = Flask(__name__, static_folder='static')
CORS(app)

print("Current directory:", os.getcwd())
print("Found images:", os.listdir('static/input_images'))

@app.route('/')
def serve_index():
    return send_from_directory('static', 'index.html')

@app.route('/static/images')
def list_images():
    image_dir = os.path.join('static', 'input_images')
    images = [f for f in os.listdir(image_dir) if f.endswith(('.jpg', '.png'))]
    print("Serving images:", images)
    return jsonify(images)

@app.route('/save_binary', methods=['POST'])
def save_binary():
    if 'file' not in request.files:
        return 'No file part', 400
    file = request.files['file']
    if file:
        # Save binary data
        binary_path = os.path.join('static', 'results', 'binary_data', file.filename)
        os.makedirs(os.path.dirname(binary_path), exist_ok=True)
        file.save(binary_path)
        print(f"Saved binary data to: {binary_path}")
        return 'File saved', 200
    return 'Error saving file', 400

@app.route('/save_masked_image', methods=['POST'])
def save_masked_image():
    if 'file' not in request.files:
        return 'No file part', 400
    file = request.files['file']
    if file:
        # Save masked image
        image_path = os.path.join('static', 'results', 'masked_images', file.filename)
        os.makedirs(os.path.dirname(image_path), exist_ok=True)
        file.save(image_path)
        print(f"Saved masked image to: {image_path}")
        return 'File saved', 200
    return 'Error saving file', 400

@app.route('/save_prediction', methods=['POST'])
def save_prediction():
    data = request.json
    index = data['imageIndex']  # Original index in dataset
    prediction = data['prediction']
    
    predictions_file = os.path.join('static', 'results', 'predictions.txt')
    os.makedirs(os.path.dirname(predictions_file), exist_ok=True)
    
    # Read existing predictions or create empty list
    predictions = []
    if os.path.exists(predictions_file):
        with open(predictions_file, 'r') as f:
            predictions = f.readlines()
    
    # Ensure list has enough space
    while len(predictions) <= index:
        predictions.append('\n')
    
    # Update prediction at correct index
    predictions[index] = f"{prediction}\n"
    
    # Write all predictions back to file
    with open(predictions_file, 'w') as f:
        f.writelines(predictions)
    
    return 'Prediction saved', 200

if __name__ == '__main__':
    app.run(port=5000, debug=True)