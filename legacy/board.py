import pygame
import config

class Board:
    def __init__(self, screen):
        self.screen = screen
        self.width, self.height = screen.get_size()
        
        self.grid_rows, self.grid_cols = config.GRID
        self.cell_width = self.width // self.grid_cols
        self.cell_height = self.height // self.grid_rows
        
        self.cells = []
        self._init_cells()
        
        # Fuentes (inicializadas luego de pygame.init() en main)
        try:
            self.font_number = pygame.font.SysFont("Arial", 120, bold=True)
            self.font_word = pygame.font.SysFont("Arial", 40)
        except:
            self.font_number = None
            self.font_word = None
            
        # Colores
        self.color_bg = (30, 30, 30)
        self.color_line = (100, 100, 100)
        self.color_text = (220, 220, 220)
        self.color_highlight = (70, 130, 180)
        self.color_progress = (0, 255, 128)
        self.color_cursor = (255, 0, 0)
        
    def _init_cells(self):
        words = ["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"]
        idx = 1
        for row in range(self.grid_rows):
            for col in range(self.grid_cols):
                rect = pygame.Rect(
                    col * self.cell_width, 
                    row * self.cell_height, 
                    self.cell_width, 
                    self.cell_height
                )
                self.cells.append({
                    'id': idx,
                    'word': words[idx - 1],
                    'rect': rect
                })
                idx += 1
                
    def get_cell_from_pos(self, x, y):
        """Retorna el ID de la celda donde cae (x, y) o None."""
        for cell in self.cells:
            if cell['rect'].collidepoint(x, y):
                return cell['id']
        return None
        
    def draw(self, gaze_x, gaze_y, current_cell_id, dwell_progress):
        """
        Dibuja el tablero, la celda resaltada, el progreso y el cursor.
        dwell_progress: flotante entre 0.0 y 1.0
        """
        if self.font_number is None:
            self.font_number = pygame.font.SysFont("Arial", 120, bold=True)
            self.font_word = pygame.font.SysFont("Arial", 40)

        # El fondo ahora se limpia en main.py para permitir la cámara de fondo
        
        # Dibujar celdas
        for cell in self.cells:
            rect = cell['rect']
            
            # Resaltado si es la celda mirada
            if cell['id'] == current_cell_id:
                pygame.draw.rect(self.screen, self.color_highlight, rect)
                
            # Bordes
            pygame.draw.rect(self.screen, self.color_line, rect, 2)
            
            # Texto (Número)
            num_surf = self.font_number.render(str(cell['id']), True, self.color_text)
            num_rect = num_surf.get_rect(center=(rect.centerx, rect.centery - 20))
            self.screen.blit(num_surf, num_rect)
            
            # Texto (Palabra)
            word_surf = self.font_word.render(cell['word'], True, self.color_text)
            word_rect = word_surf.get_rect(center=(rect.centerx, rect.centery + 60))
            self.screen.blit(word_surf, word_rect)
            
            # Barra de progreso si es la celda actual
            if cell['id'] == current_cell_id and dwell_progress > 0:
                prog_width = int(self.cell_width * min(dwell_progress, 1.0))
                prog_rect = pygame.Rect(rect.left, rect.bottom - 10, prog_width, 10)
                pygame.draw.rect(self.screen, self.color_progress, prog_rect)

        # Dibujar el cursor de mirada tenue
        if gaze_x is not None and gaze_y is not None:
            # Cursor semitransparente no soportado directamente en draw.circle sin surface extra,
            # pero para el MVP un círculo fijo está bien.
            pygame.draw.circle(self.screen, self.color_cursor, (int(gaze_x), int(gaze_y)), 10)

if __name__ == "__main__":
    # Prueba rápida del render
    pygame.init()
    screen = pygame.display.set_mode((800, 600))
    pygame.display.set_caption("Test Board")
    
    board = Board(screen)
    clock = pygame.time.Clock()
    
    running = True
    progress = 0.0
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
                
        mx, my = pygame.mouse.get_pos()
        cell_id = board.get_cell_from_pos(mx, my)
        
        # Simular llenado de progreso
        if cell_id is not None:
            progress += 0.02
            if progress > 1.0: progress = 0.0
        else:
            progress = 0.0
            
        board.draw(mx, my, cell_id, progress)
        pygame.display.flip()
        clock.tick(60)
        
    pygame.quit()
