const lista = document.getElementById('lista');
const entrada = document.getElementById('entrada');

async function cargar() {
  const res = await fetch('http://localhost:3000/api/items');
  const items = await res.json();
  lista.innerHTML = '';
  items.forEach(i => {
    const li = document.createElement('li');
    li.textContent = i;
    lista.appendChild(li);
  });
}

async function añadir() {
  const item = entrada.value;
  if (!item) return;
  await fetch('http://localhost:3000/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item })
  });
  entrada.value = '';
  cargar();
}

cargar();
