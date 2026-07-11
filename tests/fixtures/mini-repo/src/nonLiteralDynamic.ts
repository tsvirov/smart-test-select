export async function loadDynamic(moduleName: string) {
  const mod: unknown = await import(moduleName);
  return mod;
}
