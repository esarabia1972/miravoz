import pygame
import config

class DwellDetector:
    def __init__(self, on_select_callback):
        self.on_select = on_select_callback
        
        self.current_cell = None
        self.dwell_start_time = 0
        
        self.last_seen_cell = None
        self.last_seen_time = 0
        
        self.in_cooldown = False
        self.cooldown_start = 0
        
    def update(self, cell_id):
        current_time = pygame.time.get_ticks()
        
        if self.in_cooldown:
            if current_time - self.cooldown_start > config.DWELL_COOLDOWN_MS:
                self.in_cooldown = False
            else:
                return 0.0 # No hay progreso de dwell durante el cooldown
                
        if cell_id is None:
            # Si miramos fuera, damos un margen de histéresis (ej. 150ms)
            if current_time - self.last_seen_time > 150:
                self.current_cell = None
                self.dwell_start_time = 0
            return 0.0
            
        # Si miramos a una celda válida
        self.last_seen_time = current_time
        
        if cell_id != self.current_cell:
            # Cambiamos a una nueva celda
            self.current_cell = cell_id
            self.dwell_start_time = current_time
            return 0.0
            
        else:
            # Seguimos en la misma celda
            elapsed = current_time - self.dwell_start_time
            if elapsed >= config.DWELL_MS:
                # ¡Selección completada!
                self.on_select(self.current_cell)
                self.in_cooldown = True
                self.cooldown_start = current_time
                self.current_cell = None
                self.dwell_start_time = 0
                return 1.0
            else:
                return elapsed / config.DWELL_MS
