document.querySelector('#access-form').addEventListener('submit', async e => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  document.querySelector('.login-error').textContent = '';
  try {
    const response = await fetch('/api/access/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: document.querySelector('#password').value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось войти. Попробуйте позже.');
    location.replace('/');
  } catch (error) {
    document.querySelector('.login-error').textContent = error.message;
    button.disabled = false;
  }
});
