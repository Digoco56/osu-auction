const message = document.getElementById('mappool-message');
const container = document.getElementById('mappool-sections');

fetch('/api/user')
  .then(response => response.ok ? response.json() : null)
  .then(user => {
    if (!user) return;
    document.getElementById('mappool-account-area').hidden = false;
    document.getElementById('mappool-username').textContent = user.username || 'Player';
    document.getElementById('mappool-role').textContent = (user.role || 'player')
      .replace(/^./, character => character.toUpperCase());
    if (user.avatar_url) document.getElementById('mappool-user-avatar').src = user.avatar_url;
    document.getElementById('admin-nav-link').hidden = (user.role || '').toLowerCase() !== 'admin';
  })
  .catch(error => console.error('Could not load mappool user:', error));

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
  console.log(section);
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
      } else if (isMapLinkColumn(column)) {
        const mapUrl = getBeatmapUrl(row[column], row, columns);
        if (mapUrl) {
          const link = document.createElement('a');
          link.href = mapUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = row[column] || '';
          cell.appendChild(link);
        } else {
          cell.textContent = row[column] || '';
        }
      } else {
        appendMetricContent(cell, column, row[column]);
      }
      tableRow.appendChild(cell);
    });
    table.appendChild(tableRow);
  });

  wrapper.appendChild(table);
  return wrapper;
}

function isMapLinkColumn(column) {
  return /map\s*(id\s*\/\s*url|\+\s*url)/i.test(column.trim());
}

function getBeatmapUrl(value, row, columns) {
  const text = String(value ?? '').trim();
  const directUrl = text.match(/https?:\/\/[^\s)]+/i)?.[0];
  if (directUrl) return directUrl;

  const mapIdColumn = columns.find(column => /map\s*id\s*\/\s*url/i.test(column.trim()));
  const mapIdValue = mapIdColumn ? String(row[mapIdColumn] ?? '').trim() : text;
  const beatmapId = mapIdValue.match(/(?:beatmaps\/|#osu\/)?(\d+)$/i)?.[1];
  return beatmapId ? `https://osu.ppy.sh/beatmaps/${beatmapId}` : null;
}

function appendMetricContent(cell, column, value) {
  const text = String(value ?? '');
  const metric = column.trim().toLowerCase();
  const icons = {
    bpm: ['bi-metronome', 'Metronome'],
    drain: ['bi-clock', 'Analog clock']
  };

  if (!text || !icons[metric]) {
    cell.textContent = text;
    return;
  }

  const content = document.createElement('span');
  content.className = 'mappool-metric';
  const valueText = document.createElement('span');
  valueText.textContent = text;
  const icon = document.createElement('span');
  icon.className = `mappool-metric-icon mappool-${metric}-icon bi ${icons[metric][0]}`;
  icon.setAttribute('aria-label', icons[metric][1]);
  content.append(valueText, icon);
  cell.appendChild(content);
}