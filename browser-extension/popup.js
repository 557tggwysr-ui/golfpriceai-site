var email = document.getElementById('email'), auto = document.getElementById('auto'), saved = document.getElementById('saved');
chrome.storage.local.get(['email', 'auto']).then(function (s) { email.value = s.email || ''; auto.checked = s.auto !== false; });
function done() { saved.textContent = 'Saved'; setTimeout(function () { saved.textContent = ''; }, 1500); }
email.addEventListener('change', function () {
  var v = email.value.trim();
  if (v && !email.checkValidity()) { saved.textContent = 'That email doesn’t look right.'; return; }
  chrome.storage.local.set({ email: v }).then(done);
});
auto.addEventListener('change', function () { chrome.storage.local.set({ auto: auto.checked }).then(done); });
