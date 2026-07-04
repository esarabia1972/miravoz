import subprocess
import threading
import queue
import time
import sys

class TTSWorker(threading.Thread):
    def __init__(self, q):
        super().__init__()
        self.q = q
        self.daemon = True
        self.running = True
        self.is_mac = sys.platform == "darwin"

    def run(self):
        while self.running:
            try:
                text = self.q.get(timeout=0.5) 
                if text:
                    if self.is_mac:
                        # Usar el comando 'say' nativo de Mac
                        subprocess.run(["say", text])
                    else:
                        print(f"[TTS Simulado]: {text}")
                self.q.task_done()
            except queue.Empty:
                pass
            except Exception as e:
                print(f"Error TTS: {e}")

class TTS:
    def __init__(self):
        self.q = queue.Queue()
        self.worker = TTSWorker(self.q)
        self.worker.start()
        
    def speak(self, text):
        self.q.put(text)
        
    def stop(self):
        self.worker.running = False
        self.worker.join(timeout=1.0)

if __name__ == "__main__":
    tts = TTS()
    print("Diciendo 'uno'...")
    tts.speak("uno")
    time.sleep(1)
    print("Diciendo 'dos'...")
    tts.speak("dos")
    time.sleep(2)
    tts.stop()
