import Foundation
import UserNotifications

/// A time-sensitive notification for each approval, so the person hears about it even when the Live
/// Activity is off, dismissed or hidden (and, before iOS 26, as the way to answer it). Touch and hold
/// it for Allow (Face ID or the passcode first) and Don't Allow. PokiCore sends no input while an
/// approval waits, so only the person can press them.
enum ApprovalNotice {
    static let category = "approval"
    static let allow = "approval.allow"
    static let deny = "approval.deny"

    /// Allow and Don't Allow on the notification itself (touch and hold it, or pull it down), so an
    /// approval can be answered without opening Poki. Allow asks for Face ID or the passcode first.
    @MainActor static func registerActions() {
        let allowAction = UNNotificationAction(identifier: allow, title: String(localized: "Allow"),
                                               options: [.authenticationRequired], icon: UNNotificationActionIcon(systemImageName: "checkmark"))
        let denyAction = UNNotificationAction(identifier: deny, title: String(localized: "Don’t Allow"),
                                              options: [.destructive], icon: UNNotificationActionIcon(systemImageName: "xmark"))
        let approvals = UNNotificationCategory(identifier: category, actions: [allowAction, denyAction], intentIdentifiers: [],
                                               options: [.hiddenPreviewsShowTitle])
        let center = UNUserNotificationCenter.current()
        center.setNotificationCategories([approvals, ChatReplyNotice.category])
        center.delegate = ApprovalNoticeDelegate.shared
    }

    static func requestPermission() {
        Task { @MainActor in registerActions() }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            Task { @MainActor in AppLog.shared.add("notice", granted ? "notifications allowed" : "notifications not allowed") }
        }
    }

    static func post(_ approval: PendingApproval, caller: String? = nil) {
        let content = UNMutableNotificationContent()
        content.title = caller.map { String(localized: "\($0) needs your OK") } ?? String(localized: "Poki needs your OK")
        content.body = String(localized: "\(approval.summary) in \(approval.app). Touch and hold to allow or deny.")
        content.categoryIdentifier = category
        content.userInfo = ["approval": approval.id]
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        content.threadIdentifier = "approvals"
        let request = UNNotificationRequest(identifier: "approval-\(approval.id)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    static func clear(_ id: String) {
        let center = UNUserNotificationCenter.current()
        center.removeDeliveredNotifications(withIdentifiers: ["approval-\(id)"])
        center.removePendingNotificationRequests(withIdentifiers: ["approval-\(id)"])
    }
}

/// Answers from the notification's buttons go the same way as the Live Activity's (ApprovalIntentBridge).
final class ApprovalNoticeDelegate: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = ApprovalNoticeDelegate()

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        if response.notification.request.content.categoryIdentifier == ChatReplyNotice.categoryID {
            // Typed on the notification: the chat goes on from where the owner is. A plain tap opens Poki.
            if let typed = (response as? UNTextInputNotificationResponse)?.userText.trimmingCharacters(in: .whitespacesAndNewlines), !typed.isEmpty {
                await MainActor.run { ChatReplyNotice.answer(typed) }
            }
            return
        }
        guard let id = response.notification.request.content.userInfo["approval"] as? String else { return }
        let action = response.actionIdentifier
        guard action == ApprovalNotice.allow || action == ApprovalNotice.deny else { return }
        await MainActor.run { ApprovalIntentBridge.submit(ApprovalDecision(approvalID: id, approved: action == ApprovalNotice.allow)) }
    }

    /// While Poki is open the banner still shows, so the buttons are there too.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }
}

/// Poki's reply at the end of a chat task, when Poki is not in front: the owner reads it where they
/// are and can answer on the notification itself (touch and hold it, or pull it down, for Reply), and
/// the chat carries on from there. A tap opens Poki.
enum ChatReplyNotice {
    static let categoryID = "chat.reply"
    static let replyAction = "chat.reply.text"
    static let id = "chat-reply"

    static var category: UNNotificationCategory {
        let reply = UNTextInputNotificationAction(identifier: replyAction, title: String(localized: "Reply"), options: [],
                                                  icon: UNNotificationActionIcon(systemImageName: "arrowshape.turn.up.left"),
                                                  textInputButtonTitle: String(localized: "Send"),
                                                  textInputPlaceholder: String(localized: "Message Poki"))
        return UNNotificationCategory(identifier: categoryID, actions: [reply], intentIdentifiers: [], options: [])
    }

    @MainActor static func post(_ text: String, session: String) {
        let content = UNMutableNotificationContent()
        content.title = "Poki"
        content.body = String(text.prefix(400))
        content.categoryIdentifier = categoryID
        content.userInfo = ["chat": session]
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        content.threadIdentifier = "chat"
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    @MainActor static func clear() {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
    }

    /// The owner's words from the notification, into the chat as if typed there.
    @MainActor static func answer(_ text: String) {
        guard let chat = AskPoki.chat else { return }
        AppLog.shared.add("chat", "reply from the notification")
        chat.send(text)
    }
}

/// The notification for a sign-in from a client outside the relay's known list. A tap opens Poki,
/// where the owner answers (Allow asks for Face ID or the passcode on the alert's own button).
enum ConnectionNotice {
    @MainActor static func post(_ ask: AppModel.ConnectionAsk) {
        let content = UNMutableNotificationContent()
        content.title = String(localized: "Allow \(ask.client) to connect?")
        content.body = String(localized: "A client Poki doesn’t know (\(ask.callback)) is signing in with \(ask.connector). Open Poki to allow or deny it.")
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        content.threadIdentifier = "connections"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "connection-\(ask.id)", content: content, trigger: nil))
    }

    @MainActor static func clear(_ ask: AppModel.ConnectionAsk) {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["connection-\(ask.id)"])
    }
}

/// The pairing code as a time-sensitive banner, so it shows over Settings' Pair with Poki screen.
enum PairingNotice {
    static let id = "pairing-code"
    @MainActor static func post(pin: String) {
        let content = UNMutableNotificationContent()
        let shown = pin.count == 6 ? "\(pin.prefix(3)) \(pin.suffix(3))" : pin
        content.title = String(localized: "Pairing code \(shown)")
        content.body = String(localized: "Type it on the Pair with Poki screen in Settings.")
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }
    @MainActor static func clear() {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
    }
}

/// What the Live Activity would pop up for (the agent's hand-off, a problem) when there is no Live
/// Activity to pop up: dismissed, off in Settings, or Poki turned on from the background, where iOS does
/// not let an app start one. A time-sensitive banner instead.
enum AttentionNotice {
    static let id = "poki-attention"
    @MainActor static func post(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.interruptionLevel = .timeSensitive
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }
    @MainActor static func clear() {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
    }
}
