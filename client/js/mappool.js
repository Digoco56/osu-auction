const message = document.getElementById('mappool-message');
const container = document.getElementById('mappool-sections');

fetch('/api/mappool')
  .then(response => response.ok ? response.json() : Promise.reject())
  .then(({ sections }) => {
    if (!sections.length) {
      message.textContent = 'No mappool sections are public yet.';
      return;
    }

    message.textContent = '';
    sections.forEach(section => container.appendChild(createSection(section)));
  })
  .catch(() => {
    message.textContent = 'The mappool could not be loaded.';
  });

function createSection(section) {
  const wrapper = document.createElement('section');
  wrapper.className = 'mappool-section';
  const heading = document.createElement('h2');
  heading.textContent = section.name;
  wrapper.appendChild(heading);

  if (!section.rows.length) {
    const empty = document.createElement('p');
    empty.textContent = 'This section is empty.';
    wrapper.appendChild(empty);
    return wrapper;
  }

  const columns = Object.keys(section.rows[0]);
  const table = document.createElement('table');
  const header = document.createElement('tr');
  columns.forEach(column => {
    const cell = document.createElement('th');
    cell.textContent = column;
    header.appendChild(cell);
  });
  table.appendChild(header);

  section.rows.forEach(row => {
    const tableRow = document.createElement('tr');
    const firstColumnValue = String(row[columns[0]] ?? '').trim().toUpperCase();
    const modColors = ['NM', 'HD', 'HR', 'DT', 'HP', 'FM', 'TB'];
    const mod = modColors.find(prefix => firstColumnValue.startsWith(prefix));
    if (mod) {
      tableRow.classList.add(`mappool-${mod.toLowerCase()}-row`);
    }
    columns.forEach(column => {
      const cell = document.createElement('td');
      if (column.trim().toLowerCase() === 'banner' && row[column]) {
        const image = document.createElement('img');
        image.className = 'mappool-banner';
        image.src = row[column];
        image.alt = 'Beatmap banner';
        image.loading = 'lazy';
        cell.appendChild(image);
      } else {
        cell.textContent = row[column] || '';
      }
      tableRow.appendChild(cell);
    });
    table.appendChild(tableRow);
  });

  wrapper.appendChild(table);
  return wrapper;
}