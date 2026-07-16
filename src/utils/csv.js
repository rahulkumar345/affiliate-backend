export function toCsv(headersList, rowsList) {
  const escapeCell = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headersList, ...rowsList].map((row) => row.map(escapeCell).join(',')).join('\n');
}

export function formatUsd(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
