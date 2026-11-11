import Foundation
import UIKit
import UserNotifications

/// Poki keeps its own signing, the way Poki Setup does on a computer (PokiLauncher's signer, which is
/// Poki Setup's Rust core): the Apple Account is signed in here, with anisette from a remote server,
/// the next build is signed ahead of time (the installed copy for a refresh, the chosen channel's
/// release for an update), and it is installed over the loopback only when the person taps Install
/// and no task is running, because iOS ends Poki when the new copy lands.
///
/// Secrets (the Apple session, the kept password, the team key, the anisette identity) live only in
/// the Keychain, after first unlock, on this device.
@MainActor
@Observable
final class SelfSigner {
    struct Channel: Decodable, Hashable, Identifiable {
        let id: String
        let title: String
    }

    struct Status: Decodable, Equatable {
        var signed_in: Bool
        var needs_code: Bool
        var apple_id: String?
        var name: String?
        var team_id: String?
        var keeps_password: Bool
        var anisette: String
        var channel: String
        var channels: [Channel]
    }

    struct Team: Decodable, Identifiable, Hashable {
        let team_id: String
        let name: String
        let kind: String
        let is_free: Bool
        var id: String { team_id }
    }

    struct Prepared: Decodable, Equatable {
        let kind: String
        let ipa: String
        let bundle_id: String
        let version: String
        let build: String
        let tag: String
        let team_name: String
        let team_is_free: Bool
        let profile_expires_at: Int64
        let prepared_at: Int64
        var expires: Date { Date(timeIntervalSince1970: TimeInterval(profile_expires_at)) }
        var title: String { kind == "update" ? "Poki \(version) (\(build))" : "Refreshed Poki \(version) (\(build))" }
    }

    struct Release: Decodable, Equatable {
        let tag: String
        let version: String
        let build: String
        let channel: String
    }

    /// Prepare a fresh build when the installed profile has this many days left or fewer.
    static let refreshWithDaysLeft: Double = 3
    /// Home warns, and a notification reminds once a day, when the installed profile has this many days left.
    static let warnWithDaysLeft: Double = 2

    private(set) var status: Status?
    private(set) var teams: [Team] = []
    private(set) var ready: [String: Prepared] = [:]
    private(set) var latest: Release?
    /// What the signer is doing now, for the Setup page.
    private(set) var working: String?
    private(set) var fraction: Double?
    private(set) var lastError: String?
    private(set) var lastCheck: Date?
    /// When the installed Poki stops opening: its own profile's expiry. Nil when it has none (simulator).
    let expiry: Date? = SelfSigner.installedProfileExpiry() ?? SelfSigner.screenshotExpiry
    let installedVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    let installedBuild = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""

    /// The phone's own services (10.7.0.1 and the pairing file), when the loopback answers.
    var phone: () -> [String: Any]? = { nil }
    /// No task is running, so Poki may be ended by an install.
    var isIdle: () -> Bool = { false }
    /// Why an install waits, for the message under the button.
    var busyReason: () -> String? = { nil }
    /// Before an install the owner asked for: Poki winds down (automation session, Live Activity)
    /// so it exits cleanly when iOS replaces it, and comes back on after.
    var beforeInstall: () -> Void = {}

    private var started = false
    private var timer: Timer?
    private let log = AppLog.shared

    var signedIn: Bool { status?.signed_in == true }
    var needsCode: Bool { status?.needs_code == true }
    var daysLeft: Double? { expiry.map { $0.timeIntervalSinceNow / 86_400 } }
    /// The build Install would put on: an update when one is ready, else a refresh.
    var next: Prepared? { ready["update"] ?? ready["refresh"] }
    /// The channel has a newer Poki than the installed one.
    var updateAvailable: Bool { latest.map(isNewer) ?? false }
    /// A newer Poki is on the channel, but no signed copy of it is ready to install yet. Compared by
    /// version and build, not tag: the rolling releases (app-prealpha-latest, ios-prealpha-latest)
    /// keep one tag for every build, so a copy prepared from an earlier build has the same tag.
    var updateNotReady: Bool {
        guard updateAvailable, let latest else { return false }
        guard let u = ready["update"] else { return true }
        return u.version != latest.version || u.build != latest.build
    }
    /// Why Poki cannot download the update by itself, when it cannot. Nil when it can.
    var updateBlocker: String? {
        guard updateNotReady else { return nil }
        if !signedIn { return String(localized: "To download updates by itself, Poki needs your Apple Account: sign in under Signing Options. Or update Poki from Poki Setup on your Mac.") }
        if phone() == nil { return String(localized: "Poki can't reach this iPhone. Turn on the loopback, then try again.") }
        return nil
    }
    var channelTitle: String { status?.channels.first { $0.id == status?.channel }?.title ?? status?.channel ?? "" }

