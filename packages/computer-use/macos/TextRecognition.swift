import Foundation
import ImageIO
import Vision

// The lines of text in an image, through Vision: each with its frame in the
// image's pixels from the top left, and how sure Vision is of it.
enum TextRecognition {
  static func lines(png: String) throws -> [[String: Any]] {
    guard let data = Data(base64Encoded: png),
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { throw Failure("text takes an image, a base64 PNG.") }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.automaticallyDetectsLanguage = true
    try VNImageRequestHandler(cgImage: image).perform([request])
    let width = Double(image.width)
    let height = Double(image.height)
    return (request.results ?? []).compactMap { observation in
      guard let best = observation.topCandidates(1).first else { return nil }
      // Vision's boxes are fractions of the image from the bottom left.
      let box = observation.boundingBox
      return [
        "text": best.string, "x": box.minX * width, "y": (1 - box.maxY) * height,
        "width": box.width * width, "height": box.height * height, "confidence": Double(best.confidence),
      ]
    }
  }
}
