(function initLlmProviders(globalScope) {
  const providers = [
    {
      id: "openrouter",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      models: ["openai/gpt-4o-mini"],
      keyRequired: true
    },
    {
      id: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      models: ["gpt-4o-mini", "gpt-5-mini", "gpt-4.1-mini"],
      keyRequired: true
    },
    {
      id: "groq",
      name: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-20b",
      models: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.6-27b"],
      keyRequired: true
    },
    {
      id: "together",
      name: "Together AI",
      baseUrl: "https://api.together.ai/v1",
      model: "openai/gpt-oss-20b",
      models: ["openai/gpt-oss-20b", "moonshotai/Kimi-K2.5", "openai/gpt-oss-120b"],
      keyRequired: true
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      models: ["deepseek-chat", "deepseek-reasoner"],
      keyRequired: true
    },
    {
      id: "mistral",
      name: "Mistral AI",
      baseUrl: "https://api.mistral.ai/v1",
      model: "mistral-small-latest",
      models: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
      keyRequired: true
    },
    {
      id: "gemini",
      name: "Google Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.6-flash",
      models: ["gemini-3.6-flash", "gemini-3.6-pro"],
      keyRequired: true
    },
    {
      id: "ollama",
      name: "Ollama (local)",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
      models: ["llama3.2", "qwen3", "gemma3"],
      keyRequired: false
    },
    {
      id: "custom",
      name: "Custom OpenAI-compatible",
      baseUrl: "",
      model: "",
      keyRequired: true
    }
  ];

  function get(providerId) {
    return providers.find((provider) => provider.id === providerId) || providers[providers.length - 1];
  }

  function detect(baseUrl) {
    const value = String(baseUrl || "").toLowerCase();
    if (!value) return "custom";
    return providers.find((provider) => provider.id !== "custom" && value.startsWith(provider.baseUrl.toLowerCase()))?.id || "custom";
  }

  globalScope.LlmProviders = Object.freeze({ providers, get, detect });
})(globalThis);
