const dashboardPageButtons = document.querySelectorAll('[data-user-dashboard-page]');
const dashboardViews = document.querySelectorAll('[data-user-dashboard-view]');
const serviceTypeLabels = {
  new_site_basic: 'Nieuwe website (basis)',
  new_site_premium: 'Nieuwe website (premium)',
  new_site_max: 'Nieuwe website (max)',
  maintenance: 'Onderhoud',
  other: 'Anders',
};

async function loadWelcomeTitle() {
  const title = document.getElementById('user-welcome-title');
  if (!title) return;

  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Gebruikersgegevens ophalen mislukt (${response.status}).`);
    const data = await response.json();
    if (typeof data.username === 'string' && data.username.trim()) {
      title.textContent = `Welkom ${data.username.trim()}`;
    }
  } catch (error) {
    console.error('De welkomsttitel kon niet worden geladen.', error);
  }
}

loadWelcomeTitle();

const logoutButton = document.getElementById('logout-button');
logoutButton?.addEventListener('click', async () => {
  logoutButton.disabled = true;
  logoutButton.textContent = 'Bezig…';
  try {
    const response = await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(`Uitloggen mislukt (${response.status}).`);
    window.location.replace('/');
  } catch (error) {
    console.error('Uitloggen is niet gelukt.', error);
    logoutButton.disabled = false;
    logoutButton.textContent = 'Uitloggen';
    window.alert('Uitloggen is niet gelukt. Probeer het opnieuw.');
  }
});

function switchDashboardPage(page) {
  dashboardPageButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.userDashboardPage === page));
  });
  dashboardViews.forEach((view) => {
    view.hidden = view.dataset.userDashboardView !== page;
  });
}

dashboardPageButtons.forEach((button) => {
  button.addEventListener('click', () => switchDashboardPage(button.dataset.userDashboardPage));
});

const accountPasswordForm = document.getElementById('account-password-form');
accountPasswordForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const currentPassword = accountPasswordForm.elements.namedItem('currentPassword').value;
  const newPassword = accountPasswordForm.elements.namedItem('newPassword').value;
  const confirmPassword = accountPasswordForm.elements.namedItem('confirmPassword').value;
  const submitButton = accountPasswordForm.querySelector('button[type="submit"]');

  if (newPassword !== confirmPassword) {
    setFeedback('account-password-message', 'De nieuwe wachtwoorden komen niet overeen.', 'error');
    return;
  }

  submitButton.disabled = true;
  setFeedback('account-password-message', 'Wachtwoord wordt aangepast…');
  try {
    const response = await fetch('/api/account/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Het wachtwoord kon niet worden aangepast.');

    accountPasswordForm.reset();
    setFeedback('account-password-message', 'Je wachtwoord is aangepast. Andere sessies zijn afgemeld.', 'success');
  } catch (error) {
    setFeedback('account-password-message', error.message || 'Geen verbinding met de server.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelectorAll('[data-user-page-link]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    switchDashboardPage(link.dataset.userPageLink);
  });
});

function isValidAccountEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function updateRequestEmailGate(email, emailVerified) {
  const gate = document.getElementById('user-request-email-gate');
  const gateMessage = document.getElementById('user-request-email-gate-message');
  const requestCard = document.getElementById('user-new-request-card');
  if (!gate || !requestCard) return;

  const emailIsVerified = emailVerified === true && isValidAccountEmail(email);
  gate.hidden = emailIsVerified;
  requestCard.hidden = !emailIsVerified;
  if (!emailIsVerified && gateMessage) {
    gateMessage.textContent = 'Bevestig je e-mailadres bij Instellingen voordat je een aanvraag verstuurt.';
  }
}

async function loadAccountProfile() {
  const emailInput = document.getElementById('account-email');
  const gateMessage = document.getElementById('user-request-email-gate-message');
  const verificationForm = document.getElementById('account-email-verification-form');
  if (!emailInput) return;

  try {
    const response = await fetch('/api/user/profile', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Accountgegevens konden niet worden geladen.');
    emailInput.value = data.pendingEmail || data.email || '';
    updateRequestEmailGate(data.email, data.emailVerified);
    if (verificationForm) verificationForm.hidden = !data.pendingEmail;
    if (data.pendingEmail) {
      setFeedback('account-email-message', `Er is een code gestuurd naar ${data.pendingEmail}.`);
    } else if (data.emailVerified) {
      setFeedback('account-email-message', 'Je e-mailadres is bevestigd.', 'success');
    } else {
      setFeedback('account-email-message', 'Vul je e-mailadres in om een verificatiecode te ontvangen.');
    }
  } catch (error) {
    console.error('Accountgegevens konden niet worden geladen.', error);
    if (gateMessage) gateMessage.textContent = 'Je accountgegevens konden niet worden geladen. Probeer je e-mailadres bij Instellingen op te slaan.';
  }
}

const accountEmailForm = document.getElementById('account-email-form');
accountEmailForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const emailInput = accountEmailForm.elements.namedItem('email');
  const submitButton = accountEmailForm.querySelector('button[type="submit"]');
  const email = emailInput.value.trim();
  if (!emailInput.checkValidity()) {
    emailInput.reportValidity();
    return;
  }

  submitButton.disabled = true;
  setFeedback('account-email-message', 'E-mailadres wordt opgeslagen…');
  try {
    const response = await fetch('/api/user/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Het e-mailadres kon niet worden opgeslagen.');

    const pendingEmail = data.pendingEmail || '';
    emailInput.value = pendingEmail || data.email || email;
    updateRequestEmailGate(data.email, data.emailVerified);
    if (pendingEmail) {
      document.getElementById('account-email-code').value = '';
      document.getElementById('account-email-verification-form').hidden = false;
      setFeedback('account-email-message', `We hebben een verificatiecode gestuurd naar ${pendingEmail}.`);
    } else if (data.emailVerified) {
      document.getElementById('account-email-verification-form').hidden = true;
      setFeedback('account-email-message', 'Je e-mailadres is al bevestigd.', 'success');
    }
  } catch (error) {
    setFeedback('account-email-message', error.message || 'Geen verbinding met de server.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

const accountEmailVerificationForm = document.getElementById('account-email-verification-form');
accountEmailVerificationForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const codeInput = accountEmailVerificationForm.elements.namedItem('code');
  const submitButton = accountEmailVerificationForm.querySelector('button[type="submit"]');
  const code = codeInput.value.trim();
  if (!codeInput.checkValidity()) {
    codeInput.reportValidity();
    return;
  }

  submitButton.disabled = true;
  setFeedback('account-email-verification-message', 'Code controleren…');
  try {
    const response = await fetch('/api/user/profile/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Het e-mailadres kon niet worden bevestigd.');

    document.getElementById('account-email').value = data.email;
    accountEmailVerificationForm.reset();
    accountEmailVerificationForm.hidden = true;
    updateRequestEmailGate(data.email, data.emailVerified);
    setFeedback('account-email-message', 'Je e-mailadres is bevestigd. Je kunt nu aanvragen versturen.', 'success');
    setFeedback('account-email-verification-message', '');
  } catch (error) {
    setFeedback('account-email-verification-message', error.message || 'Geen verbinding met de server.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createItemAction(label, isDelete, ariaLabel, onClick) {
  const button = createTextElement('button', `user-item-action${isDelete ? ' delete' : ''}`, label);
  button.type = 'button';
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', onClick);
  return button;
}

function formatDate(value) {
  if (value === null || value === undefined || value === '') return 'Datum onbekend';

  const numericValue = Number(value);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue < 1e12 ? numericValue * 1000 : numericValue)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Datum onbekend';
  return new Intl.DateTimeFormat('nl-BE', { dateStyle: 'medium' }).format(date);
}

function setFeedback(elementId, message, type = '') {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.textContent = message;
  element.classList.remove('success', 'error');
  if (type) element.classList.add(type);
}

async function loadUserOverview() {
  const status = document.getElementById('user-payment-overview-status');
  const list = document.getElementById('user-payment-list');
  const link = document.getElementById('user-payment-link');
  if (!status || !list || !link) return;

  try {
    const response = await fetch('/api/user/overview', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Overzicht ophalen mislukt (${response.status}).`);
    const data = await response.json();
    if (typeof data.paymentNeeded !== 'boolean' || !Array.isArray(data.pendingPayments)) {
      throw new Error('Ongeldig betalingsoverzicht ontvangen.');
    }

    const hasPaymentDue = data.paymentNeeded || data.pendingPayments.length > 0;
    status.classList.toggle('pending', hasPaymentDue);
    list.replaceChildren();
    if (hasPaymentDue) {
      const count = data.pendingPayments.length;
      status.textContent = count === 1
        ? 'Er staat nog een betaling open voor een afgeronde aanvraag.'
        : count > 1
          ? `Er staan nog ${count} betalingen open voor afgeronde aanvragen.`
          : 'Er staat nog een betaling open voor een afgeronde aanvraag.';
      data.pendingPayments.forEach((payment) => {
        list.append(createTextElement('li', '', payment.title || `Aanvraag #${payment.id}`));
      });
      list.hidden = data.pendingPayments.length === 0;
      link.hidden = false;
    } else {
      status.textContent = 'Er staan momenteel geen betalingen open.';
      list.hidden = true;
      link.hidden = true;
    }
  } catch (error) {
    console.error('Het betalingsoverzicht kon niet worden geladen.', error);
    status.classList.remove('pending');
    status.textContent = 'Je betalingsoverzicht kon niet worden geladen.';
    list.replaceChildren();
    list.hidden = true;
    link.hidden = true;
  }
}

