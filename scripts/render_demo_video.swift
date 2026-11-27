import Foundation
import AVFoundation
import CoreGraphics
import ImageIO
import AppKit

// Renders a crisp narrated 1280x720 30fps H.264 + AAC demo video (<= 90s)
// for QoreDataRoom using captured 16:9 live Diana Testnet UI frames and macOS AVFoundation.

struct Slide {
    let imagePath: String?
    let badge: String
    let title: String
    let subtitle: String
    let caption: String
    let narration: String
}

let args = CommandLine.arguments
let framesDir = args.count > 1 ? args[1] : "/tmp/qore_video_frames/qoredataroom"
let docsCoverPath = args.count > 2 ? args[2] : "docs/cover-1920x1080.png"
let outPath = args.count > 3 ? args[3] : "docs/demo.mp4"

let slides: [Slide] = [
    Slide(
        imagePath: FileManager.default.fileExists(atPath: docsCoverPath) ? docsCoverPath : nil,
        badge: "QORECHAIN DEVELOPER FEST · ENCRYPTED APPS TRACK",
        title: "QoreDataRoom: Post-Quantum Encrypted Deal Rooms",
        subtitle: "Zero-plaintext M&A & diligence vault with QoreSeal ML-KEM-1024 + QoreSign ML-DSA-87",
        caption: "Live Demo: z121245017-ai.github.io/qoredataroom  |  MIT Open Source  |  Built with QoreSeal + QoreSign + QoreChain",
        narration: "Welcome to QoreDataRoom, a post-quantum encrypted virtual data room built with QoreSeal and QoreSign on the QoreChain Diana Testnet."
    ),
    Slide(
        imagePath: "\(framesDir)/01_hero_workspace.png",
        badge: "01 · QUANTUM-SAFE WORKSPACE & ON-CHAIN EPOCH REGISTRY",
        title: "Member-Bound Epochs Anchored by DataRoomRegistry.sol",
        subtitle: "Tracks active epoch keys, participant ML-DSA-87 badges, and zero-trust room telemetry live",
        caption: "Built around Recipient Cards binding qor1 / 0x identities to dual ML-KEM-1024 + ML-DSA-87 keys",
        narration: "QoreDataRoom manages deal rooms across cryptographic epochs, binding every member's identity to both an ML-KEM-1024 encryption key and an ML-DSA-87 signature."
    ),
    Slide(
        imagePath: "\(framesDir)/02_walkthrough_envelope.png",
        badge: "02 · REAL QORESEAL ML-KEM-1024 + AES-256-GCM SEALING",
        title: "1-Click Cryptographic Walkthrough & Sealed Envelopes",
        subtitle: "Seals Epoch 1 documents into real qoreseal: binary envelopes with AAD metadata authentication",
        caption: "Every document recipient receives an epoch-scoped ML-KEM-1024 encapsulation signed by ML-DSA-87",
        narration: "Running the one-click walkthrough seals diligence files directly in the browser using real ML-KEM-1024 encapsulation and AES-256-GCM authenticated encryption."
    ),
    Slide(
        imagePath: "\(framesDir)/03_diana_onchain_lookup.png",
        badge: "03 · LIVE DIANA TESTNET IDENTITY & KEM STATE LOOKUP",
        title: "Verifying Live QoreChain Accounts Against On-Chain State",
        subtitle: "Resolves registered Cosmos and Diana EVM addresses via /lcd and EVM RPC proxies in real time",
        caption: "Confirmed live against testnet address qor1jmd3fgvvz344uhma8r4nat4pglvpgsfng53d4w",
        narration: "Users can also look up any live Diana Testnet address in real time to inspect its registered post-quantum account keys and readiness before granting access."
    ),
    Slide(
        imagePath: "\(framesDir)/04_security_proofs.png",
        badge: "04 · TAMPER REJECTION & FORWARD-SECRET EPOCH ROTATION",
        title: "Blocking MITM Cards, AAD Tampering & Evicted Members",
        subtitle: "Bidder B eviction rotates to Epoch 2 with ML-DSA-87 proof; prior members hit UNKNOWN_EPOCH",
        caption: "Live browser assertions pass: CARD_INVALID · DECRYPTION_FAILED · UNKNOWN_EPOCH (0 errors)",
        narration: "Finally, live security checks prove that substituted recipient cards and modified AAD fail loudly, while evicting a bidder rotates keys into Epoch 2 so evicted keys cannot decrypt new seals."
    ),
    Slide(
        imagePath: nil,
        badge: "QOREDATAROOM · BUILT FOR ENCRYPTED APPS ON DIANA TESTNET",
        title: "Confidentiality That Survives Harvest-Now, Decrypt-Later.",
        subtitle: "Live Web App: https://z121245017-ai.github.io/qoredataroom/  |  Repo: github.com/z121245017-ai/qoredataroom",
        caption: "Testnet Address: qor1jmd3fgvvz344uhma8r4nat4pglvpgsfng53d4w  |  Foundry + Vitest + Headless Chrome QA Verified",
        narration: "Explore QoreDataRoom live on GitHub Pages and review our open-source Foundry contracts and cryptographic test suite on GitHub. Thank you."
    )
]

