import AppKit
import ApplicationServices

// The window number behind a window's element: private, and how window
// managers have long told windows apart.
@_silgen_name("_AXUIElementGetWindow")
private func axWindowNumber(_ element: AXUIElement, _ number: UnsafeMutablePointer<CGWindowID>)
  -> AXError

// Applications as the accessibility API sees them: their windows, the tree of
// elements inside, and pressing, focusing, filling or otherwise acting on an
// element without the mouse. The Accessibility permission that posts input
// also covers this.
//
// An element is named by a ref, "<pid>/<path>": the path walks from one of
// the app's windows (by its window number, "w4512") or its menu bar ("m")
// through child indices ("w4512.0.3"). It stays valid while the window's
// interface keeps its shape; acting on one checks it still has the role and
// name it was found with. Frames are global display points; hosts map them
// into screenshot pixels.
enum Accessibility {
  private static let messagingTimeout: Float = 1.5
  private static let maxDepth = 40
  private static let unnamed: Set = ["row", "treeitem", "cell", "listitem", "button", "menuitem", "tab"]
  // The roles whose value setValue may change.
  private static let editable: Set = ["textfield", "textarea", "combobox", "slider"]
  // Actions press stands for, or that nearly every element or scroll area
  // offers; perform() still does them.
  private static let ordinary: Set = [
    kAXPressAction, kAXPickAction, kAXShowMenuAction, "AXScrollToVisible", "AXShowDefaultUI", "AXShowAlternateUI",
    "AXScrollLeftByPage", "AXScrollRightByPage", "AXScrollUpByPage", "AXScrollDownByPage",
  ]

