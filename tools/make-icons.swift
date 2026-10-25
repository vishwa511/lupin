// Generates Lupine's icons from assets/logo-source.webp.
//
// The source art is a dark rounded square on a soft white glow with a drop shadow underneath.
// This finds the dark square, clips it to a clean rounded rectangle (dropping glow and shadow)
// and renders:
//   build/icon.png            1024x1024 app icon on Apple's grid (824 px body, transparent margin)
//   assets/tray.png           18x18 menu-bar icon
//   assets/tray@2x.png        36x36 menu-bar icon (Retina)
//
// Usage: swift tools/make-icons.swift [--probe]

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let sourcePath = "assets/logo-source.webp"
let iconCanvas = 1024
let iconBody = 824 // Apple's macOS icon grid: 100 px transparent margin on each side
let cornerRatio: CGFloat = 0.225 // macOS icon corner radius relative to body size
let darkLumaThreshold = 0.30

struct Bounds { var minX: Int, minY: Int, maxX: Int, maxY: Int }

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("error: \(message)\n".utf8))
    exit(1)
}

func loadImage(_ path: String) -> CGImage {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fail("cannot read \(path)")
    }
    return image
}

/// Draws the image into a known RGBA8 buffer so pixels can be inspected.
func rgbaPixels(_ image: CGImage) -> (data: [UInt8], width: Int, height: Int) {
    let width = image.width, height = image.height
    var data = [UInt8](repeating: 0, count: width * height * 4)
    let drawn = data.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(
            data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    guard drawn else { fail("cannot create bitmap context") }
    return (data, width, height)
}

/// Bounding box (top-left origin) of opaque dark pixels: the icon's navy rounded square.
func darkSquareBounds(_ pixels: (data: [UInt8], width: Int, height: Int)) -> Bounds {
    var bounds = Bounds(minX: Int.max, minY: Int.max, maxX: -1, maxY: -1)
    for y in 0..<pixels.height {
        for x in 0..<pixels.width {
            let i = (y * pixels.width + x) * 4
            let alpha = Double(pixels.data[i + 3]) / 255
            guard alpha > 0.9 else { continue }
            let luma = (0.2126 * Double(pixels.data[i]) + 0.7152 * Double(pixels.data[i + 1])
                + 0.0722 * Double(pixels.data[i + 2])) / 255 / alpha
            guard luma < darkLumaThreshold else { continue }
            bounds.minX = min(bounds.minX, x); bounds.maxX = max(bounds.maxX, x)
            bounds.minY = min(bounds.minY, y); bounds.maxY = max(bounds.maxY, y)
        }
    }
    guard bounds.maxX > bounds.minX, bounds.maxY > bounds.minY else { fail("no dark square found") }
    return bounds
}

/// Renders the cropped square, clipped to a rounded rect, centred on a transparent canvas.
func render(_ image: CGImage, crop: CGRect, canvas: Int, body: Int) -> CGImage {
    guard let cropped = image.cropping(to: crop),
          let context = CGContext(
            data: nil, width: canvas, height: canvas, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          ) else { fail("cannot render \(canvas)px icon") }
    let inset = CGFloat(canvas - body) / 2
    let rect = CGRect(x: inset, y: inset, width: CGFloat(body), height: CGFloat(body))
    let radius = CGFloat(body) * cornerRatio
    context.interpolationQuality = .high
    context.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
    context.clip()
    context.draw(cropped, in: rect)
    guard let result = context.makeImage() else { fail("cannot finish \(canvas)px icon") }
    return result
}

func writePNG(_ image: CGImage, to path: String) {
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fail("cannot write \(path)")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fail("cannot write \(path)") }
    print("wrote \(path) (\(image.width)x\(image.height))")
}

let image = loadImage(sourcePath)
let pixels = rgbaPixels(image)
let found = darkSquareBounds(pixels)
// Shrink slightly so the soft anti-aliased edge of the original square is cut away.
let edgeTrim = 6
let side = min(found.maxX - found.minX, found.maxY - found.minY) - edgeTrim * 2
let crop = CGRect(x: found.minX + edgeTrim, y: found.minY + edgeTrim, width: side, height: side)

print("source \(pixels.width)x\(pixels.height), dark square x=\(found.minX)...\(found.maxX) y=\(found.minY)...\(found.maxY), crop \(crop)")
if CommandLine.arguments.contains("--probe") {
    exit(0)
}

writePNG(render(image, crop: crop, canvas: iconCanvas, body: iconBody), to: "build/icon.png")
writePNG(render(image, crop: crop, canvas: 18, body: 18), to: "assets/tray.png")
writePNG(render(image, crop: crop, canvas: 36, body: 36), to: "assets/tray@2x.png")
