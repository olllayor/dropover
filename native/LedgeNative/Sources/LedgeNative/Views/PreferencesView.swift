import SwiftUI

struct PreferencesView: View {
    @ObservedObject var model: LedgeAppModel
    @State private var excludedText = ""
    @State private var excludedError = ""
    @State private var shortcutDraft = ""

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Divider()
            settingsStage
        }
        .onAppear {
            excludedText = model.state.preferences.excludedBundleIds.joined(separator: "\n")
            shortcutDraft = model.state.preferences.globalShortcut
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Settings")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .padding(.bottom, 8)

            ForEach(["Shelf Activation", "Shelf Interaction", "General", "Cloud Sharing", "Custom Actions", "Instant Actions", "Folder Monitoring", "Ledge Pro"], id: \.self) { item in
                HStack {
                    Image(systemName: icon(for: item))
                    Text(item)
                    Spacer()
                }
                .font(.callout)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(item == "General" ? Color.accentColor.opacity(0.18) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                .foregroundStyle(item == "General" ? .primary : .secondary)
            }

            Spacer()
            HStack {
                Image(systemName: "tray.full.fill")
                Text("Ledge 0.1.9-native")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(width: 220)
        .padding(18)
        .background(.bar)
    }

    private var settingsStage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("General")
                    .font(.largeTitle.weight(.semibold))

                settingsGroup {
                    SettingsRow(title: "Show in menu bar", trailing: Toggle("", isOn: .constant(true)).disabled(true))
                    SettingsRow(title: "Menu bar icon", trailing: Text("Traditional").foregroundStyle(.secondary))
                }

                settingsGroup {
                    SettingsRow(
                        title: "Launch at login",
                        trailing: Toggle("", isOn: Binding(
                            get: { model.state.preferences.launchAtLogin },
                            set: { value in model.setPreferences { $0.launchAtLogin = value } }
                        ))
                    )
                    SettingsRow(title: "Show in Dock", trailing: Toggle("", isOn: .constant(false)).disabled(true))
                }

                settingsGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Shelf activation")
                            .font(.headline)
                        Text("Configure the shortcut and shake gesture used to reveal the floating shelf.")
                            .font(.callout)
                            .foregroundStyle(.secondary)

                        TextField("Global shortcut", text: $shortcutDraft)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { saveShortcut() }
                            .onChange(of: shortcutDraft) { _ in }
                        Text(model.state.permissionStatus.shortcutError.isEmpty ? shortcutStatus : model.state.permissionStatus.shortcutError)
                            .font(.caption)
                            .foregroundColor(model.state.permissionStatus.shortcutError.isEmpty ? .secondary : .red)

                        SettingsRow(
                            title: "Shake gesture",
                            copy: "Reveal the shelf with a cursor shake while dragging.",
                            trailing: Toggle("", isOn: Binding(
                                get: { model.state.preferences.shakeEnabled },
                                set: { value in model.setPreferences { $0.shakeEnabled = value } }
                            ))
                        )

                        Picker("Shake sensitivity", selection: Binding(
                            get: { model.state.preferences.shakeSensitivity },
                            set: { value in model.setPreferences { $0.shakeSensitivity = value } }
                        )) {
                            Text("Gentle").tag(ShakeSensitivity.gentle)
                            Text("Balanced").tag(ShakeSensitivity.balanced)
                            Text("Firm").tag(ShakeSensitivity.firm)
                        }
                        .pickerStyle(.segmented)

                        Text("Excluded apps")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        TextEditor(text: $excludedText)
                            .font(.body.monospaced())
                            .frame(minHeight: 84)
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.18)))
                        HStack {
                            Text("One macOS bundle identifier per line.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button("Save Exclusions") { saveExcludedApps() }
                        }
                        if !excludedError.isEmpty {
                            Text(excludedError)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                }

                settingsGroup {
                    SettingsRow(
                        title: "Native helper",
                        copy: "Running in-process in the Swift app.",
                        trailing: StatusPill(text: "Online", isGood: true)
                    )
                    SettingsRow(
                        title: "Accessibility",
                        copy: model.state.permissionStatus.accessibilityTrusted ? "Granted for shake detection." : "Required if you want shake-to-open.",
                        trailing: Button("Open Settings...") { model.openPermissionSettings() }
                    )
                    Text("Shake status: \(model.state.preferences.shakeEnabled ? (model.state.permissionStatus.shakeReady ? "ready" : "blocked") : "disabled")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                settingsGroup {
                    SettingsRow(title: "Application data", trailing: Button("Manage...") {}.disabled(true))
                    SettingsRow(title: "Disable online features", trailing: Toggle("", isOn: .constant(false)).disabled(true))
                    SettingsRow(title: "Third party extensions", trailing: Button("Install Raycast Extension") {}.disabled(true))
                }
            }
            .padding(28)
            .frame(maxWidth: 620, alignment: .leading)
        }
    }

    private func settingsGroup<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8))
    }

    private var shortcutStatus: String {
        if model.state.preferences.globalShortcut.isEmpty {
            return "Shortcut disabled"
        }
        return model.state.permissionStatus.shortcutRegistered ? "Shortcut active" : "Shortcut unavailable"
    }

    private func saveShortcut() {
        model.setPreferences { preferences in
            preferences.globalShortcut = shortcutDraft
        }
    }

    private func saveExcludedApps() {
        let result = PreferencesUtilities.normalizeExcludedBundleIds(excludedText.components(separatedBy: .newlines))
        if !result.invalid.isEmpty {
            excludedError = result.invalid.count == 1
                ? "Invalid bundle identifier: \(result.invalid[0])"
                : "Invalid bundle identifiers: \(result.invalid.joined(separator: ", "))"
            return
        }
        excludedError = ""
        excludedText = result.normalized.joined(separator: "\n")
        model.setPreferences { preferences in
            preferences.excludedBundleIds = result.normalized
        }
    }

    private func icon(for item: String) -> String {
        switch item {
        case "Shelf Activation": return "arrow.up.right"
        case "Shelf Interaction": return "sparkles"
        case "General": return "gearshape"
        case "Cloud Sharing": return "icloud"
        case "Custom Actions": return "wrench.adjustable"
        case "Instant Actions": return "bolt"
        case "Folder Monitoring": return "folder"
        default: return "star"
        }
    }
}

private struct SettingsRow<Trailing: View>: View {
    var title: String
    var copy: String?
    var trailing: Trailing

    init(title: String, copy: String? = nil, trailing: Trailing) {
        self.title = title
        self.copy = copy
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                if let copy {
                    Text(copy)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            trailing
        }
    }
}

private struct StatusPill: View {
    var text: String
    var isGood: Bool

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background((isGood ? Color.green : Color.orange).opacity(0.18), in: Capsule())
            .foregroundStyle(isGood ? .green : .orange)
    }
}
