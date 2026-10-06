export const PROFILE_SETTING_IDS = Object.freeze([
  'font-family', 'font-size', 'line-height', 'letter-spacing', 'word-spacing',
  'paragraph-spacing', 'text-width', 'font-weight', 'text-align', 'preset',
  'background-color', 'text-color', 'ruler-color', 'highlight-color', 'word-highlight-color', 'dim-level',
  'ruler-mode', 'ruler-size', 'ruler-opacity', 'speech-follow-ruler',
  'footnote-view', 'endnote-view', 'citation-view', 'reference-view',
  'show-furniture', 'speak-citations', 'speak-footnotes', 'speak-endnotes',
  'speak-references', 'speak-furniture', 'equation-speech'
]);

export const WORD_HIGHLIGHT_DEFAULT = '#ffbd5c';
const LEGACY_DEFAULTS = Object.freeze({ 'word-highlight-color': WORD_HIGHLIGHT_DEFAULT, 'equation-speech': 'announce' });

export function exportProfile(values) {
  const settings = Object.fromEntries(PROFILE_SETTING_IDS.map(id => [id, values[id]]));
  if (Object.values(settings).some(value => !['string', 'number', 'boolean'].includes(typeof value))) throw new Error('Incomplete profile');
  return JSON.stringify({ format: 'richards-reader-profile', version: 1, settings }, null, 2);
}

export function importProfile(json) {
  const parsed = JSON.parse(json);
  if (parsed?.format !== 'richards-reader-profile' || parsed.version !== 1 || !parsed.settings ||
      Object.keys(parsed.settings).some(id => !PROFILE_SETTING_IDS.includes(id)) ||
      PROFILE_SETTING_IDS.some(id => !['string', 'number', 'boolean'].includes(typeof (parsed.settings[id] ?? LEGACY_DEFAULTS[id])))) {
    throw new Error('This is not a supported Reader profile');
  }
  return Object.fromEntries(PROFILE_SETTING_IDS.map(id => [id, parsed.settings[id] ?? LEGACY_DEFAULTS[id]]));
}