let width = 1280
let height = 720
let fps: Int32 = 30

func runShell(_ launchPath: String, _ arguments: [String]) throws {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: launchPath)
    proc.arguments = arguments
    let errPipe = Pipe()
    proc.standardError = errPipe
    try proc.run()
    proc.waitUntilExit()
    if proc.terminationStatus != 0 {
        let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
        let errStr = String(data: errData, encoding: .utf8) ?? ""
        throw NSError(domain: "Shell", code: Int(proc.terminationStatus), userInfo: [
            NSLocalizedDescriptionKey: "\(launchPath) failed: \(errStr)"
        ])
    }
}

func loadImage(_ path: String) -> CGImage? {
    let url = URL(fileURLWithPath: path)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

func drawText(_ ctx: CGContext, text: String, rect: CGRect, fontSize: CGFloat, weight: NSFont.Weight, color: NSColor, align: NSTextAlignment = .center, mono: Bool = false) {
    let font: NSFont = mono
        ? NSFont.monospacedSystemFont(ofSize: fontSize, weight: weight)
        : NSFont.systemFont(ofSize: fontSize, weight: weight)
    let para = NSMutableParagraphStyle()
    para.alignment = align
    para.lineBreakMode = .byWordWrapping
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: para
    ]
    let nsStr = NSAttributedString(string: text, attributes: attrs)
    NSGraphicsContext.saveGraphicsState()
    let gctx = NSGraphicsContext(cgContext: ctx, flipped: true)
    NSGraphicsContext.current = gctx
    nsStr.draw(in: rect)
    NSGraphicsContext.restoreGraphicsState()
}

