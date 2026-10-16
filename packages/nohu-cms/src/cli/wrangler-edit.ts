/**
 * Modifications ciblées de wrangler.jsonc : remplace la valeur d'une clé
 * texte sans toucher au reste du fichier (commentaires compris).
 */
export function setJsoncString(
  source: string,
  key: string,
  value: string,
): string {
  const pattern = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`);
  if (!pattern.test(source)) {
    throw new Error(`Clé « ${key} » introuvable dans wrangler.jsonc.`);
  }
  return source.replace(
    pattern,
    (_, prefix: string) => `${prefix}${JSON.stringify(value)}`,
  );
}
