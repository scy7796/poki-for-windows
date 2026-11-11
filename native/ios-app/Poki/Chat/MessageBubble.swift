// MessageBubble is from Mackarous/ConversationUI (commit e77c69e,
// Sources/ConversationUI/MessageBubble.swift), Copyright (c) 2024 Andrew Mackarous, MIT License. See
// THIRD_PARTY_NOTICES.md. Changed: Poki's message kinds, the ESP-171 board's colours, 17 pt text, the
// tail corner on the last bubble of a run, and 60 pt kept free on the far side (280 pt at most).
import SwiftUI

struct MessageBubble: View {
    enum Direction { case incoming, outgoing }
    var direction: Direction
    var text: String
    /// The last bubble of its run has the small corner on its side.
    var tail: Bool

    var body: some View {
        HStack {
            if direction == .outgoing {
                Spacer(minLength: .messageInsetPadding)
            }
            Text(rendered)
                .font(.system(size: 17))
                .tint(direction == .incoming ? Site.blue : .white)
                .fixedSize(horizontal: false, vertical: true)
                .foregroundStyle(foregroundStyle)
                .padding(.vertical, .messageVerticalPadding)
                .padding(.horizontal, 14)
                .background(backgroundStyle, in: shape)
                .contentShape(.contextMenuPreview, shape)
                .contextMenu {
                    copyButton { UIPasteboard.general.string = text }
                }
                .frame(maxWidth: 280, alignment: direction == .incoming ? .leading : .trailing)
            if direction == .incoming {
                Spacer(minLength: .messageInsetPadding)
            }
        }
    }

    /// Poki's words as Markdown (bold, italics, code, links), as models write them; the owner's as typed.
    private var rendered: AttributedString {
        guard direction == .incoming, text.contains(where: { "*_`[".contains($0) }),
              let markdown = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else {
            return AttributedString(text)
        }
        return markdown
    }

    private var shape: UnevenRoundedRectangle {
        let small: CGFloat = tail ? .tailRadius : .cornerRadius
        return UnevenRoundedRectangle(topLeadingRadius: .cornerRadius,
                                      bottomLeadingRadius: direction == .incoming ? small : .cornerRadius,
                                      bottomTrailingRadius: direction == .outgoing ? small : .cornerRadius,
                                      topTrailingRadius: .cornerRadius, style: .continuous)
    }

    private func copyButton(copy: @escaping () -> Void) -> some View {
        Button(action: copy) {
            Label("Copy", systemImage: "doc.on.doc")
        }
    }

    private var foregroundStyle: AnyShapeStyle {
        switch direction {
        case .incoming: AnyShapeStyle(Color(.label))
        case .outgoing: AnyShapeStyle(.white)
        }
    }

    private var backgroundStyle: AnyShapeStyle {
        switch direction {
        case .incoming: AnyShapeStyle(ChatColor.incoming)
        case .outgoing: AnyShapeStyle(Site.blue)
        }
    }
}

extension CGFloat {
    static let cornerRadius: CGFloat = 20
    static let tailRadius: CGFloat = 6
    static let messageInsetPadding: CGFloat = 60
    static let messageVerticalPadding: CGFloat = 9
}

/// The chat's greys. The boards draw iMessage's light colours, which are iOS's own system colours, so
/// these follow them (and dark mode) instead of fixed values.
enum ChatColor {
    /// #E9E9EB on the board (iMessage's incoming bubble): systemGray5, #E5E5EA.
    static let incoming = Color(.systemGray5)
    /// #8E8E93: times, "Delivered", the grey notes, values.
    static let secondary = Color(.systemGray)
    /// #6B6B70: a step not done yet (Site.text2 on the board).
    static let pending = Color(.secondaryLabel)
    /// #34C759.
    static let green = Color(.systemGreen)
    /// #D1D1D6: the message field's edge.
    static let fieldEdge = Color(.systemGray4)
    /// #A1A1A6: the placeholder.
    static let placeholder = Color(.placeholderText)
    /// #C6C6C8: the header's bottom line and the rows' separators.
    static let separator = Color(.opaqueSeparator)
}
