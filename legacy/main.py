import pygame
import cv2
import sys
import config
from gaze_engine import GazeEngine
from calibration import Calibration
from board import Board
from dwell import DwellDetector
from tts import TTS

def main():
    # Inicialización PyGame
    pygame.init()
    if config.SCREEN_FULLSCREEN:
        screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
    else:
        screen = pygame.display.set_mode((1024, 768))
        
    pygame.display.set_caption("Eye Tracking CAA MVP")
    clock = pygame.time.Clock()
    
    # Fuentes para info extra
    font_info = pygame.font.SysFont("Arial", 20)
    
    # Inicialización de la Cámara (buscando una que no devuelva imagen negra)
    cap = None
    for cam_idx in range(3):
        temp_cap = cv2.VideoCapture(cam_idx)
        if temp_cap.isOpened():
            # Leer algunos frames para darle tiempo a inicializar
            for _ in range(5):
                ret, frame = temp_cap.read()
                if ret and frame is not None and frame.sum() > 0:
                    cap = temp_cap
                    print(f"Cámara detectada exitosamente en el índice {cam_idx}")
                    break
            if cap is not None:
                break
        temp_cap.release()

    if cap is None:
        print("Error: No se pudo encontrar una cámara web que envíe imagen real (todas devuelven negro).")
        print("Revisa los permisos de 'Cámara' en Privacidad y Seguridad de macOS para tu Terminal.")
        sys.exit(1)
        
    # Inicialización de Módulos
    print("Cargando modelo OpenFace...")
    engine = GazeEngine(device='cpu')  # MVP especifica CPU
    print("Modelo cargado.")
    
    calibration = Calibration(screen, engine)
    board = Board(screen)
    tts = TTS()
    
    def on_cell_selected(cell_id):
        # Buscar la palabra correspondiente al ID
        for c in board.cells:
            if c['id'] == cell_id:
                tts.speak(c['word'])
                break
                
    dwell_detector = DwellDetector(on_cell_selected)
    
    state = "CALIBRANDO" # "CALIBRANDO" -> "TABLERO"
    
    running = True
    while running:
        # Manejo de eventos
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    running = False
                elif event.key == pygame.K_c:
                    # Forzar recalibración
                    state = "CALIBRANDO"
                    calibration.reset()
                    calibration.mapper.is_calibrated = False
                elif event.key == pygame.K_t:
                    cap.release()
                    # Buscar la siguiente cámara válida que no de errores al abrir
                    for i in range(1, 4):
                        next_idx = (cam_idx + i) % 3
                        new_cap = cv2.VideoCapture(next_idx)
                        if new_cap.isOpened():
                            cam_idx = next_idx
                            cap = new_cap
                            print(f"Cambiado a cámara {cam_idx}")
                            break
                        new_cap.release()

        # Captura de frame
        ret, frame = cap.read()
        if not ret:
            print("Error capturando frame de cámara.")
            continue
            
        # Flip horizontal para efecto espejo, más natural
        frame = cv2.flip(frame, 1)

        # Control de tiempo
        dt = clock.get_time()

        # Procesamiento
        res = engine.estimate(frame)
        
        # Limpiar pantalla y dibujar la cámara de fondo ANTES de la UI
        screen.fill((30, 30, 30))
        
        # Previsualización del feed de la cámara (Zoom + Wireframe)
        try:
            h, w = frame.shape[:2]
            box_size = 160  # 1/4 area de 320x320, cuadrito más discreto
            
            if res['face_found'] and res.get('bbox') is not None:
                x1, y1, x2, y2 = res['bbox']
                face_w = x2 - x1
                face_h = y2 - y1
                
                cx = x1 + face_w // 2
                cy = y1 + face_h // 2
                
                side = int(max(face_w, face_h) * 1.6) # Padding
                
                crop_x1 = max(0, cx - side // 2)
                crop_y1 = max(0, cy - side // 2)
                crop_x2 = min(w, cx + side // 2)
                crop_y2 = min(h, cy + side // 2)
                
                cropped = frame[crop_y1:crop_y2, crop_x1:crop_x2].copy()
                
                # Dibujar wireframe
                wx1 = max(0, x1 - crop_x1)
                wy1 = max(0, y1 - crop_y1)
                wx2 = min(cropped.shape[1], x2 - crop_x1)
                wy2 = min(cropped.shape[0], y2 - crop_y1)
                cv2.rectangle(cropped, (wx1, wy1), (wx2, wy2), (0, 255, 0), 2)
                
                preview_frame = cv2.resize(cropped, (box_size, box_size))
            else:
                side = min(w, h)
                crop_x1 = (w - side) // 2
                crop_y1 = (h - side) // 2
                cropped = frame[crop_y1:crop_y1+side, crop_x1:crop_x1+side]
                preview_frame = cv2.resize(cropped, (box_size, box_size))
                
            preview_rgb = cv2.cvtColor(preview_frame, cv2.COLOR_BGR2RGB)
            preview_surf = pygame.surfarray.make_surface(preview_rgb.swapaxes(0, 1))
            
            margin = 20
            screen_w, screen_h = screen.get_size()
            screen.blit(preview_surf, (screen_w - box_size - margin, screen_h - box_size - margin))
        except Exception as e:
            pass
        
        # Ahora dibujar la UI encima
        if state == 'CALIBRANDO':
            done = calibration.update_and_draw(res)
            if done:
                state = 'TABLERO'
                print("Calibración finalizada. Entrando al tablero.")
        
        elif state == 'TABLERO':
            gaze_x, gaze_y = None, None
            cell_id = None
            
            if res['face_found']:
                # Mapear a coordenadas de pantalla usando la calibración
                raw_gaze_x, raw_gaze_y = calibration.mapper.map_gaze(
                    res['yaw'], res['pitch'], 
                    board.width, board.height
                )
                
                import math
                if raw_gaze_x is not None and raw_gaze_y is not None:
                    if not (math.isnan(raw_gaze_x) or math.isnan(raw_gaze_y)):
                        # Suavizado del cursor final (EMA)
                        if not hasattr(calibration, 'smooth_gaze_x'):
                            calibration.smooth_gaze_x = raw_gaze_x
                            calibration.smooth_gaze_y = raw_gaze_y
                        else:
                            cursor_alpha = 0.4
                            calibration.smooth_gaze_x = cursor_alpha * raw_gaze_x + (1 - cursor_alpha) * calibration.smooth_gaze_x
                            calibration.smooth_gaze_y = cursor_alpha * raw_gaze_y + (1 - cursor_alpha) * calibration.smooth_gaze_y
                            
                        gaze_x = calibration.smooth_gaze_x
                        gaze_y = calibration.smooth_gaze_y
                        cell_id = board.get_cell_from_pos(gaze_x, gaze_y)
                    else:
                        gaze_x, gaze_y = None, None
                        
            # Actualizar dwell
            progress = dwell_detector.update(cell_id)
            
            # Dibujar tablero
            board.draw(gaze_x, gaze_y, cell_id, progress)
                
            # Mostrar info extra
            fps = clock.get_fps()
            info_text = f"FPS: {fps:.1f} | Rostro: {'Si' if res['face_found'] else 'No'} | Recalibrar: 'C' | Salir: 'ESC'"
            info_surf = font_info.render(info_text, True, (255, 255, 255))
            screen.blit(info_surf, (10, 10))
            
        pygame.display.flip()
        clock.tick(config.FPS)
        
    # Limpieza
    cap.release()
    tts.stop()
    pygame.quit()

if __name__ == "__main__":
    main()
