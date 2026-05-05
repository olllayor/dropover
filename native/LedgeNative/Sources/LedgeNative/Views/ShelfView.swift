import SwiftUI
import UniformTypeIdentifiers

struct ShelfView: View {
    @ObservedObject var model: LedgeAppModel
    @State private var isDropTargeted = false
    @State private var showsItemSheet = false
    @State private var isHovering = false

    private var items: [ShelfItemRecord] { model.state.liveShelf?.items ?? [] }
    private var primaryItem: ShelfItemRecord? { items.first }

    var body: some View {
        ZStack(alignment: .top) {
            VisualEffectView(material: .popover, blendingMode: .behindWindow)
                .ignoresSafeArea()

            VStack(spacing: 8) {
                Capsule()
                    .fill(Color.secondary.opacity(0.35))
                    .frame(width: 36, height: 5)
                    .padding(.top, 6)

                HStack {
                    Button {
                        model.closeShelf()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.plain)
                    .frame(width: 28, height: 28)
                    .background(.ultraThinMaterial, in: Circle())

                    Spacer()

                    Menu {
                        shelfMenuItems
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .menuStyle(.borderlessButton)
                    .frame(width: 28, height: 28)
                    .disabled(model.state.liveShelf == nil)
                }

                if showsItemSheet {
                    ItemSheetView(model: model, items: items, onClose: { showsItemSheet = false })
                } else {
                    shelfSurface
                    permissionBanner
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 10)
        }
        .frame(minWidth: 240, idealWidth: 320, minHeight: 296, idealHeight: 380)
        .onDrop(of: DropPayloadReader.supportedTypeIdentifiers, isTargeted: $isDropTargeted) { providers in
            Task {
                let payloads = await DropPayloadReader.payloads(from: providers)
                await MainActor.run {
                    model.addPayloads(payloads)
                }
            }
            return true
        }
    }

    @ViewBuilder
    private var shelfSurface: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14)
                .fill(isDropTargeted ? Color.accentColor.opacity(0.16) : Color.clear)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(isDropTargeted ? Color.accentColor.opacity(0.45) : Color.clear, lineWidth: 1)
                )

            if let primaryItem {
                HeroItemView(
                    model: model,
                    item: primaryItem,
                    items: items,
                    onShowItems: { showsItemSheet = true }
                )
                .onHover { hovering in isHovering = hovering }
            } else {
                Text("Drop files here")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, minHeight: 168)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 168)
    }

    @ViewBuilder
    private var permissionBanner: some View {
        let status = model.state.permissionStatus
        if !status.accessibilityTrusted && model.state.preferences.shakeEnabled {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Accessibility access is off")
                        .font(.caption.weight(.semibold))
                    Text("Enable it if you want shake-to-open.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Open Settings") {
                    model.openPermissionSettings()
                }
                .font(.caption)
            }
            .padding(10)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
        } else if !status.lastError.isEmpty {
            Text(status.lastError)
                .font(.caption)
                .foregroundStyle(.red)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    @ViewBuilder
    private var shelfMenuItems: some View {
        if let first = items.first {
            Button("Quick Look") { _ = model.systemActions.previewItem(first) }
                .disabled(first.fileBackedPath == nil)
            Button("Reveal in Finder") { _ = model.systemActions.revealItem(first) }
                .disabled(first.fileBackedPath == nil)
            Button("Open") { _ = model.systemActions.openItem(first) }
            Button("Copy") { _ = model.systemActions.copyItem(first) }
            Button("Save") { _ = model.systemActions.saveItem(first, defaultDirectory: model.store.exportsURL) }
                .disabled(first.kind != .text && first.kind != .url)
            Divider()
        }
        Button("Share All") { _ = model.systemActions.shareItems(items) }
            .disabled(items.allSatisfy { $0.fileBackedPath == nil })
        Divider()
        Button("Clear Shelf") { model.clearShelf() }
            .disabled(items.isEmpty)
        Button("Close Shelf") { model.closeShelf() }
    }
}

