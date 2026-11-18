import Foundation
import ImageIO
import Vision

struct Word: Encodable {
    let x: Double
    let y: Double
    let text: String
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      image.width >= 850, image.width <= 3000, image.height <= 12000,
      (3.25...3.8).contains(Double(image.height) / Double(image.width)) else {
    print("{}")
    exit(2)
}

// Reference coordinates of the full brochure template, normalized by image width.
let factor = Double(image.width) / 1080
var result: [String: [Word]] = [:]
for (name, top, height) in [("title", 100, 510), ("claim", 810, 525), ("surrender", 1340, 450)] {
    let region = CGRect(x: 25 * factor, y: Double(top) * factor,
                        width: 1030 * factor, height: Double(height) * factor)
    guard let crop = image.cropping(to: region) else { exit(2) }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    try VNImageRequestHandler(cgImage: crop).perform([request])
    result[name] = (request.results ?? []).compactMap { observation in
        guard let text = observation.topCandidates(1).first?.string else { return nil }
        let box = observation.boundingBox
        return Word(x: 25 + box.midX * 1030, y: Double(top) + (1 - box.midY) * Double(height), text: text)
    }
}
FileHandle.standardOutput.write(try JSONEncoder().encode(result))
