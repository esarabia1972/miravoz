import pygame
import config
from gaze_mapper import GazeMapper

class Calibration:
    def __init__(self, screen, gaze_engine):
        self.screen = screen
        self.width, self.height = screen.get_size()
        self.engine = gaze_engine
        self.mapper = GazeMapper()
        
        # Puntos de calibración: 3x3 en los bordes y el centro
        margin_x = self.width * 0.1
        margin_y = self.height * 0.1
        
        self.points = [
            (margin_x, margin_y),
            (self.width / 2, margin_y),
            (self.width - margin_x, margin_y),
            (margin_x, self.height / 2),
            (self.width / 2, self.height / 2),
            (self.width - margin_x, self.height / 2),
            (margin_x, self.height - margin_y),
            (self.width / 2, self.height - margin_y),
            (self.width - margin_x, self.height - margin_y)
        ]
        
        self.font = pygame.font.SysFont("Arial", 40)
        self.reset()
        
    def reset(self):
        self.current_point_idx = 0
        self.samples_gaze = []
        self.samples_screen = []
        self.point_samples = []
        self.state = "COUNTDOWN"  # "COUNTDOWN" o "SAMPLING"
        self.timer = pygame.time.get_ticks()
        
    def update_and_draw(self, res):
        """
        Retorna True si la calibración ha terminado, False si sigue en curso.
        res es el resultado de la estimación del engine.
        """
        if self.current_point_idx >= len(self.points):
            # Terminado, ajustar modelo
            if not self.mapper.is_calibrated:
                self.mapper.calibrate(self.samples_gaze, self.samples_screen)
            return True
            
        target_x, target_y = self.points[self.current_point_idx]
        current_time = pygame.time.get_ticks()
        
        # Fondo oscuro sutil detrás del punto para contraste
        pygame.draw.circle(self.screen, (20, 20, 20), (int(target_x), int(target_y)), 35)
        
        if self.state == "COUNTDOWN":
            elapsed = current_time - self.timer
            # 1.5s countdown
            if elapsed > 1500:
                self.state = "SAMPLING"
                self.timer = current_time
                self.point_samples = []
            else:
                progress = elapsed / 1500.0
                
                # Anillo exterior rojo contrayéndose
                outer_radius = max(2, int(50 - 30 * progress))
                pygame.draw.circle(self.screen, (255, 50, 50), (int(target_x), int(target_y)), outer_radius, 3)
                
                # Punto central rojo pulsante
                inner_radius = int(8 + 4 * progress)
                pygame.draw.circle(self.screen, (255, 50, 50), (int(target_x), int(target_y)), inner_radius)
                
                # Mensaje con fondo semitransparente simulado
                text = self.font.render("Mira el centro del círculo fijamente", True, (255, 255, 255))
                rect = text.get_rect(center=(self.width//2, 80))
                bg_rect = rect.inflate(40, 20)
                pygame.draw.rect(self.screen, (30, 30, 30), bg_rect, border_radius=10)
                pygame.draw.rect(self.screen, (100, 100, 100), bg_rect, 2, border_radius=10)
                self.screen.blit(text, rect)
                
        elif self.state == "SAMPLING":
            # Punto verde central indicando captura
            pygame.draw.circle(self.screen, (50, 255, 50), (int(target_x), int(target_y)), 15)
            
            if res['face_found']:
                self.point_samples.append((res['yaw'], res['pitch']))
                
            progress = len(self.point_samples) / config.CALIB_SAMPLES_PER_POINT
            
            # Anillo exterior verde de progreso
            import math
            arc_rect = pygame.Rect(int(target_x)-25, int(target_y)-25, 50, 50)
            end_angle = (math.pi/2) + (2 * math.pi * progress)
            pygame.draw.arc(self.screen, (0, 255, 100), arc_rect, math.pi/2, end_angle, 5)
            
            if len(self.point_samples) >= config.CALIB_SAMPLES_PER_POINT:
                # Agregar muestras al pool
                for sample in self.point_samples:
                    self.samples_gaze.append(sample)
                    self.samples_screen.append((target_x, target_y))
                    
                self.current_point_idx += 1
                self.state = "COUNTDOWN"
                self.timer = current_time
                
        # Mostrar advertencia si no detecta la cara en SAMPLING
        if self.state == "SAMPLING" and not res['face_found']:
            warn = self.font.render("¡Rostro no detectado!", True, (255, 100, 100))
            self.screen.blit(warn, (self.width//2 - warn.get_width()//2, self.height - 100))
            
        return False
