Add-Type -AssemblyName System.Drawing

$inputPath = "f:\Share\FileShareApp\Emit.png"
$outputPath = "f:\Share\FileShareApp\favicon.png"

$img = [System.Drawing.Image]::FromFile($inputPath)
$w = $img.Width
$h = $img.Height

$size = [math]::Min($w, $h)

$left = [math]::Floor(($w - $size) / 2)
$top = [math]::Floor(($h - $size) / 2)

$rect = New-Object System.Drawing.Rectangle($left, $top, $size, $size)
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$bmp.SetResolution($img.HorizontalResolution, $img.VerticalResolution)

$g = [System.Drawing.Graphics]::FromImage($bmp)
# Use high quality interpolation
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, $rect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()

$bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$bmp.Dispose()
$img.Dispose()

Write-Host "Successfully cropped image to: $outputPath"
