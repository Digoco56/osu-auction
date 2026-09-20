window.openTeamImageEditor = async function openTeamImageEditor(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw new Error('Use a PNG, JPEG, or WebP image.');
  }
  if (file.size > 1400000) {
    throw new Error('Use an image smaller than 1.4 MB.');
  }

  const sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Could not read image.'));
    image.src = sourceUrl;
  });

  const dialog = document.createElement('dialog');
  dialog.className = 'image-editor-dialog';
  dialog.innerHTML = `
    <form class="image-editor-form" method="dialog">
      <div class="image-editor-header"><h2>Adjust team image</h2><button value="cancel" class="team-dialog-close">Close</button></div>
      <canvas width="360" height="360"></canvas>
      <label>Zoom <input class="image-editor-zoom" type="range" min="1" max="3" step="0.01" value="1"></label>
      <label>Horizontal <input class="image-editor-x" type="range" min="-1" max="1" step="0.01" value="0"></label>
      <label>Vertical <input class="image-editor-y" type="range" min="-1" max="1" step="0.01" value="0"></label>
      <div class="image-editor-actions"><button value="cancel" class="team-dialog-close">Cancel</button><button value="save" class="btn btn-primary">Use image</button></div>
    </form>`;
  document.body.append(dialog);
  const canvas = dialog.querySelector('canvas');
  const context = canvas.getContext('2d');
  const zoom = dialog.querySelector('.image-editor-zoom');
  const x = dialog.querySelector('.image-editor-x');
  const y = dialog.querySelector('.image-editor-y');

  function draw() {
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height) * Number(zoom.value);
    const width = image.width * scale;
    const height = image.height * scale;
    const offsetX = (canvas.width - width) / 2 + Number(x.value) * Math.max(0, (width - canvas.width) / 2);
    const offsetY = (canvas.height - height) / 2 + Number(y.value) * Math.max(0, (height - canvas.height) / 2);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, offsetX, offsetY, width, height);
  }
  [zoom, x, y].forEach(control => control.addEventListener('input', draw));
  draw();

  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const imageData = dialog.returnValue === 'save' ? canvas.toDataURL('image/jpeg', 0.9) : null;
      URL.revokeObjectURL(sourceUrl);
      dialog.remove();
      resolve(imageData);
    }, { once: true });
    dialog.showModal();
  });
};
