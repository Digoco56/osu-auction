const form = document.getElementById('mappool-config-form');
const sheetInput = document.getElementById('mappool-sheet-name');
const addSheetButton = document.getElementById('add-sheet-button');
const sectionsContainer = document.getElementById('mappool-sections');
const statusMessage = document.getElementById('mappool-config-status');
let sections = [];

loadConfiguration();

async function loadConfiguration() {
  try {
    const response = await fetch('/admin/mappool');
    if (!response.ok) throw new Error('Could not load mappool configuration');
    const configuration = await response.json();
    statusMessage.textContent = configuration.spreadsheetConfigured
      ? 'Google Sheets está configurado.'
      : 'Configura la URL y el token de Apps Script en el servidor.';
    sections = configuration.sections.map(section => ({
      name: section.sheet_name,
      isPublic: section.is_public
    }));
    renderSections();
  } catch (error) {
    console.error('Error loading mappool configuration:', error);
    statusMessage.textContent = 'No se pudo cargar la configuración del mappool.';
  }
}

addSheetButton.addEventListener('click', addSheet);
sheetInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addSheet();
  }
});

function addSheet() {
  const name = sheetInput.value.trim();
  if (!name) return;
  if (sections.some(section => section.name.toLowerCase() === name.toLowerCase())) {
    statusMessage.textContent = 'Esa pestaña ya está añadida.';
    return;
  }
  sections.push({ name, isPublic: false });
  sheetInput.value = '';
  statusMessage.textContent = '';
  renderSections();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const payload = sections.map(section => ({
    name: section.name,
    isPublic: section.isPublic
  }));
  try {
    const response = await fetch('/admin/mappool/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections: payload })
    });
    if (!response.ok) throw new Error(await response.text());
    statusMessage.textContent = 'Visibilidad guardada correctamente.';
  } catch (error) {
    console.error('Error saving mappool configuration:', error);
    statusMessage.textContent = 'No se pudo guardar la visibilidad.';
  }
});

function renderSections() {
  sectionsContainer.innerHTML = '';
  if (!sections.length) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'empty-state';
    emptyMessage.textContent = 'Todavía no hay pestañas añadidas.';
    sectionsContainer.appendChild(emptyMessage);
    return;
  }

  sections.forEach((section, index) => {
    const row = document.createElement('div');
    row.className = 'sheet-row';
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = section.isPublic;
    checkbox.addEventListener('change', () => {
      section.isPublic = checkbox.checked;
    });
    const name = document.createElement('span');
    name.textContent = section.name;
    label.append(checkbox, name);

    const removeButton = document.createElement('button');
    removeButton.className = 'remove-sheet-button';
    removeButton.type = 'button';
    removeButton.textContent = 'Quitar';
    removeButton.addEventListener('click', () => {
      sections.splice(index, 1);
      renderSections();
    });

    row.append(label, removeButton);
    sectionsContainer.appendChild(row);
  });
}