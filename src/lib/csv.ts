// CSV dla polskiego Excela: średnik jako separator, BOM, CRLF.

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Tekst zaczynający się od =, +, - lub @ Excel uruchomiłby jako formułę.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers, ...rows].map((row) => row.map(cell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function csvBlob(headers: string[], rows: Array<Array<string | number | null | undefined>>): Blob {
  return new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
}

/** Kwota do CSV bez symbolu waluty, np. 123450 -> "1234,50". */
export function csvMoney(grosze: number): string {
  return (grosze / 100).toFixed(2).replace('.', ',');
}
