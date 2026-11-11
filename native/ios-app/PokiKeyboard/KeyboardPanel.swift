import SwiftUI

/// What the panel shows. The keyboard has no keys: Poki types through it, and the owner types on
/// their own keyboard.
@MainActor
final class PanelModel: ObservableObject {
    enum Mode: Equatable { case idle, typing, needsFullAccess }
    @Published var mode = Mode.idle
    /// The whole text Poki is typing; nil for a password, which is never shown.
    @Published var text: String?
    /// How long that text is, and how much of it is in the field so far.
    @Published var total = 0
    @Published var typed = 0
    /// The Pinyin letters of the word being typed, as an input method shows them.
    @Published var composing = ""
    /// A task of Poki's is under way, so the panel waits for its next text.
    @Published var held = false
    var takeOver: () -> Void = {}
    var switchKeyboard: () -> Void = {}

    var progress: Double { total > 0 ? min(1, Double(typed) / Double(total)) : 0 }
}

/// The keyboard's whole face, on the system's own keyboard backdrop: a title row with the one
/// button at its trailing edge, and under it a card. While Poki types, the card is the text itself,
/// what is in the field so far in the label colour, the rest still grey, with a dot where the cursor
/// is and the Pinyin being typed beside it. Native controls only, in the system's fonts.
struct KeyboardPanel: View {
    @ObservedObject var model: PanelModel

    /// Poki blue (#2084FD).
    static let blue = Color(red: 0x20 / 255.0, green: 0x84 / 255.0, blue: 0xFD / 255.0)

    private var typing: Bool { model.mode == .typing }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: typing ? "keyboard.fill" : "keyboard")
                    .symbolEffect(.variableColor.iterative, isActive: typing)
                    .foregroundStyle(typing ? Self.blue : Color.secondary)
                Text(typing ? Words.typing : Words.idleTitle)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(typing ? Self.blue : Color.primary)
                Spacer(minLength: 8)
                button(typing ? Words.takeOver : Words.switchKeyboard, systemImage: typing ? "hand.raised" : "globe",
                       action: typing ? model.takeOver : model.switchKeyboard)
            }
            card
            if typing {
                ProgressView(value: model.progress).tint(Self.blue)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(.default, value: model.mode)
    }

    private var card: some View {
        Group {
            switch model.mode {
            case .typing:
                Text(preview)
                    .font(.body)
                    .lineSpacing(2)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            case .idle:
                note(model.held ? Words.waiting : Words.idleDetail)
            case .needsFullAccess:
                note(Words.fullAccess)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(typing ? AnyShapeStyle(Self.blue.opacity(0.12)) : AnyShapeStyle(Color.primary.opacity(0.06)),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            if typing { RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Self.blue.opacity(0.45), lineWidth: 1) }
        }
        .clipped()
    }

    private func note(_ words: String) -> some View {
        Text(words)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// The text around the cursor: typed, then the Pinyin under way, the cursor's dot, and what is
    /// still to come. A long text shows the part the cursor is in.
    private var preview: AttributedString {
        var dot = AttributedString(" \u{25CF} ")
        dot.foregroundColor = Self.blue
        guard let text = model.text else {
            var hidden = AttributedString(String(repeating: "\u{2022}", count: min(model.typed, 60)))
            hidden.foregroundColor = Color.primary
            var rest = AttributedString(String(repeating: "\u{2022}", count: min(max(0, model.total - model.typed), 60)))
            rest.foregroundColor = Color.secondary
            return hidden + dot + rest
        }
        let typed = min(model.typed, text.count)
        let before = text.prefix(typed), after = text.dropFirst(typed)
        var done = AttributedString((before.count > 160 ? "\u{2026}" : "") + String(before.suffix(160)))
        done.foregroundColor = Color.primary
        var composing = AttributedString(model.composing)
        composing.foregroundColor = Self.blue
        composing.underlineStyle = .single
        var rest = AttributedString(String(after.prefix(400)) + (after.count > 400 ? "\u{2026}" : ""))
        rest.foregroundColor = Color.secondary
        return done + composing + dot + rest
    }

    @ViewBuilder
    private func button(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        if #available(iOS 26, *) {
            Button(title, systemImage: systemImage, action: action).buttonStyle(.glass).controlSize(.small)
        } else {
            Button(title, systemImage: systemImage, action: action).buttonStyle(.bordered).controlSize(.small)
        }
    }
}

/// The panel's few words, in English or Simplified Chinese after the iPhone's language.
enum Words {
    static let chinese = Locale.preferredLanguages.first?.hasPrefix("zh") ?? false
    static var typing: String { chinese ? "Poki 正在输入" : "Poki is typing" }
    static var takeOver: String { chinese ? "我来输入" : "Take Over" }
    static var idleTitle: String { chinese ? "Poki 键盘" : "Poki Keyboard" }
    static var idleDetail: String { chinese ? "Poki 工作时通过这里输入。要自己输入，请切换到你的键盘。" : "Poki types through here while it works. To type yourself, switch to your own keyboard." }
    static var waiting: String { chinese ? "Poki 正在执行任务，下一段文字会从这里输入。" : "Poki is working on a task. Its next text is typed from here." }
    static var fullAccess: String { chinese ? "请在“设置”里为 Poki 键盘打开“允许完全访问”，它才能收到 Poki 要输入的文字。" : "Turn on Allow Full Access for the Poki keyboard in Settings, so it can receive the text Poki types." }
    static var switchKeyboard: String { chinese ? "切换键盘" : "Switch Keyboard" }
    static var nextKeyboard: String { chinese ? "下一个键盘" : "Next Keyboard" }
}
