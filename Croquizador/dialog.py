import tkinter as tk
from tkinter import filedialog
import sys

def open_dialog():
    try:
        root = tk.Tk()
        root.withdraw() # Hide the main window
        root.attributes('-topmost', True) # Bring to front
        
        file_path = filedialog.askopenfilename(
            title="Seleccionar Archivo Inkscape",
            filetypes=[("Archivos Inkscape SVG", "*.svg"), ("Todos los archivos", "*.*")]
        )
        
        root.destroy()
        
        if file_path:
            print(file_path)
            return True
        else:
            return False
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return False

if __name__ == "__main__":
    open_dialog()
