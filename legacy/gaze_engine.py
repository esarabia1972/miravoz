import cv2
import numpy as np
import torch
from openface.face_detection import FaceDetector
from openface.multitask_model import MultitaskPredictor
import openface.multitask_model

# Monkey-patch para que MultitaskPredictor tenga cv2 (ya que le falta el import en su código original)
openface.multitask_model.cv2 = cv2

# Monkey-patch para que FaceDetector acepte frames en memoria (numpy arrays) en lugar de solo rutas a archivos
original_preprocess_image = FaceDetector.preprocess_image

def patched_preprocess_image(self, image_or_path, resize=1.0):
    if isinstance(image_or_path, str):
        img_raw = cv2.imread(image_or_path, cv2.IMREAD_COLOR)
    else:
        img_raw = image_or_path.copy()
        
    img = np.float32(img_raw)
    if resize != 1:
        img = cv2.resize(img, None, fx=resize, fy=resize, interpolation=cv2.INTER_LINEAR)
    img -= (104, 117, 123)
    img = img.transpose(2, 0, 1)
    img = torch.from_numpy(img).unsqueeze(0).to(self.device)
    return img, img_raw

FaceDetector.preprocess_image = patched_preprocess_image

class GazeEngine:
    def __init__(self, device='cpu'):
        self.device = device
        # Usar los paths de los pesos descargados localmente
        self.face_detector = FaceDetector(
            model_path='./weights/Alignment_RetinaFace.pth',
            device=device
        )
        self.face_detector.vis_threshold = 0.1
        self.face_detector.confidence_threshold = 0.02
        
        self.multitask_model = MultitaskPredictor(
            model_path='./weights/MTL_backbone.pth',
            device=device
        )
        
        # Suavizado de la mirada
        self.smooth_yaw = 0.0
        self.smooth_pitch = 0.0
        self.alpha = 0.3 # factor de suavizado

    def estimate(self, frame):
        """
        Retorna {yaw, pitch, blink, face_found, bbox}
        """
        cropped_face, dets = self.face_detector.get_face(frame)
        
        if dets is None or len(dets) == 0:
            return {'face_found': False, 'yaw': 0.0, 'pitch': 0.0, 'blink': False, 'bbox': None}
            
        emotion_logits, gaze_output, au_output = self.multitask_model.predict(cropped_face)
        
        # gaze_output es un tensor con [yaw, pitch]
        raw_yaw = float(gaze_output[0][0])
        raw_pitch = float(gaze_output[0][1])
        
        # Extraer bounding box de la primera cara detectada
        # dets suele ser un array de numpy o tensor donde cada fila es [x1, y1, x2, y2, score, ...]
        bbox = None
        if len(dets) > 0:
            # Aseguramos extraer enteros
            x1, y1, x2, y2 = dets[0][:4]
            bbox = (int(x1), int(y1), int(x2), int(y2))
            
        # AU45 es típicamente el parpadeo (blink). 
        # asumiendo au_output tiene las action units (0-1) y blink es uno de ellos.
        # Por ahora lo simularemos si no conocemos el índice exacto, 
        # pero según la literatura de OpenFace, au45_c es blink.
        # Solo devolveremos False por defecto para el MVP si no lo usamos.
        blink = False
        
        # Suavizado exponencial
        self.smooth_yaw = self.alpha * raw_yaw + (1 - self.alpha) * self.smooth_yaw
        self.smooth_pitch = self.alpha * raw_pitch + (1 - self.alpha) * self.smooth_pitch
        
        return {
            'face_found': True,
            'yaw': self.smooth_yaw,
            'pitch': self.smooth_pitch,
            'blink': blink,
            'bbox': bbox
        }

if __name__ == "__main__":
    print("Iniciando GazeEngine...")
    engine = GazeEngine()
    cap = cv2.VideoCapture(0)
    print("Cámara abierta. Presiona ESC para salir.")
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        res = engine.estimate(frame)
        if res['face_found']:
            text = f"Yaw: {res['yaw']:.2f} | Pitch: {res['pitch']:.2f}"
            cv2.putText(frame, text, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        else:
            cv2.putText(frame, "Rostro no detectado", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            
        cv2.imshow("Prueba GazeEngine", frame)
        if cv2.waitKey(1) == 27:
            break
            
    cap.release()
    cv2.destroyAllWindows()
