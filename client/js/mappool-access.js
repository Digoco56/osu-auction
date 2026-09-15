const publicMappoolLink = document.getElementById('public-mappool-link');

fetch('/api/mappool-access')
  .then(response => response.ok ? response.json() : Promise.reject())
  .then(({ publicAccessEnabled }) => {
    publicMappoolLink.hidden = !publicAccessEnabled;
  })
  .catch(error => {
    console.error('Error checking mappool access:', error);
    publicMappoolLink.hidden = true;
  });
