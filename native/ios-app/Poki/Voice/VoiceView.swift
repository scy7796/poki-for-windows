import AVFoundation
import SwiftUI

/// Talk to Poki: say what to do, Poki does it on this iPhone and answers out loud.
struct VoiceView: View {
    @Environment(AppModel.self) private var app
    /// Set when Voice is a sheet over Home: the Done button closes it.
    var close: (() -> Void)?
    /// Pushed in the Poki tab: no navigation stack or Done of its own.
    var embedded = false
    @State private var bridgeText = ""
    @State private var editingBridge = false
    @State private var bridgeRejected = false
    @State private var micDenied = false

    private var voice: VoiceModel { app.voice }

    var body: some View {
        if embedded { form } else { NavigationStack { form.toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { if let close { close() } else { dismiss() } } } } } }
    }

    private var form: some View {
        @Bindable var voice = voice
        return Form {
                // Voice runs in the chat (the waveform button for a live conversation, the microphone
                // for dictation). This page only says how it runs and keeps its options.
                Section {
                    LabeledContent("Live Voice") {
                        Text(voice.canTalkLive ? (VoiceDirect.apiKey != nil ? String(localized: "OpenAI key") : String(localized: "Voice bridge")) : String(localized: "Not Available"))
                            .foregroundStyle(voice.canTalkLive ? Color.secondary : Color.orange)
                    }
                    LabeledContent("Dictation", value: String(localized: "On this iPhone"))
                    Toggle("Mute Poki’s Voice", isOn: $voice.muted)
                } footer: {
                    if micDenied { Text("Poki can't use the microphone. Allow it in Settings, Privacy, Microphone.").foregroundStyle(.orange) }
                    else if voice.canTalkLive {
                        Text("In the chat, the waveform button starts a live conversation: Poki listens, acts and answers out loud. It ends by itself 8 seconds after an answer if nobody speaks, and when Poki goes to the background (once a running step is done). Tap End to stop sooner. The microphone in the message field only dictates.")
                    } else {
                        Text("A live conversation uses OpenAI’s Realtime voice, which needs an OpenAI API key in Poki › Model. Dictation in the message field works with every model.")
                    }
                }
                if voice.lastTurnMS != nil || voice.bridge != nil || VoiceDirect.apiKey == nil {
                    DisclosureGroup("Advanced") {
                        if let ms = voice.lastTurnMS { LabeledContent("Last Answer", value: "\(ms) ms") }
                        bridgeRows
                    }
                }
            }
            .navigationTitle("Voice")
            .navigationBarTitleDisplayMode(.inline)
    }

    @Environment(\.dismiss) private var dismiss

    @ViewBuilder private var bridgeRows: some View {
        if let bridge = voice.bridge, !editingBridge {
            LabeledContent("Mac Voice Bridge") { Text(bridge.display).font(.footnote.monospaced()) }
            Button("Change Address") { bridgeText = bridge.base.absoluteString; bridgeRejected = false; editingBridge = true }
        } else {
            TextField("Mac voice bridge address", text: $bridgeText)
                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                .font(.body.monospaced())
                .onSubmit(saveBridge)
            Button("Save Address", action: saveBridge).disabled(bridgeText.trimmingCharacters(in: .whitespaces).isEmpty)
            Text(bridgeRejected ? "That is not a voice bridge address. It looks like http://192.168.1.10:47830/voice/ followed by a long code." : "Optional, for live voice without an OpenAI key on this iPhone: run bin/voice-bridge.mjs on your Mac and enter the address it gives.")
                .font(.footnote).foregroundStyle(bridgeRejected ? Color.orange : Color.secondary)
        }
    }

    private func saveBridge() {
        bridgeRejected = !voice.setBridge(bridgeText)
        if !bridgeRejected { editingBridge = false }
    }

    private var symbol: String {
        switch voice.phase {
        case .off: "waveform.slash"
        case .connecting: "antenna.radiowaves.left.and.right"
        case .listening, .hearing: "waveform"
        case .thinking: "hand.tap.fill"
        case .speaking: "speaker.wave.2.fill"
        case .lost: "exclamationmark.triangle.fill"
        }
    }

    private static func icon(_ role: VoiceLine.Role) -> String {
        switch role {
        case .you: "person.wave.2"
        case .poki: "pawprint.fill"
        case .tool: "hand.tap"
        case .note: "info.circle"
        }
    }
}

private extension View {
    /// Liquid Glass on iOS 26; the bordered prominent style before it.
    @ViewBuilder func prominentGlass() -> some View {
        if #available(iOS 26, *) { buttonStyle(.glassProminent) } else { buttonStyle(.borderedProminent) }
    }
}
