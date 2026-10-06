let dictionary;

export async function defineWord(selection) {
  const headword = String(selection || '').toLocaleLowerCase('en').replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!/^[a-z]{2,24}$/.test(headword)) return null;
  dictionary ||= import('./wordnet-data.js').then(module => module.default);
  const data = await dictionary;
  const senses = data[headword];
  return senses ? { headword, senses: senses.map(([partOfSpeech, definition]) => ({ partOfSpeech, definition })) } : null;
}
