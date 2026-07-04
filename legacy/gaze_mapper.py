import numpy as np

class GazeMapper:
    def __init__(self):
        # coeficientes polinómicos para X e Y
        self.coeffs_x = None
        self.coeffs_y = None
        self.is_calibrated = False

    def _get_features(self, yaw, pitch):
        """Retorna el vector de características: [1, yaw, pitch, yaw^2, pitch^2, yaw*pitch]"""
        return np.array([1, yaw, pitch, yaw**2, pitch**2, yaw*pitch])

    def calibrate(self, samples_gaze, samples_screen):
        """
        samples_gaze: lista de tuplas (yaw, pitch)
        samples_screen: lista de tuplas (x, y) en píxeles
        Ajusta un modelo polinómico de 2do grado por mínimos cuadrados.
        """
        if len(samples_gaze) < 6:
            # Necesitamos al menos 6 puntos para ajustar 6 coeficientes
            print("No hay suficientes muestras para calibrar.")
            return False
            
        A = np.array([self._get_features(y, p) for (y, p) in samples_gaze])
        Bx = np.array([pt[0] for pt in samples_screen])
        By = np.array([pt[1] for pt in samples_screen])
        
        # Ajuste por mínimos cuadrados (lstsq)
        # rcond=None silencia un warning en numpy
        self.coeffs_x, _, _, _ = np.linalg.lstsq(A, Bx, rcond=None)
        self.coeffs_y, _, _, _ = np.linalg.lstsq(A, By, rcond=None)
        
        self.is_calibrated = True
        return True

    def map_gaze(self, yaw, pitch, screen_width, screen_height):
        """
        Dada una mirada (yaw, pitch), devuelve la coordenada estimada (x, y) en pantalla.
        """
        if not self.is_calibrated:
            return None, None
            
        features = self._get_features(yaw, pitch)
        
        x = np.dot(features, self.coeffs_x)
        y = np.dot(features, self.coeffs_y)
        
        # Clamp a los límites de pantalla
        x = max(0, min(screen_width - 1, x))
        y = max(0, min(screen_height - 1, y))
        
        return float(x), float(y)
