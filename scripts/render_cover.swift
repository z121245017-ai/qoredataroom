import AppKit
import CoreGraphics
import Foundation

// Renders a crisp 1920x1080 submission cover PNG for QoreDataRoom (Encrypted Apps — QoreChain Developer Fest)
let width = 1920
let height = 1080

let args = CommandLine.arguments
let outPath = args.count > 1 ? args[1] : "docs/cover-1920x1080.png"

guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let ctx = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
else {
    fputs("Failed to create CGContext\n", stderr)
    exit(1)
}

func rgba(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1.0) -> CGColor {
    CGColor(colorSpace: colorSpace, components: [r / 255.0, g / 255.0, b / 255.0, a])!
}

// 1. Deep Obsidian Base Fill
ctx.setFillColor(rgba(6, 8, 16))
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

// 2. Quantum Violet & Cyan Radial Ambient Glows
func drawRadialGlow(center: CGPoint, radius: CGFloat, inner: CGColor) {
    let colors = [inner, rgba(6, 8, 16, 0.0)] as CFArray
    if let grad = CGGradient(colorsSpace: colorSpace, colors: colors, locations: [0.0, 1.0]) {
        ctx.drawRadialGradient(
            grad,
            startCenter: center,
            startRadius: 10,
            endCenter: center,
            endRadius: radius,
            options: [.drawsAfterEndLocation]
        )
    }
}

drawRadialGlow(center: CGPoint(x: 340, y: 860), radius: 740, inner: rgba(139, 92, 246, 0.28))
drawRadialGlow(center: CGPoint(x: 1620, y: 240), radius: 680, inner: rgba(34, 211, 238, 0.22))
drawRadialGlow(center: CGPoint(x: 1450, y: 860), radius: 520, inner: rgba(16, 185, 129, 0.12))

// 3. Subtle Cryptographic Lattice Grid
ctx.setStrokeColor(rgba(148, 163, 184, 0.06))
ctx.setLineWidth(1.0)
for x in stride(from: 0, through: width, by: 64) {
    ctx.move(to: CGPoint(x: x, y: 0))
    ctx.addLine(to: CGPoint(x: x, y: height))
}
for y in stride(from: 0, through: height, by: 64) {
    ctx.move(to: CGPoint(x: 0, y: y))
    ctx.addLine(to: CGPoint(x: width, y: y))
}
ctx.strokePath()

// Helper for rounded rectangles
func fillRoundedRect(_ rect: CGRect, radius: CGFloat, fill: CGColor, stroke: CGColor? = nil, lineWidth: CGFloat = 1.5) {
    let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.addPath(path)
    ctx.setFillColor(fill)
    ctx.fillPath()
    if let stroke = stroke {
        ctx.addPath(path)
        ctx.setStrokeColor(stroke)
        ctx.setLineWidth(lineWidth)
        ctx.strokePath()
    }
}

// Helper for NSGraphicsContext text drawing (flipped for top-down coordinates via AppKit)
let nsCtx = NSGraphicsContext(cgContext: ctx, flipped: false)
NSGraphicsContext.current = nsCtx

func drawText(_ text: String, x: CGFloat, yFromTop: CGFloat, size: CGFloat, weight: NSFont.Weight, color: NSColor, mono: Bool = false, maxWidth: CGFloat = 1600) {
    let font: NSFont = mono
        ? NSFont.monospacedSystemFont(ofSize: size, weight: weight)
        : NSFont.systemFont(ofSize: size, weight: weight)
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = size * 0.24
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: paragraph
    ]
    let str = NSAttributedString(string: text, attributes: attrs)
    let bounds = str.boundingRect(with: CGSize(width: maxWidth, height: 600), options: [.usesLineFragmentOrigin, .usesFontLeading])
    let yBottom = CGFloat(height) - yFromTop - bounds.height
    str.draw(with: CGRect(x: x, y: yBottom, width: maxWidth, height: bounds.height + 12), options: [.usesLineFragmentOrigin, .usesFontLeading])
}

