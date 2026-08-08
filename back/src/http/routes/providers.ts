import type { RouteHandler } from "../router";
import { sendJson } from "../responses";

export const listProvidersRoute: RouteHandler = async ({ res, ctx, rc }) => {
  const items = ctx.providerRegistry.list().map((provider) => {
    const capabilities = provider.getCapabilities();
    return {
      id: provider.name,
      displayName: provider.name === "gemini" ? "Gemini" : "DeepSeek",
      available: capabilities.available,
      capabilities: {
        inputs: capabilities.supportedInputs,
        languages: capabilities.supportedLanguages,
        maxPages: capabilities.maxInputPages,
        maxBytes: capabilities.maxInputBytes,
      },
    };
  });
  sendJson({ res, rc, body: { items } });
};