private struct HeroItemView: View {
    @ObservedObject var model: LedgeAppModel
    var item: ShelfItemRecord
    var items: [ShelfItemRecord]
    var onShowItems: () -> Void

    private var exportableItems: [ShelfItemRecord] {
        items.filter { $0.fileBackedPath != nil }
    }

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                if heroMode == .collage {
                    collage
                } else if heroMode == .stack {
                    stack
                } else {
                    artwork(for: item, size: CGSize(width: 88, height: 88))
                }
            }
            .frame(height: heroMode == .collage ? 160 : 112)
            .onDrag {
                model.dragProvider(for: exportableItems)
            }
            .disabled(exportableItems.isEmpty)
            .contextMenu { itemMenu(item) }

            Button {
                if items.count >= 2 { onShowItems() }
            } label: {
                HStack(spacing: 4) {
                    Text(countLabel)
                    if items.count >= 2 {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                    }
                }
                .font(.caption2.weight(.medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(.ultraThinMaterial, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(items.count < 2)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var collage: some View {
        ZStack {
            ForEach(Array(items.prefix(3).enumerated()), id: \.element.id) { index, entry in
                artwork(for: entry, size: CGSize(width: 104, height: 132))
                    .rotationEffect(.degrees(index == 1 ? -8 : index == 2 ? 7 : 0))
                    .offset(x: index == 1 ? -18 : index == 2 ? 18 : 0, y: index == 0 ? 8 : 2)
            }
        }
        .frame(width: 176, height: 160)
    }

    @ViewBuilder
    private var stack: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16).fill(.thinMaterial).frame(width: 88, height: 88).rotationEffect(.degrees(-8)).offset(x: -16)
            RoundedRectangle(cornerRadius: 16).fill(.thinMaterial).frame(width: 88, height: 88).rotationEffect(.degrees(8)).offset(x: 16)
            artwork(for: item, size: CGSize(width: 88, height: 88))
        }
        .frame(width: 124, height: 112)
    }

    private func artwork(for item: ShelfItemRecord, size: CGSize) -> some View {
        ZStack {
            if let path = item.fileBackedPath, item.isPreviewableImage, let image = NSImage(contentsOfFile: path) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: symbolName(for: item))
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: size.width, height: size.height)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: item.isPreviewableImage ? 3 : 14))
        .shadow(color: .black.opacity(0.22), radius: 14, y: 8)
    }

    @ViewBuilder
    private func itemMenu(_ item: ShelfItemRecord) -> some View {
        Button("Quick Look") { _ = model.systemActions.previewItem(item) }
            .disabled(item.fileBackedPath == nil)
        Button("Reveal in Finder") { _ = model.systemActions.revealItem(item) }
            .disabled(item.fileBackedPath == nil)
        Button("Open") { _ = model.systemActions.openItem(item) }
        Button("Copy") { _ = model.systemActions.copyItem(item) }
        Button("Save") { _ = model.systemActions.saveItem(item, defaultDirectory: model.store.exportsURL) }
            .disabled(item.kind != .text && item.kind != .url)
        Divider()
        Button("Remove Item") { model.removeItem(id: item.id) }
    }

    private var heroMode: HeroMode {
        if items.count <= 1 { return .single }
        if items.count <= 3 && items.allSatisfy(\.isPreviewableImage) { return .collage }
        return .stack
    }

    private var countLabel: String {
        switch heroMode {
        case .single:
            return item.isPreviewableImage ? "1 Image" : "1 Item"
        case .collage:
            return "\(items.count) Images"
        case .stack:
            return "\(items.count) Items"
        }
    }

    private func symbolName(for item: ShelfItemRecord) -> String {
        switch item.kind {
        case .folder: return "folder.fill"
        case .url: return "link"
        case .text: return "doc.text.fill"
        case .file, .imageAsset: return "doc.fill"
        }
    }
}

private enum HeroMode {
    case single
    case collage
    case stack
}

