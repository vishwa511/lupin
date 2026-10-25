// Lupine Fn helper.
//
// Electron cannot observe the Fn (globe) key on its own, so this tiny process watches it with
// a CGEventTap and reports presses to the parent app. It also posts Cmd+V on request so
// dictated text can be pasted into whatever app has focus.
//
// Protocol (newline-delimited JSON on stdout):
//   {"event":"permission","accessibility":true|false}
//   {"event":"ready"}
//   {"event":"fn","down":true|false}
//   {"event":"fn-chord"}            Fn was combined with another key; cancel dictation
//   {"event":"pasted"}
//   {"event":"error","message":"..."}
// Commands (one per line on stdin): "paste". EOF on stdin means the parent exited.

import ApplicationServices
import Foundation

let fnKeyCode: Int64 = 63 // kVK_Function
let vKeyCode: CGKeyCode = 9 // kVK_ANSI_V
let permissionRetrySeconds = 2.0

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else {
        return
    }
    FileHandle.standardOutput.write(data + Data("\n".utf8))
}

final class FnMonitor {
    private var fnDown = false
    private var chorded = false
    var tap: CFMachPort?

    func handle(type: CGEventType, event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            // macOS disables slow taps; turn it straight back on.
            if let tap {
                CGEvent.tapEnable(tap: tap, enable: true)
            }
        case .flagsChanged where event.getIntegerValueField(.keyboardEventKeycode) == fnKeyCode:
            let isDown = event.flags.contains(.maskSecondaryFn)
            guard isDown != fnDown else {
                return
            }
            fnDown = isDown
            if isDown {
                chorded = false
            }
            emit(["event": "fn", "down": isDown])
        case .keyDown where fnDown && !chorded:
            chorded = true
            emit(["event": "fn-chord"])
        default:
            break
        }
    }
}

let monitor = FnMonitor()

func installTap() -> Bool {
    let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
    let callback: CGEventTapCallBack = { _, type, event, refcon in
        if let refcon {
            Unmanaged<FnMonitor>.fromOpaque(refcon).takeUnretainedValue().handle(type: type, event: event)
        }
        return Unmanaged.passUnretained(event)
    }
    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: CGEventMask(mask),
        callback: callback,
        userInfo: Unmanaged.passUnretained(monitor).toOpaque()
    ) else {
        return false
    }
    monitor.tap = tap
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    return true
}

func paste() {
    let source = CGEventSource(stateID: .combinedSessionState)
    for keyDown in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: keyDown)
        event?.flags = .maskCommand
        event?.post(tap: .cghidEventTap)
    }
    emit(["event": "pasted"])
}

func waitForPermissionThenInstall() {
    // Prompting registers the process in System Settings > Privacy & Security > Accessibility.
    // LUPINE_AX_PROMPT=0 skips the prompt (used by the integration tests).
    let shouldPrompt = ProcessInfo.processInfo.environment["LUPINE_AX_PROMPT"] != "0"
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: shouldPrompt] as CFDictionary
    let trusted = AXIsProcessTrustedWithOptions(options)
    emit(["event": "permission", "accessibility": trusted])
    if trusted && installTap() {
        emit(["event": "ready"])
        return
    }
    if trusted {
        emit(["event": "error", "message": "Could not create the keyboard event tap"])
    }
    Timer.scheduledTimer(withTimeInterval: permissionRetrySeconds, repeats: true) { timer in
        guard AXIsProcessTrusted() else {
            return
        }
        timer.invalidate()
        emit(["event": "permission", "accessibility": true])
        if installTap() {
            emit(["event": "ready"])
        } else {
            emit(["event": "error", "message": "Could not create the keyboard event tap"])
        }
    }
}

func listenForCommands() {
    Thread.detachNewThread {
        while let line = readLine() {
            let command = line.trimmingCharacters(in: .whitespaces)
            DispatchQueue.main.async {
                switch command {
                case "paste": paste()
                case "": break
                default: emit(["event": "error", "message": "Unknown command: \(command)"])
                }
            }
        }
        exit(0)
    }
}

setvbuf(stdout, nil, _IOLBF, 0)
listenForCommands()
waitForPermissionThenInstall()
CFRunLoopRun()
