import AppKit
import Carbon
import Foundation

final class GlobalShortcutService {
    private static weak var activeService: GlobalShortcutService?

    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?
    private var onTrigger: (() -> Void)?

    deinit {
        unregister()
    }

    func register(shortcut: String, onTrigger: @escaping () -> Void) -> (registered: Bool, error: String) {
        unregister()

        let normalized = ShortcutUtilities.normalizeGlobalShortcut(shortcut)
        let validationError = ShortcutUtilities.validateGlobalShortcut(normalized)
        if !validationError.isEmpty {
            return (false, validationError)
        }
        guard !normalized.isEmpty else {
            return (false, "")
        }
        guard let parsed = Self.parse(shortcut: normalized) else {
            return (false, "Shortcut key is not supported by the native registrar yet.")
        }

        self.onTrigger = onTrigger
        Self.activeService = self

        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))
        let handlerStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, _ in
                GlobalShortcutService.activeService?.onTrigger?()
                return noErr
            },
            1,
            &eventType,
            nil,
            &eventHandlerRef
        )
        guard handlerStatus == noErr else {
            return (false, "Shortcut event handler could not be installed.")
        }

        let hotKeyId = EventHotKeyID(signature: Self.fourCharCode("LDGE"), id: 1)
        let status = RegisterEventHotKey(
            UInt32(parsed.keyCode),
            parsed.modifiers,
            hotKeyId,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )

        if status != noErr {
            unregister()
            return (false, "Shortcut could not be registered. It may already be in use.")
        }

        return (true, "")
    }

    func unregister() {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        if let eventHandlerRef {
            RemoveEventHandler(eventHandlerRef)
            self.eventHandlerRef = nil
        }
        if Self.activeService === self {
            Self.activeService = nil
        }
        onTrigger = nil
    }

    private static func parse(shortcut: String) -> (keyCode: Int, modifiers: UInt32)? {
        var modifiers: UInt32 = 0
        var keyCode: Int?

        for rawToken in shortcut.split(separator: "+").map(String.init) {
            switch rawToken.lowercased() {
            case "command", "cmd", "commandorcontrol", "cmdorctrl":
                modifiers |= UInt32(cmdKey)
            case "control", "ctrl":
                modifiers |= UInt32(controlKey)
            case "shift":
                modifiers |= UInt32(shiftKey)
            case "option", "alt":
                modifiers |= UInt32(optionKey)
            default:
                keyCode = keyCodeForToken(rawToken)
            }
        }

        guard let keyCode else { return nil }
        return (keyCode, modifiers)
    }

    private static func keyCodeForToken(_ token: String) -> Int? {
        switch token.uppercased() {
        case "A": return kVK_ANSI_A
        case "B": return kVK_ANSI_B
        case "C": return kVK_ANSI_C
        case "D": return kVK_ANSI_D
        case "E": return kVK_ANSI_E
        case "F": return kVK_ANSI_F
        case "G": return kVK_ANSI_G
        case "H": return kVK_ANSI_H
        case "I": return kVK_ANSI_I
        case "J": return kVK_ANSI_J
        case "K": return kVK_ANSI_K
        case "L": return kVK_ANSI_L
        case "M": return kVK_ANSI_M
        case "N": return kVK_ANSI_N
        case "O": return kVK_ANSI_O
        case "P": return kVK_ANSI_P
        case "Q": return kVK_ANSI_Q
        case "R": return kVK_ANSI_R
        case "S": return kVK_ANSI_S
        case "T": return kVK_ANSI_T
        case "U": return kVK_ANSI_U
        case "V": return kVK_ANSI_V
        case "W": return kVK_ANSI_W
        case "X": return kVK_ANSI_X
        case "Y": return kVK_ANSI_Y
        case "Z": return kVK_ANSI_Z
        case "0": return kVK_ANSI_0
        case "1": return kVK_ANSI_1
        case "2": return kVK_ANSI_2
        case "3": return kVK_ANSI_3
        case "4": return kVK_ANSI_4
        case "5": return kVK_ANSI_5
        case "6": return kVK_ANSI_6
        case "7": return kVK_ANSI_7
        case "8": return kVK_ANSI_8
        case "9": return kVK_ANSI_9
        case "SPACE": return kVK_Space
        case "RETURN", "ENTER": return kVK_Return
        case "TAB": return kVK_Tab
        case "ESCAPE": return kVK_Escape
        case "DELETE", "BACKSPACE": return kVK_Delete
        case "LEFT": return kVK_LeftArrow
        case "RIGHT": return kVK_RightArrow
        case "UP": return kVK_UpArrow
        case "DOWN": return kVK_DownArrow
        default:
            if token.uppercased().hasPrefix("F"), let number = Int(token.dropFirst()), (1...20).contains(number) {
                return kVK_F1 + number - 1
            }
            return nil
        }
    }

    private static func fourCharCode(_ string: String) -> OSType {
        string.utf8.reduce(0) { ($0 << 8) + OSType($1) }
    }
}
