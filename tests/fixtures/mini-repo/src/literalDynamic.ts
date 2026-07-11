export async function loadA() {
  const mod = await import('./a.js');
  return mod.makeA(1);
}