    static var home: URL {
        let url = AppFiles.support.appendingPathComponent("signer", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// Where Poki Setup leaves its team key for Poki (see the desktop core's signing-identity.json).
    static var handedIdentity: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("PokiSetup/signing-identity.json")
    }

    func start() {
        guard !started else { return }
        started = true
        SignerBridge.installVault()
        Task {
            do {
                _ = try await SignerBridge.call(["op": "configure", "home": Self.home.path, "device_name": UIDevice.current.name])
                if let imported = try? await SignerBridge.decode([String: AnyDecodable].self, ["op": "import_identity", "path": Self.handedIdentity.path]),
                   imported["imported"]?.value as? Bool == true {
                    log.add("signing", "took Poki Setup's signing key into the Keychain")
                }
                await reload()
                loadReady()
                maintain()
            } catch {
                lastError = error.localizedDescription
                log.add("signing", "signer did not start: \(error.localizedDescription)")
            }
        }
        // Poki stays up in the background while it is on; a check every three hours is plenty for
        // a 7-day profile.
        timer = Timer.scheduledTimer(withTimeInterval: 3 * 3600, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.maintain() }
        }
    }

    func reload() async {
        do { status = try await SignerBridge.decode(Status.self, ["op": "status"]) } catch { lastError = error.localizedDescription }
    }

    // MARK: Account

    func signIn(appleID: String, password: String, keepPassword: Bool) async {
        await run("Signing in") {
            _ = try await SignerBridge.call(["op": "sign_in", "apple_id": appleID, "password": password, "keep_password": keepPassword])
        }
        await reload()
        if signedIn { await loadTeams() }
    }

    func finishSignIn(code: String) async {
        await run("Checking the code") { _ = try await SignerBridge.call(["op": "finish_sign_in", "code": code]) }
        await reload()
        if signedIn { await loadTeams() }
    }

    func signOut() async {
        await run("Signing out") { _ = try await SignerBridge.call(["op": "sign_out"]) }
        teams = []
        await reload()
    }

    func loadTeams() async {
        do { teams = try await SignerBridge.decode([Team].self, ["op": "teams"]) } catch { lastError = error.localizedDescription }
        await reload()
    }

    func choose(team: Team) async {
        await run("Choosing the team") { _ = try await SignerBridge.call(["op": "choose_team", "team_id": team.team_id]) }
        await reload()
    }

    func setChannel(_ id: String) async {
        await run(nil) { _ = try await SignerBridge.call(["op": "set_channel", "channel": id]) }
        await reload()
        latest = nil
        maintain()
    }

    func setAnisette(_ url: String) async {
        await run(nil) { _ = try await SignerBridge.call(["op": "set_anisette", "url": url]) }
        await reload()
    }

    // MARK: Builds

    private func loadReady() {
        var found: [String: Prepared] = [:]
        for kind in ["refresh", "update"] {
            let url = Self.home.appendingPathComponent("ready/\(kind)/manifest.json")
            if let data = try? Data(contentsOf: url), let p = try? JSONDecoder().decode(Prepared.self, from: data), FileManager.default.fileExists(atPath: p.ipa) {
                found[kind] = p
            }
        }
        // A build that is already on, or older than what is on (Poki Setup installed a newer one
        // meanwhile), has nothing left to give.
        if let u = found["update"], !isNewer(version: u.version, build: u.build) { found["update"] = nil }
        if let r = found["refresh"], let expiry, r.expires <= expiry.addingTimeInterval(3600) { found["refresh"] = nil }
        ready = found
    }

