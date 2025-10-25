import { Disposable, Event, EventEmitter, ExtensionContext } from "vscode";
import { pythonInterpreter } from "../python";
import { AbsolutePath } from "../path";


// Fired when the active task changes
export interface PackageChangedEvent {
  available: boolean;
  binPath: AbsolutePath | null;
}

export class PackageManager implements Disposable {
  constructor(context: ExtensionContext, private checkForPackage_: () => AbsolutePath | null) {
    // If the interpreter changes, refresh the tasks
    context.subscriptions.push(
      pythonInterpreter().onDidChange(() => {
        this.updatePackageAvailable();
      })
    );
    this.updatePackageAvailable();
  }
  private packageBinPath_: string | undefined = undefined;

  get available(): boolean {
    return this.packageBinPath_ !== null;
  }

  private updatePackageAvailable() {
    const binPath = this.checkForPackage_();
    const available = binPath !== null;
    const valueChanged = this.packageBinPath_ !== binPath?.path;
    if (valueChanged) {
      this.packageBinPath_ = binPath?.path;
      this.onPackageChanged_.fire({
        available: !!this.packageBinPath_,
        binPath,
      });
    }
    if (!available) {
      this.watchForPackage();
    }
  }

  watchForPackage() {
    this.packageTimer = setInterval(() => {
      const path = this.checkForPackage_();
      if (path) {
        if (this.packageTimer) {
          clearInterval(this.packageTimer);
          this.packageTimer = null;
          this.updatePackageAvailable();
        }
      }
    }, 3000);
  }

  private packageTimer: NodeJS.Timeout | null = null;

  dispose() {
    if (this.packageTimer) {
      clearInterval(this.packageTimer);
      this.packageTimer = null;
    }
  }

  private readonly onPackageChanged_ = new EventEmitter<PackageChangedEvent>();
  public readonly onPackageChanged: Event<PackageChangedEvent> =
    this.onPackageChanged_.event;
}
