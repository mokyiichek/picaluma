# Face models (People)

Used by `src-tauri/src/faces.rs` and run on the CPU with tract; nothing is uploaded. Not in the installer or the repository: the app downloads them once, when the user agrees, from the `face-models-v1` release (OpenCV Zoo as fallback), checks their SHA-256, and keeps them in the library folder. For development and the `eval_against_picasa` test, put copies here.

| File | Model | Source | Licence |
|---|---|---|---|
| `face_detection_yunet_2023mar.onnx` | YuNet face detector | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | MIT |
| `face_recognition_sface_2021dec.onnx` | SFace face recogniser | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) | Apache-2.0 |
