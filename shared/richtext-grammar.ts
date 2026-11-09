/** Shared editor/renderer grammar. Raw HTML, images and arbitrary attributes are excluded. */
export const richtextGrammar = {
  inline: ['strong', 'emphasis', 'link', 'lineBreak'],
  block: ['paragraph', 'bulletList'],
  linkSchemes: ['https:', 'http:', 'mailto:', '/path', '#anchor'],
} as const;
