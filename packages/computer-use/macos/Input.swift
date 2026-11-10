import CoreGraphics
import Foundation

// Mouse and keyboard input as CoreGraphics events. Points are global display
// points, the space hosts map screenshot pixels into; key names arrive as the
// guest names them ("cmd", "enter", "a").
enum Step: Decodable {
  case move(CGPoint)
  case button(Button, down: Bool, clicks: Int64)
  case key(String, down: Bool)
  case text(String)
  // Lines up (positive) or down, and columns left (positive) or right.
  case scroll(lines: Int32, columns: Int32)

  enum Button: String, Decodable {
    case left, right, middle
  }

  private enum Keys: String, CodingKey {
    case type, x, y, button, down, clicks, key, text, lines, columns
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: Keys.self)
    switch try values.decode(String.self, forKey: .type) {
    case "move":
      self = .move(
        CGPoint(x: try values.decode(Double.self, forKey: .x), y: try values.decode(Double.self, forKey: .y)))
    case "button":
      self = .button(
        try values.decode(Button.self, forKey: .button),
        down: try values.decode(Bool.self, forKey: .down),
        clicks: try values.decode(Int64.self, forKey: .clicks))
    case "key":
      self = .key(try values.decode(String.self, forKey: .key), down: try values.decode(Bool.self, forKey: .down))
    case "text":
      self = .text(try values.decode(String.self, forKey: .text))
    case "scroll":
      self = .scroll(
        lines: try values.decode(Int32.self, forKey: .lines),
        columns: try values.decodeIfPresent(Int32.self, forKey: .columns) ?? 0)
    case let other:
      throw Failure("Unknown input step \"\(other)\".")
    }
  }
}

enum Input {
  // The modifiers and the button held down, across requests, which post one
  // at a time: CoreGraphics takes each event's modifiers from the event, so a
  // Shift held in one request still shifts the next one's click.
  private static let posting = NSLock()
  nonisolated(unsafe) private static var flags: CGEventFlags = []
  nonisolated(unsafe) private static var held: Step.Button?

  static func run(_ steps: [Step]) throws {
    // Every key is known before any is pressed, so a refused chord leaves no
    // modifier held down.
    for case let .key(name, _) in steps where keyCodes[name] == nil {
      throw Failure("Unknown key \"\(name)\".")
    }
    posting.lock()
    defer { posting.unlock() }
    var location = CGEvent(source: nil)?.location ?? .zero
    let post = { (event: CGEvent?) in event?.post(tap: .cghidEventTap) }

    for step in steps {
      switch step {
      case let .move(point):
        location = point
        let event = CGEvent(
          mouseEventSource: nil, mouseType: held.map(dragged) ?? .mouseMoved,
          mouseCursorPosition: point, mouseButton: held.map(cgButton) ?? .left)
        event?.flags = flags
        post(event)
        pause(0.02)
      case let .button(button, down, clicks):
        let event = CGEvent(
          mouseEventSource: nil, mouseType: down ? pressed(button) : released(button),
          mouseCursorPosition: location, mouseButton: cgButton(button))
        event?.setIntegerValueField(.mouseEventClickState, value: clicks)
        event?.flags = flags
        post(event)
        held = down ? button : nil
        pause(0.03)
      case let .key(name, down):
        let code = keyCodes[name]!
        if let flag = modifierFlags[name] {
          if down { flags.insert(flag) } else { flags.remove(flag) }
        }
        let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
        event?.flags = flags
        post(event)
        pause(0.01)
      case let .text(text):
        // One event per character, carrying the character itself, so any
        // keyboard layout types it and emoji survive.
        for character in text {
          let units = Array(String(character).utf16)
          for down in [true, false] {
            let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
            event?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            post(event)
          }
          pause(0.004)
        }
      case let .scroll(lines, columns):
        post(
          CGEvent(
            scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: lines,
            wheel2: columns, wheel3: 0))
        pause(0.02)
      }
    }
  }

  private static func pause(_ seconds: Double) {
    Thread.sleep(forTimeInterval: seconds)
  }

  private static func cgButton(_ button: Step.Button) -> CGMouseButton {
    switch button {
    case .left: .left
    case .right: .right
    case .middle: .center
    }
  }

  private static func pressed(_ button: Step.Button) -> CGEventType {
    switch button {
    case .left: .leftMouseDown
    case .right: .rightMouseDown
    case .middle: .otherMouseDown
    }
  }

  private static func released(_ button: Step.Button) -> CGEventType {
    switch button {
    case .left: .leftMouseUp
    case .right: .rightMouseUp
    case .middle: .otherMouseUp
    }
  }

  private static func dragged(_ button: Step.Button) -> CGEventType {
    switch button {
    case .left: .leftMouseDragged
    case .right: .rightMouseDragged
    case .middle: .otherMouseDragged
    }
  }

  private static let modifierFlags: [String: CGEventFlags] = [
    "alt": .maskAlternate, "cmd": .maskCommand, "ctrl": .maskControl, "fn": .maskSecondaryFn,
    "shift": .maskShift,
  ]

  // Virtual key codes of the ANSI layout.
  private static let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11,
    "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21,
    "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31,
    "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42,
    ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50, "enter": 36, "tab": 48, "space": 49,
    "backspace": 51, "escape": 53, "delete": 117, "home": 115, "end": 119, "pageup": 116,
    "pagedown": 121, "left": 123, "right": 124, "down": 125, "up": 126, "f1": 122, "f2": 120,
    "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109,
    "f11": 103, "f12": 111, "cmd": 55, "shift": 56, "alt": 58, "ctrl": 59, "fn": 63,
  ]
}