    /// Prepares what is due, by itself: an update when the channel has a newer Poki, a refresh when
    /// the installed profile is close to expiring. Never installs.
    func maintain() {
        guard signedIn, working == nil, phone() != nil else { return }
        Task {
            lastCheck = Date()
            if let rel = try? await SignerBridge.decode(Release.self, ["op": "check_update"]) {
                latest = rel
                if updateNotReady {
                    await prepare(kind: "update")
                    return
                }
            }
            if let days = daysLeft, days <= Self.refreshWithDaysLeft, ready["refresh"] == nil, ready["update"] == nil {
                await prepare(kind: "refresh")
            }
            remindIfExpiring()
        }
    }

    /// Looks up the newest build on the chosen channel without preparing it, for the version rows.
    /// Works without an Apple Account. False when GitHub could not be read.
    @discardableResult
    func checkLatest() async -> Bool {
        guard let rel = try? await SignerBridge.decode(Release.self, ["op": "check_update"]) else { return false }
        latest = rel
        lastCheck = Date()
        // Found here first (the Signing page looks without waiting for the 3-hour check): the
        // download starts now too, as it would from that check.
        if updateNotReady { maintain() }
        return true
    }

    /// Download and Install Update, in one tap: gets the newest build and signs it, then installs it.
    /// install() still checks that Poki is idle: with a task running it waits and says why, and the
    /// downloaded build stays ready for Install Update.
    func downloadAndInstallUpdate() async {
        if updateNotReady { await prepare(kind: "update") }
        guard !updateNotReady, ready["update"] != nil, lastError == nil else { return }
        await install()
    }

    func isNewer(_ rel: Release) -> Bool { isNewer(version: rel.version, build: rel.build) }

    func isNewer(version: String, build: String) -> Bool {
        let installed = (installedVersion, Int(installedBuild) ?? 0)
        switch version.compare(installed.0, options: .numeric) {
        case .orderedDescending: return true
        case .orderedAscending: return false
        case .orderedSame: return (Int(build) ?? 0) > installed.1
        }
    }

    func prepare(kind: String) async {
        guard var request = phone() else {
            lastError = String(localized: "Poki can't reach this iPhone. Turn on the loopback, then try again.")
            return
        }
        request["op"] = "prepare"
        request["kind"] = kind
        request["app_path"] = Bundle.main.bundlePath
        request["device_name"] = UIDevice.current.name
        await run(kind == "update" ? "Preparing the update" : "Preparing a refresh") {
            let p = try await SignerBridge.decode(Prepared.self, request) { [weak self] progress in
                Task { @MainActor in self?.show(progress) }
            }
            self.ready[kind] = p
            self.log.add("signing", "prepared \(kind): \(p.version) (\(p.build)), profile until \(p.expires)")
            self.notify(title: kind == "update" ? String(localized: "Poki Update Ready") : String(localized: "Poki Refresh Ready"),
                        body: String(localized: "Open Setup and tap Install when Poki isn't running a task."), id: Self.readyNotice)
        }
    }

