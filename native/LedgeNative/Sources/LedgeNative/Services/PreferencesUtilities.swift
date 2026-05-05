import Foundation

enum PreferencesUtilities {
    private static let bundleIdPattern = #"^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$"#

    static func normalizeExcludedBundleIds(_ values: [String]) -> (normalized: [String], invalid: [String]) {
        var normalized: [String] = []
        var invalid: [String] = []
        var seenValid = Set<String>()
        var seenInvalid = Set<String>()

        for rawValue in values {
            let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { continue }

            if value.range(of: bundleIdPattern, options: .regularExpression) == nil {
                if !seenInvalid.contains(value) {
                    invalid.append(value)
                    seenInvalid.insert(value)
                }
                continue
            }

            if seenValid.insert(value).inserted {
                normalized.append(value)
            }
        }

        return (normalized, invalid)
    }
}

enum ShortcutUtilities {
    private static let modifierAliases: [String: String] = [
        "alt": "Alt",
        "altgr": "AltGr",
        "cmd": "Command",
        "command": "Command",
        "commandorcontrol": "CommandOrControl",
        "cmdorctrl": "CommandOrControl",
        "control": "Control",
        "ctrl": "Control",
        "meta": "Super",
        "option": "Option",
        "shift": "Shift",
        "super": "Super"
    ]
    private static let specialKeys: Set<String> = [
        "Backspace", "CapsLock", "Delete", "Down", "End", "Enter", "Escape",
        "Home", "Insert", "Left", "PageDown", "PageUp", "Return", "Right",
        "Space", "Tab", "Up"
    ]

    static func normalizeGlobalShortcut(_ shortcut: String) -> String {
        shortcut
            .split(separator: "+")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "+")
    }

    static func validateGlobalShortcut(_ shortcut: String) -> String {
        let normalized = normalizeGlobalShortcut(shortcut)
        guard !normalized.isEmpty else { return "" }

        let tokens = normalized.split(separator: "+").map(String.init)
        var modifiers = Set<String>()
        var keyToken = ""

        for token in tokens {
            if let modifier = modifierAliases[token.lowercased()] {
                if modifiers.contains(modifier) {
                    return "Shortcut contains duplicate modifier keys."
                }
                modifiers.insert(modifier)
                continue
            }

            if !keyToken.isEmpty {
                return "Shortcut must contain only one non-modifier key."
            }

            if !isValidKeyToken(token) {
                return #"Shortcut key "\#(token)" is not supported."#
            }

            keyToken = normalizeKeyToken(token)
        }

        if keyToken.isEmpty {
            return "Shortcut needs a non-modifier key."
        }

        return ""
    }

    static func urlToWebloc(_ url: String) -> String {
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>URL</key>
          <string>\(escapeXML(url))</string>
        </dict>
        </plist>

        """
    }

    private static func isValidKeyToken(_ token: String) -> Bool {
        isSingleKey(token) || isFunctionKey(token) || specialKeys.contains(normalizeKeyToken(token))
    }

    private static func normalizeKeyToken(_ token: String) -> String {
        if isSingleKey(token) || isFunctionKey(token) {
            return token.uppercased()
        }

        switch token.lowercased() {
        case "backspace": return "Backspace"
        case "capslock": return "CapsLock"
        case "delete": return "Delete"
        case "down": return "Down"
        case "end": return "End"
        case "enter": return "Enter"
        case "escape", "esc": return "Escape"
        case "home": return "Home"
        case "insert": return "Insert"
        case "left": return "Left"
        case "pagedown": return "PageDown"
        case "pageup": return "PageUp"
        case "return": return "Return"
        case "right": return "Right"
        case "space": return "Space"
        case "tab": return "Tab"
        case "up": return "Up"
        default: return token
        }
    }

    private static func isSingleKey(_ token: String) -> Bool {
        token.range(of: #"^[A-Z0-9]$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func isFunctionKey(_ token: String) -> Bool {
        token.range(of: #"^F(?:[1-9]|1\d|2[0-4])$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func escapeXML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }
}
