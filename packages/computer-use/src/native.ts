// The native side of computer use that runs as scripts, the same for every
// product: the Windows helper and the Linux accessibility script. They answer
// the requests the macOS helper does (macos/Native.swift): apps, tree, act,
// open and, on Windows, input. multidesktop's bridge includes this file as text, so
// each script is a String.raw without backticks or a dollar sign before a
// brace.

// Mouse and keyboard input as steps, with keys named as the guest names them
// ("cmd", "enter", "a"): in global display points on macOS, physical pixels
// on Windows.
export type InputStep =
  | { type: "move"; x: number; y: number }
  | {
      type: "button";
      button: "left" | "right" | "middle";
      down: boolean;
      clicks: number;
    }
  | { type: "key"; key: string; down: boolean }
  | { type: "text"; text: string }
  // Lines up (positive) or down, and columns left (positive) or right.
  | { type: "scroll"; columns: number; lines: number };

// Windows' helper: a PowerShell script that compiles the C# in it once and
// then answers JSON lines, sending input through SendInput and reading
// applications' elements through UI Automation. Coordinates are physical screen pixels, the process
// being DPI aware. PowerShell reads a piped script line by line, which breaks
// the here-string holding the C#, so it runs from a file.
export const windowsHelper = String.raw`$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$names = 'UIAutomationClient', 'UIAutomationTypes', 'WindowsBase', 'System.Web.Extensions'
Add-Type -AssemblyName $names
$references = [AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $names -contains $_.GetName().Name } | ForEach-Object { $_.Location }
Add-Type -ReferencedAssemblies $references -TypeDefinition @'

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation;

public static class ComputerUse {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);

  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 100 };

  public static void Serve() {
    SetProcessDPIAware();
    string line;
    while ((line = Console.In.ReadLine()) != null) {
      object id = null;
      Dictionary<string, object> reply;
      try {
        var request = Json.Deserialize<Dictionary<string, object>>(line);
        id = request["id"];
        reply = Handle(request);
        reply["ok"] = true;
      } catch (Exception error) {
        while (error.InnerException != null) error = error.InnerException;
        reply = new Dictionary<string, object>();
        reply["ok"] = false;
        reply["error"] = error.Message;
      }
      reply["id"] = id;
      Console.Out.WriteLine(Json.Serialize(reply));
      Console.Out.Flush();
    }
  }

  static Dictionary<string, object> Handle(Dictionary<string, object> request) {
    var reply = new Dictionary<string, object>();
    switch ((string)request["type"]) {
      case "input": {
        var steps = ((IEnumerable)request["steps"]).Cast<Dictionary<string, object>>().ToList();
        // Every key is known before any is pressed, so a refused chord leaves
        // no modifier held down.
        foreach (var step in steps) if ((string)step["type"] == "key") VirtualKey((string)step["key"]);
        foreach (var step in steps) Input(step);
        break;
      }
      case "apps":
        reply["apps"] = Apps();
        break;
      case "tree":
        return Tree(Field(request, "app"), Convert.ToInt32(request["limit"]));
      case "act":
        Act((string)request["ref"], (string)request["action"], (string)Field(request, "role"), (string)Field(request, "name"), (string)Field(request, "value"));
        break;
      case "open":
        // The shell's own open, which finds an application by name; no
        // command line parses the target.
        Process.Start(new ProcessStartInfo((string)request["target"]) { UseShellExecute = true });
        break;
      default:
        throw new Exception("Unknown request \"" + request["type"] + "\".");
    }
    return reply;
  }

  static object Field(Dictionary<string, object> values, string name) {
    object value;
    return values.TryGetValue(name, out value) ? value : null;
  }

  // ---- Input ----

  static void Send(INPUT input) {
    if (SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1)
      throw new Exception("Windows refused the input (error " + Marshal.GetLastWin32Error() + "). An elevated window may be in front.");
    Thread.Sleep(10);
  }
  static void Mouse(uint flags, uint data) { var input = new INPUT { type = 0 }; input.u.mi.dwFlags = flags; input.u.mi.mouseData = data; Send(input); }
  static void Keyboard(ushort vk, ushort scan, uint flags) { var input = new INPUT { type = 1 }; input.u.ki.wVk = vk; input.u.ki.wScan = scan; input.u.ki.dwFlags = flags; Send(input); }

  // Keys as the guest names them, by their virtual key codes.
  static readonly Dictionary<string, ushort> Keys = new Dictionary<string, ushort> {
    { "enter", 0x0d }, { "tab", 0x09 }, { "space", 0x20 }, { "backspace", 0x08 }, { "delete", 0x2e },
    { "escape", 0x1b }, { "left", 0x25 }, { "up", 0x26 }, { "right", 0x27 }, { "down", 0x28 },
    { "home", 0x24 }, { "end", 0x23 }, { "pageup", 0x21 }, { "pagedown", 0x22 }, { "shift", 0x10 },
    { "ctrl", 0x11 }, { "alt", 0x12 }, { "cmd", 0x5b }, { ";", 0xba }, { "=", 0xbb }, { ",", 0xbc },
    { "-", 0xbd }, { ".", 0xbe }, { "/", 0xbf }, { "\u0060", 0xc0 }, { "[", 0xdb }, { "\\", 0xdc },
    { "]", 0xdd }, { "'", 0xde },
  };

  static ushort VirtualKey(string key) {
    if (key.Length == 1 && char.IsLetterOrDigit(key[0]) && key[0] < 128) return (ushort)char.ToUpperInvariant(key[0]);
    int f;
    if (key.Length > 1 && key[0] == 'f' && int.TryParse(key.Substring(1), out f) && f >= 1 && f <= 12) return (ushort)(0x6f + f);
    ushort code;
    if (Keys.TryGetValue(key, out code)) return code;
    throw new Exception("Unknown key \"" + key + "\".");
  }

  static void Input(Dictionary<string, object> step) {
    switch ((string)step["type"]) {
      case "move":
        SetCursorPos(Convert.ToInt32(step["x"]), Convert.ToInt32(step["y"]));
        Thread.Sleep(20);
        break;
      case "button": {
        var down = (bool)step["down"];
        var button = (string)step["button"];
        Mouse(button == "right" ? (down ? 0x0008u : 0x0010u) : button == "middle" ? (down ? 0x0020u : 0x0040u) : (down ? 0x0002u : 0x0004u), 0);
        break;
      }
      case "key":
        Keyboard(VirtualKey((string)step["key"]), 0, (bool)step["down"] ? 0u : 0x0002u);
        break;
      case "text":
        foreach (char c in (string)step["text"]) { Keyboard(0, c, 0x0004); Keyboard(0, c, 0x0004 | 0x0002); }
        break;
      case "scroll": {
        var lines = Convert.ToInt32(step["lines"]);
        var columns = Convert.ToInt32(Field(step, "columns") ?? 0);
        if (lines != 0) Mouse(0x0800, unchecked((uint)(lines * 120)));
        if (columns != 0) Mouse(0x1000, unchecked((uint)(-columns * 120)));
        break;
      }
    }
  }

  // ---- UI Automation ----

  static readonly CacheRequest Cache = MakeCache();
  static CacheRequest MakeCache() {
    var cache = new CacheRequest();
    foreach (var property in new AutomationProperty[] {
      AutomationElement.ControlTypeProperty, AutomationElement.NameProperty,
      AutomationElement.BoundingRectangleProperty, AutomationElement.IsEnabledProperty,
      AutomationElement.HasKeyboardFocusProperty, AutomationElement.HelpTextProperty,
      AutomationElement.ProcessIdProperty, AutomationElement.NativeWindowHandleProperty,
      AutomationElement.RuntimeIdProperty, AutomationElement.IsPasswordProperty,
      ValuePattern.ValueProperty, ValuePattern.IsReadOnlyProperty, TogglePattern.ToggleStateProperty,
      RangeValuePattern.IsReadOnlyProperty, AutomationElement.IsExpandCollapsePatternAvailableProperty,
      AutomationElement.IsWindowPatternAvailableProperty,
    }) cache.Add(property);
    return cache;
  }

  static object Cached(AutomationElement element, AutomationProperty property) {
    var value = element.GetCachedPropertyValue(property, true);
    return value == AutomationElement.NotSupported ? null : value;
  }

  static int ForegroundPid() {
    int pid;
    GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    return pid;
  }

  static string ProcessName(int pid) {
    try {
      var process = Process.GetProcessById(pid);
      try {
        var description = process.MainModule.FileVersionInfo.FileDescription;
        if (!string.IsNullOrEmpty(description)) return description;
      } catch { }
      return process.ProcessName;
    } catch { return ""; }
  }

  static List<AutomationElement> TopWindows(Condition condition) {
    List<AutomationElement> windows;
    using (Cache.Activate())
      windows = AutomationElement.RootElement.FindAll(TreeScope.Children, condition).Cast<AutomationElement>().ToList();
    var foreground = GetForegroundWindow().ToInt64();
    return windows.OrderBy(window => Convert.ToInt64(Cached(window, AutomationElement.NativeWindowHandleProperty) ?? 0) == foreground ? 0 : 1).ToList();
  }

  static Dictionary<string, object> Frame(AutomationElement element) {
    var frame = new Dictionary<string, object>();
    var value = Cached(element, AutomationElement.BoundingRectangleProperty);
    var rect = value is Rect ? (Rect)value : Rect.Empty;
    frame["x"] = rect.IsEmpty ? 0 : rect.X;
    frame["y"] = rect.IsEmpty ? 0 : rect.Y;
    frame["width"] = rect.IsEmpty ? 0 : rect.Width;
    frame["height"] = rect.IsEmpty ? 0 : rect.Height;
    return frame;
  }

  static List<object> Apps() {
    var foreground = ForegroundPid();
    var apps = new Dictionary<int, Dictionary<string, object>>();
    foreach (var window in TopWindows(Condition.TrueCondition)) {
      var pid = Convert.ToInt32(Cached(window, AutomationElement.ProcessIdProperty));
      Dictionary<string, object> app;
      if (!apps.TryGetValue(pid, out app)) {
        app = new Dictionary<string, object>();
        app["name"] = ProcessName(pid);
        app["pid"] = pid;
        app["frontmost"] = pid == foreground;
        app["windows"] = new List<object>();
        apps[pid] = app;
      }
      var entry = Frame(window);
      entry["title"] = (string)Cached(window, AutomationElement.NameProperty) ?? "";
      ((List<object>)app["windows"]).Add(entry);
    }
    return apps.Values.Cast<object>().ToList();
  }

  static int Pid(object app) {
    if (app == null) return ForegroundPid();
    if (!(app is string)) return Convert.ToInt32(app);
    var wanted = ((string)app).ToLowerInvariant();
    var apps = Apps().Cast<Dictionary<string, object>>().ToList();
    Func<Dictionary<string, object>, string> name = a => ((string)a["name"]).ToLowerInvariant();
    var match = apps.FirstOrDefault(a => name(a) == wanted)
      ?? apps.FirstOrDefault(a => { try { return Process.GetProcessById((int)a["pid"]).ProcessName.ToLowerInvariant() == wanted; } catch { return false; } })
      ?? apps.FirstOrDefault(a => name(a).Contains(wanted))
      ?? apps.FirstOrDefault(a => ((List<object>)a["windows"]).Cast<Dictionary<string, object>>().Any(w => ((string)w["title"]).ToLowerInvariant().Contains(wanted)));
    if (match == null) {
      var running = string.Join(", ", apps.Select(a => (string)a["name"]).Where(n => n != "").Distinct());
      throw new Exception("No application named " + app + " is running. Running: " + (running == "" ? "none" : running) + ".");
    }
    return (int)match["pid"];
  }

  // The roles agents query by (@wrkrsh/computer-use). A
  // document is a text area when its text can be edited, as Notepad's is,
  // and a web page or reader's otherwise.
  static string Role(AutomationElement element, bool cached) {
    var type = (ControlType)(cached ? Cached(element, AutomationElement.ControlTypeProperty) : element.Current.ControlType);
    var name = type.ProgrammaticName.Replace("ControlType.", "").ToLowerInvariant();
    if (name == "document") {
      var readOnly = cached ? Cached(element, ValuePattern.IsReadOnlyProperty) : element.GetCurrentPropertyValue(ValuePattern.IsReadOnlyProperty, true);
      return Equals(readOnly, false) ? "textarea" : "document";
    }
    switch (name) {
      case "edit": return "textfield";
      case "hyperlink": return "link";
      case "radiobutton": return "radio";
      case "progressbar": return "progress";
      case "spinner": return "slider";
      case "tab": return "tablist";
      case "tabitem": return "tab";
      case "datagrid": return "table";
      case "dataitem": return "row";
      case "splitbutton": return "button";
      case "appbar": return "toolbar";
      default: return name;
    }
  }

  static string Clip(string text) {
    return text == null ? "" : text.Length > 500 ? text.Substring(0, 500) + "…" : text;
  }

  static Dictionary<string, object> Tree(object app, int limit) {
    var pid = Pid(app);
    var elements = new List<object>();
    var truncated = false;
    var walker = TreeWalker.ControlViewWalker;
    Action<AutomationElement, int> walk = null;
    walk = (element, depth) => {
      if (elements.Count >= limit) { truncated = true; return; }
      var entry = Frame(element);
      entry["ref"] = pid + "/" + string.Join(".", (int[])Cached(element, AutomationElement.RuntimeIdProperty));
      entry["stable"] = true;
      entry["depth"] = depth;
      entry["role"] = Role(element, true);
      entry["name"] = Clip((string)Cached(element, AutomationElement.NameProperty));
      var help = (string)Cached(element, AutomationElement.HelpTextProperty);
      if (!string.IsNullOrEmpty(help)) entry["description"] = Clip(help);
      var sensitive = Equals(Cached(element, AutomationElement.IsPasswordProperty), true);
      if (sensitive) entry["sensitive"] = true;
      var value = sensitive ? null : Cached(element, ValuePattern.ValueProperty) as string;
      if (!string.IsNullOrEmpty(value)) entry["value"] = Clip(value);
      var toggle = Cached(element, TogglePattern.ToggleStateProperty);
      if (toggle is ToggleState) entry["checked"] = (ToggleState)toggle == ToggleState.On;
      if (Equals(Cached(element, AutomationElement.IsEnabledProperty), false)) entry["enabled"] = false;
      if (Equals(Cached(element, AutomationElement.HasKeyboardFocusProperty), true)) entry["focused"] = true;
      if (Equals(Cached(element, ValuePattern.IsReadOnlyProperty), false) || Equals(Cached(element, RangeValuePattern.IsReadOnlyProperty), false)) entry["settable"] = true;
      var actions = new List<object>();
      if (Equals(Cached(element, AutomationElement.IsExpandCollapsePatternAvailableProperty), true)) { actions.Add("expand"); actions.Add("collapse"); }
      if (Equals(Cached(element, AutomationElement.IsWindowPatternAvailableProperty), true)) actions.Add("close");
      if (actions.Count > 0) entry["actions"] = actions;
      elements.Add(entry);
      if (depth >= 40) return;
      var child = walker.GetFirstChild(element, Cache);
      while (child != null && !truncated) {
        walk(child, depth + 1);
        child = walker.GetNextSibling(child, Cache);
      }
    };
    foreach (var window in TopWindows(new PropertyCondition(AutomationElement.ProcessIdProperty, pid))) {
      walk(window, 0);
      if (truncated) break;
    }
    var named = new Dictionary<string, object>();
    named["name"] = ProcessName(pid);
    named["pid"] = pid;
    var reply = new Dictionary<string, object>();
    reply["app"] = named;
    reply["elements"] = elements;
    reply["truncated"] = truncated;
    return reply;
  }

  static AutomationElement Resolve(string reference) {
    var slash = reference.IndexOf('/');
    int pid;
    if (slash < 0 || !int.TryParse(reference.Substring(0, slash), out pid)) throw new Exception(reference + " is not an element ref.");
    var ids = reference.Substring(slash + 1).Split('.').Select(int.Parse).ToArray();
    var condition = new PropertyCondition(AutomationElement.RuntimeIdProperty, ids);
    foreach (var window in TopWindows(new PropertyCondition(AutomationElement.ProcessIdProperty, pid))) {
      if (window.GetRuntimeId().SequenceEqual(ids)) return window;
      var found = window.FindFirst(TreeScope.Descendants, condition);
      if (found != null) return found;
    }
    throw new Exception("The element " + reference + " is gone; find it again.");
  }

  // Invoking a button that opens a modal dialog does not return until the
  // dialog closes; the press happened all the same.
  static void Briefly(Action action) {
    Exception failure = null;
    var thread = new Thread(() => { try { action(); } catch (Exception error) { failure = error; } });
    thread.IsBackground = true;
    thread.Start();
    if (thread.Join(3000) && failure != null) throw failure;
  }

  static void Act(string reference, string action, string role, string name, string value) {
    var element = Resolve(reference);
    var type = element.Current.ControlType;
    var found = Role(element, false);
    if (role != null && role != found)
      throw new Exception("The element " + reference + " is now a " + found + ", not a " + role + "; find it again.");
    var current = Clip(element.Current.Name);
    if (!string.IsNullOrEmpty(name) && name != current)
      throw new Exception("The element " + reference + " is now " + found + " \"" + current + "\", not \"" + name + "\"; find it again.");
    object pattern;
    switch (action) {
      case "press":
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) { var invoke = (InvokePattern)pattern; Briefly(() => invoke.Invoke()); }
        else if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) ((TogglePattern)pattern).Toggle();
        else if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) ((SelectionItemPattern)pattern).Select();
        else if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) {
          var expand = (ExpandCollapsePattern)pattern;
          if (expand.Current.ExpandCollapseState == ExpandCollapseState.Expanded) expand.Collapse(); else expand.Expand();
        }
        else throw new Exception("The " + found + " " + reference + " cannot be pressed; click() it instead.");
        break;
      case "focus":
        if (type == ControlType.Window && element.Current.NativeWindowHandle != 0)
          SetForegroundWindow(new IntPtr(element.Current.NativeWindowHandle));
        element.SetFocus();
        break;
      case "setValue":
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) ((ValuePattern)pattern).SetValue(value ?? "");
        else if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern))
          ((RangeValuePattern)pattern).SetValue(double.Parse(value ?? "", System.Globalization.CultureInfo.InvariantCulture));
        else throw new Exception("The " + found + " " + reference + " does not take a value; focus() or click() it and type().");
        break;
      case "expand":
      case "collapse": {
        if (!element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
          throw new Exception("The " + found + " " + reference + " cannot " + action + ".");
        var expandable = (ExpandCollapsePattern)pattern;
        Briefly(() => { if (action == "expand") expandable.Expand(); else expandable.Collapse(); });
        break;
      }
      case "close":
        if (!element.TryGetCurrentPattern(WindowPattern.Pattern, out pattern))
          throw new Exception("The " + found + " " + reference + " cannot close.");
        ((WindowPattern)pattern).Close();
        break;
      default:
        throw new Exception("Unknown element action \"" + action + "\".");
    }
  }
}
'@
[ComputerUse]::Serve()
`;

