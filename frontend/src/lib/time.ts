export function toLocal(ts: string) {
  return new Date(ts).toLocaleString("pt-BR", { timeZone: "America/Araguaina" });
}
