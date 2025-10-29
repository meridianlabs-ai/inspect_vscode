import { openUrl, setEnvValue, setEnvWhenKeyup } from "./webview-utils";

export const kModelInfo: Record<string, string> = {
  openai: "https://platform.openai.com/docs/models/overview",
  anthropic: "https://docs.anthropic.com/claude/docs/models-overview",
  google: "https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models",
  mistral: "https://docs.mistral.ai/getting-started/models",
  deepseek: "https://api-docs.deepseek.com/quick_start/pricing",
  grok: "https://docs.x.ai/docs/models",
  bedrock:
    "https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html",
  azureai: "https://ai.azure.com/explore/models",
  together: "https://docs.together.ai/docs/inference-models#chat-models",
  groq: "https://console.groq.com/docs/models",
  fireworks: "https://fireworks.ai/models?modelTypes=LLM",
  sambanova: "https://docs.sambanova.ai/docs/en/models/sambacloud-models",
  cf: "https://developers.cloudflare.com/workers-ai/models/?tasks=Text+Generation",
  perplexity: "https://docs.perplexity.ai/getting-started/models",
  hf: "https://huggingface.co/models?pipeline_tag=text-generation&sort=trending",
  vllm: "https://docs.vllm.ai/en/latest/models/supported_models.html",
  sglang: "https://docs.sglang.ai/supported_models/generative_models.html",
  transformer_lens:
    "https://transformerlensorg.github.io/TransformerLens/generated/model_properties_table.html",
  ollama: "https://ollama.com/search",
  "llama-cpp-python":
    "https://llama-cpp-python.readthedocs.io/en/latest/#pulling-models-from-hugging-face-hub",
  openrouter: "https://openrouter.ai/models",
  "hf-inference-providers":
    "https://huggingface.co/docs/inference-providers/en/index",
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
