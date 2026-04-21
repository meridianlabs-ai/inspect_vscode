import { HostWebviewPanel } from ".";
import {
  ViewColumn,
  WebviewOptions,
  WebviewPanelOptions,
  window,
} from "vscode";

export function createPreviewPanel(
  viewType: string,
  title: string,
  preserveFocus?: boolean,
  options?: WebviewPanelOptions & WebviewOptions
): HostWebviewPanel {
  return window.createWebviewPanel(
    viewType,
    title,
    {
      viewColumn: ViewColumn.Beside,
      preserveFocus,
    },
    options
  ) as HostWebviewPanel;
}
