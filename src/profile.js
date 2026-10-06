export const PROFILE_SETTING_IDS = Object.freeze([
  'font-family', 'font-size', 'line-height', 'letter-spacing', 'word-spacing',
  'paragraph-spacing', 'text-width', 'font-weight', 'text-align', 'preset',
  'background-color', 'text-color', 'ruler-color', 'highlight-color', 'dim-level',
  'ruler-mode', 'ruler-size', 'ruler-opacity', 'speech-follow-ruler',
  'footnote-view', 'endnote-view', 'citation-view', 'reference-view',
  'show-furniture', 'speak-citations', 'speak-footnotes', 'speak-endnotes',
  'speak-references', 'speak-furniture'
]);

export function exportProfile(values) {
  const settings = Object.fromEntries(PROFILE_SETTING_IDS.map(id => [id, values[id]]));
  if (Object.values(settings).some(value => !['string', 'number', 'boolean'].includes(typeof value))) throw new Error('Incomplete profile');
  return JSON.stringify({ format: 'richards-reader-profile', version: 1, settings }, null, 2);
}

export function importProfile(json) {
  const parsed = JSON.parse(json);
  if (parsed?.format !== 'richards-reader-profile' || parsed.version !== 1 || !parsed.settings ||
      Object.keys(parsed.settings).length !== PROFILE_SETTING_IDS.length ||
      Object.keys(parsed.settings).some(id => !PROFILE_SETTING_IDS.includes(id)) ||
      PROFILE_SETTING_IDS.some(id => !['string', 'number', 'boolean'].includes(typeof parsed.settings[id]))) {
    throw new Error('This is not a supported Reader profile');
  }
  return parsed.settings;
}