    /// Installs the prepared build. iOS ends Poki when it lands; a notification brings it back.
    func install() async {
        guard let p = next else { log.add("signing", "install tapped, but no build is ready"); return }
        log.add("signing", "install tapped: \(p.kind) \(p.version) (\(p.build))")
        guard isIdle() else {
            let why = busyReason() ?? ""
            lastError = String(localized: "Poki is running a task. Install when it has finished.") + (why.isEmpty ? "" : " " + why)
            log.add("signing", "install waits: \(why)")
            return
        }
        guard var request = phone() else {
            lastError = String(localized: "Poki can't reach this iPhone. Turn on the loopback, then try again.")
            log.add("signing", "install: no loopback or pairing file")
            return
        }
        request["op"] = "install"
        request["manifest"] = Self.home.appendingPathComponent("ready/\(p.kind)/manifest.json").path
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.reopenNotice])
        beforeInstall()
        steppedAside = false
        closing = false
        installFraction = nil
        installStepSince = nil
        asideSince = nil
        // iOS holds the last part of an upgrade until the app it replaces is gone: stepping aside
        // to the Home Screen is not enough (seen on the phone: the install waited until Poki was
        // swiped away). So once the new copy is almost in, or has stalled there, Poki exits by
        // itself, and a notice set at that moment reopens it.
        let background = UIApplication.shared.beginBackgroundTask(withName: "Poki update")
        let watch = Task { @MainActor [weak self] in
            var last: (fraction: Double?, since: Date)?
            while !Task.isCancelled, let self, self.working != nil {
                try? await Task.sleep(for: .milliseconds(500))
                guard let began = self.installStepSince else { continue }
                let f = self.installFraction
                if last == nil || last?.fraction != f { last = (f, Date()) }
                let still = Date().timeIntervalSince(last!.since)
                if Self.shouldClose(fraction: f, still: still, sinceInstallBegan: Date().timeIntervalSince(began), sinceAside: self.asideSince.map { Date().timeIntervalSince($0) }) {
                    self.closeToFinish()
                    break
                }
            }
        }
        await run("Installing") {
            _ = try await SignerBridge.call(request) { [weak self] progress in
                Task { @MainActor in self?.show(progress) }
            }
        }
        watch.cancel()
        UIApplication.shared.endBackgroundTask(background)
        // Still here: the install failed before Poki closed for it.
        if lastError != nil, !closing {
            finishNotice = false
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.reopenNotice])
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [Self.finishNoticeID])
        }
    }

    // MARK: Helpers

    private func run(_ title: String?, _ work: () async throws -> Void) async {
        working = title
        fraction = nil
        lastError = nil
        defer { working = nil; fraction = nil }
        do { try await work() } catch {
            lastError = error.localizedDescription
            log.add("signing", "\(title ?? "signer"): \(error.localizedDescription)")
        }
    }

    /// The upgrade's progress while it installs, for `install`'s watch.
    private var installFraction: Double?
    private var steppedAside = false
    /// When the install itself began (the build is on the phone).
    private var installStepSince: Date?
    /// When the owner sent Poki to the Home Screen from the alert.
    private var asideSince: Date?
    private var closing = false

    static let readyNotice = "nz.zheha.poki.signing.ready"
    static let finishNoticeID = "nz.zheha.poki.signing.finish"
    static let reopenNotice = "nz.zheha.poki.signing.reopen"
    static let expiringNotice = "nz.zheha.poki.signing.expiring"

    /// Whether Poki exits now for iOS to finish the upgrade: the new copy is almost in, or the
    /// install has stood still (iOS is waiting for Poki to go), sooner once Poki is off the screen.
    nonisolated static func shouldClose(fraction: Double?, still: Double, sinceInstallBegan: Double, sinceAside: Double?) -> Bool {
        if let fraction, fraction >= 0.9 { return true }
        if let sinceAside { return sinceAside >= 8 || (still >= 3 && sinceAside >= 1) }
        if let fraction, fraction >= 0.4 { return still >= 5 }
        // No progress reported at all, or stuck early.
        return still >= 15 && sinceInstallBegan >= 15
    }

    /// Poki exits so iOS can finish the upgrade. The notice that reopens it is set now, counted
    /// from the exit, so it does not arrive while the install is still going.
    private func closeToFinish() {
        guard !closing else { return }
        closing = true
        finishNotice = false
        log.add("signing", "closing Poki so iOS can finish the install")
        let center = UNUserNotificationCenter.current()
        center.removeDeliveredNotifications(withIdentifiers: [Self.finishNoticeID, Self.readyNotice, Self.expiringNotice])
        notify(title: String(localized: "Poki Was Updated"), body: String(localized: "Tap to open Poki again."), id: Self.reopenNotice, after: 15)
        UIApplication.shared.perform(NSSelectorFromString("suspend"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { exit(0) }
    }

    /// The update notices still in Notification Centre are taken away: called when Poki opens.
    func clearNotices() {
        let center = UNUserNotificationCenter.current()
        center.removeDeliveredNotifications(withIdentifiers: [Self.readyNotice, Self.finishNoticeID, Self.reopenNotice, Self.expiringNotice])
        // Notices from builds that gave each one its own id.
        center.getDeliveredNotifications { delivered in
            let old = delivered.filter { $0.request.content.userInfo["poki_link"] as? String == "poki://setup" }.map(\.request.identifier)
            if !old.isEmpty { center.removeDeliveredNotifications(withIdentifiers: old) }
        }
    }

    /// Poki to the Home Screen, as the person swiping up would: iOS finishes the upgrade only once the
    /// app it replaces is no longer in front. Once per install.
    private func stepAside() {
        guard !steppedAside else { return }
        log.add("signing", "the install's last step: telling the owner Poki will close to finish")
        steppedAside = true
        working = String(localized: "Finishing the update: Poki will close to finish it")
        // The last step: the owner is told Poki will close (the alert's OK steps aside, and iOS ends
        // Poki by itself otherwise); the notice says it again in case the alert was missed.
        installStepSince = Date()
        finishNotice = true
        notify(title: String(localized: "Poki Will Close to Finish the Update"),
               body: String(localized: "Poki will close by itself. Open it again once the update is in."), id: Self.finishNoticeID)
    }
    /// The last install step's alert: Poki has to exit for the update to finish.
    var finishNotice = false
    /// OK on that alert: Poki leaves for the Home Screen.
    func finishNoticeAnswered() {
        guard finishNotice else { return }
        finishNotice = false
        asideSince = Date()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            UIApplication.shared.perform(NSSelectorFromString("suspend"))
        }
    }

    private func show(_ progress: [String: Any]) {
        switch progress["kind"] as? String {
        case "step":
            working = progress["title"] as? String ?? working; fraction = nil
            // The install itself has begun (the build is on the phone): the last step, where Poki
            // must exit for iOS to finish. The owner is told now rather than at a percentage that a
            // fast or stalled install may never report.
            if progress["id"] as? String == "install" { stepAside() }
        case "part":
            fraction = progress["fraction"] as? Double
            if progress["id"] as? String == "install" { installFraction = fraction; stepAside() }
            if let d = progress["detail"] as? String { working = d }
        case "note", "waiting": if let t = progress["text"] as? String { working = t }
        default: break
        }
    }

    private func notify(title: String, body: String, id: String, after seconds: TimeInterval? = nil) {
        // One notice of each kind at a time: a newer one takes the older one's place.
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.userInfo = ["poki_link": "poki://setup"]
        let trigger = seconds.map { UNTimeIntervalNotificationTrigger(timeInterval: $0, repeats: false) }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }

    /// Once a day in the last two days: the build is ready (or can't be made) and nothing installed it.
    private func remindIfExpiring() {
        guard let days = daysLeft, days <= Self.warnWithDaysLeft else { return }
        let key = "signing.reminded"
        if let last = UserDefaults.standard.object(forKey: key) as? Date, Date().timeIntervalSince(last) < 20 * 3600 { return }
        UserDefaults.standard.set(Date(), forKey: key)
        let when = expiry.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? ""
        notify(title: String(localized: "Poki Expires Soon"),
               body: next != nil ? String(localized: "A refreshed Poki is ready. Open Setup and tap Install before \(when).") : String(localized: "Open Setup to refresh Poki before \(when)."), id: Self.expiringNotice)
    }

    /// `-pokiSigningDays 1`: a simulator has no profile, so a screenshot gives Poki one that ends then.
    nonisolated private static var screenshotExpiry: Date? {
        #if targetEnvironment(simulator)
        guard UserDefaults.standard.object(forKey: "pokiSigningDays") != nil else { return nil }
        return Date().addingTimeInterval(UserDefaults.standard.double(forKey: "pokiSigningDays") * 86_400)
        #else
        nil
        #endif
    }

    /// The ExpirationDate of Poki's own embedded.mobileprovision (a CMS envelope around a plist).
    nonisolated static func installedProfileExpiry() -> Date? {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex) else { return nil }
        let plist = data.subdata(in: start.lowerBound..<end.upperBound)
        let dict = (try? PropertyListSerialization.propertyList(from: plist, format: nil)) as? [String: Any]
        return dict?["ExpirationDate"] as? Date
    }
}

