import { Effect } from "effect"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { ModelV2Info } from "@opencode-ai/sdk/v2/types"

export interface SdkEvent {
  readonly model: ModelV2Info
  readonly package: string
  readonly options: Record<string, unknown>
  sdk?: unknown
}

export interface LanguageEvent {
  readonly model: ModelV2Info
  readonly sdk: unknown
  readonly options: Record<string, unknown>
  language?: LanguageModelV3
}

export interface MockPluginContext {
  readonly options: Record<string, unknown>
  readonly agent: unknown
  readonly aisdk: {
    sdk(callback: (input: SdkEvent) => Effect.Effect<void> | void): Effect.Effect<void>
    language(callback: (input: LanguageEvent) => Effect.Effect<void> | void): Effect.Effect<void>
  }
  readonly catalog: unknown
  readonly command: unknown
  readonly integration: unknown
  readonly plugin: unknown
  readonly reference: unknown
  readonly skill: unknown
}

export function createMockPluginContext(
  sdkCallback?: (evt: SdkEvent) => Effect.Effect<void> | void,
  languageCallback?: (evt: LanguageEvent) => Effect.Effect<void> | void
): MockPluginContext & {
  sdkEvt: SdkEvent | undefined
  languageEvt: LanguageEvent | undefined
  runSdk(evt: SdkEvent): Effect.Effect<void> | void
  runLanguage(evt: LanguageEvent): Effect.Effect<void> | void
} {
  let sdkEvt: SdkEvent | undefined
  let languageEvt: LanguageEvent | undefined

  return {
    options: {},
    agent: {},
    aisdk: {
      sdk(callback) {
        sdkCallback = callback
        return Effect.void
      },
      language(callback) {
        languageCallback = callback
        return Effect.void
      },
    },
    catalog: {},
    command: {},
    integration: {},
    plugin: {},
    reference: {},
    skill: {},
    get sdkEvt() {
      return sdkEvt
    },
    get languageEvt() {
      return languageEvt
    },
    runSdk(evt: SdkEvent) {
      sdkEvt = evt
      if (sdkCallback) return sdkCallback(evt)
    },
    runLanguage(evt: LanguageEvent) {
      languageEvt = evt
      if (languageCallback) return languageCallback(evt)
    },
  } as MockPluginContext & {
    sdkEvt: SdkEvent | undefined
    languageEvt: LanguageEvent | undefined
    runSdk(evt: SdkEvent): Effect.Effect<void> | void
    runLanguage(evt: LanguageEvent): Effect.Effect<void> | void
  }
}
