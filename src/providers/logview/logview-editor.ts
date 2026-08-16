import * as vscode from "vscode";
import { Uri } from "vscode";

import { log } from "../../core/log";
import {
  canonicalViewPathLocationFromUri,
  dirname,
  fileViewPathScope,
  viewPathLocationFromUri,
  viewPathUriString,
} from "../../core/uri";
import { HostWebviewPanel } from "../../hooks";
import { inspectViewPath } from "../../inspect/props";
import { hasMinimumInspectVersion } from "../../inspect/version";
import { kInspectEvalLogFormatVersion } from "../inspect/inspect-constants";
import { InspectViewServer } from "../inspect/inspect-view-server";

import { LogviewPanel } from "./logview-panel";
import { LogviewState } from "./logview-state";

export const kInspectLogViewType = "inspect-ai.log-editor";

interface InspectLogDocument extends vscode.CustomDocument {
  resourceUri: Uri;
  resourceLocation: string;
  canonicalLocation: boolean;
  sample_id?: string;
  epoch?: string;
}

export function resolveLogDocumentLocation(uri: Uri): {
  resourceUri: Uri;
  resourceLocation: string;
  canonicalLocation: boolean;
  sample_id?: string;
  epoch?: string;
} {
  const canonicalLocation = canonicalViewPathLocationFromUri(uri);
  const opaqueLocation = viewPathLocationFromUri(uri);
  const queryParams = new URLSearchParams(uri.query);
  const sampleIds = queryParams.getAll("sample_id");
  const epochs = queryParams.getAll("epoch");
  const isViewStateQuery =
    !canonicalLocation &&
    !opaqueLocation &&
    sampleIds.length === 1 &&
    epochs.length === 1 &&
    [...queryParams.keys()].every(
      (key) => key === "sample_id" || key === "epoch"
    );

  const resourceUri = uri.with({
    query: isViewStateQuery ? "" : uri.query,
    fragment: "",
  });
  return {
    resourceUri,
    resourceLocation:
      canonicalLocation ?? opaqueLocation ?? viewPathUriString(resourceUri),
    canonicalLocation: canonicalLocation !== undefined,
    sample_id: isViewStateQuery ? sampleIds[0] : undefined,
    epoch: isViewStateQuery ? epochs[0] : undefined,
  };
}

class InspectLogReadonlyEditor implements vscode.CustomReadonlyEditorProvider {
  static register(
    context: vscode.ExtensionContext,
    server: InspectViewServer
  ): vscode.Disposable {
    const provider = new InspectLogReadonlyEditor(context, server);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      kInspectLogViewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: false,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
    return providerRegistration;
  }

  constructor(
    private readonly context_: vscode.ExtensionContext,
    private readonly server_: InspectViewServer
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    const location = resolveLogDocumentLocation(uri);

    // Return the document with additional info attached to payload
    return {
      uri: uri,
      dispose: () => {},
      ...location,
    } satisfies InspectLogDocument;
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const doc = document as InspectLogDocument;
    const sample_id = doc.sample_id;
    const epoch = doc.epoch;

    const resourceUri = doc.resourceUri;
    const resourceLocation = doc.resourceLocation;
    const canonicalLocation = doc.canonicalLocation;

    // check if we should use the log viewer (version check + size threshold)
    let useLogViewer = hasMinimumInspectVersion(kInspectEvalLogFormatVersion);
    if (useLogViewer) {
      if (resourceUri.path.endsWith(".json")) {
        const fileSize = await this.server_.evalLogSize(
          resourceLocation,
          fileViewPathScope(
            resourceUri,
            canonicalLocation ? undefined : resourceLocation,
            canonicalLocation ? resourceLocation : undefined
          )
        );
        if (fileSize > 1024 * 1000 * 100) {
          log.info(
            `JSON log file ${document.uri.path} is to large for Inspect View, opening in text editor.`
          );
          useLogViewer = false;
        }
      }
    }

    if (useLogViewer) {
      const pathScope = fileViewPathScope(
        resourceUri,
        canonicalLocation ? undefined : resourceLocation,
        canonicalLocation ? resourceLocation : undefined
      );
      await pathScope.canonicalUri;

      // local resource roots
      const localResourceRoots: Uri[] = [];
      const viewDir = inspectViewPath();
      if (viewDir) {
        localResourceRoots.push(Uri.file(viewDir.path));
      }
      Uri.joinPath(this.context_.extensionUri, "assets", "www");

      // set webview options
      webviewPanel.webview.options = {
        enableScripts: true,
        enableForms: true,
        localResourceRoots,
      };

      // editor panel implementation
      this.logviewPanel_ = new LogviewPanel(
        webviewPanel as HostWebviewPanel,
        this.context_,
        this.server_,
        pathScope
      );

      // set html
      const logViewState: LogviewState = {
        log_file: resourceUri,
        log_location: resourceLocation,
        canonical_location: canonicalLocation,
        log_dir: dirname(resourceUri),
        sample:
          sample_id && epoch
            ? {
                id: sample_id,
                epoch: epoch,
              }
            : undefined,
      };
      webviewPanel.webview.html =
        await this.logviewPanel_.getHtml(logViewState);
    } else {
      const viewColumn = webviewPanel.viewColumn;
      await vscode.commands.executeCommand(
        "vscode.openWith",
        resourceUri,
        "default",
        viewColumn
      );
    }
  }

  dispose() {
    this.logviewPanel_?.dispose();
  }

  private logviewPanel_?: LogviewPanel;
}

export function activateLogviewEditor(
  context: vscode.ExtensionContext,
  server: InspectViewServer
) {
  context.subscriptions.push(
    InspectLogReadonlyEditor.register(context, server)
  );
}
