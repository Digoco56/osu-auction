const form = document.getElementById('mappool-config-form');
const sheetInput = document.getElementById('mappool-sheets');
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
      ? 'Google Sheets is configured.'
      : 'Configure the Apps Script URL and token on the server.';
    sections = configuration.sections.map(section => ({
      name: section.sheet_name,
      isPublic: section.is_public
    }));
    sheetInput.value = sections.map(section => section.name).join('\n');
    renderSections(sections);
  } catch (error) {
    console.error('Error loading mappool configuration:', error);
    statusMessage.textContent = 'Mappool configuration could not be loaded.';
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const names = sheetInput.value.split('\n').map(name => name.trim()).filter(Boolean);
  const current = [...sectionsContainer.querySelectorAll('input[type="checkbox"]')];
  const sections = names.map(name => ({
    name,
    isPublic: current.find(input => input.dataset.sheetName === name)?.checked || false
  }));

  try {
    const response = await fetch('/admin/mappool/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'The server rejected the configuration.');
    }
    statusMessage.textContent = 'Mappool tabs saved.';
    renderSections(sections);
  } catch (error) {
    console.error('Error saving mappool configuration:', error);
    statusMessage.textContent = error.message;
  }
});

function renderSections(sectionData) {
  sectionsContainer.innerHTML = '';
  if (!sectionData?.length) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'empty-state';
    emptyMessage.textContent = 'No tabs configured.';
    sectionsContainer.appendChild(emptyMessage);
    return;
  }

  sectionData.forEach(section => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = section.isPublic;
    checkbox.dataset.sheetName = section.name;
    label.append(checkbox, ` Public: ${section.name}`);
    sectionsContainer.appendChild(label);
  });
}