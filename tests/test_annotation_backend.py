import csv
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]


class MedicalImageAnnotationBackendTests(unittest.TestCase):
    def setUp(self):
        self.data_root = Path(tempfile.mkdtemp(prefix="medical-image-annotation-"))
        (self.data_root / "input_images").mkdir(parents=True)
        Image.new("RGB", (23, 17), (80, 120, 160)).save(self.data_root / "input_images" / "sample.png")
        os.environ["ANNOTATION_STUDY_DATA_DIR"] = str(self.data_root)

        spec = importlib.util.spec_from_file_location("medical_annotation_app_test", REPO_ROOT / "app.py")
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        self.module = module
        self.client = module.app.test_client()

    def tearDown(self):
        os.environ.pop("ANNOTATION_STUDY_DATA_DIR", None)
        shutil.rmtree(self.data_root, ignore_errors=True)
        sys.modules.pop("medical_annotation_app_test", None)

    def test_native_dimension_outputs_and_optional_assessment(self):
        self.assertEqual(self.client.get("/health").get_json()["app"], "medical-image-annotation-tool")
        self.assertEqual(self.client.get("/static/images").get_json(), ["sample.png"])

        saved = self.client.post(
            "/save_annotation",
            json={
                "filename": "sample.png",
                "imageIndex": 0,
                "assessment": "1",
                "selectedCells": ["0:0", "122:120"],
                "brushColour": "#3366cc",
            },
        )
        self.assertEqual(saved.status_code, 200)

        mask_path = self.data_root / "results" / "binary_data" / "sample_binary.txt"
        rows = [line.split("\t") for line in mask_path.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(rows), 17)
        self.assertTrue(all(len(row) == 23 for row in rows))
        self.assertEqual(rows[0][0], "1")
        self.assertEqual(rows[-1][-1], "1")
        self.assertEqual(rows[8][11], "0")

        for directory, filename in [
            ("masked_images", "sample_result_image.png"),
            ("final_preview_images", "sample_final_preview.png"),
        ]:
            with Image.open(self.data_root / "results" / directory / filename) as image:
                self.assertEqual(image.size, (23, 17))

        state = json.loads((self.data_root / "results" / "annotation_state" / "sample_state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["assessment"], "1")
        self.assertEqual(state["gridDimension"], 128)

        with (self.data_root / "results" / "assessments.csv").open(encoding="utf-8", newline="") as source:
            self.assertEqual(list(csv.DictReader(source)), [{"image_filename": "sample.png", "assessment_code": "1"}])

        resaved = self.client.post(
            "/save_annotation",
            json={
                "filename": "sample.png",
                "imageIndex": 0,
                "assessment": None,
                "selectedCells": [],
                "brushColour": "#3366cc",
            },
        )
        self.assertEqual(resaved.status_code, 200)
        with (self.data_root / "results" / "assessments.csv").open(encoding="utf-8", newline="") as source:
            self.assertEqual(list(csv.DictReader(source)), [])


if __name__ == "__main__":
    unittest.main()
