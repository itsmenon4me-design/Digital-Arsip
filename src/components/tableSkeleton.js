export function renderTableSkeleton(tbody, columnCount, rowCount = 4) {
  tbody.replaceChildren()
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = document.createElement('tr')
    row.className = 'table-skeleton-row'
    row.setAttribute('aria-hidden', 'true')
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const cell = document.createElement('td')
      const bar = document.createElement('span')
      bar.className = `table-skeleton-bar table-skeleton-width-${(rowIndex + columnIndex) % 3 + 1}`
      cell.append(bar)
      row.append(cell)
    }
    tbody.append(row)
  }
}
