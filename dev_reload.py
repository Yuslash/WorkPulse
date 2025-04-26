import time
import subprocess
import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import threading

class ReloadHandler(FileSystemEventHandler):
    def __init__(self, entry_file, cooldown_time=2):
        self.entry_file = entry_file
        self.process = None
        self.last_reload_time = 0
        self.cooldown_time = cooldown_time
        self.timer = None
        self.run_script()

    def run_script(self):
        if self.process:
            self.process.kill()
        print(f"▶️ Running: {self.entry_file}\n")
        self.process = subprocess.Popen(["python", self.entry_file])

    def schedule_reload(self):
        if self.timer:
            self.timer.cancel()  # Cancel the previous timer if a new change occurs within the cooldown period
        # Schedule the reload after the cooldown time
        self.timer = threading.Timer(self.cooldown_time, self.run_script)
        self.timer.start()

    def on_modified(self, event):
        if event.src_path.endswith(".py"):
            print(f"🔁 Changed: {event.src_path} — Will reload after {self.cooldown_time} seconds...\n")
            self.schedule_reload()

if __name__ == "__main__":
    entry_file = "main.py"  # 👈 Your PyQt5 entry point

    event_handler = ReloadHandler(entry_file, cooldown_time=3)  # Set cooldown to 3 seconds
    observer = Observer()

    # 👇 Watch all relevant folders recursively
    folders_to_watch = [".", "components", "themes", "windows"]
    for folder in folders_to_watch:
        observer.schedule(event_handler, folder, recursive=True)

    observer.start()
    print(f"👀 Watching for changes in: {', '.join(folders_to_watch)}")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
