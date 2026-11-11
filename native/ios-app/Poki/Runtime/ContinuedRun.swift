import BackgroundTasks
import Foundation

/// iOS 26's continued processing task: work the person started keeps running after Poki leaves the
/// screen, shown by iOS with its own progress UI, with no silent audio and no location. Poki holds one
/// while it is on and ends it when it turns off. iOS may end it early (under load, or when the person
/// stops it from that UI); then BackgroundKeeper falls back to silent audio.
@available(iOS 26.0, *)
@MainActor
final class ContinuedRun {
    static let shared = ContinuedRun()

    /// The wildcard the Info.plist permits: the signed bundle id's when the signer renamed it, else
    /// the one the build carries.
    static var permitted: String? {
        (Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String])?.first { $0.hasSuffix(".run.*") }
    }

    /// Nothing is registered at launch: iOS refused a handler for the wildcard itself (seen on the
    /// phone: "would not register nz.zheha.poki.<team>.run.*"). A continued processing task's handler
    /// is registered for its own identifier, one that matches the wildcard, just before the request
    /// is submitted (`begin`).
    static func registerAtLaunch() {
        AppLog.shared.add("background", permitted.map { "continued run permitted for \($0)" } ?? "continued run: no BGTaskSchedulerPermittedIdentifiers in this build")
    }

    /// The handler for one task's own identifier. False when iOS will not take it.
    private func register(_ id: String) -> Bool {
        let ok = BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: .main) { [weak self] task in
            guard let task = task as? BGContinuedProcessingTask else { task.setTaskCompleted(success: false); return }
            MainActor.assumeIsolated { self?.started(task) }
        }
        if !ok { AppLog.shared.add("background", "continued run: iOS would not register \(id) (bundle \(Bundle.main.bundleIdentifier ?? "?"))") }
        return ok
    }
    private var task: BGContinuedProcessingTask?
    private var identifier: String?
    private var ticker: Task<Void, Never>?
    /// iOS ended the task before Poki turned off.
    var onExpired: (() -> Void)?
    private(set) var isRunning = false

    /// Asks iOS for the task; must be called while Poki is in front. False when iOS refuses.
    func begin(subtitle: String) -> Bool {
        guard !isRunning else { return true }
        guard let wildcard = Self.permitted else {
            AppLog.shared.add("background", "continued run: no BGTaskSchedulerPermittedIdentifiers in this build"); return false
        }
        let id = String(wildcard.dropLast()) + UUID().uuidString.prefix(8).lowercased()
        guard register(id) else { return false }
        let request = BGContinuedProcessingTaskRequest(identifier: id, title: String(localized: "Poki is on"), subtitle: subtitle)
        request.strategy = .fail
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            AppLog.shared.add("background", "continued run refused: \(error.localizedDescription)")
            return false
        }
        identifier = id
        isRunning = true
        AppLog.shared.add("background", "continued run requested (\(id))")
        return true
    }

    private func started(_ task: BGContinuedProcessingTask) {
        guard isRunning else { task.setTaskCompleted(success: true); return }
        self.task = task
        task.progress.totalUnitCount = 1_000
        task.expirationHandler = { [weak self] in
            Task { @MainActor in
                guard let self, self.isRunning else { return }
                AppLog.shared.add("background", "continued run ended by iOS")
                self.finish(success: false)
                self.onExpired?()
            }
        }
        // iOS ends a task that shows no progress: a tick every few seconds, never reaching the end.
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled, let self, let task = self.task {
                let p = task.progress
                if p.completedUnitCount < p.totalUnitCount - 1 { p.completedUnitCount += 1 } else { p.completedUnitCount = p.totalUnitCount / 2 }
                try? await Task.sleep(for: .seconds(5))
            }
        }
        AppLog.shared.add("background", "continued run started: Poki keeps running without silent audio")
    }

    func update(subtitle: String) {
        task?.updateTitle(String(localized: "Poki is on"), subtitle: subtitle)
    }

    func end() { finish(success: true) }

    private func finish(success: Bool) {
        isRunning = false
        ticker?.cancel(); ticker = nil
        if let task { task.progress.completedUnitCount = task.progress.totalUnitCount; task.setTaskCompleted(success: success) }
        task = nil
        if let identifier { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier) }
        identifier = nil
    }
}
