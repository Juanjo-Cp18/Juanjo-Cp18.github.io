import os
import sys
import subprocess
import base64
import json
import logging
from flask import Flask, render_template, request, jsonify
# import tkinter as tk
# from tkinter import filedialog
import platform

app = Flask(__name__)
logging.basicConfig(level=logging.DEBUG)

# Try to locate Inkscape
def find_inkscape():
    system = platform.system()
    if system == "Windows":
        paths = [
            r"C:\Program Files\Inkscape\bin\inkscape.exe",
            r"C:\Program Files\Inkscape\inkscape.exe",
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Inkscape\bin\inkscape.exe")
        ]
        for p in paths:
            if os.path.exists(p):
                return p
    # Fallback to just 'inkscape' and hope it's in PATH
    return "inkscape"

INKSCAPE_PATH = find_inkscape()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/select-file', methods=['GET'])
def select_file():
    # Call the external script, which is safer for GUI operations
    try:
        # We need to run with the same python interpreter
        result = subprocess.run([sys.executable, "dialog.py"], capture_output=True, text=True)
        file_path = result.stdout.strip()
        
        if file_path and not file_path.startswith("ERROR"):
            return jsonify({"success": True, "path": file_path})
        else:
            return jsonify({"success": False, "message": "No se seleccionó ningún archivo."})
    except Exception as e:
        app.logger.error(f"Error calling dialog: {e}")
        return jsonify({"success": False, "message": str(e)})

import time
from lxml import etree as ET

import io
from PIL import Image

import shutil

