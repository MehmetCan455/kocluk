const netFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatNet(net: number): string {
  return netFormatter.format(net);
}

export function formatPercent(percent: number): string {
  return `%${Math.round(percent)}`;
}
