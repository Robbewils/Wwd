const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const registerForm = document.getElementById('register-form');
const registerMessage = document.getElementById('register-message');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(loginForm))),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return location.replace(data.next === '/admin' ? '/admin' : '/user');
    loginError.textContent = res.status === 429 ? 'Te veel pogingen, probeer het later opnieuw.' : data.error || 'Er ging iets mis.';
  } catch {
    loginError.textContent = 'Geen verbinding met de server.';
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  registerMessage.textContent = '';
  registerMessage.classList.remove('is-success');
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(registerForm))),
    });
    if (response.ok) {
      const username = new FormData(registerForm).get('username');
      registerForm.reset();
      loginForm.elements.username.value = username;
      registerMessage.textContent = 'Account aangemaakt. Je kunt nu inloggen.';
      registerMessage.classList.add('is-success');
      loginForm.elements.password.focus();
      return;
    }
    const data = await response.json().catch(() => ({}));
    registerMessage.textContent = response.status === 429
      ? 'Te veel pogingen, probeer het later opnieuw.'
      : data.error || 'Account kon niet worden aangemaakt.';
  } catch {
    registerMessage.textContent = 'Geen verbinding met de server.';
  }
});
