// The Live Activity's configuration follows AgentLiveActivityWidget in Clarklevis1995/dsh-mobile
// (commit ebe19764, AgentLiveActivityWidget/AgentLiveActivityWidget.swift), MIT License, Copyright (c)
// 2026 Chaofan Li. See THIRD_PARTY_NOTICES.md.
import ActivityKit
import SwiftUI
import WidgetKit

@main
struct PokiWidgetsBundle: WidgetBundle {
    var body: some Widget { PokiLiveActivity() }
}

/// Poki's Live Activity: what the agent is doing on the phone, or what it needs from you. The pairing
/// code while pairing, the current setup step while setting up, and Allow/Deny for sensitive actions.
/// The buttons are for the person; PokiCore sends no input while an approval waits, so the runner never
/// taps them. A tap anywhere else opens the screen the state is about (`ActivityFace.link`).
struct PokiLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PokiActivityAttributes.self) { context in
            let face = context.face
            LockScreenCard(face: face)
                .activityBackgroundTint(ActivityTheme.current.lockBackground)
                .widgetURL(face.link)
        } dynamicIsland: { context in
            let face = context.face
            let insets = ActivityMetrics.islandInsets
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { IslandLeading(face: face) }
                DynamicIslandExpandedRegion(.trailing) { IslandTrailing(face: face) }
                DynamicIslandExpandedRegion(.bottom) { IslandBottom(face: face) }
            } compactLeading: {
                CompactLeading(face: face)
            } compactTrailing: {
                CompactTrailing(face: face)
            } minimal: {
                MinimalView(face: face)
            }
            .widgetURL(face.link)
            // The outline takes the state's blue while the person is needed; otherwise the system's own.
            .keylineTint(face.outlined ? ActivityTheme.current.approvalOutline : nil)
            .contentMargins(.leading, insets.leading, for: .expanded)
            .contentMargins(.trailing, insets.trailing, for: .expanded)
            .contentMargins(.top, insets.top, for: .expanded)
            .contentMargins(.bottom, insets.bottom, for: .expanded)
        }
    }
}

extension ActivityViewContext<PokiActivityAttributes> {
    /// The face to draw. An approval's stale date is its expiry: once it passes, the buttons go even if
    /// the app has not had a chance to update yet, so nobody taps Allow on a dead request. Any other
    /// state past its stale date says it is not updating.
    var face: ActivityFace {
        var state = self.state
        if isStale, state.approval != nil, state.phase.holdsApproval {
            state.approval = nil
            state.decision = nil
            state.phase = .working
            state.headline = "Step skipped"
            state.event = .init(kind: .expired, text: "Timed out")
            return state.face(stale: false)
        }
        return state.face(stale: isStale)
    }
}