// 4. Outer Glass Frame
fillRoundedRect(
    CGRect(x: 56, y: 56, width: width - 112, height: height - 112),
    radius: 32,
    fill: rgba(12, 17, 29, 0.72),
    stroke: rgba(148, 163, 184, 0.20),
    lineWidth: 1.5
)

// 5. Eyebrow Badge
fillRoundedRect(
    CGRect(x: 112, y: CGFloat(height) - 168, width: 536, height: 42),
    radius: 21,
    fill: rgba(34, 211, 238, 0.14),
    stroke: rgba(34, 211, 238, 0.45),
    lineWidth: 1.2
)
drawText(
    "QORECHAIN DEVELOPER FEST  ·  ENCRYPTED APPS TRACK",
    x: 136,
    yFromTop: 138,
    size: 15.5,
    weight: .bold,
    color: NSColor(calibratedRed: 0.40, green: 0.91, blue: 0.98, alpha: 1.0),
    mono: true
)

// 6. Main Brand Title & Headline
drawText(
    "QoreDataRoom",
    x: 112,
    yFromTop: 214,
    size: 86,
    weight: .heavy,
    color: NSColor(calibratedRed: 0.97, green: 0.98, blue: 1.0, alpha: 1.0)
)
drawText(
    "Post-Quantum M&A Virtual Data Rooms\nBuilt Before Q-Day on QoreChain Diana",
    x: 112,
    yFromTop: 326,
    size: 36,
    weight: .semibold,
    color: NSColor(calibratedRed: 0.77, green: 0.71, blue: 0.99, alpha: 1.0),
    maxWidth: 960
)
drawText(
    "Defeat Harvest-Now-Decrypt-Later attacks and compromised classical ECDSA keys.\nML-KEM-1024 + X25519 hybrid sealing, ML-DSA-87 Recipient Cards, EpochKeyManager\nrevocation (UNKNOWN_EPOCH), and EVM precompiles 0x...0a01 & 0x...0a02.",
    x: 112,
    yFromTop: 446,
    size: 22,
    weight: .regular,
    color: NSColor(calibratedRed: 0.65, green: 0.72, blue: 0.82, alpha: 1.0),
    maxWidth: 940
)

// 7. Right Cryptographic Spec Card
let cardX: CGFloat = 1140
let cardY: CGFloat = 228
let cardW: CGFloat = 668
let cardH: CGFloat = 632
fillRoundedRect(
    CGRect(x: cardX, y: cardY, width: cardW, height: cardH),
    radius: 24,
    fill: rgba(8, 12, 22, 0.92),
    stroke: rgba(139, 92, 246, 0.48),
    lineWidth: 2.0
)

drawText(
    "LIVE CRYPTOGRAPHIC ARCHITECTURE",
    x: cardX + 34,
    yFromTop: 256,
    size: 16,
    weight: .bold,
    color: NSColor(calibratedRed: 0.40, green: 0.91, blue: 0.98, alpha: 1.0),
    mono: true
)

let specs: [(String, String, String)] = [
    ("HYBRID SEALING", "ML-KEM-1024 + X25519", "1,568 B KEM pk · 32 B X25519 · AES-256-GCM AAD"),
    ("RECIPIENT CARDS", "ML-DSA-87 + secp256k1", "2,592 B pk · 4,627 B sig · Zero Silent Downgrade"),
    ("EPOCH EVICTION", "EpochKeyManager (E1 → E2)", "Evicted Bidder B blocked: UNKNOWN_EPOCH"),
    ("PRECOMPILE 0A01", "0x...0a01 · pqcVerify()", "Verifies 4,627 B ML-DSA-87 eviction digest"),
    ("PRECOMPILE 0A02", "0x...0a02 · pqcKeyStatus()", "Enforces registered + possessionProven + alg=1"),
    ("EVM AUTH WINDOW", "MsgOpenEVMWindow", "Scoped target + block/tx/uQOR spend cap")
]

