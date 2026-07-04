import cv2
import time

backends = [cv2.CAP_AVFOUNDATION, cv2.CAP_ANY]

for backend in backends:
    print(f"\nProbando backend: {backend}")
    for i in range(3):
        print(f"  Cam {i}...")
        cap = cv2.VideoCapture(i, backend)
        if not cap.isOpened():
            print(f"    No abrió.")
            continue
            
        time.sleep(1.0) # Dar tiempo a que caliente
        successes = 0
        for _ in range(5):
            ret, frame = cap.read()
            if ret and frame is not None:
                if frame.sum() > 0:
                    successes += 1
        
        print(f"    Frames validos y con imagen: {successes}/5")
        cap.release()
