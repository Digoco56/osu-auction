const saveButton = document.getElementById('save-mappool-button');
const sheetInput = document.getElementById('mappool-sheets');
const sectionsContainer = document.getElementById('mappool-sections');
const statusMessage = document.getElementById('mappool-config-status');

loadConfiguration();

async function loadConfiguration() {
  const response = await fetch('/admin/mappool');
  if (!response.ok) return;
  const configuration = await response.json();
  statusMessage.textContent = configuration.spreadsheetConfigured
    ? 'Google Sheets is configured.'
    : 'Configure the Apps Script URL and token on the server.';
  sheetInput.value = configuration.sections.map(section => section.sheet_name).join('\n');
  renderSections(configuration.sections);
}

saveButton.addEventListener('click', async () => {
  const names = sheetInput.value.split('\n').map(name => name.trim()).filter(Boolean);
  const current = [...sectionsContainer.querySelectorAll('input[type="checkbox"]')];
  const sections = names.map(name => ({
    name,
    isPublic: current.find(input => input.dataset.sheetName === name)?.checked || false
  }));

  renderSections(sections.map(section => ({
    sheet_name: section.name,
    is_public: section.isPublic
  })));
  statusMessage.textContent = 'Saving mappool tabs...';

  try {
    const response = await fetch('/admin/mappool/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections })
    });
    statusMessage.textContent = response.ok ? 'Mappool tabs saved.' : await response.text();
  } catch (error) {
    console.error('Error saving mappool tabs:', error);
    statusMessage.textContent = 'Could not save mappool tabs. The current list is still visible.';
  }
});

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
