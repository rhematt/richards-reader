// Defer sentence navigation until the browser's double-click window has passed.
export function createClickArbiter({ timer = setTimeout, clear = clearTimeout, onSentence, onDefine, delay = 250 }) {
  let pending = null;
  const cancel = () => { if (pending != null) clear(pending); pending = null; };
  return {
    click({ sentenceId, word, detail = 1 }) {
      if (detail > 1) { cancel(); return; }
      cancel();
      pending = timer(() => { pending = null; onSentence(sentenceId); }, delay);
    },
    doubleClick({ word }) {
      cancel();
      if (word) onDefine(word);
    },
    cancel
  };
}