private struct ItemSheetView: View {
    @ObservedObject var model: LedgeAppModel
    var items: [ShelfItemRecord]
    var onClose: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Button(action: onClose) {
                    Image(systemName: "chevron.left")
                }
                .buttonStyle(.plain)

                Spacer()
                VStack(spacing: 2) {
                    Text("\(items.count) Files")
                        .font(.headline)
                    Text(items.isEmpty ? "" : "Items in shelf")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "square.grid.2x2")
                    .foregroundStyle(.secondary)
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 10)], spacing: 10) {
                ForEach(items) { item in
                    VStack(spacing: 6) {
                        HeroItemThumbnail(item: item)
                        Text(item.title)
                            .font(.caption)
                            .lineLimit(1)
                        Text(item.preview.summary.isEmpty ? item.subtitle : item.preview.summary)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .padding(6)
                    .contextMenu {
                        Button("Reveal in Finder") { _ = model.systemActions.revealItem(item) }
                            .disabled(item.fileBackedPath == nil)
                        Button("Remove Item") { model.removeItem(id: item.id) }
                    }
                }
            }
        }
        .padding(10)
    }
}

private struct HeroItemThumbnail: View {
    var item: ShelfItemRecord

    var body: some View {
        ZStack {
            if let path = item.fileBackedPath, item.isPreviewableImage, let image = NSImage(contentsOfFile: path) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: item.kind == .folder ? "folder.fill" : "doc.fill")
                    .font(.title2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 60, height: 60)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

struct VisualEffectView: NSViewRepresentable {
    var material: NSVisualEffectView.Material
    var blendingMode: NSVisualEffectView.BlendingMode

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}

enum DropPayloadReader {
    static let supportedTypeIdentifiers = [
        UTType.fileURL.identifier,
        UTType.url.identifier,
        UTType.text.identifier,
        UTType.image.identifier
    ]

    static func payloads(from providers: [NSItemProvider]) async -> [IngestPayload] {
        var payloads: [IngestPayload] = []
        var filePaths: [String] = []

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
               let url = await loadURL(provider: provider, typeIdentifier: UTType.fileURL.identifier) {
                filePaths.append(url.path)
                continue
            }

            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let url = await loadURL(provider: provider, typeIdentifier: UTType.url.identifier),
               url.scheme == "http" || url.scheme == "https" {
                payloads.append(.url(url: url.absoluteString, label: url.host ?? url.absoluteString))
                continue
            }

            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
               let data = await loadData(provider: provider, typeIdentifier: UTType.image.identifier) {
                payloads.append(.image(mimeType: "image/png", base64: data.base64EncodedString(), filenameHint: "drop-image"))
                continue
            }

            if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier),
               let text = await loadString(provider: provider, typeIdentifier: UTType.text.identifier) {
                let service = PayloadService(assetsURL: FileManager.default.temporaryDirectory, bookmarkService: FileBookmarkService())
                payloads.append(service.detectPayload(fromText: text))
            }
        }

        if !filePaths.isEmpty {
            payloads.insert(.fileDrop(paths: Array(Set(filePaths))), at: 0)
        }

        return payloads
    }

    private static func loadURL(provider: NSItemProvider, typeIdentifier: String) async -> URL? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
                if let url = item as? URL {
                    continuation.resume(returning: url)
                } else if let data = item as? Data,
                          let string = String(data: data, encoding: .utf8) {
                    continuation.resume(returning: URL(string: string.trimmingCharacters(in: .whitespacesAndNewlines)))
                } else if let string = item as? String {
                    continuation.resume(returning: URL(string: string.trimmingCharacters(in: .whitespacesAndNewlines)))
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    private static func loadData(provider: NSItemProvider, typeIdentifier: String) async -> Data? {
        await withCheckedContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { data, _ in
                continuation.resume(returning: data)
            }
        }
    }

    private static func loadString(provider: NSItemProvider, typeIdentifier: String) async -> String? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, _ in
                if let string = item as? String {
                    continuation.resume(returning: string)
                } else if let data = item as? Data {
                    continuation.resume(returning: String(data: data, encoding: .utf8))
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }
}
