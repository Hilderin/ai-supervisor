# Genere build/icon.png (256x256) a partir du logo du Superviseur (ui/public/favicon.svg
# redraw en System.Drawing : carre vert arrondi + cercle blanc, coins transparents).
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# echelle : le SVG est en 32x32 -> facteur 8 ; rx=8 -> 64 px
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 64
$path.AddArc(0, 0, $r, $r, 180, 90)
$path.AddArc($size - $r, 0, $r, $r, 270, 90)
$path.AddArc($size - $r, $size - $r, $r, $r, 0, 90)
$path.AddArc(0, $size - $r, $r, $r, 90, 90)
$path.CloseFigure()
$green = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0x2b, 0x9f, 0x6a))
$g.FillPath($green, $path)

# cercle blanc : cx=16 cy=16 r=7.5 -> centre 128, rayon 60, trait 2.2*8 = 17.6
$white = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 17.6)
$g.DrawEllipse($white, 128 - 60, 128 - 60, 120, 120)
# point central : r=2.6 -> rayon 20.8
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillEllipse($whiteBrush, 128 - 20.8, 128 - 20.8, 41.6, 41.6)

$g.Dispose()
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'build'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$bmp.Save((Join-Path $dir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "icon.png genere"
