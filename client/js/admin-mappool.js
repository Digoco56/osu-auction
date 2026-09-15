const form = document.getElementById('mappool-config-form');
const sheetInput = document.getElementById('mappool-sheet-name');
const addSheetButton = document.getElementById('add-sheet-button');
const sectionsContainer = document.getElementById('mappool-sections');
const statusMessage = document.getElementById('mappool-config-status');
let sections = [];
let configurationLoaded = false;
const pendingSections = [];

loadConfiguration();

async function loadConfiguration() {
  try {
    const response = await fetch('/admin/mappool');
    if (!response.ok) throw new Error('Could not load mappool configuration');
    const configuration = await response.json();
    statusMessage.textContent = configuration.spreadsheetConfigured
      ? 'Google Sheets is configured.'
      : 'Configure the Apps Script URL and token on the server.';
    sections = configuration.sections.map(section => ({
      name: section.sheet_name,
      isPublic: section.is_public
    }));
    pendingSections.forEach(section => {
      if (!sections.some(existing => existing.name.toLowerCase() === section.name.toLowerCase())) {
        sections.push(section);
      }
    });
    configurationLoaded = true;
    renderSections();
  } catch (error) {
    console.error('Error loading mappool configuration:', error);
    statusMessage.textContent = 'Mappool configuration could not be loaded. Refresh and try again.';
  }
}

addSheetButton.addEventListener('click', event => {
  event.preventDefault();
  addSheet();
});
sheetInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addSheet();
  }
});

function addSheet() {
  const name = sheetInput.value.trim();
  if (!name) {
    statusMessage.textContent = 'Enter a Google Sheets tab name first.';
    sheetInput.focus();
    return;
  }
  if (sections.some(section => section.name.toLowerCase() === name.toLowerCase())) {
    statusMessage.textContent = 'That tab has already been added.';
    return;
  }
  const newSection = { name, isPublic: false };
  sections.push(newSection);
  if (!configurationLoaded) pendingSections.push(newSection);
  sheetInput.value = '';
  statusMessage.textContent = 'Tab added. Save visibility to apply the change.';
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
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'The server rejected the configuration.');
    }
    statusMessage.textContent = 'Visibility saved successfully.';
  } catch (error) {
    console.error('Error saving mappool configuration:', error);
    statusMessage.textContent = error.message;
  }
});

function renderSections() {
  sectionsContainer.innerHTML = '';
  if (!sections.length) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'empty-state';
    emptyMessage.textContent = 'No tabs have been added yet.';
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
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
      sections.splice(index, 1);
      renderSections();
    });

    row.append(label, removeButton);
    sectionsContainer.appendChild(row);
  });
}