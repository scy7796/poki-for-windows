import SwiftUI
import UIKit

/// Geist, the website's typeface, for prominent text only (page titles, session names, the Live
/// Activity's status word and main line); body text and controls keep the system font. Geist has no
/// Chinese, and laid Chinese lines out narrower than they drew (cut off on the Live Activity), so
/// Chinese uses the system font throughout.
enum Prominent {
    static let usesGeist = Bundle.main.preferredLocalizations.first?.hasPrefix("zh") != true

    private static func name(_ weight: Font.Weight) -> String {
        switch weight {
        case .bold, .heavy, .black: "Geist-Bold"
        case .semibold: "Geist-SemiBold"
        case .medium: "Geist-Medium"
        default: "Geist-Regular"
        }
    }

    /// Geist at a text style's size, scaling with Dynamic Type.
    static func font(_ style: Font.TextStyle, _ weight: Font.Weight = .semibold) -> Font {
        guard usesGeist else { return .system(style, weight: weight) }
        return .custom(name(weight), size: UIFont.preferredFont(forTextStyle: style.uiKit).pointSize, relativeTo: style)
    }

    static func uiFont(_ style: UIFont.TextStyle, _ weight: Font.Weight) -> UIFont? {
        guard usesGeist, let base = UIFont(name: name(weight), size: UIFont.preferredFont(forTextStyle: style).pointSize) else { return nil }
        return UIFontMetrics(forTextStyle: style).scaledFont(for: base)
    }
}

private extension Font.TextStyle {
    var uiKit: UIFont.TextStyle {
        switch self {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
    }
}
