import { workspace } from "vscode";

// Inspect Settings
export interface InspectSettings {
  notifyEvalComplete: boolean;
  notifyScanComplete: boolean;
}
export type InspectLogViewStyle = "html" | "text";

// Settings namespace and constants
const kInspectConfigSection = "inspect_ai";
const kInspectConfigNotifyEvalComplete = "notifyEvalComplete";
const kInspectConfigNotifyScanComplete = "notifyScanComplete";

// Manages the settings for the inspect extension
export class InspectSettingsManager {
  constructor(private readonly onChanged_: (() => void) | undefined) {
    workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(kInspectConfigSection)) {
        // Configuration for has changed
        this.settings_ = undefined;
        if (this.onChanged_) {
          this.onChanged_();
        }
      }
    });
  }
  private settings_: InspectSettings | undefined;

  // get the current settings values
  public getSettings(): InspectSettings {
    if (!this.settings_) {
      this.settings_ = this.readSettings();
    }
    return this.settings_;
  }

  // write the notification pref
  public setNotifyEvalComplete(notify: boolean) {
    const configuration = workspace.getConfiguration(kInspectConfigSection);
    void configuration.update(kInspectConfigNotifyEvalComplete, notify, true);
  }

  // write the notification pref
  public setNotifyScanComplete(notify: boolean) {
    const configuration = workspace.getConfiguration(kInspectConfigSection);
    void configuration.update(kInspectConfigNotifyScanComplete, notify, true);
  }

  // Read settings values directly from VS.Code
  private readSettings() {
    const configuration = workspace.getConfiguration(kInspectConfigSection);
    const notifyEvalComplete = configuration.get<boolean>(
      kInspectConfigNotifyEvalComplete
    );
    const notifyScanComplete = configuration.get<boolean>(
      kInspectConfigNotifyScanComplete
    );
    return {
      notifyEvalComplete:
        notifyEvalComplete !== undefined ? notifyEvalComplete : true,
      notifyScanComplete:
        notifyScanComplete !== undefined ? notifyScanComplete : true,
    };
  }
}
