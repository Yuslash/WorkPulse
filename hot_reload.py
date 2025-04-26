import subprocess
import time
import keyboard  # pip install keyboard

class ScriptReloader:
    def __init__(self, entry_file):
        self.entry_file = entry_file
        self.process = None
        self.run_script()

    def run_script(self):
        if self.process:
            print("🛑 Stopping current process...\n")
            self.process.kill()
        print(f"▶️ Running: {self.entry_file}\n")
        self.process = subprocess.Popen(["python", self.entry_file])

    def listen_for_hotkey(self):
        print("🎯 Press Ctrl + Alt + R to reload the script.\n")
        try:
            while True:
                if keyboard.is_pressed('ctrl+alt+r'):
                    print("♻️ Hot reload triggered!\n")
                    self.run_script()
                    while keyboard.is_pressed('ctrl+alt+r'):
                        time.sleep(0.1)
                time.sleep(0.1)
        except KeyboardInterrupt:
            print("👋 Exiting...")
            if self.process:
                self.process.kill()

if __name__ == "__main__":
    entry_file = "main.py"  # Your script entry point
    reloader = ScriptReloader(entry_file)
    reloader.listen_for_hotkey()
