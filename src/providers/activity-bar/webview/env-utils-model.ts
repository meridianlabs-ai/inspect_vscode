import {
  openUrl,
  setEnvValue,
  setEnvWhenKeyup,
  setEnvWhenValueChanged,
} from "./webview-utils";

export const kModelInfo: Record<string, string> = {
  openai: "https://platform.openai.com/docs/models/overview",
  anthropic: "https://docs.anthropic.com/claude/docs/models-overview",
  google: "https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models",
  mistral: "https://docs.mistral.ai/platform/endpoints/",
  hf: "https://huggingface.co/models?pipeline_tag=text-generation&sort=trending",
  together: "https://docs.together.ai/docs/inference-models#chat-models",
  bedrock:
    "https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html",
  azureai: "https://ai.azure.com/explore/models",
  cf: "https://developers.cloudflare.com/workers-ai/models/#text-generation",
};
export function getModelEl() {
  return document.getElementById("model") as HTMLInputElement;
}
export function getProviderEl() {
  return document.getElementById("provider") as HTMLSelectElement;
}
export function getProviderText() {
  const providerEl = getProviderEl();
  return providerEl.value;
}
export function resetModel() {
  const modelEl = getModelEl();
  modelEl.value = "";
}
export function showProviderHelp(vscode: any) {
  const providerEl = getProviderEl();

  // Shows a help icon next to the model name with additional model details
  let modelHelpEl = document.getElementById("model-help");
  if (modelHelpEl && !providerEl.value) {
    modelHelpEl.remove();
  } else {
    if (providerEl.value) {
      if (kModelInfo[getProviderText()]) {
        if (!modelHelpEl) {
          modelHelpEl = document.createElement("vscode-link");
          modelHelpEl.id = "model-help";
          modelHelpEl.setAttribute("title", "Available Models");
          const questionEl = document.createElement("div");
          questionEl.classList.add("codicon");
          questionEl.classList.add("codicon-question");
          modelHelpEl.appendChild(questionEl);

          const labelContainerEl = document.getElementById(
            "provider-label-container"
          );
          labelContainerEl?.appendChild(modelHelpEl);
          modelHelpEl.addEventListener("click", () => {
            openUrl(vscode, kModelInfo[getProviderText()]);
          });
        }
      } else {
        if (modelHelpEl) {
          modelHelpEl.remove();
        }
      }
    }
  }
}
export const attachModelListeners = (vscode: any) => {
  const providerChanged = (e: Event) => {
    // If the user chooses 'none' from the dropdown, this will fire
    const txt = getProviderText();
    if (txt === "") {
      getProviderEl().value = "";
    }
    if (e.target) {
      setEnvValue(vscode, "provider", txt);
      resetModel();
      showProviderHelp(vscode);
    }
  };

  const el = document.getElementById("provider") as HTMLSelectElement;

  el.addEventListener("change", providerChanged);

  setEnvWhenKeyup(vscode, "model", "model");

  setEnvWhenKeyup(vscode, "model-base-url", "modelBaseUrl");

  const showBaseUrlEl = document.getElementById(
    "show-base-url"
  ) as HTMLAnchorElement;
  showBaseUrlEl.addEventListener("click", () => {
    toggleBaseUrl();
  });

  setEnvWhenKeyup(vscode, "max-connections", "maxConnections");
  setEnvWhenValueChanged(vscode, "max-connections", "maxConnections");
  setEnvWhenKeyup(vscode, "max-retries", "maxRetries");
  setEnvWhenValueChanged(vscode, "max-retries", "maxRetries");
  setEnvWhenKeyup(vscode, "timeout", "timeout");
  setEnvWhenValueChanged(vscode, "timeout", "timeout");

  setEnvWhenKeyup(vscode, "log-dir", "logDir");
  setEnvWhenValueChanged(vscode, "log-level", "logLevel");
};
export function toggleBaseUrl() {
  const baseUrlContainerEl = document.getElementById(
    "model-base-url-container"
  );
  if (baseUrlContainerEl) {
    const hidden = baseUrlContainerEl.classList.contains("hidden");
    if (hidden) {
      baseUrlContainerEl.classList.remove("hidden");
    } else {
      baseUrlContainerEl.classList.add("hidden");
    }
  }
}
