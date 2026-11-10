import Foundation

// The requests a computer-use helper answers, one JSON object per line on
// stdin, each answered by a line on stdout with the same id: {"id", "ok":
// true, ...} or {"id", "ok": false, "error"}. Requests run concurrently;
// callers order their own. The Windows helper and the Linux script in
// @wrkrsh/computer-use/native answer the same.
//
//   apps                         → apps: running apps and their windows
//   tree app? menus limit        → app, elements, truncated: an app's
//                                  accessibility tree (Accessibility.swift)
//   act ref action role? name? value?
//                                → presses, focuses, fills or otherwise acts
//                                  on an element
//   input steps                  → posts the steps (Input.swift)
//   open target                  → opens a URL, a file or an application by
//                                  name
//
// Multiwork Computer Use answers these and more of its own; the helper in
// helper/ answers just these, for the process that starts it.
struct Request: Decodable {
  let id: Int
  let type: String
  let steps: [Step]?
  let app: App?
  let menus: Bool?
  let limit: Int?
  let ref: String?
  let action: String?
  let role: String?
  let name: String?
  let value: String?
  let target: String?

  // An app by pid or by name.
  struct App: Decodable {
    let target: Accessibility.Target

    init(from decoder: Decoder) throws {
      let value = try decoder.singleValueContainer()
      if let pid = try? value.decode(Int32.self) {
        target = .pid(pid)
      } else {
        target = .name(try value.decode(String.self))
      }
    }
  }
}

struct Failure: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

enum Native {
  private struct Envelope: Decodable {
    let id: Int
  }

  private static let output = NSLock()
  private static let running = DispatchGroup()

  // Answers one of the requests above.
  static func answer(_ request: Request) throws -> [String: Any] {
    switch request.type {
    case "input":
      try Input.run(request.steps ?? [])
      return [:]
    case "apps":
      return ["apps": Accessibility.apps()]
    case "tree":
      return try Accessibility.tree(
        app: request.app?.target, menus: request.menus ?? false, limit: request.limit ?? 2_000)
    case "act":
      guard let ref = request.ref, let action = request.action else {
        throw Failure("An element action names its ref and action.")
      }
      try Accessibility.act(
        ref: ref, action: action, role: request.role, name: request.name, value: request.value)
      return [:]
    case "open":
      guard let target = request.target else { throw Failure("open names a URL, a path or an application.") }
      try open(target)
      return [:]
    default:
      throw Failure("Unknown request \"\(request.type)\".")
    }
  }

  // Through open(1), which finds an application by name; arguments, never a
  // shell, carry the target.
  private static func open(_ target: String) throws {
    let named = !target.contains(":") && !target.hasPrefix("/")
    let process = Process()
    let errors = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = named ? ["-a", target] : [target]
    process.standardError = errors
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
      let said = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
      throw Failure("Could not open \(target): \(said.trimmingCharacters(in: .whitespacesAndNewlines))")
    }
  }

  // Reads requests until stdin closes, answering each with `handle`, which is
  // also given the line to read fields of its own from; then calls `done`
  // once the last is answered, so input is never cut off midway.
  static func serve(
    _ handle: @escaping @Sendable (Request, Data) async throws -> [String: Any],
    done: @escaping @Sendable () -> Void
  ) {
    Thread.detachNewThread {
      while let line = readLine() {
        let data = Data(line.utf8)
        do {
          let request = try JSONDecoder().decode(Request.self, from: data)
          running.enter()
          Task.detached {
            do {
              reply(request.id, try await handle(request, data))
            } catch let failure as Failure {
              reply(request.id, error: failure.message)
            } catch {
              reply(request.id, error: error.localizedDescription)
            }
            running.leave()
          }
        } catch {
          // Answered when it at least has an id, so the caller is not left waiting.
          if let envelope = try? JSONDecoder().decode(Envelope.self, from: data) {
            reply(envelope.id, error: (error as? Failure)?.message ?? "Unreadable request: \(error)")
          } else {
            fputs("Could not read a request: \(error)\n", stderr)
          }
        }
      }
      whenIdle(done)
    }
  }

  // Runs `work` on the main queue once no request is running.
  static func whenIdle(_ work: @escaping @Sendable () -> Void) {
    running.notify(queue: .main, execute: work)
  }

  private static func reply(_ id: Int, _ result: [String: Any] = [:], error: String? = nil) {
    var message = result
    message["id"] = id
    message["ok"] = error == nil
    if let error { message["error"] = error }
    guard var data = try? JSONSerialization.data(withJSONObject: message) else { return }
    data.append(0x0A)
    output.lock()
    FileHandle.standardOutput.write(data)
    output.unlock()
  }
}
