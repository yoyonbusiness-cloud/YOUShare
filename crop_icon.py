from PIL import Image
import os

img_path = 'f:/Share/FileShareApp/Emit.png'
img = Image.open(img_path)
w, h = img.size

size = min(w, h)
left = (w - size) // 2
top = (h - size) // 2
right = (w + size) // 2
bottom = (h + size) // 2

img_cropped = img.crop((left, top, right, bottom))
img_cropped.save('f:/Share/FileShareApp/favicon.png', format='PNG')
img_cropped.save('f:/Share/FileShareApp/favicon.ico', format='ICO', sizes=[(32, 32), (64, 64), (128, 128), (256, 256)])
print("Successfully cropped and saved favicon!")