// X's names for keys as the guest names them, for xdotool.
const xKeysyms: Record<string, string> = {
  cmd: "super",
  ctrl: "ctrl",
  alt: "alt",
  shift: "shift",
  fn: "super",
  enter: "Return",
  tab: "Tab",
  space: "space",
  backspace: "BackSpace",
  delete: "Delete",
  escape: "Escape",
  home: "Home",
  end: "End",
  pageup: "Prior",
  pagedown: "Next",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  "-": "minus",
  "=": "equal",
  ",": "comma",
  ".": "period",
  "/": "slash",
  ";": "semicolon",
  "'": "apostrophe",
  "[": "bracketleft",
  "]": "bracketright",
  "\\": "backslash",
  "`": "grave",
  "!": "exclam",
  "+": "plus",
};
export const xKeysym = (key: string) => {
  if (xKeysyms[key]) return xKeysyms[key];
  if (/^f([1-9]|1[0-2])$/.test(key)) return key.toUpperCase();
  if (/^[a-z0-9]$/.test(key)) return key;
  throw new Error(`Unknown key "${key}".`);
};

// Linux's applications as AT-SPI, the accessibility bus, sees them: a Python
// program run for each request, given it as JSON in its argument or on
// stdin. An element's ref is "<pid>/<path>", the child indices from its
// application down; acting on one checks its role and name first. Frames are
// screen pixels. Applications started before accessibility was switched on
// (linuxAccessibilitySetup) do not show their elements.
export const linuxAccessibility = String.raw`
import json, os, subprocess, sys, warnings

warnings.filterwarnings("ignore")

def sh(*args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return ""

def process_name(pid):
    try:
        with open("/proc/%d/comm" % pid) as comm:
            return comm.read().strip()
    except OSError:
        return ""

def x_front_pid():
    window = sh("xdotool", "getactivewindow").strip()
    pid = sh("xdotool", "getwindowpid", window).strip() if window else ""
    return int(pid) if pid.isdigit() else None

# Applications' showing windows as AT-SPI sees them, and the pid of the one
# whose window is active: what X cannot see on Wayland.
def atspi_windows():
    try:
        Atspi = atspi()
    except Exception:
        return {}, None
    desktop = Atspi.get_desktop(0)
    found, front = {}, None
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        if app is None:
            continue
        pid = app.get_process_id()
        for child in range(app.get_child_count()):
            window = app.get_child_at_index(child)
            if window is None or not window.get_state_set().contains(Atspi.StateType.SHOWING):
                continue
            if window.get_state_set().contains(Atspi.StateType.ACTIVE):
                front = pid
            extents = window.get_extents(Atspi.CoordType.SCREEN)
            entry = found.setdefault(pid, {"name": app.get_name() or process_name(pid), "pid": pid, "frontmost": False, "windows": []})
            entry["windows"].append({"title": window.get_name() or "", "x": extents.x, "y": extents.y, "width": extents.width, "height": extents.height})
    return found, front

def front_pid():
    return x_front_pid() or atspi_windows()[1]

def apps():
    front = x_front_pid()
    found = {}
    for window in sh("xdotool", "search", "--onlyvisible", "--name", ".").split():
        pid = sh("xdotool", "getwindowpid", window).strip()
        if not pid.isdigit():
            continue
        geometry = dict(line.split("=", 1) for line in sh("xdotool", "getwindowgeometry", "--shell", window).split() if "=" in line)
        width, height = int(geometry.get("WIDTH", 0)), int(geometry.get("HEIGHT", 0))
        if width < 2 or height < 2:
            continue
        app = found.setdefault(int(pid), {"name": process_name(int(pid)), "pid": int(pid), "frontmost": int(pid) == front, "windows": []})
        app["windows"].append({"title": sh("xdotool", "getwindowname", window).strip(), "x": int(geometry.get("X", 0)), "y": int(geometry.get("Y", 0)), "width": width, "height": height})
    # Native Wayland applications, which xdotool cannot see.
    more, active = atspi_windows()
    for pid, app in more.items():
        found.setdefault(pid, app)
    for app in found.values():
        app["frontmost"] = app["pid"] == (front or active)
    return {"apps": list(found.values())}

# A URL or file with its default application, or an application by name.
def open_target(request):
    target = request["target"]
    named = ":" not in target and not target.startswith("/")
    try:
        ran = subprocess.run(["gtk-launch", target] if named else ["xdg-open", target], capture_output=True, text=True, timeout=15)
    except subprocess.TimeoutExpired:
        return {}
    if ran.returncode != 0:
        raise Exception("Could not open %s: %s" % (target, ran.stderr.strip()))
    return {}

def atspi():
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi
    return Atspi

ROLES = {
    "frame": "window", "window": "window", "dialog": "dialog", "alert": "dialog", "file chooser": "dialog",
    "menu bar": "menubar", "menu": "menu", "menu item": "menuitem", "check menu item": "menuitem",
    "radio menu item": "menuitem", "tool bar": "toolbar", "push button": "button", "toggle button": "button",
    "button": "button", "check box": "checkbox", "radio button": "radio", "switch": "switch",
    "text": "textfield", "entry": "textfield", "password text": "textfield", "combo box": "combobox",
    "slider": "slider", "spin button": "slider", "page tab": "tab", "page tab list": "tablist",
    "list": "list", "list box": "list", "list item": "listitem", "table": "table", "tree table": "table",
    "table row": "row", "table cell": "cell", "tree": "tree", "tree item": "treeitem", "link": "link",
    "image": "image", "icon": "image", "label": "text", "static": "text", "heading": "heading",
    "panel": "group", "filler": "group", "section": "group", "grouping": "group", "scroll pane": "scrollarea",
    "document web": "webarea", "document frame": "webarea", "progress bar": "progress", "application": "application",
}

def role_of(Atspi, node):
    name = node.get_role_name() or "unknown"
    role = ROLES.get(name, name.replace(" ", ""))
    if role == "textfield" and node.get_state_set().contains(Atspi.StateType.MULTI_LINE):
        return "textarea"
    return role

def find_app(Atspi, target):
    desktop = Atspi.get_desktop(0)
    candidates = [desktop.get_child_at_index(i) for i in range(desktop.get_child_count())]
    candidates = [app for app in candidates if app is not None and app.get_child_count() > 0]
    if target is None:
        front = front_pid()
        for app in candidates:
            if app.get_process_id() == front:
                return app
        raise Exception("The application in front does not show its elements (it may have opened before accessibility was set up; reopen it).")
    if isinstance(target, int):
        for app in candidates:
            if app.get_process_id() == target:
                return app
        raise Exception("No application with pid %d shows its elements." % target)
    wanted = target.lower()
    named = lambda app: [(app.get_name() or "").lower(), process_name(app.get_process_id()).lower()]
    for test in (lambda names: wanted in names, lambda names: any(wanted in name for name in names)):
        for app in candidates:
            if test(named(app)):
                return app
    showing = sorted({app.get_name() for app in candidates if app.get_name()})
    raise Exception("No application named %s shows its elements (one opened before accessibility was set up must be reopened). Showing: %s." % (target, ", ".join(showing) or "none"))

# Actions press stands for, or that nearly every element offers.
ORDINARY = ("click", "press", "activate", "toggle", "jump", "open", "showmenu", "show menu")

def action_names(Atspi, node):
    doer = node.get_action_iface()
    return doer, ([Atspi.Action.get_action_name(doer, i) for i in range(Atspi.Action.get_n_actions(doer))] if doer else [])

def clip(text):
    return text if len(text) <= 500 else text[:500] + "…"

def describe(Atspi, node, ref, depth):
    role = role_of(Atspi, node)
    extents = node.get_extents(Atspi.CoordType.SCREEN)
    states = node.get_state_set()
    entry = {"ref": ref, "depth": depth, "role": role, "name": clip(node.get_name() or ""),
             "x": extents.x, "y": extents.y, "width": extents.width, "height": extents.height}
    description = node.get_description() or ""
    if description and description != entry["name"]:
        entry["description"] = clip(description)
    secret = node.get_role_name() == "password text"
    if secret:
        entry["sensitive"] = True
    text = None if secret else node.get_text_iface()
    if text is not None and role in ("textfield", "textarea", "combobox", "text", "cell"):
        value = Atspi.Text.get_text(text, 0, min(Atspi.Text.get_character_count(text), 2000)) or ""
        if role in ("text", "cell") and not entry["name"]:
            entry["name"] = clip(value)
        elif value and value != entry["name"]:
            entry["value"] = clip(value)
    numeric = node.get_value_iface() if role in ("slider", "progress", "scrollbar") else None
    if numeric is not None:
        entry["value"] = "%g" % Atspi.Value.get_current_value(numeric)
    if role in ("checkbox", "radio", "switch", "menuitem", "button") and states.contains(Atspi.StateType.CHECKABLE):
        entry["checked"] = states.contains(Atspi.StateType.CHECKED)
    if not states.contains(Atspi.StateType.SENSITIVE):
        entry["enabled"] = False
    if states.contains(Atspi.StateType.FOCUSED):
        entry["focused"] = True
    if (role in ("textfield", "textarea", "combobox") and states.contains(Atspi.StateType.EDITABLE) and node.get_editable_text_iface() is not None) \
            or (role == "slider" and node.get_value_iface() is not None):
        entry["settable"] = True
    actions = [name for name in action_names(Atspi, node)[1] if name and name not in ORDINARY]
    if actions:
        entry["actions"] = actions
    return entry

def tree(request):
    Atspi = atspi()
    app = find_app(Atspi, request.get("app"))
    pid = app.get_process_id()
    limit = request.get("limit", 2000)
    menus = request.get("menus", False)
    elements = []
    state = {"truncated": False}
    def walk(node, path, depth):
        if len(elements) >= limit:
            state["truncated"] = True
            return
        # Hidden parts (closed menus, other tabs) are left out, the menu
        # bar's only when asked for.
        role = role_of(Atspi, node)
        showing = node.get_state_set().contains(Atspi.StateType.SHOWING)
        menu = role in ("menubar", "menu", "menuitem")
        if (not showing and not (menus and menu)) or (role == "menubar" and not menus):
            return
        elements.append(describe(Atspi, node, "%d/%s" % (pid, path), depth))
        if depth >= 40:
            return
        for index in range(node.get_child_count()):
            child = node.get_child_at_index(index)
            if child is not None:
                walk(child, "%s.%d" % (path, index), depth + 1)
    for index in range(app.get_child_count()):
        child = app.get_child_at_index(index)
        if child is not None:
            walk(child, str(index), 0)
    return {"app": {"name": app.get_name() or process_name(pid), "pid": pid}, "elements": elements, "truncated": state["truncated"]}

def resolve(Atspi, ref):
    pid, _, path = ref.partition("/")
    if not pid.isdigit() or not path:
        raise Exception("%s is not an element ref." % ref)
    node = find_app(Atspi, int(pid))
    for step in path.split("."):
        index = int(step)
        if index >= node.get_child_count():
            raise Exception("The element %s is gone; find it again." % ref)
        node = node.get_child_at_index(index)
    return node

def act(request):
    Atspi = atspi()
    ref, action = request["ref"], request["action"]
    node = resolve(Atspi, ref)
    found = role_of(Atspi, node)
    if request.get("role") and request["role"] != found:
        raise Exception("The element %s is now a %s, not a %s; find it again." % (ref, found, request["role"]))
    # A list that changed puts another row at the same place.
    current = describe(Atspi, node, ref, 0)["name"]
    if request.get("name") and request["name"] != current:
        raise Exception('The element %s is now %s "%s", not "%s"; find it again.' % (ref, found, current, request["name"]))
    doer, names = action_names(Atspi, node)
    if action == "press":
        for wanted in ("click", "press", "activate", "toggle", "jump", "open"):
            if wanted in names:
                Atspi.Action.do_action(doer, names.index(wanted))
                return {}
        if names:
            Atspi.Action.do_action(doer, 0)
            return {}
        parent = node.get_parent()
        chooser = parent.get_selection_iface() if parent else None
        if chooser is not None:
            Atspi.Selection.select_child(chooser, node.get_index_in_parent())
            return {}
        raise Exception("The %s %s cannot be pressed; click() it instead." % (found, ref))
    if action == "focus":
        if found in ("window", "dialog"):
            sh("xdotool", "search", "--onlyvisible", "--pid", ref.split("/")[0], "windowactivate")
        component = node.get_component_iface()
        if component is not None:
            Atspi.Component.grab_focus(component)
        return {}
    if action == "setValue":
        editable = node.get_editable_text_iface()
        if editable is not None:
            if not Atspi.EditableText.set_text_contents(editable, request.get("value") or ""):
                raise Exception("The desktop control did not accept the value.")
            return {}
        numeric = node.get_value_iface()
        if numeric is not None:
            Atspi.Value.set_current_value(numeric, float(request.get("value") or 0))
            return {}
        raise Exception("The %s %s does not take a value; focus() or click() it and type()." % (found, ref))
    if action in names:
        Atspi.Action.do_action(doer, names.index(action))
        return {}
    offered = [name for name in names if name and name not in ORDINARY]
    raise Exception("The %s %s cannot %s%s." % (found, ref, action, "; it can " + ", ".join(offered) if offered else ""))

# Commands run outside the desktop session; AT-SPI is found through its bus.
def join_session():
    if os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
        return
    for pid in sh("pgrep", "-u", os.environ.get("SUDO_USER", str(os.getuid())), "xfce4-session").split():
        try:
            with open("/proc/%s/environ" % pid, "rb") as environ:
                for entry in environ.read().split(b"\0"):
                    if entry.startswith(b"DBUS_SESSION_BUS_ADDRESS="):
                        os.environ["DBUS_SESSION_BUS_ADDRESS"] = entry.split(b"=", 1)[1].decode()
                        return
        except OSError:
            pass

def main():
    request = json.load(sys.stdin) if len(sys.argv) == 1 else json.loads(sys.argv[1])
    # Private form requests are read from root-only files before joining
    # the desktop as its user; AT-SPI's registry is per user, not root's.
    if os.getuid() == 0 and os.environ.get("SUDO_USER"):
        import pwd
        user = pwd.getpwnam(os.environ["SUDO_USER"])
        sys.stdin.close()
        os.setgroups([])
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)
        os.environ["HOME"] = user.pw_dir
    join_session()
    handlers = {"apps": lambda _: apps(), "tree": tree, "act": act, "open": open_target}
    try:
        answer = handlers[request["type"]](request)
        answer["ok"] = True
    except Exception as error:
        answer = {"ok": False, "error": str(error)}
    print(json.dumps(answer))

main()
`;

