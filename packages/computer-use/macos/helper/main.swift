import AppKit
import ApplicationServices

// The computer-use helper: the shared requests (Native.swift), for a process
// that holds the Accessibility permission itself and starts this as its
// child, which macOS then holds responsible for it: Multidesktop's bridge,
// ProcessControl Host.

Native.serve({ request, _ in
  guard AXIsProcessTrusted(), request.type != "input" || CGPreflightPostEventAccess() else {
    throw Failure(
      "The app that started the computer-use helper is not allowed Accessibility; allow it in System Settings → Privacy & Security → Accessibility."
    )
  }
  return try Native.answer(request)
}, done: { exit(0) })
// Running applications and their windows update through the main run loop.
RunLoop.main.run()