function renderRequests(requests) {
  const list = document.getElementById('user-request-list');
  const state = document.getElementById('user-request-list-state');
  if (!list || !state) return;

  list.replaceChildren();
  list.setAttribute('aria-busy', 'false');
  if (requests.length === 0) {
    state.textContent = 'Je hebt nog geen aanvragen.';
    state.hidden = false;
    return;
  }

  const statusLabels = {
    open: { label: 'Nieuw', className: 'open' },
    in_progress: { label: 'Bezig', className: 'in-progress' },
    closed: { label: 'Klaar', className: 'closed' },
  };

  requests.forEach((request) => {
    const item = createTextElement('article', 'user-request-item', '');
    const heading = createTextElement('div', 'user-request-heading', '');
    const title = request.title?.trim() || `Aanvraag #${request.id}`;
    heading.append(createTextElement('h3', 'user-request-title', title));
    const statusInfo = statusLabels[request.status] || { label: request.status || 'Onbekend', className: '' };
    heading.append(createTextElement('span', `user-request-status ${statusInfo.className}`.trim(), statusInfo.label));
    const actions = createTextElement('div', 'user-item-actions', '');
    actions.append(createItemAction('Bewerken', false, `Aanvraag ${request.id} bewerken`, () => openRequestEditor(request)));
    actions.append(createItemAction('Verwijderen', true, `Aanvraag ${request.id} verwijderen`, (event) => {
      deleteUserRecord(
        `/api/user/requests/${encodeURIComponent(request.id)}`,
        `Aanvraag “${title}” verwijderen? Deze actie kan niet ongedaan worden gemaakt.`,
        () => Promise.all([loadRequests(), loadUserOverview()]),
        event.currentTarget
      );
    }));
    heading.append(actions);
    item.append(heading);

    const meta = createTextElement('div', 'user-request-meta', '');
    meta.append(createTextElement('span', '', `Ingediend ${formatDate(request.createdAt)}`));
    meta.append(createTextElement('span', '', `Dienst: ${serviceTypeLabels[request.serviceType] || 'Onbekend'}`));
    item.append(meta);
    item.append(createTextElement('p', 'user-request-description', request.description || 'Geen beschrijving toegevoegd.'));
    const adminNote = typeof request.adminNotes === 'string' ? request.adminNotes.trim() : '';
    if (adminNote) {
      const note = createTextElement('div', 'user-request-admin-note', '');
      note.append(createTextElement('strong', 'user-request-admin-note-label', 'Notitie van de beheerder'));
      note.append(createTextElement('p', 'user-request-admin-note-text', adminNote));
      item.append(note);
    }
    list.append(item);
  });

  state.hidden = true;
}

