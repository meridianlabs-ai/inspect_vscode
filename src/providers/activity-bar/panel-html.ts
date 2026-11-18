// HTML for the activity bar's webview panels. This module doesn't import
// `vscode`, so the webview tests can render the panels outside VS Code.

export interface PanelResources {
  cspSource: string;
  nonce: string;
  scriptUri: string;
  codiconCssUri: string;
  codiconFontUri: string;
}

export function panelDocument(resources: PanelResources, body: string) {
  const { cspSource, nonce, scriptUri, codiconCssUri, codiconFontUri } =
    resources;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <!--
        Use a content security policy to only allow loading styles from our extension directory,
        and only allow scripts that have a specific nonce.
        (See the 'webview-sample' extension sample for img-src content security policy examples)
    -->
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style type="text/css">
    @font-face {
      font-family: "codicon";
      font-display: block;
      src: url("${codiconFontUri}?939d3cf562f2f1379a18b5c3113b59cd") format("truetype");
    }
    </style>
    <link rel="stylesheet" type="text/css" href="${codiconCssUri}">
    <title>Task Options</title>
  </head>
  <body>
    ${body}
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

const kInspectProviders = [
  "openai",
  "anthropic",
  "google",
  "mistral",
  "deepseek",
  "grok",
  "bedrock",
  "azureai",
  "together",
  "groq",
  "fireworks",
  "sambanova",
  "cf",
  "perplexity",
  "hf",
  "vllm",
  "sglang",
  "transformer_lens",
  "ollama",
  "llama-cpp-python",
  "openai-api",
  "openrouter",
  "hf-inference-providers",
];

interface TextFieldOptions {
  id: string;
  label: string;
  placeholder?: string;
  title?: string;
  className?: string;
}

function textField(options: TextFieldOptions): string {
  const { id, label, placeholder = "default", title, className } = options;
  const classes = ["field", className].filter(Boolean).join(" ");
  const titleAttr = title ? ` title="${title}"` : "";
  return `
    <div class="${classes}"${titleAttr}>
      <label class="field-label" for="${id}">${label}</label>
      <input id="${id}" class="text-input" placeholder="${placeholder}">
    </div>`;
}

// The provider is free text, since Inspect accepts providers this list
// doesn't know about (mockllm, or ones that packages register). A datalist
// suggests the common ones; like the log level's <select>, its popup draws
// outside the webview, so the short Configuration view can't clip it.
function modelPickerHTML(): string {
  const providerOptions = kInspectProviders.map((provider) => {
    return `<option value="${provider}"></option>`;
  });
  return `
    <div class="field full-width">
      <div id="provider-label-container"><span class="field-label">Model</span></div>
      <input id="provider" class="text-input" list="provider-list" aria-label="Provider" placeholder="Provider" autocomplete="off" spellcheck="false">
      <datalist id="provider-list">
        ${providerOptions.join("\n")}
      </datalist>
    </div>
    <div class="field full-width">
      <input id="model" class="text-input" placeholder="Model Name">
    </div>
    <div id="show-base-url-container" class="full-width">
      <button type="button" id="show-base-url" class="icon-button" title="Model base URL"><i class="codicon codicon-ellipsis"></i></button>
    </div>
    <div id="model-base-url-container" class="field full-width hidden">
      <input id="model-base-url" class="text-input" placeholder="Model Base Url">
    </div>`;
}

const kLogLevels = [
  "debug",
  "trace",
  "http",
  "info",
  "warning",
  "error",
  "critical",
];

export function inspectConfigBody(): string {
  const logLevelOptions = kLogLevels.map((level) => {
    return `<option value="${level}">${level}</option>`;
  });
  return `
    <section class="component-container">
      <div id="configuration-controls" class="hidden full-width">
        <vscode-tabs>
          <vscode-tab-header slot="header">Model</vscode-tab-header>
          <vscode-tab-panel>
            <div class="rows full-width">
              ${modelPickerHTML()}
              <div class="cols full-width three-cols">
                ${textField({ id: "max-connections", label: "Connections" })}
                ${textField({ id: "max-retries", label: "Retries" })}
                ${textField({ id: "timeout", label: "Timeout" })}
              </div>
            </div>
          </vscode-tab-panel>
          <vscode-tab-header slot="header">Logging</vscode-tab-header>
          <vscode-tab-panel>
            <div class="rows full-width">
              ${textField({ id: "log-dir", label: "Log Directory", className: "full-width" })}
              <div class="field full-width">
                <label class="field-label" for="log-level">Log Level</label>
                <select id="log-level" class="select-input">
                  <option value="">default</option>
                  ${logLevelOptions.join("\n")}
                </select>
              </div>
            </div>
          </vscode-tab-panel>
        </vscode-tabs>
      </div>
    </section>`;
}

export function taskConfigBody(): string {
  return `
    <section class="component-container">
      <div id="configuration-controls" class="hidden full-width">
        <vscode-tabs>
          <vscode-tab-header slot="header">Options</vscode-tab-header>
          <vscode-tab-panel>
            <div class="cols full-width two-cols">
              ${textField({ id: "limit", label: "Limit", title: "Limit samples to evaluate e.g. 10 or 10-20" })}
              ${textField({ id: "epochs", label: "Epochs", title: "Number of times to repeat dataset (defaults to 1)" })}
              ${textField({ id: "max_tokens", label: "Max Tokens", title: "The maximum number of tokens that can be generated in the completion (default is model specific)." })}
              ${textField({ id: "temperature", label: "Temperature", title: "What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic." })}
              ${textField({ id: "top_p", label: "Top P", title: "An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass." })}
              ${textField({ id: "top_k", label: "Top K", title: "Randomly sample the next word from the top_k most likely next words. Anthropic, Google, HuggingFace, and vLLM only." })}
              ${textField({ id: "sample_ids", label: "Sample Ids", placeholder: "none", className: "span-cols", title: "One or more sample ids to evaluate (comma separated)" })}
            </div>
            <div id="validation-error" class="full-width cols hidden error"></div>
          </vscode-tab-panel>
          <vscode-tab-header slot="header">Task Args</vscode-tab-header>
          <vscode-tab-panel>
            <div id="task-args" class="full-width rows"></div>
          </vscode-tab-panel>
        </vscode-tabs>
      </div>
    </section>`;
}

export function scoutPanelBody(): string {
  return `
        <section class="component-container">
          <div id="scout-panel" class="hidden">
            <div class="nav-links">
              <a class="nav-link" data-target="project">
                <i class="codicon codicon-settings-gear"></i>
                <div class="nav-text">
                  <span class="nav-title">Project Config</span>
                  <span class="nav-description">Edit project settings</span>
                </div>
              </a>
              <a class="nav-link" data-target="transcripts">
                <i class="codicon codicon-file-text"></i>
                <div class="nav-text">
                  <span class="nav-title">Transcripts</span>
                  <span class="nav-description">Browse transcripts</span>
                </div>
              </a>
              <a class="nav-link" data-target="scans">
                <i class="codicon codicon-graph"></i>
                <div class="nav-text">
                  <span class="nav-title">Scans</span>
                  <span class="nav-description">View scan results</span>
                </div>
              </a>
              <a class="nav-link" data-target="validations">
                <i class="codicon codicon-checklist"></i>
                <div class="nav-text">
                  <span class="nav-title">Validations</span>
                  <span class="nav-description">Review validation sets</span>
                </div>
              </a>
            </div>
          </div>
          <div id="no-package" class="hidden">
            <p>Scout is not installed.</p>
          </div>
        </section>`;
}
