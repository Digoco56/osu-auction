const addTabsButton = document.getElementById('add-mappool-tabs-button');
const updateVisibilityButton = document.getElementById('update-mappool-visibility-button');
const sheetInput = document.getElementById('mappool-sheets');
const sectionsContainer = document.getElementById('mappool-sections');
const mappoolStatusMessage = document.getElementById('mappool-config-status');

loadConfiguration();

async function loadConfiguration() {
  const response = await fetch('/admin/mappool');
  if (!response.ok) return;
  const configuration = await response.json();
  mappoolStatusMessage.textContent = configuration.spreadsheetConfigured
    ? 'Google Sheets is configured.'
    : 'Configure the Apps Script URL and token on the server.';
  sheetInput.value = configuration.sections.map(section => section.sheet_name).join('\n');
  renderSections(configuration.sections);
}

addTabsButton.addEventListener('click', () => {
  const names = getNames();
  const current = getCurrentVisibility();
  const sections = names.map(name => ({
    name,
    isPublic: current[name] || false
  }));

  renderSections(sections);
  mappoolStatusMessage.textContent = 'Tabs added. Select which tabs are public, then update visibility.';
});

updateVisibilityButton.addEventListener('click', async () => {
  const names = getNames();
  const current = [...sectionsContainer.querySelectorAll('input[type="checkbox"]')];
  const sections = names.map(name => ({
    name,
    isPublic: current.find(input => input.dataset.sheetName === name)?.checked || false
  }));

  renderSections(sections.map(section => ({
    sheet_name: section.name,
    is_public: section.isPublic
  })));
  mappoolStatusMessage.textContent = 'Updating mappool visibility...';

  try {
    const response = await fetch('/admin/mappool/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections })
    });
    mappoolStatusMessage.textContent = response.ok ? 'Mappool visibility updated.' : await response.text();
  } catch (error) {
    console.error('Error updating mappool visibility:', error);
    mappoolStatusMessage.textContent = 'Could not update mappool visibility. The current list is still visible.';
  }
});

function getNames() {
  return sheetInput.value.split('\n').map(name => name.trim()).filter(Boolean);
}

function getCurrentVisibility() {
  return Object.fromEntries([...sectionsContainer.querySelectorAll('input[type="checkbox"]')]
    .map(input => [input.dataset.sheetName, input.checked]));
}

function renderSections(sections) {
  sectionsContainer.innerHTML = '';
  sections.forEach(section => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = section.is_public ?? section.isPublic;
    checkbox.dataset.sheetName = section.sheet_name ?? section.name;
    label.append(checkbox, ` Public: ${checkbox.dataset.sheetName}`);
    sectionsContainer.appendChild(label);
  });
}