struct SignerError: LocalizedError {
    let message: String
    let code: String
    var errorDescription: String? { message }
}

/// A JSON value of any shape, for answers that need no struct.
struct AnyDecodable: Decodable {
    let value: Any
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { value = b }
        else if let n = try? c.decode(Double.self) { value = n }
        else if let s = try? c.decode(String.self) { value = s }
        else if let a = try? c.decode([AnyDecodable].self) { value = a.map(\.value) }
        else if let d = try? c.decode([String: AnyDecodable].self) { value = d.mapValues(\.value) }
        else { value = NSNull() }
    }
}

/// poki_signer_* through the C ABI.
enum SignerBridge {
    fileprivate static let prefix = "signer."

    /// The Keychain as the signer's vault (Keychain items are after-first-unlock, this device only).
    static func installVault() {
        _ = poki_signer_set_vault({ _, name in
            guard let name, let data = try? Keychain.read(SignerBridge.prefix + String(cString: name)) else { return nil }
            return strdup(data.base64EncodedString())
        }, { _, name, value in
            guard let name, let value, let data = Data(base64Encoded: String(cString: value)) else { return -1 }
            do { try Keychain.write(data, account: SignerBridge.prefix + String(cString: name)); return 0 } catch { return -2 }
        }, { _, name in
            guard let name else { return -1 }
            Keychain.delete(SignerBridge.prefix + String(cString: name))
            return 0
        }, nil)
    }

