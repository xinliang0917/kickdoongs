$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class MiaoYaoAssets
{
    public static void Build(string root)
    {
        string source = Path.Combine(root, "source");
        string assets = Path.Combine(root, "assets");
        string petDir = Path.Combine(assets, "pet");
        Directory.CreateDirectory(petDir);

        using (var sleepySrc = new Bitmap(Path.Combine(source, "IMG_20261028_224551.png")))
        using (var dizzySrc = new Bitmap(Path.Combine(source, "IMG_20261028_225130.png")))
        using (var skateSrc = new Bitmap(Path.Combine(source, "IMG_20261028_225153.png")))
        {
            Bitmap sleepy = CutBorderColor(sleepySrc, Color.FromArgb(255, 255, 255), 92);
            Bitmap dizzy = CutDarkPhoto(dizzySrc, new Rectangle(430, 370, 880, 700));
            Bitmap skate = CutBorderColor(skateSrc, Color.FromArgb(240, 145, 144), 62);

            sleepy = CropToContent(sleepy, 10);
            dizzy = CropToContent(dizzy, 8);
            skate = CropToContent(skate, 8);

            sleepy = ResizeToMax(sleepy, 700, 490, true);
            dizzy = ResizeToMax(dizzy, 640, 640, false);
            skate = ResizeToMax(skate, 730, 560, false);

            Bitmap dizzyBody = MakeDizzyBody(sleepy, dizzy);
            SavePng(dizzyBody, Path.Combine(petDir, "dizzy.png"));
            SavePng(sleepy, Path.Combine(petDir, "idle.png"));
            SavePng(sleepy, Path.Combine(petDir, "sleepy.png"));
            SavePng(sleepy, Path.Combine(petDir, "goodnight.png"));
            SavePng(sleepy, Path.Combine(petDir, "charge.png"));
            SavePng(skate, Path.Combine(petDir, "skate.png"));

            using (Bitmap icon = MakeIcon(sleepy))
            {
                SavePng(icon, Path.Combine(assets, "icon.png"));
            }
            sleepy.Dispose();
            dizzy.Dispose();
            skate.Dispose();
        }
    }

    static Bitmap MakeDizzyBody(Bitmap body, Bitmap head)
    {
        Bitmap result = Clone32(body);
        using (Graphics g = Graphics.FromImage(result))
        using (SolidBrush white = new SolidBrush(Color.White))
        {
            g.FillRectangle(white, 250, 175, 255, 130);
        }

        Rectangle crop = new Rectangle(110, 135, 420, 190);
        Bitmap patch = new Bitmap(crop.Width, crop.Height, PixelFormat.Format32bppArgb);
        for (int y = 0; y < crop.Height; y++)
        {
            for (int x = 0; x < crop.Width; x++)
            {
                Color c = head.GetPixel(crop.X + x, crop.Y + y);
                int lum = (c.R + c.G + c.B) / 3;
                bool dark = lum < 125;
                bool pink = c.R - c.G > 30 && c.R - c.B > 15;
                if (dark || pink)
                {
                    patch.SetPixel(x, y, Color.FromArgb(255, c.R, c.G, c.B));
                }
            }
        }

        using (Graphics g = Graphics.FromImage(result))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingMode = CompositingMode.SourceOver;
            g.DrawImage(
                patch,
                new Rectangle(210, 170, 330, 149),
                new Rectangle(0, 0, crop.Width, crop.Height),
                GraphicsUnit.Pixel
            );
        }
        patch.Dispose();
        return result;
    }
    static Bitmap CutBorderColor(Bitmap source, Color bg, int tolerance)
    {
        Bitmap bmp = Clone32(source);
        int w = bmp.Width, h = bmp.Height;
        BitmapData data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int stride = data.Stride;
        byte[] bytes = new byte[stride * h];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
        bool[] seen = new bool[w * h];
        Queue<int> queue = new Queue<int>();

        Action<int, int> seed = (x, y) =>
        {
            int idx = y * w + x;
            if (seen[idx]) return;
            int off = y * stride + x * 4;
            int b = bytes[off], g = bytes[off + 1], r = bytes[off + 2];
            int dr = r - bg.R, dg = g - bg.G, db = b - bg.B;
            if (dr * dr + dg * dg + db * db <= tolerance * tolerance)
            {
                seen[idx] = true;
                queue.Enqueue(idx);
            }
        };

        for (int x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
        for (int y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }

        int[] dx = { 1, -1, 0, 0 };
        int[] dy = { 0, 0, 1, -1 };
        while (queue.Count > 0)
        {
            int idx = queue.Dequeue();
            int x = idx % w, y = idx / w;
            int off = y * stride + x * 4;
            bytes[off + 3] = 0;
            for (int k = 0; k < 4; k++)
            {
                int nx = x + dx[k], ny = y + dy[k];
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                int nidx = ny * w + nx;
                if (seen[nidx]) continue;
                int noff = ny * stride + nx * 4;
                int b = bytes[noff], g = bytes[noff + 1], r = bytes[noff + 2];
                int dr = r - bg.R, dg = g - bg.G, db = b - bg.B;
                if (dr * dr + dg * dg + db * db <= tolerance * tolerance)
                {
                    seen[nidx] = true;
                    queue.Enqueue(nidx);
                }
            }
        }

        System.Runtime.InteropServices.Marshal.Copy(bytes, 0, data.Scan0, bytes.Length);
        bmp.UnlockBits(data);
        return bmp;
    }

    static Bitmap CutDarkPhoto(Bitmap source, Rectangle crop)
    {
        using (Bitmap part = source.Clone(crop, PixelFormat.Format32bppArgb))
        {
            Bitmap bmp = Clone32(part);
            int w = bmp.Width, h = bmp.Height;
            BitmapData data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            byte[] bytes = new byte[stride * h];
            System.Runtime.InteropServices.Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);

            bool[] background = new bool[w * h];
            Queue<int> queue = new Queue<int>();

            Func<int, bool> isDark = (idx) =>
            {
                int off = (idx / w) * stride + (idx % w) * 4;
                int b = bytes[off], g = bytes[off + 1], r = bytes[off + 2];
                int lum = (r * 299 + g * 587 + b * 114) / 1000;
                return lum < 122;
            };

            Action<int> seed = (idx) =>
            {
                if (background[idx]) return;
                if (!isDark(idx)) return;
                background[idx] = true;
                queue.Enqueue(idx);
            };

            for (int x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
            for (int y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }

            int[] dx = { 1, -1, 0, 0 };
            int[] dy = { 0, 0, 1, -1 };
            while (queue.Count > 0)
            {
                int idx = queue.Dequeue();
                int x = idx % w, y = idx / w;
                for (int k = 0; k < 4; k++)
                {
                    int nx = x + dx[k], ny = y + dy[k];
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    int nidx = ny * w + nx;
                    if (background[nidx]) continue;
                    if (!isDark(nidx)) continue;
                    background[nidx] = true;
                    queue.Enqueue(nidx);
                }
            }

            bool[] keep = new bool[w * h];
            bool[] visited = new bool[w * h];
            int bestCount = -1;
            List<int> best = new List<int>();
            int[] fx = { 1, -1, 0, 0 };
            int[] fy = { 0, 0, 1, -1 };
            for (int start = 0; start < w * h; start++)
            {
                if (background[start] || visited[start]) continue;
                List<int> comp = new List<int>();
                Queue<int> q = new Queue<int>();
                q.Enqueue(start); visited[start] = true;
                while (q.Count > 0)
                {
                    int idx = q.Dequeue();
                    comp.Add(idx);
                    int x = idx % w, y = idx / w;
                    for (int k = 0; k < 4; k++)
                    {
                        int nx = x + fx[k], ny = y + fy[k];
                        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                        int nidx = ny * w + nx;
                        if (visited[nidx] || background[nidx]) continue;
                        visited[nidx] = true;
                        q.Enqueue(nidx);
                    }
                }
                if (comp.Count > bestCount)
                {
                    bestCount = comp.Count;
                    best = comp;
                }
            }
            foreach (int idx in best) keep[idx] = true;

            for (int i = 0; i < w * h; i++)
            {
                int off = (i / w) * stride + (i % w) * 4;
                bytes[off + 3] = keep[i] ? (byte)255 : (byte)0;
            }

            System.Runtime.InteropServices.Marshal.Copy(bytes, 0, data.Scan0, bytes.Length);
            bmp.UnlockBits(data);
            return bmp;
        }
    }

    static Bitmap Clone32(Bitmap source)
    {
        Bitmap bmp = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.CompositingMode = CompositingMode.SourceCopy;
            g.DrawImage(source, new Rectangle(0, 0, source.Width, source.Height));
        }
        return bmp;
    }

    static Bitmap CropToContent(Bitmap source, int pad)
    {
        int w = source.Width, h = source.Height;
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                if (source.GetPixel(x, y).A <= 8) continue;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < minX || maxY < minY) return source;
        minX = Math.Max(0, minX - pad);
        minY = Math.Max(0, minY - pad);
        maxX = Math.Min(w - 1, maxX + pad);
        maxY = Math.Min(h - 1, maxY + pad);
        Bitmap outBmp = new Bitmap(maxX - minX + 1, maxY - minY + 1, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(outBmp))
        {
            g.CompositingMode = CompositingMode.SourceCopy;
            g.DrawImage(source, new Rectangle(0, 0, outBmp.Width, outBmp.Height), new Rectangle(minX, minY, outBmp.Width, outBmp.Height), GraphicsUnit.Pixel);
        }
        if (!ReferenceEquals(outBmp, source)) source.Dispose();
        return outBmp;
    }

    static Bitmap ResizeToMax(Bitmap source, int maxW, int maxH, bool allowUpscale)
    {
        double scale = Math.Min((double)maxW / source.Width, (double)maxH / source.Height);
        if (!allowUpscale && scale > 1.0) scale = 1.0;
        int w = Math.Max(1, (int)Math.Round(source.Width * scale));
        int h = Math.Max(1, (int)Math.Round(source.Height * scale));
        if (w == source.Width && h == source.Height) return source;
        Bitmap outBmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(outBmp))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingMode = CompositingMode.SourceCopy;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.DrawImage(source, new Rectangle(0, 0, w, h));
        }
        source.Dispose();
        return outBmp;
    }

    static Bitmap MakeIcon(Bitmap source)
    {
        int w = source.Width, h = source.Height;
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                if (source.GetPixel(x, y).A <= 8) continue;
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < minX) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
        int headBottom = minY + Math.Max(1, (int)((maxY - minY + 1) * 0.62));
        Rectangle head = new Rectangle(minX, minY, maxX - minX + 1, headBottom - minY);
        int side = Math.Max(head.Width, head.Height);
        side = Math.Max(side, 1);
        Bitmap square = new Bitmap(side, side, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(square))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.DrawImage(source, new Rectangle((side - head.Width) / 2, (side - head.Height) / 2, head.Width, head.Height), head, GraphicsUnit.Pixel);
        }
        Bitmap icon = new Bitmap(256, 256, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(icon))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.DrawImage(square, new Rectangle(0, 0, 256, 256));
        }
        square.Dispose();
        return icon;
    }

    static void SavePng(Bitmap bmp, string path)
    {
        bmp.Save(path, ImageFormat.Png);
        Console.WriteLine(path + " " + bmp.Width + "x" + bmp.Height);
    }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies 'System.Drawing.dll'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
[MiaoYaoAssets]::Build($root)