func renderSlideBuffer(_ slide: Slide, pool: CVPixelBufferPool) -> CVPixelBuffer? {
    var pixelBufferOut: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBufferOut) == kCVReturnSuccess,
          let pb = pixelBufferOut else { return nil }
    CVPixelBufferLockBaseAddress(pb, [])
    defer { CVPixelBufferUnlockBaseAddress(pb, []) }

    guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pb)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: base,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) else { return nil }

    ctx.translateBy(x: 0, y: CGFloat(height))
    ctx.scaleBy(x: 1, y: -1)

    // Deep midnight-indigo QoreSeal canvas
    ctx.setFillColor(NSColor(red: 0.025, green: 0.032, blue: 0.072, alpha: 1.0).cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

    // Top accent stripe (cyan -> indigo)
    ctx.setFillColor(NSColor(red: 0.22, green: 0.74, blue: 0.97, alpha: 0.92).cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: width / 2, height: 4))
    ctx.setFillColor(NSColor(red: 0.49, green: 0.32, blue: 0.96, alpha: 0.92).cgColor)
    ctx.fill(CGRect(x: width / 2, y: 0, width: width / 2, height: 4))

    let accentBright = NSColor(red: 0.40, green: 0.84, blue: 0.98, alpha: 1.0)
    let whiteSoft = NSColor(red: 0.95, green: 0.97, blue: 1.0, alpha: 1.0)
    let muted = NSColor(red: 0.62, green: 0.70, blue: 0.84, alpha: 1.0)

    if let imgPath = slide.imagePath, let cgImg = loadImage(imgPath) {
        drawText(ctx, text: slide.badge, rect: CGRect(x: 48, y: 18, width: 1184, height: 20), fontSize: 13, weight: .bold, color: accentBright, align: .center, mono: true)
        drawText(ctx, text: slide.title, rect: CGRect(x: 48, y: 40, width: 1184, height: 36), fontSize: 27, weight: .bold, color: whiteSoft, align: .center)
        drawText(ctx, text: slide.subtitle, rect: CGRect(x: 64, y: 78, width: 1152, height: 26), fontSize: 15, weight: .regular, color: muted, align: .center)

        // Exact 16:9 frame box: 912x513
        let frameRect = CGRect(x: 184, y: 116, width: 912, height: 513)
        let bezel = frameRect.insetBy(dx: -8, dy: -8)
        ctx.setFillColor(NSColor(red: 0.012, green: 0.018, blue: 0.042, alpha: 1.0).cgColor)
        ctx.fill(bezel)
        ctx.setStrokeColor(NSColor(red: 0.38, green: 0.78, blue: 0.98, alpha: 0.55).cgColor)
        ctx.setLineWidth(2.0)
        ctx.stroke(bezel)

        ctx.saveGState()
        ctx.translateBy(x: frameRect.origin.x, y: frameRect.origin.y + frameRect.size.height)
        ctx.scaleBy(x: 1, y: -1)
        ctx.interpolationQuality = .high
        ctx.draw(cgImg, in: CGRect(origin: .zero, size: frameRect.size))
        ctx.restoreGState()

        ctx.setFillColor(NSColor(red: 0.055, green: 0.075, blue: 0.16, alpha: 1.0).cgColor)
        ctx.fill(CGRect(x: 48, y: 648, width: 1184, height: 48))
        ctx.setStrokeColor(NSColor(red: 0.25, green: 0.50, blue: 0.72, alpha: 0.7).cgColor)
        ctx.setLineWidth(1.0)
        ctx.stroke(CGRect(x: 48, y: 648, width: 1184, height: 48))
        drawText(ctx, text: slide.caption, rect: CGRect(x: 64, y: 661, width: 1152, height: 24), fontSize: 14, weight: .medium, color: accentBright, align: .center, mono: true)
    } else {
        let box = CGRect(x: 90, y: 130, width: 1100, height: 460)
        ctx.setFillColor(NSColor(red: 0.045, green: 0.06, blue: 0.135, alpha: 1.0).cgColor)
        ctx.fill(box)
        ctx.setStrokeColor(NSColor(red: 0.38, green: 0.78, blue: 0.98, alpha: 0.65).cgColor)
        ctx.setLineWidth(2.0)
        ctx.stroke(box)

        drawText(ctx, text: slide.badge, rect: CGRect(x: 120, y: 185, width: 1040, height: 28), fontSize: 15, weight: .bold, color: accentBright, align: .center, mono: true)
        drawText(ctx, text: slide.title, rect: CGRect(x: 120, y: 245, width: 1040, height: 74), fontSize: 44, weight: .bold, color: whiteSoft, align: .center)
        drawText(ctx, text: slide.subtitle, rect: CGRect(x: 130, y: 345, width: 1020, height: 60), fontSize: 20, weight: .medium, color: muted, align: .center)
        drawText(ctx, text: slide.caption, rect: CGRect(x: 120, y: 450, width: 1040, height: 70), fontSize: 14, weight: .semibold, color: accentBright, align: .center, mono: true)
    }

    return pb
}

