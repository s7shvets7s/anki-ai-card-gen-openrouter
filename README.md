# Anki AI Card Gen

Browser extension for Google Chrome and Microsoft Edge. Select a word or short phrase on any page, send it to an LLM, generate a flashcard, and add it to Anki through AnkiConnect.

## Features

- Automatic card generation after selecting a word.
- Floating `+ Anki` button near the selection.
- Selection context menu.
- Popup button for explicit debug-friendly creation from the current selection.
- Keyboard shortcut: `Alt+Shift+A`.
- Multiple LLM API key profiles.
- Configurable `Base URL`, model, and prompt.
- Configurable Anki deck, note type, `Front` and `Back` fields, and tags.
- Configurable LLM and AnkiConnect timeouts.
- Works in Chromium-based Microsoft Edge as an unpacked extension.

## Install in Microsoft Edge

1. Install Anki.
2. Install the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) Anki add-on.
3. Open Anki so AnkiConnect listens on `http://127.0.0.1:8765`.
4. Open `edge://extensions` in Microsoft Edge.
5. Enable Developer mode.
6. Click Load unpacked.
7. Select this project folder.
8. Open the extension options, add your API key, and run the AnkiConnect test.

## Install in Chrome

1. Install Anki.
2. Install the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) Anki add-on.
3. Open Anki so AnkiConnect listens on `http://127.0.0.1:8765`.
4. Open `chrome://extensions` in Chrome.
5. Enable Developer mode.
6. Click Load unpacked.
7. Select this project folder.
8. Open the extension options, add your API key, and run the AnkiConnect test.

## LLM Settings

The default endpoint is OpenRouter-compatible:

```text
https://openrouter.ai/api/v1
```

You can add multiple API key profiles and switch between them. For OpenAI-compatible providers, set `Base URL` to the API root, for example:

```text
https://api.openai.com/v1
```

The extension appends `/chat/completions` automatically when the full endpoint is not provided.

Use Check LLM key in the options page after editing a profile. The test sends a tiny chat request and reports whether the key, base URL, and model are accepted. If a model is slow, raise the LLM timeout or switch to a faster model.

## Prompt

The prompt supports these variables:

- `{{word}}` - selected word or phrase.
- `{{context}}` - short text fragment around the selection.
- `{{language}}` - target language from the options page.

The LLM should return strict JSON. If you edit the prompt, keep the default response shape or compatible fields: `term`, `reading`, `partOfSpeech`, `translation`, `definition`, `examples`, `mnemonic`, `tags`.

## Anki

The default setup targets Anki note type `Basic` with fields `Front` and `Back`. For custom Anki note templates, enter the exact field names in the extension options.

Use Check Anki settings before generating cards. The extension validates that:

- AnkiConnect is reachable.
- The configured deck exists.
- The configured note type exists.
- The configured `Front` and `Back` fields exist on that note type.

The extension checks Anki before calling the LLM, so a broken Anki setup will not spend API tokens.

## Edge Notes

Microsoft Edge supports this extension through the Chromium extension APIs used in `manifest.json`. If the keyboard shortcut does not trigger, open `edge://extensions/shortcuts` and assign the shortcut manually.

## Debug Checklist

- Reload the target web page after loading or reloading the unpacked extension.
- The extension cannot run content scripts on browser pages like `edge://extensions`, `chrome://extensions`, or the web store.
- Keep Anki open while generating cards.
- Run Check LLM key and Check Anki settings from the options page.
- If generation starts but never finishes, lower the model latency or increase the LLM timeout in options.