  static func apps() -> [[String: Any]] {
    let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
    return NSWorkspace.shared.runningApplications
      .filter { $0.activationPolicy == .regular }
      .map { app in
        let root = application(app.processIdentifier)
        let windows = (copy(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []
        return [
          "frontmost": app.processIdentifier == frontmost,
          "name": app.localizedName ?? "",
          "pid": app.processIdentifier,
          "windows": windows.map { window in
            var entry = frame(window)
            entry["title"] = (copy(window, kAXTitleAttribute) as? String) ?? ""
            return entry
          },
        ]
      }
  }

  // The tree of an app (by pid, by name, or the frontmost), walked depth
  // first: the focused window, its other windows, then its menu bar.
  static func tree(app: Target?, menus: Bool, limit: Int) throws -> [String: Any] {
    let running = try find(app)
    let pid = running.processIdentifier
    let root = application(pid)
    var elements: [[String: Any]] = []
    var truncated = false

    func walk(_ element: AXUIElement, path: String, depth: Int) {
      guard elements.count < limit else {
        truncated = true
        return
      }
      let values = attributes(element)
      var entry = describe(values)
      entry["ref"] = "\(pid)/\(path)"
      entry["depth"] = depth
      // A window's number, and the menu bar, name them wherever they are.
      if depth == 0 { entry["stable"] = true }
      if editable.contains(entry["role"] as? String ?? ""), settable(element, kAXValueAttribute) {
        entry["settable"] = true
      }
      let actions = extra(actionNames(element))
      if !actions.isEmpty { entry["actions"] = actions }
      let index = elements.count
      elements.append(entry)
      // Rows, cells and items without a name of their own take their
      // first text's, as they read on screen.
      defer {
        if (entry["name"] as? String)?.isEmpty == true, unnamed.contains(entry["role"] as? String ?? ""),
          let text = elements[(index + 1)...].first(where: {
            $0["role"] as? String == "text" && !(($0["name"] as? String) ?? "").isEmpty
          })
        {
          elements[index]["name"] = text["name"]
        }
      }
      guard depth < maxDepth else { return }
      let children = values[kAXChildrenAttribute] as? [AXUIElement] ?? []
      // Long lists, tables and outlines are walked by their visible rows,
      // keeping each row's index among all the children.
      let visible =
        (copy(element, kAXVisibleRowsAttribute) as? [AXUIElement])
        ?? (copy(element, kAXVisibleChildrenAttribute) as? [AXUIElement])
      if let visible, children.count > 50 {
        for child in visible {
          guard let index = children.firstIndex(where: { CFEqual($0, child) }) else { continue }
          walk(child, path: "\(path).\(index)", depth: depth + 1)
        }
      } else {
        for (index, child) in children.enumerated() {
          walk(child, path: "\(path).\(index)", depth: depth + 1)
        }
      }
    }

    let windows = (copy(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    let focused = copy(root, kAXFocusedWindowAttribute).flatMap { focused in
      windows.firstIndex { CFEqual($0, focused) }
    }
    for index in [focused].compactMap({ $0 }) + windows.indices.filter({ $0 != focused }) {
      guard let number = windowNumber(windows[index]) else { continue }
      walk(windows[index], path: "w\(number)", depth: 0)
    }
    if menus, let bar = copy(root, kAXMenuBarAttribute) {
      walk(bar as! AXUIElement, path: "m", depth: 0)
    }
    return [
      "app": ["name": running.localizedName ?? "", "pid": pid],
      "elements": elements,
      "truncated": truncated,
    ]
  }

  static func act(ref: String, action: String, role: String?, name: String?, value: String?) throws
  {
    let element = try resolve(ref)
    let values = attributes(element)
    let described = describe(values)
    let found = described["role"] as? String ?? ""
    if let role, role != found {
      throw Failure("The element \(ref) is now a \(found), not a \(role); find it again.")
    }
    if let name, !name.isEmpty {
      var current = described["name"] as? String ?? ""
      if current.isEmpty, unnamed.contains(found) { current = firstText(element) ?? "" }
      if current != name {
        throw Failure("The element \(ref) is now \(found) \"\(current)\", not \"\(name)\"; find it again.")
      }
    }
    let rawRole = values[kAXRoleAttribute] as? String ?? ""
    switch action {
    case "press":
      let actions = actionNames(element)
      if actions.contains(kAXPressAction) {
        try check(AXUIElementPerformAction(element, kAXPressAction as CFString), "press \(ref)")
      } else if actions.contains(kAXPickAction) {
        try check(AXUIElementPerformAction(element, kAXPickAction as CFString), "press \(ref)")
      } else if settable(element, kAXSelectedAttribute) {
        try check(
          AXUIElementSetAttributeValue(element, kAXSelectedAttribute as CFString, kCFBooleanTrue),
          "select \(ref)")
      } else {
        let offered = actions.isEmpty ? "nothing" : actions.joined(separator: ", ")
        throw Failure("The \(found) \(ref) cannot be pressed (it offers \(offered)); click() it instead.")
      }
    case "focus":
      if rawRole == kAXWindowRole {
        _ = AXUIElementPerformAction(element, kAXRaiseAction as CFString)
        _ = AXUIElementSetAttributeValue(element, kAXMainAttribute as CFString, kCFBooleanTrue)
        if let pid = pid(of: ref) { NSRunningApplication(processIdentifier: pid)?.activate() }
      } else {
        try check(
          AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue),
          "focus \(ref)")
      }
    case "setValue":
      guard settable(element, kAXValueAttribute) else {
        throw Failure("The \(found) \(ref) does not take a value; focus() or click() it and type().")
      }
      try check(
        AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, (value ?? "") as CFString),
        "set the value of \(ref)")
    default:
      let actions = actionNames(element)
      guard let named = actions.first(where: { $0.hasPrefix("AX") && actionName($0) == action }) else {
        let offered = extra(actions)
        throw Failure(
          "The \(found) \(ref) cannot \(action)"
            + (offered.isEmpty ? "." : "; it can \(offered.joined(separator: ", ")).")
        )
      }
      try check(AXUIElementPerformAction(element, named as CFString), "\(action) \(ref)")
    }
  }

  enum Target {
    case pid(pid_t)
    case name(String)
  }

  // ---- Resolving ----

  private static func application(_ pid: pid_t) -> AXUIElement {
    let element = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(element, messagingTimeout)
    return element
  }

  private static func find(_ target: Target?) throws -> NSRunningApplication {
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    switch target {
    case nil:
      guard let app = NSWorkspace.shared.frontmostApplication else {
        throw Failure("No application is in front.")
      }
      return app
    case let .pid(pid):
      guard let app = NSRunningApplication(processIdentifier: pid) else {
        throw Failure("No application with pid \(pid) is running.")
      }
      return app
    case let .name(name):
      let wanted = name.lowercased()
      let named = { (app: NSRunningApplication) in app.localizedName?.lowercased() ?? "" }
      if let app = apps.first(where: { named($0) == wanted })
        ?? apps.first(where: { $0.bundleIdentifier?.lowercased() == wanted })
        ?? apps.first(where: { named($0).contains(wanted) })
      {
        return app
      }
      let running = apps.compactMap(\.localizedName).joined(separator: ", ")
      throw Failure("No application named \(name) is running. Running: \(running).")
    }
  }

  private static func pid(of ref: String) -> pid_t? {
    ref.split(separator: "/", maxSplits: 1).first.flatMap { pid_t($0) }
  }

  private static func resolve(_ ref: String) throws -> AXUIElement {
    let parts = ref.split(separator: "/", maxSplits: 1).map(String.init)
    guard parts.count == 2, let pid = pid_t(parts[0]) else { throw Failure("\(ref) is not an element ref.") }
    let root = application(pid)
    var steps = parts[1].split(separator: ".").map(String.init)
    guard !steps.isEmpty else { throw Failure("\(ref) is not an element ref.") }
    let head = steps.removeFirst()
    var element: AXUIElement
    if head == "m" {
      guard let bar = copy(root, kAXMenuBarAttribute) else { throw gone(ref) }
      element = bar as! AXUIElement
    } else if head.hasPrefix("w"), let number = CGWindowID(head.dropFirst()) {
      let windows = (copy(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []
      guard let window = windows.first(where: { windowNumber($0) == number }) else { throw gone(ref) }
      element = window
    } else {
      throw Failure("\(ref) is not an element ref.")
    }
    for step in steps {
      let children = (copy(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
      guard let index = Int(step), children.indices.contains(index) else { throw gone(ref) }
      element = children[index]
    }
    return element
  }

  private static func windowNumber(_ window: AXUIElement) -> CGWindowID? {
    var number: CGWindowID = 0
    return axWindowNumber(window, &number) == .success && number != 0 ? number : nil
  }

  // The first text inside an element, which names a row or cell that has no
  // name of its own; the tree walk finds it among what it collected.
  private static func firstText(_ element: AXUIElement, depth: Int = 0) -> String? {
    guard depth < 6 else { return nil }
    for child in (copy(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).prefix(20) {
      let described = describe(attributes(child))
      if described["role"] as? String == "text", let name = described["name"] as? String, !name.isEmpty {
        return name
      }
      if let name = firstText(child, depth: depth + 1) { return name }
    }
    return nil
  }

  private static func gone(_ ref: String) -> Failure {
    Failure("The element \(ref) is gone; find it again.")
  }

  // ---- Reading ----

  private static let read = [
    kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute,
    kAXValueAttribute, kAXPositionAttribute, kAXSizeAttribute, kAXEnabledAttribute,
    kAXFocusedAttribute, kAXChildrenAttribute, kAXPlaceholderValueAttribute,
  ]

  private static func attributes(_ element: AXUIElement) -> [String: Any] {
    AXUIElementSetMessagingTimeout(element, messagingTimeout)
    var values: CFArray?
    guard
      AXUIElementCopyMultipleAttributeValues(element, read as CFArray, [], &values) == .success,
      let list = values as? [Any]
    else { return [:] }
    var result: [String: Any] = [:]
    for (name, value) in zip(read, list) {
      // Attributes an element lacks come back as AXValue errors.
      if CFGetTypeID(value as CFTypeRef) == AXValueGetTypeID(),
        AXValueGetType(value as! AXValue) == .axError
      {
        continue
      }
      result[name] = value
    }
    return result
  }

  private static func describe(_ values: [String: Any]) -> [String: Any] {
    let raw = values[kAXRoleAttribute] as? String ?? "AXUnknown"
    let subrole = values[kAXSubroleAttribute] as? String
    let role = normalized(raw, subrole: subrole)
    var entry: [String: Any] = ["role": role]
    var name = (values[kAXTitleAttribute] as? String) ?? ""
    let description = (values[kAXDescriptionAttribute] as? String) ?? ""
    if name.isEmpty { name = description } else if !description.isEmpty, description != name {
      entry["description"] = clip(description)
    }
    let sensitive = subrole == "AXSecureTextField"
    if sensitive { entry["sensitive"] = true }
    switch sensitive ? nil : values[kAXValueAttribute] {
    case let text as String:
      if role == "text" && name.isEmpty { name = text } else if !text.isEmpty { entry["value"] = clip(text) }
    case let number as NSNumber:
      if ["checkbox", "radio", "switch", "tab"].contains(role) {
        entry["checked"] = number.intValue != 0
      } else {
        entry["value"] = number.stringValue
      }
    default:
      break
    }
    if name.isEmpty, let placeholder = values[kAXPlaceholderValueAttribute] as? String {
      name = placeholder
    }
    entry["name"] = clip(name)
    if (values[kAXEnabledAttribute] as? Bool) == false { entry["enabled"] = false }
    if (values[kAXFocusedAttribute] as? Bool) == true { entry["focused"] = true }
    entry.merge(frame(values)) { $1 }
    return entry
  }

  private static func frame(_ window: AXUIElement) -> [String: Any] {
    var values: [String: Any] = [:]
    values[kAXPositionAttribute] = copy(window, kAXPositionAttribute)
    values[kAXSizeAttribute] = copy(window, kAXSizeAttribute)
    return frame(values)
  }

  private static func frame(_ values: [String: Any]) -> [String: Any] {
    var origin = CGPoint.zero
    var size = CGSize.zero
    if let position = values[kAXPositionAttribute], CFGetTypeID(position as CFTypeRef) == AXValueGetTypeID() {
      AXValueGetValue(position as! AXValue, .cgPoint, &origin)
    }
    if let extent = values[kAXSizeAttribute], CFGetTypeID(extent as CFTypeRef) == AXValueGetTypeID() {
      AXValueGetValue(extent as! AXValue, .cgSize, &size)
    }
    return ["height": size.height, "width": size.width, "x": origin.x, "y": origin.y]
  }

  private static func clip(_ text: String) -> String {
    text.count > 500 ? String(text.prefix(500)) + "…" : text
  }

  // The roles agents query by (@wrkrsh/computer-use).
  private static func normalized(_ role: String, subrole: String?) -> String {
    switch (role, subrole ?? "") {
    case (kAXWindowRole, "AXDialog"), (kAXWindowRole, "AXSystemDialog"), ("AXSheet", _): "dialog"
    case (kAXCheckBoxRole, "AXSwitch"): "switch"
    case (kAXRadioButtonRole, "AXTabButton"): "tab"
    case (kAXApplicationRole, _): "application"
    case (kAXWindowRole, _): "window"
    case (kAXMenuBarRole, _): "menubar"
    case (kAXMenuRole, _): "menu"
    case (kAXMenuItemRole, _), (kAXMenuBarItemRole, _): "menuitem"
    case (kAXToolbarRole, _): "toolbar"
    case (kAXButtonRole, _), (kAXMenuButtonRole, _), ("AXDisclosureTriangle", _): "button"
    case (kAXPopUpButtonRole, _), (kAXComboBoxRole, _): "combobox"
    case (kAXCheckBoxRole, _): "checkbox"
    case (kAXRadioButtonRole, _): "radio"
    case (kAXTextFieldRole, _): "textfield"
    case (kAXTextAreaRole, _): "textarea"
    case (kAXSliderRole, _), (kAXIncrementorRole, _): "slider"
    case (kAXTabGroupRole, _): "tablist"
    case (kAXListRole, _): "list"
    case (kAXTableRole, _), (kAXGridRole, _): "table"
    case (kAXOutlineRole, _), (kAXBrowserRole, _): "tree"
    case (kAXRowRole, "AXOutlineRow"): "treeitem"
    case (kAXRowRole, _): "row"
    case (kAXCellRole, _): "cell"
    case ("AXLink", _): "link"
    case (kAXImageRole, _): "image"
    case (kAXStaticTextRole, _): "text"
    case ("AXHeading", _): "heading"
    case (kAXGroupRole, _), (kAXRadioGroupRole, _): "group"
    case (kAXScrollAreaRole, _): "scrollarea"
    case ("AXWebArea", _): "webarea"
    case (kAXProgressIndicatorRole, _), (kAXBusyIndicatorRole, _): "progress"
    default:
      role.hasPrefix("AX") ? String(role.dropFirst(2)).lowercased() : role.lowercased()
    }
  }

  // ---- AX calls ----

  private static func copy(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success
      ? value : nil
  }

  // An action as agents name it: AXRaise is raise.
  private static func actionName(_ action: String) -> String {
    String(action.dropFirst(2)).lowercased()
  }

  // What an element can do besides being pressed, as agents name it. Apps'
  // own actions, named without the AX prefix, describe themselves at length.
  private static func extra(_ actions: [String]) -> [String] {
    actions.filter { $0.hasPrefix("AX") && !ordinary.contains($0) }.map(actionName)
  }

  private static func actionNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    return AXUIElementCopyActionNames(element, &names) == .success ? (names as? [String] ?? []) : []
  }

  private static func settable(_ element: AXUIElement, _ attribute: String) -> Bool {
    var settable = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) == .success
      && settable.boolValue
  }

  private static func check(_ error: AXError, _ what: String) throws {
    switch error {
    case .success: return
    case .invalidUIElement: throw Failure("Could not \(what): the element is gone; find it again.")
    case .cannotComplete: throw Failure("Could not \(what): the application did not answer.")
    default: throw Failure("Could not \(what) (accessibility error \(error.rawValue)).")
    }
  }
}
