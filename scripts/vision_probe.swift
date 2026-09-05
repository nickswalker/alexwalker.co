// Build-time image analysis via Apple's Vision framework.
//
// Reads newline-separated absolute image paths on stdin, writes one JSON
// object per line to stdout:
//
//   {"path":"…","w":1600,"h":670,
//    "faces":[{"x":0.31,"y":0.22,"w":0.09,"h":0.19}],      // normalised, y from TOP
//    "saliency":{"x":…,"y":…,"w":…,"h":…},                  // attention bbox, y from TOP
//    "salientObjects":[…]}
//
// Why Vision and not a Python library: it ships with macOS (no install, no
// model download), VNDetectFaceRectanglesRequest is the same detector Photos
// uses, and VNGenerateAttentionBasedSaliencyImageRequest gives a real
// "where does a human look" map rather than an edge-energy proxy. Both run
// on the Neural Engine, so ~200 stills analyse in seconds.
//
// Vision's coordinate space is normalised with the ORIGIN AT BOTTOM-LEFT.
// Everything emitted here is flipped to origin-at-top-left so the Python
// cropper can work in ordinary image coordinates.

import Foundation
import Vision
import AppKit

struct Box: Codable { let x: Double, y: Double, w: Double, h: Double }
struct Result: Codable {
    let path: String
    let w: Int
    let h: Int
    let faces: [Box]
    let saliency: Box?
    let salientObjects: [Box]
    let error: String?
}

/// Vision rect (origin bottom-left) -> top-left origin.
func flip(_ r: CGRect) -> Box {
    Box(x: Double(r.origin.x),
        y: Double(1.0 - r.origin.y - r.size.height),
        w: Double(r.size.width),
        h: Double(r.size.height))
}

func analyse(_ path: String) -> Result {
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return Result(path: path, w: 0, h: 0, faces: [], saliency: nil,
                      salientObjects: [], error: "unreadable")
    }

    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    let faceReq = VNDetectFaceRectanglesRequest()
    let attnReq = VNGenerateAttentionBasedSaliencyImageRequest()
    let objReq  = VNGenerateObjectnessBasedSaliencyImageRequest()

    var faces: [Box] = []
    var saliency: Box? = nil
    var objects: [Box] = []
    var err: String? = nil

    do {
        try handler.perform([faceReq, attnReq, objReq])

        if let obs = faceReq.results {
            faces = obs.map { flip($0.boundingBox) }
        }
        // Attention saliency returns ONE observation whose salientObjects
        // carry the attention bounding boxes. Union them: a two-shot with a
        // face on each side must not crop to just one side.
        if let obs = attnReq.results?.first, let sal = obs.salientObjects, !sal.isEmpty {
            var u = sal[0].boundingBox
            for s in sal.dropFirst() { u = u.union(s.boundingBox) }
            saliency = flip(u)
        }
        if let obs = objReq.results?.first, let sal = obs.salientObjects {
            objects = sal.map { flip($0.boundingBox) }
        }
    } catch {
        err = "\(error)"
    }

    return Result(path: path, w: cg.width, h: cg.height, faces: faces,
                  saliency: saliency, salientObjects: objects, error: err)
}

let encoder = JSONEncoder()
while let line = readLine(strippingNewline: true) {
    let p = line.trimmingCharacters(in: .whitespaces)
    if p.isEmpty { continue }
    if let data = try? encoder.encode(analyse(p)),
       let s = String(data: data, encoding: .utf8) {
        print(s)
        fflush(stdout)
    }
}