// Run once on a machine before its applications start: AT-SPI's libraries and
// bus, and accessibility switched on for the toolkits that check for it.
export const linuxAccessibilitySetup = String.raw`
set -e
test -f /tmp/computer-use-accessibility-ready && exit 0
if ! python3 -c 'import gi; gi.require_version("Atspi", "2.0")' 2>/dev/null; then
  # An install cut off earlier leaves dpkg to finish first.
  sudo DEBIAN_FRONTEND=noninteractive dpkg --configure -a >/dev/null 2>&1 || true
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends python3-gi gir1.2-atspi-2.0 at-spi2-core >/dev/null 2>&1 \
    || { sudo apt-get update -q >/dev/null 2>&1 && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends python3-gi gir1.2-atspi-2.0 at-spi2-core >/dev/null; }
fi
session=$(pgrep -u "$(id -u)" -n xfce4-session || true)
if [ -n "$session" ]; then
  export $(tr '\0' '\n' < /proc/$session/environ | grep '^DBUS_SESSION_BUS_ADDRESS=')
fi
gsettings set org.gnome.desktop.interface toolkit-accessibility true 2>/dev/null || true
dbus-send --session --print-reply --dest=org.a11y.Bus /org/a11y/bus org.freedesktop.DBus.Properties.Set string:org.a11y.Status string:IsEnabled variant:boolean:true >/dev/null 2>&1 || true
touch /tmp/computer-use-accessibility-ready
`;