for (idx, item) in specs.enumerated() {
    let topY = CGFloat(302 + idx * 86)
    let boxY = CGFloat(height) - topY - 72
    fillRoundedRect(
        CGRect(x: cardX + 30, y: boxY, width: cardW - 60, height: 72),
        radius: 14,
        fill: rgba(17, 24, 39, 0.9),
        stroke: rgba(148, 163, 184, 0.16),
        lineWidth: 1.0
    )
    drawText(
        item.0,
        x: cardX + 48,
        yFromTop: topY + 17,
        size: 12,
        weight: .bold,
        color: NSColor(calibratedRed: 0.65, green: 0.55, blue: 0.98, alpha: 1.0),
        mono: true
    )
    drawText(
        item.1,
        x: cardX + 240,
        yFromTop: topY + 14,
        size: 16.5,
        weight: .bold,
        color: NSColor(calibratedRed: 0.95, green: 0.97, blue: 1.0, alpha: 1.0),
        mono: true
    )
    drawText(
        item.2,
        x: cardX + 48,
        yFromTop: topY + 44,
        size: 14.5,
        weight: .medium,
        color: NSColor(calibratedRed: 0.60, green: 0.68, blue: 0.78, alpha: 1.0)
    )
}

// 8. Bottom Proof Metric Pills on Left
let pills: [(String, String, CGColor, CGColor)] = [
    ("DIANA TESTNET", "qorechain-diana · 9800", rgba(16, 185, 129, 0.14), rgba(16, 185, 129, 0.45)),
    ("FOUNDRY SOLC 0.8.28", "13/13 Unit + Fuzz Pass", rgba(139, 92, 246, 0.16), rgba(139, 92, 246, 0.50)),
    ("REAL PQC SUITE", "qoreseal + qoresign", rgba(34, 211, 238, 0.14), rgba(34, 211, 238, 0.45))
]

for (i, pill) in pills.enumerated() {
    let px = CGFloat(112 + i * 324)
    let py: CGFloat = 228
    fillRoundedRect(
        CGRect(x: px, y: py, width: 304, height: 92),
        radius: 18,
        fill: pill.2,
        stroke: pill.3,
        lineWidth: 1.4
    )
    drawText(
        pill.0,
        x: px + 22,
        yFromTop: CGFloat(height) - py - 70,
        size: 12.5,
        weight: .bold,
        color: NSColor(calibratedRed: 0.82, green: 0.88, blue: 0.96, alpha: 1.0),
        mono: true
    )
    drawText(
        pill.1,
        x: px + 22,
        yFromTop: CGFloat(height) - py - 42,
        size: 16.5,
        weight: .bold,
        color: NSColor.white,
        mono: true,
        maxWidth: 265
    )
}

// Footer bar
drawText(
    "MIT License  ·  github.com/z121245017-ai/qoredataroom  ·  Build Before Q-Day",
    x: 112,
    yFromTop: 948,
    size: 17,
    weight: .medium,
    color: NSColor(calibratedRed: 0.50, green: 0.58, blue: 0.70, alpha: 1.0),
    mono: true
)

guard let image = ctx.makeImage() else {
    fputs("Failed to make CGImage\n", stderr)
    exit(1)
}
let rep = NSBitmapImageRep(cgImage: image)
guard let pngData = rep.representation(using: .png, properties: [:]) else {
    fputs("Failed to encode PNG\n", stderr)
    exit(1)
}

let outUrl = URL(fileURLWithPath: outPath)
try FileManager.default.createDirectory(at: outUrl.deletingLastPathComponent(), withIntermediateDirectories: true)
try pngData.write(to: outUrl)
print("Rendered cover image: \(outUrl.path) (\(width)x\(height), \(pngData.count) bytes)")