let sem = DispatchSemaphore(value: 0)
Task {
    let tempDir = URL(fileURLWithPath: "/tmp/qoredataroom_vid_\(ProcessInfo.processInfo.processIdentifier)")
    do {
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let finalURL = URL(fileURLWithPath: outPath)
        try FileManager.default.createDirectory(at: finalURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let silentURL = tempDir.appendingPathComponent("silent.mp4")

        var audioURLs: [URL] = []
        var slideDurations: [Double] = []
        for (idx, slide) in slides.enumerated() {
            let m4aURL = tempDir.appendingPathComponent("s\(idx).m4a")
            try runShell("/usr/bin/say", ["-v", "Daniel", "-r", "172", "--file-format=m4af", "--data-format=aac", "-o", m4aURL.path, slide.narration])
            let aAsset = AVURLAsset(url: m4aURL)
            let aDur = try await aAsset.load(.duration)
            let durSec = max(4.5, ceil((CMTimeGetSeconds(aDur) + 1.1) * 10.0) / 10.0)
            audioURLs.append(m4aURL)
            slideDurations.append(durSec)
        }

        let writer = try AVAssetWriter(outputURL: silentURL, fileType: .mp4)
        let videoSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 2_600_000,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoMaxKeyFrameIntervalKey: 60
            ]
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        input.expectsMediaDataInRealTime = false
        let poolAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA),
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: poolAttrs)
        writer.add(input)
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)
        guard let pool = adaptor.pixelBufferPool else { fatalError("Missing CVPixelBufferPool") }

        var slideStarts: [CMTime] = []
        var currentFrame: Int64 = 0
        for (idx, slide) in slides.enumerated() {
            slideStarts.append(CMTime(value: currentFrame, timescale: fps))
            guard let pb = renderSlideBuffer(slide, pool: pool) else { fatalError("Slide render failed") }
            let frameCount = Int64((slideDurations[idx] * Double(fps)).rounded())
            var offset: Int64 = 0
            while offset < frameCount {
                while !input.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(5)) }
                adaptor.append(pb, withPresentationTime: CMTime(value: currentFrame + offset, timescale: fps))
                offset += 10
            }
            currentFrame += frameCount
        }
        if let lastSlide = slides.last, let pb = renderSlideBuffer(lastSlide, pool: pool) {
            while !input.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(5)) }
            adaptor.append(pb, withPresentationTime: CMTime(value: currentFrame, timescale: fps))
        }
        input.markAsFinished()
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            writer.finishWriting { cont.resume() }
        }
        guard writer.status == .completed else { fatalError("Writer failed: \(String(describing: writer.error))") }

        if FileManager.default.fileExists(atPath: outPath) {
            try FileManager.default.removeItem(at: finalURL)
        }
        let composition = AVMutableComposition()
        guard let compV = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let compA = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            fatalError("Failed to create composition tracks")
        }
        let vAsset = AVURLAsset(url: silentURL)
        let vTracks = try await vAsset.loadTracks(withMediaType: .video)
        guard let vTrack = vTracks.first else { fatalError("No video track") }
        let vRange = try await vTrack.load(.timeRange)
        try compV.insertTimeRange(vRange, of: vTrack, at: .zero)

        for (idx, aURL) in audioURLs.enumerated() {
            let aAsset = AVURLAsset(url: aURL)
            let aTracks = try await aAsset.loadTracks(withMediaType: .audio)
            if let aTrack = aTracks.first {
                let aRange = try await aTrack.load(.timeRange)
                try compA.insertTimeRange(aRange, of: aTrack, at: slideStarts[idx])
            }
        }

        guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            fatalError("Failed to create AVAssetExportSession")
        }
        exporter.outputURL = finalURL
        exporter.outputFileType = .mp4
        exporter.shouldOptimizeForNetworkUse = true
        try await exporter.export(to: finalURL, as: .mp4)

        let outAsset = AVURLAsset(url: finalURL)
        let outDur = try await outAsset.load(.duration)
        let outV = try await outAsset.loadTracks(withMediaType: .video)
        let outA = try await outAsset.loadTracks(withMediaType: .audio)
        let outSize = try await outV.first?.load(.naturalSize) ?? .zero
        let attrs = try FileManager.default.attributesOfItem(atPath: outPath)
        let bytes = (attrs[.size] as? NSNumber)?.int64Value ?? 0
        print(String(format: "[OK] %@ | duration=%.2fs | %.0fx%.0f | videoTracks=%d | audioTracks=%d | bytes=%lld",
                     outPath, CMTimeGetSeconds(outDur), outSize.width, outSize.height, outV.count, outA.count, bytes))
    } catch {
        fputs("ERROR: \(error)\n", stderr)
        exit(1)
    }
    sem.signal()
}
sem.wait()
