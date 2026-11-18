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

function modelPickerHTML(modelCaption: string = "Model"): string {
  const modelOptions = kInspectProviders.map((model) => {
    return `<fast-option value="${model}">${model}</fast-option>`;
  });
  return `
                      <div class="dropdown-container full-width">
                        <div id="provider-label-container"><label id="provider-label" for="provider">${modelCaption}</label></div>
                        <div class="cols full-width no-wrap">
                          <fast-combobox autocomplete="both" id="provider" placeholder="Provider">
                            <fast-option value="">(none)</fast-option>
                            ${modelOptions.join("\n")}
                          </fast>
                        </div>
                      </div>
                      <div id="model-container">
                        <vscode-text-field placeholder="Model Name" id="model"></vscode-text-field>
                      </div>
                      <div id="show-base-url-container">
                        <vscode-link id="show-base-url"><i class="codicon codicon-ellipsis"></i></vscode-link>
                      </div>
                      <div id="model-base-url-container" class="hidden full-width">
                        <vscode-text-field placeholder="Model Base Url" id="model-base-url" class="full-width"></vscode-text-field>
                      </div>
    `;
}

export function inspectConfigBody(): string {
  return `
              <section class="component-container">
                <form id="configuration-controls" class="hidden">
                <vscode-panels>
                  <vscode-panel-tab id="tab-1">Model</vscode-panel-tab>
                  <vscode-panel-tab id="tab-2">Logging</vscode-panel-tab>
                  <vscode-panel-view id="view-1">

                    <div class="group rows full-width" >
                      ${modelPickerHTML()}
                      <div class="cols control-column full-width">
                        <vscode-text-field id="max-connections" size="3" placeholder="default" min="1">Connections</vscode-text-field>
                        <vscode-text-field id="max-retries" size="3" placeholder="default" min="1">Retries</vscode-text-field>
                        <vscode-text-field id="timeout" size="3" placeholder="default" min="1">Timeout</vscode-text-field>
                      </div>
                    </div>
                  </vscode-panel-view>
                  <vscode-panel-view id="view-2">
                    <div class="rows full-width">
                      <div class="cols full-width">
                        <vscode-text-field placeholder="default" id="log-dir" size="16" class="full-width"
                          >Log Directory</vscode-text-field
                        >

                        <div class="dropdown-container full-width">
                          <label for="provider">Log Level</label>
                          <vscode-dropdown id="log-level" position="below" class="full-width">
                            <vscode-option value="">default</vscode-option>
                            <vscode-option value="debug">debug</vscode-option>
                            <vscode-option value="trace">trace</vscode-option>
                            <vscode-option value="http">http</vscode-option>
                            <vscode-option value="info">info</vscode-option>
                            <vscode-option value="warning" selected="true">warning</vscode-option>
                            <vscode-option value="error">error</vscode-option>
                            <vscode-option value="critical">critical</vscode-option>
                          </vscode-dropdown>
                        </div>
                      </div>
                    </div>
                  </vscode-panel-view>
                </vscode-panels>
                </form>
              </section>`;
}

export function taskConfigBody(): string {
  return `
              <section class="component-container">
                <form id="configuration-controls" class="hidden">
                  <vscode-panels>
                  <vscode-panel-tab id="tab-1">Options</vscode-panel-tab>
                  <vscode-panel-tab id="tab-2">Task Args</vscode-panel-tab>
                  <vscode-panel-view id="view-1" class="flex-rows">
                    <div class="cols full-width two-cols">
                      <vscode-text-field id="limit" size="3" placeholder="default" title="Limit samples to evaluate e.g. 10 or 10-20">Limit</vscode-text-field>
                      <vscode-text-field id="epochs" size="3" placeholder="default" title="Number of times to repeat dataset (defaults to 1)">Epochs</vscode-text-field>
                      <vscode-text-field id="max_tokens" size="3" placeholder="default" title="The maximum number of tokens that can be generated in the completion (default is model specific).">Max Tokens</vscode-text-field>
                      <vscode-text-field id="temperature" size="3" placeholder="default" title="What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.">Temperature</vscode-text-field>
                      <vscode-text-field id="top_p" size="3" placeholder="default" title="An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass.">Top P</vscode-text-field>
                      <vscode-text-field id="top_k" size="3" placeholder="default" title="Randomly sample the next word from the top_k most likely next words. Anthropic, Google, HuggingFace, and vLLM only.">Top K</vscode-text-field>
                      <vscode-text-field id="sample_ids" size="3" placeholder="none" class="span-cols" title="One or more sample ids to evaluate (comma separated)">Sample Ids</vscode-text-field>
                    </div>
                    <div id="validation-error" class="full-width cols hidden error">
                    </div>
                  </vscode-panel-view>
                  <vscode-panel-view id="view-2">
                    <div id="task-args" class="full-width cols">
                    </div>
                  </vscode-panel-view>
                </vscode-panels>
                </form>
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