async function loadRequests() {
  const list = document.getElementById('user-request-list');
  const state = document.getElementById('user-request-list-state');
  if (!list || !state) return;

  try {
    const response = await fetch('/api/user/requests', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Aanvragen ophalen mislukt (${response.status}).`);
    const data = await response.json();
    if (!Array.isArray(data.requests)) throw new Error('Ongeldige lijst met aanvragen ontvangen.');
    renderRequests(data.requests);
  } catch (error) {
    console.error('Aanvragen konden niet worden geladen.', error);
    list.replaceChildren();
    list.setAttribute('aria-busy', 'false');
    state.textContent = 'Je aanvragen konden niet worden geladen.';
    state.hidden = false;
  }
}

function openRequestEditor(request) {
  document.getElementById('request-edit-id').value = request.id;
  document.getElementById('request-edit-title').value = request.title?.trim() || `Aanvraag #${request.id}`;
  document.getElementById('request-edit-service-type').value = request.serviceType || 'other';
  document.getElementById('request-edit-description').value = request.description || '';
  document.getElementById('request-edit-message').textContent = '';
  const dialog = document.getElementById('request-edit-dialog');
  dialog.showModal();
  document.getElementById('request-edit-title').focus();
}

async function deleteUserRecord(url, confirmation, refresh, button) {
  if (!window.confirm(confirmation)) return;
  button.disabled = true;
  try {
    const response = await fetch(url, { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Verwijderen is mislukt.');
    await refresh();
  } catch (error) {
    window.alert(error.message || 'Verwijderen is mislukt.');
  } finally {
    button.disabled = false;
  }
}

const requestEditForm = document.getElementById('request-edit-form');
requestEditForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saveButton = document.getElementById('request-edit-save');
  const message = document.getElementById('request-edit-message');
  const requestId = document.getElementById('request-edit-id').value;
  const payload = {
    title: document.getElementById('request-edit-title').value,
    serviceType: document.getElementById('request-edit-service-type').value,
    description: document.getElementById('request-edit-description').value,
  };
  saveButton.disabled = true;
  message.textContent = 'Aanvraag opslaan…';
  try {
    const response = await fetch(`/api/user/requests/${encodeURIComponent(requestId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'De aanvraag kon niet worden opgeslagen.');
    document.getElementById('request-edit-dialog').close();
    await loadRequests();
  } catch (error) {
    message.textContent = error.message || 'De aanvraag kon niet worden opgeslagen.';
  } finally {
    saveButton.disabled = false;
  }
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog)?.close());
});

const requestForm = document.getElementById('user-request-form');
requestForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = requestForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setFeedback('user-request-feedback', 'Aanvraag wordt verstuurd…');

  try {
    const response = await fetch('/api/user/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(requestForm))),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'De aanvraag kon niet worden verstuurd.');

    requestForm.reset();
    setFeedback('user-request-feedback', 'Je aanvraag is verstuurd.', 'success');
    await loadRequests();
  } catch (error) {
    setFeedback('user-request-feedback', error.message || 'Geen verbinding met de server.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

loadRequests();
loadUserOverview();
loadAccountProfile();