@app.route('/process', methods=['POST'])
def process():
    data = request.json
    svg_path = data.get('svg_path')
    
    # Defaults and Path Resolution
    if not svg_path:
        svg_path = "PLANIFICADOR.svg"
        
    # If absolute path not provided, assume relative to app directory
    if not os.path.isabs(svg_path):
        svg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), svg_path)

    image_data = data.get('image_data') 
    
    if not os.path.exists(svg_path):
        return jsonify({"success": False, "message": f"No se encuentra el archivo: {svg_path}"})

    if not image_data:
        return jsonify({"success": False, "message": "No se recibieron datos de imagen"})

    try:
        # 1. Save Image (PNG) in 'captures' folder
        if "base64," in image_data:
            header, encoded = image_data.split("base64,", 1)
        else:
            encoded = image_data
            
        img_bytes = base64.b64decode(encoded)
        
        # Unique timestamp
        timestamp = int(time.time())
        img_filename = f"map_capture_{timestamp}.png"
        
        # Folder logic
        svg_dir = os.path.dirname(svg_path)
        captures_dir = os.path.join(svg_dir, "captures")
        os.makedirs(captures_dir, exist_ok=True)
        
        img_full_path = os.path.join(captures_dir, img_filename)
        
        img_full_path = os.path.join(captures_dir, img_filename)
        
        with open(img_full_path, "wb") as f:
            f.write(img_bytes)

        # 2. Get Native Dimensions
        # We will use these EXACT numbers to define the SVG image size.
        # This prevents any "container fitting" distortion.
        with Image.open(io.BytesIO(img_bytes)) as pil_img:
            px_w, px_h = pil_img.size
            app.logger.info(f"NATIVE SIZE: {px_w}x{px_h}")

        # 3. Parse SVG 
        with open(svg_path, 'r', encoding='utf-8') as f:
            raw_xml = f.read()

        if 'xmlns:xlink' not in raw_xml:
            raw_xml = raw_xml.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"', 1)
            
        parser = ET.XMLParser(remove_blank_text=False)
        root = ET.fromstring(raw_xml.encode('utf-8'), parser)
        tree = ET.ElementTree(root)
        
        ns = root.nsmap
        svg_ns = ns.get(None, "http://www.w3.org/2000/svg")
        xlink_ns = "http://www.w3.org/1999/xlink" 

        # --- STEP 3: CLEANUP OLD GROUPS ---
        # We look for <g> elements that we created previously and remove them.
        # Since we append them to root, we iterate over root children.
        # We iterate a list(root) to avoid issues while modifying the tree during iteration.
        for child in list(root):
            # Check if it has our ID signature
            eid = child.get('id', '')
            if eid.startswith('map_group_'):
                root.remove(child)
                app.logger.info(f"Removed old map group: {eid}")

        # --- STEP 4: FIT TO DOCUMENT PAGE ---
        # Get Document Dimensions dynamically
        # Priority: viewBox (4th and 5th values) -> width/height attributes
        
        doc_w = 297.0 # Default A4 Landscape fallback
        doc_h = 210.0
        
        vbox = root.get('viewBox')
        if vbox:
            parts = vbox.split()
            if len(parts) == 4:
                doc_w = float(parts[2])
                doc_h = float(parts[3])
        else:
            # Fallback to width/height attrs (stripping 'mm')
            w_str = root.get('width', '297mm').replace('mm', '')
            h_str = root.get('height', '210mm').replace('mm', '')
            try:
                doc_w = float(w_str)
                doc_h = float(h_str)
            except:
                pass

        app.logger.info(f"Target Document Size: {doc_w}x{doc_h}")

        # Calculate scale ratio for both dimensions
        scale_w = doc_w / px_w
        scale_h = doc_h / px_h
        
        # Use the smaller scale to ensure it fits both width and height (Contain)
        # REDUCE BY 20% as requested by user (0.8 multiplier)
        scale_factor = min(scale_w, scale_h) * 0.8
        
        # Calculate the resulting size in units
        final_w = px_w * scale_factor
        final_h = px_h * scale_factor
        
        # Calculate centering offsets
        offset_x = (doc_w - final_w) / 2.0
        offset_y = (doc_h - final_h) / 2.0
        
        g_elem = ET.Element(f"{{{svg_ns}}}g")
        g_elem.set('id', f'map_group_{timestamp}')
        
        # Apply Translation (Centering) AND Scaling
        # Order matters: Translate then Scale? No, in SVG transform string:
        # "translate(tx, ty) scale(s)" -> Moves by tx,ty, then scales the axes at the new origin? 
        # Actually standard element transform order is right-to-list matrices, but string varies.
        # "translate(x,y) scale(s)" means:
        # 1. Translate system by x,y.
        # 2. Scale system by s.
        # Image at 0,0 will be drawn at x,y with scale s. This is correct.
        g_elem.set('transform', f'translate({offset_x:.5f},{offset_y:.5f}) scale({scale_factor:.5f})')
        
        image_elem = ET.Element(f"{{{svg_ns}}}image")
        image_elem.set('x', '0')
        image_elem.set('y', '0')
        # SET NATIVE PIXEL DIMENSIONS
        image_elem.set('width', str(px_w)) 
        image_elem.set('height', str(px_h))
        image_elem.set('id', f'inserted_map_image_{timestamp}')
        
        image_elem.set(f"{{{xlink_ns}}}href", f"captures/{img_filename}")

        g_elem.append(image_elem)
        root.append(g_elem)
        
        tree.write(svg_path, encoding='utf-8', xml_declaration=True, pretty_print=False)

        # 3. Open Inkscape
        subprocess.Popen([INKSCAPE_PATH, svg_path], shell=False)

        return jsonify({"success": True, "message": f"Mapa insertado (Centrado y Ajustado al A4)."})

    except Exception as e:
        app.logger.error(e)
        return jsonify({"success": False, "message": str(e)})

@app.route('/open-captures', methods=['POST'])
def open_captures():
    try:
        captures_dir = os.path.join(os.path.dirname(__file__), "captures")
        if not os.path.exists(captures_dir):
            os.makedirs(captures_dir)
            
        if platform.system() == "Windows":
            os.startfile(captures_dir)
        else:
            # Fallback for other OS (Linux/Mac)
            subprocess.Popen(["xdg-open", captures_dir])
            
        return jsonify({"success": True, "message": "Carpeta abierta"})
    except Exception as e:
        app.logger.error(f"Error opening folder: {e}")
        return jsonify({"success": False, "message": str(e)})

if __name__ == '__main__':
    # Run slightly different port to avoid conflicts
    print(f"Inkscape path detected: {INKSCAPE_PATH}")
    app.run(debug=True, port=5001)