    final class Box: @unchecked Sendable {
        let progress: (@Sendable ([String: Any]) -> Void)?
        var continuation: CheckedContinuation<Data, Error>?
        init(progress: (@Sendable ([String: Any]) -> Void)?, continuation: CheckedContinuation<Data, Error>) {
            self.progress = progress
            self.continuation = continuation
        }
    }

    /// Runs one request; the answer's `value` as JSON (wrapped as {"v": value}).
    @discardableResult
    static func call(_ request: [String: Any], progress: (@Sendable ([String: Any]) -> Void)? = nil) async throws -> Data {
        let json = try JSONSerialization.data(withJSONObject: request)
        return try await withCheckedThrowingContinuation { (c: CheckedContinuation<Data, Error>) in
            let box = Unmanaged.passRetained(Box(progress: progress, continuation: c))
            let rc = String(decoding: json, as: UTF8.self).withCString { text in
                poki_signer_call(text, { context, event in
                    guard let context, let event else { return }
                    let unmanaged = Unmanaged<Box>.fromOpaque(context)
                    let box = unmanaged.takeUnretainedValue()
                    guard let object = (try? JSONSerialization.jsonObject(with: Data(String(cString: event).utf8))) as? [String: Any] else { return }
                    if object["event"] as? String == "result" {
                        if object["ok"] as? Bool == true {
                            let wrapped = (try? JSONSerialization.data(withJSONObject: ["v": object["value"] ?? NSNull()])) ?? Data("{\"v\":null}".utf8)
                            box.continuation?.resume(returning: wrapped)
                        } else {
                            box.continuation?.resume(throwing: SignerError(message: object["error"] as? String ?? "The signer failed.", code: object["code"] as? String ?? ""))
                        }
                        box.continuation = nil
                        unmanaged.release()
                    } else if let p = object["progress"] as? [String: Any] {
                        box.progress?(p)
                    }
                }, box.toOpaque())
            }
            if rc != 0 {
                box.takeUnretainedValue().continuation = nil
                box.release()
                c.resume(throwing: SignerError(message: "The signer did not take the request.", code: "config"))
            }
        }
    }

    private struct Wrapped<T: Decodable>: Decodable { let v: T }

    static func decode<T: Decodable>(_ type: T.Type, _ request: [String: Any], progress: (@Sendable ([String: Any]) -> Void)? = nil) async throws -> T {
        let data = try await call(request, progress: progress)
        return try JSONDecoder().decode(Wrapped<T>.self, from: data).v
    }
}
