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
  setStatus('Tabs added. Select which tabs are public, then update visibility.');
});

updateVisibilityButton.addEventListener('click', async () => {
  updateVisibilityButton.disabled = true;
  updateVisibilityButton.setAttribute('aria-busy', 'true');
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
  setStatus('Updating mappool visibility', 'updating');

  try {
    const response = await fetch('/admin/mappool/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'Mappool visibility could not be updated.');
    }
    const result = await response.json();
    if (result.warnings?.length) {
      setStatus(`Visibility updated with warning: ${result.warnings.join(' ')}`, 'warning');
    } else {
      setStatus('Mappool visibility updated!', 'success');
    }
  } catch (error) {
    console.error('Error updating mappool visibility:', error);
    setStatus(error.message, 'error');
  } finally {
    updateVisibilityButton.disabled = false;
    updateVisibilityButton.removeAttribute('aria-busy');
  }
});

function setStatus(message, state = '') {
  mappoolStatusMessage.className = `status-message ${state}`;
  mappoolStatusMessage.textContent = message;
}

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
